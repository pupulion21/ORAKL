/** ORAKL Predict — LOCAL selected entry point.
 *
 *  This app talks ONLY to the isolated Anvil chain (31337) through the verified
 *  SelectedMarketFactory / ProtocolConfig deployment. It reuses the frozen
 *  legacy modules (wallet session, tx tracker, formatters, platform icons,
 *  styles) by import; every local-specific behaviour lives here or under
 *  src/selected and src/local.
 *
 *  Fail-closed contract: until `verifyLocalDeployment` returns ACTIVE, the UI
 *  renders a blocking notice and performs no contract reads or writes.
 */

import '../styles.css';
import {encodeFunctionData, keccak256, toHex} from 'viem';
import {createWalletSession, discoverWallets, type WalletInfo, type WalletSession, type WalletSnapshot} from '../wallet.ts';
import {createTransactionTracker, type TxRecord} from '../transactions.ts';
import {
  addressEq,
  countdownText,
  escapeHtml,
  formatDateTime,
  formatQie,
  nowSec,
  parseQie,
  shortAddress,
} from '../format.ts';
import {icon} from '../platform.ts';
import {
  BOND_LABELS,
  MARKET_STATE_LABELS,
  OUTCOME_LABELS,
  SIDE_LABELS,
  accountingInvariant,
  encodeCancelExpiredMarket,
  encodeChallengeResult,
  encodeClaim,
  encodeClaimBond,
  encodeClaimRefund,
  encodeCreateMarket,
  encodeFinalizeResult,
  encodePredict,
  encodeProposeResult,
  encodeSettleDispute,
  encodeSubmitEvidence,
  errorMessage,
  marketIdFromReceipt,
  readAccounting,
  readBlockTimestamp,
  readBond,
  readBondEntitlement,
  readChallengeStake,
  readClaimable,
  readMarket,
  readMarkets,
  readPosition,
  verifyLocalDeployment,
  waitForReceipt,
  type Address,
  type Hex,
  type MarketRecord,
  type VerifiedDeployment,
} from '../selected/chain.ts';
import {
  EVIDENCE_KINDS,
  evidenceCommitment,
  evidenceContentHash,
  validateEvidenceManifest,
  verifyEvidenceIntegrity,
  type EvidenceKind,
  type EvidenceManifest,
} from '../selected/evidence.ts';
import { createPublicationAuth, publicationAuthMessage } from '../selected/auth.ts';
import {MANIFEST_URL, NETWORK_LABEL, LOCAL_CHAIN_ID, LOCAL_RPC_URL, LOCAL_API_URL, publicClient} from './config.ts';
import {walletErrorTextLocal} from './wallet-text.ts';
import {
  createApiClient,
  parsePoolAmount,
  type ApiClient,
  type MarketListItem,
  type MarketDetail,
  type MarketListParams,
  type SyncStatus,
  type MarketChallengesResult,
  type PortfolioDetail,
} from '../selected/api-client.ts';
import {
  parseRoute,
  stateTone,
  calculatePoolShares,
  isArbitratorOwner,
  calculateMinimumMaxResolutionTime,
  validateMarketCreationInput,
  formatResolutionCriteriaBlob,
  canonicalizeMarketMetadata,
  GOLD_BENCHMARK_PRESET,
  VALID_MARKET_CATEGORIES,
  type Route,
  type MarketMetadataManifest,
  type CreateMarketFormValues,
} from './navigation.ts';

// ---------------------------------------------------------------------- state

export interface MarketViewItem {
  id: bigint;
  title: string;
  hasMetadata: boolean;
  metadataStatus: 'verified' | 'cached' | 'unavailable';
  metadataUnavailableReason?: string;
  metadataHash?: string;
  description: string | null;
  category: string | null;
  metadataURI: string;
  statusText: string;
  statusTone: string;
  yesPool: bigint;
  noPool: bigint;
  closeTime: bigint;
  fromApi: boolean;
}

interface FilterState {
  q: string;
  category: string;
  status: string;
  sort: 'id' | 'closeTime';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

interface AppState {
  route: Route;
  deployment: VerifiedDeployment | null;
  deploymentError: string | null;
  deploymentPhase: 'checking' | 'ready' | 'failed';
  wallets: WalletInfo[];
  session: WalletSession | null;
  snapshot: WalletSnapshot;
  markets: MarketViewItem[];
  marketsLoading: boolean;
  marketsError: string | null;
  totalMarkets: number;
  filters: FilterState;
  syncStatus: SyncStatus;
  syncLag: string | null;
  syncBlock: string | null;
  chainTime: bigint | null;
  flash: {kind: 'ok' | 'err'; text: string} | null;
  busy: boolean;
  multisigNotice: string | null;
  mode: 'api' | 'rpc';
  createWizardStep: number;
}

const apiClient: ApiClient = createApiClient({
  baseUrl: LOCAL_API_URL,
  chainId: LOCAL_CHAIN_ID,
});

let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

const state: AppState = {
  route: {name: 'list'},
  deployment: null,
  deploymentError: null,
  deploymentPhase: 'checking',
  wallets: [],
  session: null,
  snapshot: {phase: 'disconnected', account: null, chainId: null, error: null, info: null},
  markets: [],
  marketsLoading: false,
  marketsError: null,
  totalMarkets: 0,
  filters: {
    q: '',
    category: 'all',
    status: 'all',
    sort: 'id',
    order: 'desc',
    page: 1,
    pageSize: 12,
  },
  syncStatus: 'INITIALIZING',
  syncLag: null,
  syncBlock: null,
  chainTime: null,
  flash: null,
  busy: false,
  multisigNotice: null,
  mode: 'api',
  createWizardStep: 1,
};

// ------------------------------------------------------------- manifest cache

const MANIFEST_CACHE_KEY = 'orakl_market_manifests_v1';

export function saveLocalManifest(manifest: MarketMetadataManifest, hashOrUri?: string): void {
  try {
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    const store: Record<string, MarketMetadataManifest> = raw ? JSON.parse(raw) : {};
    if (hashOrUri) {
      store[hashOrUri.toLowerCase()] = manifest;
    }
    try {
      const canonical = canonicalizeMarketMetadata(manifest);
      const computedHash = keccak256(toHex(canonical));
      store[computedHash.toLowerCase()] = manifest;
    } catch {}
    localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[ORAKL] Failed to cache local manifest in localStorage:', e);
  }
}

export function getLocalManifest(hashOrUri?: string | null): MarketMetadataManifest | null {
  if (!hashOrUri) return null;
  try {
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const store: Record<string, MarketMetadataManifest> = JSON.parse(raw);
    const key = hashOrUri.toLowerCase();
    return store[key] || null;
  } catch {
    return null;
  }
}

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('#app root is missing');
const app: HTMLElement = appRoot;

const tracker = createTransactionTracker({
  waitForReceipt: async (hash: string) => waitForReceipt(publicClient, hash as Hex),
  getReceipt: async (hash: string) => publicClient.getTransactionReceipt({hash: hash as Hex}),
  errorText: (error: unknown) => errorMessage(error),
  onChange: () => renderTxPanel(),
  onError: (message: string) => {
    state.flash = {kind: 'err', text: message};
    renderFlash();
  },
});

// -------------------------------------------------------------------- helpers

function connectedAccount(): Address | null {
  return state.snapshot.phase === 'ready' && state.snapshot.account ? (state.snapshot.account as Address) : null;
}

function requireDeployment(): VerifiedDeployment {
  if (!state.deployment) throw new Error('The local deployment is not verified yet.');
  return state.deployment;
}

function flash(kind: 'ok' | 'err', text: string): void {
  state.flash = {kind, text};
  renderFlash();
}

// ---------------------------------------------------------------- boot / load

async function boot(): Promise<void> {
  render();
  state.wallets = await discoverWallets();

  try {
    const check = await verifyLocalDeployment(publicClient, MANIFEST_URL);
    if (check.kind === 'ACTIVE') {
      state.deployment = check.deployment;
      state.deploymentPhase = 'ready';
    } else {
      state.deploymentPhase = 'failed';
      state.deploymentError =
        check.kind === 'NOT_DEPLOYED'
          ? 'No local deployment manifest. Run scripts/p1/deploy-local-selected.mjs first.'
          : check.reason;
    }
  } catch (error) {
    state.deploymentPhase = 'failed';
    state.deploymentError = errorMessage(error);
  }

  if (state.deployment) {
    await refreshChainTime();
    await loadMarkets();
  }
  render();
}

async function refreshChainTime(): Promise<void> {
  try {
    state.chainTime = await readBlockTimestamp(publicClient);
  } catch {
    state.chainTime = null;
  }
}

function chainNow(): number {
  return state.chainTime ? Number(state.chainTime) : nowSec();
}

export function apiItemToView(item: MarketListItem): MarketViewItem {
  const tone =
    item.status === 'OPEN'
      ? 'open'
      : item.status === 'CLOSED'
        ? 'wait'
        : item.status === 'FINALIZED'
          ? 'done'
          : 'expired';

  const hasApiQuestion = Boolean(item.question && item.question.trim().length > 0);
  let title = hasApiQuestion ? item.question.trim() : '';
  let description = item.description || null;
  let category = item.category || null;
  let hasMetadata = hasApiQuestion;
  let metadataStatus: 'verified' | 'cached' | 'unavailable' = hasApiQuestion ? 'verified' : 'unavailable';
  let metadataUnavailableReason: string | undefined = undefined;

  if (!hasApiQuestion) {
    const cached = getLocalManifest(item.metadataURI);
    if (cached) {
      title = cached.question;
      description = cached.description || null;
      category = cached.category || null;
      hasMetadata = true;
      metadataStatus = 'cached';
    } else {
      title = 'Market metadata unavailable';
      hasMetadata = false;
      metadataStatus = 'unavailable';
      metadataUnavailableReason =
        'Off-chain question manifest is not available via indexer or local storage for this market. On-chain state and ID are preserved.';
    }
  }

  return {
    id: BigInt(item.id),
    title,
    hasMetadata,
    metadataStatus,
    metadataUnavailableReason,
    metadataHash: undefined,
    description,
    category,
    metadataURI: item.metadataURI,
    statusText: item.status,
    statusTone: tone,
    yesPool: parsePoolAmount(item.yesPool),
    noPool: parsePoolAmount(item.noPool),
    closeTime: BigInt(item.closeTime || '0'),
    fromApi: true,
  };
}

export function rpcRecordToView(m: MarketRecord): MarketViewItem {
  const now = chainNow();
  const effectiveState = (m.storedState === 0 && now >= Number(m.closeTime)) ? 1 : m.storedState;
  const label = MARKET_STATE_LABELS[effectiveState] ?? 'UNKNOWN';

  // Check local manifest cache by metadataHash or metadataURI
  const cached = getLocalManifest(m.metadataHash) || getLocalManifest(m.metadataURI);
  let title = 'Market metadata unavailable';
  let description: string | null = null;
  let category: string | null = null;
  let hasMetadata = false;
  let metadataStatus: 'verified' | 'cached' | 'unavailable' = 'unavailable';
  let metadataUnavailableReason: string | undefined =
    'Direct RPC mode cannot recover off-chain IPFS metadata without an active indexer or local manifest cache.';

  if (cached) {
    try {
      const canonical = canonicalizeMarketMetadata(cached);
      const computedHash = keccak256(toHex(canonical));
      if (computedHash.toLowerCase() === m.metadataHash.toLowerCase()) {
        title = cached.question;
        description = cached.description || null;
        category = cached.category || null;
        hasMetadata = true;
        metadataStatus = 'cached';
        metadataUnavailableReason = undefined;
      }
    } catch {
      // verification failed
    }
  }

  return {
    id: m.id,
    title,
    hasMetadata,
    metadataStatus,
    metadataUnavailableReason,
    metadataHash: m.metadataHash,
    description,
    category,
    metadataURI: m.metadataURI,
    statusText: label,
    statusTone: stateTone(effectiveState),
    yesPool: m.yesPool,
    noPool: m.noPool,
    closeTime: m.closeTime,
    fromApi: false,
  };
}

async function loadMarkets(): Promise<void> {
  const deployment = state.deployment;
  if (!deployment) return;
  state.marketsLoading = true;
  state.marketsError = null;
  renderMarkets();

  try {
    const params: MarketListParams = {
      page: state.filters.page,
      pageSize: state.filters.pageSize,
      sort: state.filters.sort,
      order: state.filters.order,
    };
    if (state.filters.q.trim()) params.q = state.filters.q.trim();
    if (state.filters.category && state.filters.category !== 'all') params.category = state.filters.category;
    if (state.filters.status && state.filters.status !== 'all') params.status = state.filters.status;

    const res = await apiClient.getMarkets(params);
    state.markets = res.data.items.map(apiItemToView);
    state.totalMarkets = res.data.total;
    state.mode = 'api';
    if (res.sync) {
      state.syncStatus = res.sync.status;
      state.syncLag = res.sync.lag;
      state.syncBlock = res.sync.lastProcessedBlock;
    }
  } catch (apiErr: unknown) {
    console.warn('[ORAKL] API request failed, falling back to direct RPC:', apiErr);
    try {
      const records = await readMarkets(publicClient, deployment.factory, 0, 24);
      let views = records.map(rpcRecordToView);
      if (state.filters.status && state.filters.status !== 'all') {
        views = views.filter((v) => v.statusText.toUpperCase() === state.filters.status.toUpperCase());
      }
      if (state.filters.q.trim()) {
        const query = state.filters.q.toLowerCase().trim();
        views = views.filter((v) => v.title.toLowerCase().includes(query));
      }
      state.markets = views;
      state.totalMarkets = views.length;
      state.mode = 'rpc';
      state.syncStatus = 'UNAVAILABLE';
      state.syncLag = null;
      state.syncBlock = null;
    } catch (rpcErr: unknown) {
      state.marketsError = errorMessage(rpcErr);
    }
  } finally {
    state.marketsLoading = false;
    renderMarkets();
    renderHeader();
  }
}

// -------------------------------------------------------------------- wallet

async function connectWallet(uuid: string): Promise<void> {
  const info = state.wallets.find((wallet) => wallet.uuid === uuid);
  if (!info) return;
  state.session?.dispose();
  state.session = createWalletSession(info, LOCAL_CHAIN_ID, (snapshot) => {
    state.snapshot = snapshot;
    render();
  });
  await state.session.connect(info, LOCAL_CHAIN_ID);
  renderWallet();
  renderHeader();
  if (state.snapshot.phase === 'ready') {
    flash('ok', `Connected on ${NETWORK_LABEL}.`);
  } else if (state.snapshot.error) {
    flash('err', walletErrorTextLocal(state.snapshot.error));
  }
}

function disconnectWallet(): void {
  state.session?.dispose();
  state.session = null;
  state.snapshot = {phase: 'disconnected', account: null, chainId: null, error: null, info: null};
  renderWallet();
  renderHeader();
}

async function sendWrite(label: string, data: Hex, value: bigint, onMined: (receipt: Awaited<ReturnType<typeof waitForReceipt>>) => Promise<void>): Promise<void> {
  const session = state.session;
  const account = connectedAccount();
  if (!session || !account) {
    flash('err', 'Connect a wallet on the local chain first.');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  renderActionButtons();
  try {
    const deployment = requireDeployment();
    const hash = await session.sendTransaction({to: deployment.factory, data, value});
    tracker.add(hash, label, onMined);
    await tracker.watch(hash);
  } catch (error) {
    flash('err', errorMessage(error));
  } finally {
    state.busy = false;
    renderActionButtons();
  }
}

/** Send a call through the arbitrator LocalRoleMock. Threshold is 2, so the
 *  first owner records a confirmation and the second executes. The UI detects
 *  execution by the mock nonce advancing. */
async function sendMultisig(label: string, data: Hex, value: bigint, onMined: (receipt: Awaited<ReturnType<typeof waitForReceipt>>) => Promise<void>): Promise<void> {
  const session = state.session;
  const account = connectedAccount();
  const deployment = state.deployment;
  if (!session || !account || !deployment) {
    flash('err', 'Connect a wallet on the local chain first.');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  state.multisigNotice = null;
  renderActionButtons();
  try {
    const mock = deployment.manifest.roleMocks.arbitrator.address as Address;
    const nonceBefore = (await publicClient.readContract({
      address: mock,
      abi: [
        {type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256', name: ''}]},
      ],
      functionName: 'nonce',
    })) as bigint;
    const executeData = encodeMockExecute(deployment.factory, data);
    const hash = await session.sendTransaction({to: mock, data: executeData, value});
    tracker.add(hash, label, onMined);
    await tracker.watch(hash);
    const nonceAfter = (await publicClient.readContract({
      address: mock,
      abi: [
        {type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256', name: ''}]},
      ],
      functionName: 'nonce',
    })) as bigint;    if (nonceAfter === nonceBefore) {
      const owners = deployment.manifest.roleMocks.arbitrator.owners;
      const other = owners.find((owner: string) => !addressEq(owner, account));
      state.multisigNotice =
        `Confirmation recorded (1 of ${deployment.manifest.roleMocks.arbitrator.threshold}). ` +
        `The call executes when ${other ? shortAddress(other) : 'the other owner'} confirms it from their wallet.`;
      flash('ok', 'First confirmation recorded. Nothing executed on-chain yet.');
    } else {
      state.multisigNotice = null;
    }
  } catch (error) {
    flash('err', errorMessage(error));
  } finally {
    state.busy = false;
    renderActionButtons();
  }
}

const MOCK_EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {name: 'target', type: 'address'},
      {name: 'data', type: 'bytes'},
    ],
    outputs: [{name: 'result', type: 'bytes'}],
  },
] as const;

function encodeMockExecute(target: Address, data: Hex): Hex {
  return encodeFunctionData({abi: MOCK_EXECUTE_ABI, functionName: 'execute', args: [target, data]});
}

// --------------------------------------------------------------- lifecycle io

function renderActionButtons(): void {
  // Re-render the current route in place (button disabled/busy states).
  renderRoute();
}

async function refreshAfterWrite(): Promise<void> {
  await refreshChainTime();
  await loadMarkets();
  renderRoute();
}

async function actPredict(id: bigint, side: 0 | 1): Promise<void> {
  const deployment = requireDeployment();
  const value = deployment.parameters.minContribution;
  await sendWrite(
    `Predict ${SIDE_LABELS[side]} on market #${id}`,
    encodePredict(id, side),
    value,
    async () => {
      flash('ok', `Prediction recorded on the local chain.`);
      await refreshAfterWrite();
    },
  );
}

async function actPredictCustom(id: bigint, side: 0 | 1, amountText: string): Promise<void> {
  const deployment = requireDeployment();
  let amount: bigint;
  try {
    amount = parseQie(amountText);
  } catch (error) {
    flash('err', errorMessage(error));
    return;
  }
  if (amount < deployment.parameters.minContribution) {
    flash('err', `Minimum contribution is ${formatQie(deployment.parameters.minContribution)} ETH.`);
    return;
  }
  await sendWrite(`Predict ${SIDE_LABELS[side]} on market #${id}`, encodePredict(id, side), amount, async () => {
    flash('ok', 'Prediction recorded on the local chain.');
    await refreshAfterWrite();
  });
}

async function actPropose(id: bigint, outcome: 1 | 2 | 3, evidenceHash: Hex): Promise<void> {
  const deployment = requireDeployment();
  if (evidenceHash === ('0x' + '0'.repeat(64) as Hex)) {
    flash('err', 'A proposal needs a non-zero evidence hash. Build one on the Evidence page.');
    return;
  }
  await sendWrite(
    `Propose ${OUTCOME_LABELS[outcome]} on market #${id}`,
    encodeProposeResult(id, outcome, evidenceHash),
    deployment.parameters.proposalBond,
    async () => {
      flash('ok', 'Result proposed. The challenge window is now open.');
      await refreshAfterWrite();
    },
  );
}

async function actChallenge(id: bigint, evidenceHash: Hex): Promise<void> {
  const deployment = requireDeployment();
  if (evidenceHash === ('0x' + '0'.repeat(64) as Hex)) {
    flash('err', 'A challenge needs a non-zero evidence hash. Build one on the Evidence page.');
    return;
  }
  await sendWrite(
    `Challenge result on market #${id}`,
    encodeChallengeResult(id, evidenceHash),
    deployment.parameters.challengeBond,
    async () => {
      flash('ok', 'Challenge accepted. The dispute goes to the arbitrator.');
      await refreshAfterWrite();
    },
  );
}

async function actSubmitEvidence(id: bigint, evidenceHash: Hex): Promise<void> {
  if (evidenceHash === ('0x' + '0'.repeat(64) as Hex)) {
    flash('err', 'An evidence hash is required.');
    return;
  }
  await sendWrite(`Submit evidence on market #${id}`, encodeSubmitEvidence(id, evidenceHash), 0n, async () => {
    flash('ok', 'Evidence commitment recorded on-chain.');
    await refreshAfterWrite();
  });
}

async function actSettle(id: bigint, decision: 1 | 2 | 3, evidenceHash: Hex): Promise<void> {
  if (evidenceHash === ('0x' + '0'.repeat(64) as Hex)) {
    flash('err', 'A decision evidence hash is required.');
    return;
  }
  await sendMultisig(
    `Arbitrator decision ${OUTCOME_LABELS[decision]} on market #${id}`,
    encodeSettleDispute(id, decision, evidenceHash),
    0n,
    async () => {
      flash('ok', 'Arbitrator decision executed.');
      await refreshAfterWrite();
    },
  );
}

async function actFinalize(id: bigint): Promise<void> {
  await sendWrite(`Finalize market #${id}`, encodeFinalizeResult(id), 0n, async () => {
    flash('ok', 'Market finalized. Winning stakes are claimable.');
    await refreshAfterWrite();
  });
}

async function actClaim(id: bigint): Promise<void> {
  await sendWrite(`Claim reward on market #${id}`, encodeClaim(id), 0n, async () => {
    flash('ok', 'Reward claimed.');
    await refreshAfterWrite();
  });
}

async function actClaimRefund(id: bigint): Promise<void> {
  await sendWrite(`Claim refund on market #${id}`, encodeClaimRefund(id), 0n, async () => {
    flash('ok', 'Refund claimed.');
    await refreshAfterWrite();
  });
}

async function actClaimBond(id: bigint, bondType: 0 | 1 | 2, recipient?: Address): Promise<void> {
  const account = connectedAccount();
  if (!account) return;
  const targetRecipient = recipient && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? (recipient.toLowerCase() as Address) : account;
  await sendWrite(`Claim ${BOND_LABELS[bondType]} bond on market #${id}`, encodeClaimBond(id, bondType, targetRecipient), 0n, async () => {
    flash('ok', `${BOND_LABELS[bondType]} bond claimed.`);
    await refreshAfterWrite();
  });
}

async function actCancelExpired(id: bigint): Promise<void> {
  await sendWrite(`Cancel expired market #${id}`, encodeCancelExpiredMarket(id), 0n, async () => {
    flash('ok', 'Market cancelled. Stakes are refundable.');
    await refreshAfterWrite();
  });
}

async function actCreateMarket(form: HTMLFormElement): Promise<void> {
  await refreshChainTime();
  const deployment = requireDeployment();
  const account = connectedAccount();
  if (!account) {
    flash('err', 'Connect a wallet on the local chain first.');
    return;
  }
  const data = new FormData(form);
  const question = String(data.get('question') ?? '').trim();
  const category = String(data.get('category') ?? '').trim();
  const description = String(data.get('description') ?? '').trim();
  const primarySource = String(data.get('primarySource') ?? '').trim();
  const fallbackSource = String(data.get('fallbackSource') ?? '').trim();
  const yesCriteria = String(data.get('yesCriteria') ?? '').trim();
  const noCriteria = String(data.get('noCriteria') ?? '').trim();
  const invalidCriteria = String(data.get('invalidCriteria') ?? '').trim();

  const closeInput = String(data.get('closeTime') ?? '');
  const resolutionInput = String(data.get('resolutionTime') ?? '');
  const maxInput = String(data.get('maxResolutionTime') ?? '');

  const closeTime = BigInt(Math.floor(new Date(closeInput).getTime() / 1000));
  const resolutionTime = BigInt(Math.floor(new Date(resolutionInput).getTime() / 1000));
  const maxResolutionTime = BigInt(Math.floor(new Date(maxInput).getTime() / 1000));
  const now = BigInt(chainNow());

  const formValues: CreateMarketFormValues = {
    question,
    category,
    description,
    primarySource,
    fallbackSource,
    yesCriteria,
    noCriteria,
    invalidCriteria,
    closeTimeSec: closeTime,
    resolutionTimeSec: resolutionTime,
    maxResolutionTimeSec: maxResolutionTime,
    nowSec: now,
    challengePeriodSec: deployment.parameters.challengePeriod,
    arbitrationPeriodSec: deployment.parameters.arbitrationPeriod,
  };

  const validation = validateMarketCreationInput(formValues);
  const errorContainer = document.getElementById('create-validation-errors');
  if (!validation.ok) {
    if (errorContainer) {
      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `<strong>Creation Validation Failed:</strong><ul style="margin:6px 0 0;padding-left:18px;">${validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    }
    flash('err', validation.errors[0] || 'Please fix the errors in the market creation form.');
    return;
  }
  if (errorContainer) {
    errorContainer.style.display = 'none';
  }

  const confirmCheckbox = form.querySelector<HTMLInputElement>('#confirm-immutability');
  if (!confirmCheckbox?.checked) {
    flash('err', 'You must confirm that the market rules and timeline are permanent and immutable.');
    return;
  }

  const statusText = document.getElementById('publication-status-text');
  const statusDetails = document.getElementById('publication-details');

  if (statusText) {
    statusText.textContent = 'Generating RFC 8785 canonical metadata manifest...';
  }

  // Compile full criteria blob
  const resolutionCriteria = formatResolutionCriteriaBlob({
    yes: yesCriteria,
    no: noCriteria,
    invalid: invalidCriteria,
    fallback: fallbackSource,
  });

  const sources = fallbackSource ? [primarySource, fallbackSource] : [primarySource];

  const manifest: MarketMetadataManifest = {
    schema: 'orakl-market-metadata-v1',
    chainId: String(LOCAL_CHAIN_ID),
    factory: deployment.factory.toLowerCase(),
    question,
    description: description || question,
    category,
    resolutionCriteria,
    sources,
    creator: account.toLowerCase(),
    createdAt: String(chainNow()),
  };

  const canonicalString = canonicalizeMarketMetadata(manifest);
  const metadataHash = evidenceContentHash(canonicalString) as Hex;
  let metadataURI = `ipfs://orakl-local-artifact/${metadataHash.slice(2)}`;

  // Save to local cache immediately to ensure deterministic client-side recovery
  saveLocalManifest(manifest, metadataHash);
  saveLocalManifest(manifest, metadataURI);

  if (statusText) {
    statusText.textContent = 'Publishing metadata artifact to local node discovery channel...';
  }

  try {
    const auth = createPublicationAuth({
      action: 'metadata',
      chainId: LOCAL_CHAIN_ID,
      factory: deployment.factory,
      publisher: account,
      commitment: metadataHash,
    });
    let signature: string | undefined;
    if (state.session) {
      const msg = publicationAuthMessage(auth);
      const msgHex = `0x${Array.from(new TextEncoder().encode(msg)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      try {
        signature = await state.session.request<string>('personal_sign', [msgHex, account]);
      } catch {
        // Fallback for local testing
      }
    }
    const pubRes = await apiClient.publishMetadata({
      metadata: manifest,
      auth,
      signature,
    });
    if (pubRes.data.uri) {
      metadataURI = pubRes.data.uri;
      saveLocalManifest(manifest, metadataURI);
    }
    if (statusDetails) {
      statusDetails.style.display = 'block';
      statusDetails.innerHTML = `Published to Node · Commitment: <code class="mono">${escapeHtml(metadataHash)}</code><br/>URI: <code class="mono">${escapeHtml(metadataURI)}</code>`;
    }
  } catch (err) {
    console.warn('Local API node metadata publication offline, using deterministic artifact URI:', err);
    if (statusDetails) {
      statusDetails.style.display = 'block';
      statusDetails.innerHTML = `Local API offline (using verified deterministic hash) · Commitment: <code class="mono">${escapeHtml(metadataHash)}</code><br/>URI: <code class="mono">${escapeHtml(metadataURI)}</code>`;
    }
  }

  if (statusText) {
    statusText.textContent = `Submitting on-chain createMarket transaction (${formatQie(deployment.parameters.creationBond)} ETH bond)...`;
  }

  await sendWrite(
    'Create market',
    encodeCreateMarket({metadataHash, metadataURI, closeTime, resolutionTime, maxResolutionTime}),
    deployment.parameters.creationBond,
    async (receipt) => {
      const id = marketIdFromReceipt(receipt, deployment.factory);
      flash('ok', id !== null ? `Market #${id} created.` : 'Market created.');
      await refreshAfterWrite();
      if (id !== null) location.hash = `#/market/${id}`;
    },
  );
}

// -------------------------------------------------------------------- render

function render(): void {
  app.innerHTML = shellHtml();
  renderHeader();
  renderWallet();
  renderFlash();
  renderTxPanel();
  renderRoute();
}

function shellHtml(): string {
  const navItem = (href: string, label: string, glyph: string, active: boolean) =>
    `<a href="${href}" class="${active ? 'active' : ''}">${icon(glyph, 20)}<span>${label}</span></a>`;
  const route = state.route;
  const listActive = route.name === 'list' || route.name === 'market';
  const arbActive = route.name === 'arbitration' || route.name === 'arbitration-case';
  return `
    <a href="#view" class="skip-link">Skip to content</a>
    <aside class="sidebar">
      <a class="brand" href="#/" aria-label="ORAKL home">
        <span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 23a11 11 0 1 0-7 3h12l-7-7"/><path d="m10 18 5-6 4 3 5-7"/></svg></span>
        <span class="brand-text">ORAKL<small style="display:block;font-size:9px;letter-spacing:0.06em;color:var(--text-muted);font-weight:500;margin-top:-2px;">POWERED BY QIE</small></span>
      </a>
      <div class="workspace-label">WORKSPACE <span>LOCAL</span></div>
      <nav class="sidebar-primary nav" aria-label="Main navigation">
        ${navItem('#/', 'Markets', 'grid', listActive)}
        ${navItem('#/arbitration?filter=disputed', 'Disputes', 'shield', arbActive)}
        ${navItem('#/create', 'Create market', 'plus', route.name === 'create')}
        ${navItem('#/portfolio', 'Portfolio', 'wallet', route.name === 'portfolio')}
        ${navItem('#/evidence', 'Evidence lab', 'search', route.name === 'evidence')}
        ${navItem('#/status', 'Protocol status', 'settings', route.name === 'status')}
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-network"><span class="status-dot ${state.deploymentPhase === 'ready' ? 'connected' : ''}"></span><span>${NETWORK_LABEL}<small>${state.deploymentPhase === 'ready' ? 'Deployment verified' : state.deploymentPhase === 'checking' ? 'Verifying deployment…' : 'Deployment unavailable'}</small></span></div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <a class="brand mobile-brand" href="#/" aria-label="ORAKL home"><span class="brand-text">ORAKL</span></a>
        <div class="header-actions"><span class="network-pill"><span class="status-dot ${state.deploymentPhase === 'ready' ? 'connected' : ''}"></span> ${NETWORK_LABEL} · ${LOCAL_CHAIN_ID}</span><div class="wallet-panel" id="wallet-panel"></div></div>
      </header>
      <div class="shell">
        <div id="flash"></div>
        <main id="view" class="view" tabindex="-1"></main>
        <div id="tx-panel"></div>
        <footer class="footer"><div><span class="footer-wordmark">ORAKL</span><span>Prediction Oracle Protocol · Local Simulation (Anvil 31337)</span></div><div class="footer-links"><a href="#/status">Protocol status</a><span class="testnet-label">LOCAL · ${LOCAL_CHAIN_ID}</span></div></footer>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      ${navItem('#/', 'Markets', 'grid', listActive)}
      ${navItem('#/arbitration?filter=disputed', 'Disputes', 'shield', arbActive)}
      ${navItem('#/create', 'Create', 'plus', route.name === 'create')}
      ${navItem('#/portfolio', 'Portfolio', 'wallet', route.name === 'portfolio')}
      ${navItem('#/evidence', 'Evidence', 'search', route.name === 'evidence')}
      ${navItem('#/status', 'Status', 'settings', route.name === 'status')}
    </nav>`;
}

function renderHeader(): void {
  const pill = document.querySelector('.network-pill');
  if (pill) {
    let syncBadge = '';
    if (state.mode === 'api') {
      if (state.syncStatus === 'SYNCHRONIZED') {
        syncBadge = `<span class="pill ok" style="margin-left:8px" title="Fastify API synchronized at block #${state.syncBlock}">● Synced ${state.syncBlock ? `#${state.syncBlock}` : ''}</span>`;
      } else if (state.syncStatus === 'LAGGING') {
        syncBadge = `<span class="pill wait" style="margin-left:8px" title="Indexer is lagging by ${state.syncLag ?? '>5'} blocks">▲ Indexer Syncing (+${state.syncLag ?? ''} blk)</span>`;
      } else {
        syncBadge = `<span class="pill wait" style="margin-left:8px" title="Indexer status: ${state.syncStatus}">● ${state.syncStatus}</span>`;
      }
    } else {
      syncBadge = `<span class="pill" style="margin-left:8px" title="Direct Anvil RPC mode (Fastify API offline)">◈ Direct RPC</span>`;
    }
    pill.innerHTML = `<span class="status-dot ${state.deploymentPhase === 'ready' ? 'connected' : ''}"></span> ${NETWORK_LABEL} · ${LOCAL_CHAIN_ID}${syncBadge}`;
  }
}

function renderWallet(): void {
  const panel = document.getElementById('wallet-panel');
  if (!panel) return;
  const snapshot = state.snapshot;
  if (snapshot.phase === 'ready' && snapshot.account) {
    panel.innerHTML = `<div class="wallet-ready"><span class="wallet-account">${icon('wallet', 17)} ${escapeHtml(shortAddress(snapshot.account))}</span><button class="icon-btn" type="button" data-action="disconnect" aria-label="Disconnect wallet" title="Disconnect wallet">${icon('close', 16)}</button></div>`;
    return;
  }
  if (snapshot.phase === 'connecting') {
    panel.innerHTML = `<button class="btn primary wallet-button" type="button" disabled><span class="spinner"></span> Connecting…</button>`;
    return;
  }
  if (snapshot.phase === 'wrong-chain') {
    panel.innerHTML = `<button class="btn wallet-wrong" type="button" data-action="refresh-chain" title="${escapeHtml(walletErrorTextLocal(snapshot.error))}">${icon('wallet', 17)} Switch to local chain</button>`;
    return;
  }
  if (state.wallets.length > 0) {
    const buttons = state.wallets
      .map(
        (wallet) =>
          `<button class="btn primary wallet-button" type="button" data-action="connect" data-uuid="${escapeHtml(wallet.uuid)}" title="${escapeHtml(wallet.name)}">${icon('wallet', 17)} <span>${escapeHtml(wallet.name)}</span></button>`,
      )
      .join(' ');
    panel.innerHTML = buttons;
    return;
  }
  panel.innerHTML = `<button class="btn primary wallet-button" type="button" data-action="connect-first">${icon('wallet', 17)} <span>Connect wallet</span></button>`;
}

function renderFlash(): void {
  const el = document.getElementById('flash');
  if (!el) return;
  if (!state.flash) {
    el.innerHTML = '';
    return;
  }
  const cls = state.flash.kind === 'ok' ? 'ok' : 'err';
  el.innerHTML = `<div class="banner connection-notice" role="status"><span class="${cls}">${escapeHtml(state.flash.text)}</span><button class="text-btn" type="button" data-action="dismiss-flash">Dismiss</button></div>`;
}

function renderTxPanel(): void {
  const el = document.getElementById('tx-panel');
  if (!el) return;
  const records = tracker.records;
  if (records.length === 0) {
    el.innerHTML = '';
    return;
  }
  const rows = records.slice(0, 8).map((record: TxRecord) => {
    const tone = record.status === 'success' ? 'ok' : record.status === 'reverted' ? 'err' : 'muted';
    return `<div class="row space"><span>${escapeHtml(record.label)}</span><span class="${tone} mono">${record.status}${record.error ? ` — ${escapeHtml(record.error)}` : ''}</span></div>`;
  });
  el.innerHTML = `<div class="card"><h3>Transactions</h3>${rows.join('')}</div>`;
}

function renderRoute(): void {
  const view = document.getElementById('view');
  if (!view) return;
  if (state.deploymentPhase === 'checking') {
    view.innerHTML = `<div class="card" role="status"><span class="spinner"></span> Verifying the local deployment…</div>`;
    return;
  }
  if (state.deploymentPhase === 'failed' || !state.deployment) {
    view.innerHTML = `<section class="page-head"><div class="eyebrow">LOCAL SELECTED</div><h1>Deployment not verified</h1><p>The app refuses to read or write contracts until the local deployment passes verification.</p></section><div class="card empty-state"><h2>Verification failed</h2><p class="err">${escapeHtml(state.deploymentError ?? 'Unknown error')}</p><p class="muted">Run <span class="mono">node scripts/p1/deploy-local-selected.mjs</span> against the isolated Anvil chain, then reload.</p></div>`;
    return;
  }
  switch (state.route.name) {
    case 'list':
      renderListView(view);
      break;
    case 'market':
      void renderMarketView(view, state.route.id);
      break;
    case 'arbitration':
      void renderArbitrationView(view, state.route.filter ?? 'all');
      break;
    case 'arbitration-case':
      void renderArbitrationCaseView(view, state.route.id);
      break;
    case 'create':
      renderCreateView(view);
      break;
    case 'evidence':
      renderEvidenceView(view);
      break;
    case 'status':
      void renderStatusView(view);
      break;
    case 'portfolio':
      void renderPortfolioView(view);
      break;
  }
}

function renderMarkets(): void {
  if (state.route.name === 'list') {
    const view = document.getElementById('view');
    if (view) renderListView(view);
  }
}

function marketCardHtml(market: MarketViewItem): string {
  const total = market.yesPool + market.noPool;
  const hasPool = total > 0n;
  const yesPct = hasPool ? Number((market.yesPool * 10_000n) / total) / 100 : 50;
  const noPct = hasPool ? Number((market.noPool * 10_000n) / total) / 100 : 50;

  const categoryPill = market.category
    ? `<span class="pill category-pill">${escapeHtml(market.category)}</span>`
    : '';

  const metaBadge = market.hasMetadata
    ? (market.metadataStatus === 'verified'
        ? `<span class="pill ok" style="font-size:10px;">Verified Question</span>`
        : `<span class="pill" style="font-size:10px;">Cached Question</span>`)
    : `<span class="pill warn" style="font-size:10px;">Metadata Unavailable</span>`;

  const desc = market.description
    ? `<p class="market-card-desc">${escapeHtml(market.description)}</p>`
    : (market.hasMetadata
        ? ''
        : `<p class="market-card-desc warn-text" style="font-size:12px;margin-bottom:8px;">Off-chain question manifest is unavailable. ID and on-chain state are preserved.</p>`);

  return `
    <div class="market-card ${!market.hasMetadata ? 'market-card-unindexed' : ''}">
      <div class="market-card-header">
        <div class="market-card-badges">
          <span class="badge ${market.statusTone}">${escapeHtml(market.statusText)}</span>
          ${categoryPill}
          ${metaBadge}
        </div>
        <span class="mono market-id-tag">#${market.id}</span>
      </div>

      <h3 class="market-card-title">
        <a href="#/market/${market.id}" class="market-title-link">
          ${market.hasMetadata ? escapeHtml(market.title) : '<em style="color:var(--text-muted);font-weight:500;">Market metadata unavailable</em>'}
        </a>
      </h3>

      ${desc}

      <!-- Contribution Distribution Bar -->
      <div class="distribution-block">
        <div class="distribution-labels">
          <span class="dist-label-yes">YES ${hasPool ? `${yesPct.toFixed(1)}%` : '—'}</span>
          <span class="dist-caption">Contribution Distribution</span>
          <span class="dist-label-no">NO ${hasPool ? `${noPct.toFixed(1)}%` : '—'}</span>
        </div>
        <div class="dist-track ${!hasPool ? 'is-empty' : ''}" role="progressbar" aria-valuenow="${hasPool ? yesPct : 50}" aria-valuemin="0" aria-valuemax="100" aria-label="Contribution Distribution">
          ${hasPool
            ? `<div class="dist-fill-yes" style="width:${yesPct}%"></div><div class="dist-fill-no" style="width:${noPct}%"></div>`
            : `<div class="dist-fill-empty" style="width:100%"></div>`
          }
        </div>
        <div class="dist-pool-amounts mono">
          <span>${formatQie(market.yesPool)} ETH</span>
          <span>${hasPool ? `${formatQie(total)} ETH Total` : 'No contributions yet'}</span>
          <span>${formatQie(market.noPool)} ETH</span>
        </div>
      </div>

      <div class="market-card-footer">
        <div class="market-close-time">
          ${icon('clock', 13)}
          <span>${market.closeTime > 0n ? `Closes ${formatDateTime(market.closeTime)}` : 'No deadline'}</span>
        </div>
        <a class="btn small market-card-action" href="#/market/${market.id}">
          <span>View Market</span>
          ${icon('chevron', 12)}
        </a>
      </div>

      ${!market.hasMetadata ? `
        <details class="tech-disclosure">
          <summary>Technical Details & URI</summary>
          <div class="tech-disclosure-body">
            <div><span class="muted">URI:</span> <code class="mono" style="word-break:break-all;">${escapeHtml(market.metadataURI)}</code></div>
            <div><span class="muted">Commitment:</span> <code class="mono" style="word-break:break-all;">${escapeHtml(market.metadataHash || '—')}</code></div>
            <p class="muted" style="margin:4px 0 0;font-size:11px;">${escapeHtml(market.metadataUnavailableReason || 'Indexer did not return metadata for this market.')}</p>
          </div>
        </details>
      ` : ''}
    </div>
  `;
}

function renderListView(view: HTMLElement): void {
  const deployment = state.deployment!;
  const params = deployment.parameters;
  let body: string;
  if (state.marketsLoading) {
    body = `<div class="market-grid">${Array.from({length: 6}, () => '<div class="market-skeleton" aria-hidden="true"><i></i><b></b><b></b><span></span></div>').join('')}</div>`;
  } else if (state.marketsError) {
    body = `<div class="card empty-state"><h2>Could not load markets</h2><p class="err">${escapeHtml(state.marketsError)}</p><button class="btn" type="button" data-action="refresh-markets">Try again</button></div>`;
  } else if (state.markets.length === 0) {
    body = `<div class="card empty-state"><span class="empty-icon">${icon('sparkles', 30)}</span><h2>No markets match your criteria.</h2><p>${state.filters.q || state.filters.category !== 'all' || state.filters.status !== 'all' ? 'Try adjusting your search or filters.' : 'Create the first local market to exercise the full lifecycle.'}</p><a class="btn primary" href="#/create">Create market</a></div>`;
  } else {
    body = `<div class="market-grid">${state.markets.map(marketCardHtml).join('')}</div>`;
  }

  const totalPages = Math.max(1, Math.ceil(state.totalMarkets / state.filters.pageSize));
  let paginationHtml = '';
  if (totalPages > 1) {
    paginationHtml = `
      <div class="pagination">
        <button class="btn" type="button" data-action="prev-page" ${state.filters.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${state.filters.page} of ${totalPages} (${state.totalMarkets} total)</span>
        <button class="btn" type="button" data-action="next-page" ${state.filters.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
  }

  const modeBadge =
    state.mode === 'api'
      ? state.syncStatus === 'LAGGING'
        ? '<span class="pill wait" title="Indexer lag > 5 blocks">Indexer Lagging</span>'
        : '<span class="pill ok">Fastify API Live</span>'
      : '<span class="pill">Direct Anvil RPC</span>';

  view.innerHTML = `<section class="page-head"><div class="eyebrow">LOCAL SELECTED PROTOCOL · ${modeBadge}</div><h1>Markets</h1><p>Every market below lives on the isolated Anvil chain (${LOCAL_CHAIN_ID}) behind the verified SelectedMarketFactory. Pool shares are contribution distributions, never guaranteed probabilities or fixed payouts.</p></section>
    <div class="summary-grid">
      <div><span>Protocol fee</span><b>${(params.feeBps / 100).toFixed(2)}%</b></div>
      <div><span>Pool cap / market</span><b>${formatQie(params.poolCap)} ETH</b></div>
      <div><span>Challenge window</span><b>${params.challengePeriod / 3600}h</b></div>
      <div><span>Arbitration window</span><b>${params.arbitrationPeriod / 3600}h</b></div>
    </div>
    <div class="row space" style="flex-wrap:wrap;gap:12px;margin:24px 0 16px">
      <div class="row" style="gap:8px;flex:1;min-width:240px">
        <div class="search" style="height:38px;background:var(--bg-soft);border:1px solid var(--line);border-radius:6px;padding:0 10px;width:100%">
          ${icon('search', 16)}
          <input id="market-search" type="search" placeholder="Search markets by question..." value="${escapeHtml(state.filters.q)}" aria-label="Search markets" />
        </div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="filter-category" aria-label="Filter by category" style="height:38px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="all" ${state.filters.category === 'all' ? 'selected' : ''}>All Categories</option>
          ${VALID_MARKET_CATEGORIES.map(c => `<option value="${c.slug}" ${state.filters.category === c.slug ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
        <select id="filter-status" aria-label="Filter by status" style="height:38px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="OPEN" ${state.filters.status === 'OPEN' ? 'selected' : ''}>OPEN</option>
          <option value="PROPOSED" ${state.filters.status === 'PROPOSED' ? 'selected' : ''}>PROPOSED</option>
          <option value="DISPUTED" ${state.filters.status === 'DISPUTED' ? 'selected' : ''}>DISPUTED</option>
          <option value="FINALIZED" ${state.filters.status === 'FINALIZED' ? 'selected' : ''}>FINALIZED</option>
          <option value="CANCELLED" ${state.filters.status === 'CANCELLED' ? 'selected' : ''}>CANCELLED</option>
        </select>
        <select id="filter-sort" aria-label="Sort markets" style="height:38px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="id-desc" ${state.filters.sort === 'id' && state.filters.order === 'desc' ? 'selected' : ''}>Newest First</option>
          <option value="id-asc" ${state.filters.sort === 'id' && state.filters.order === 'asc' ? 'selected' : ''}>Oldest First</option>
          <option value="closeTime-asc" ${state.filters.sort === 'closeTime' && state.filters.order === 'asc' ? 'selected' : ''}>Closing Soonest</option>
        </select>
        <button class="text-btn" type="button" data-action="refresh-markets" title="Refresh market listings">${icon('refresh', 16)} Refresh</button>
      </div>
    </div>
    ${body}
    ${paginationHtml}`;
}

function isZeroHash(hash: string | null | undefined): boolean {
  if (!hash) return true;
  const h = hash.trim().toLowerCase();
  return h === '' || /^0x0{64}$/.test(h) || h === '0';
}

let modalRoot: HTMLElement | null = null;
let activeEvidenceCommitment: string | null = null;

function ensureModalRoot(): HTMLElement {
  if (modalRoot && modalRoot.isConnected) return modalRoot;
  let root = document.getElementById('modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    root.className = 'modal-root';
    document.body.appendChild(root);
  }
  modalRoot = root;
  return root;
}

function closeEvidenceModal(): void {
  activeEvidenceCommitment = null;
  const root = ensureModalRoot();
  root.hidden = true;
  root.innerHTML = '';
  window.removeEventListener('keydown', handleModalKeydown);
}

function handleModalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeEvidenceModal();
  }
}

async function openEvidenceModal(commitment: string): Promise<void> {
  activeEvidenceCommitment = commitment;
  const root = ensureModalRoot();
  root.hidden = false;
  window.addEventListener('keydown', handleModalKeydown);

  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="evidence-modal-title">
        <div class="modal-head">
          <h2 id="evidence-modal-title">Evidence Inspection</h2>
          <button class="icon-btn" type="button" data-action="close-modal" aria-label="Close modal">✕</button>
        </div>
        <div class="modal-body">
          <div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:12px;word-break:break-all;">Commitment: ${escapeHtml(commitment)}</div>
          <p><span class="spinner"></span> Loading evidence artifact from local discovery channel…</p>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-action="close-modal">Close</button>
        </div>
      </div>
    </div>
  `;

  try {
    const res = await apiClient.getEvidence(commitment);
    if (activeEvidenceCommitment !== commitment) return; // Stale request

    const artifact = res.data;
    let manifest: EvidenceManifest | null = null;
    try {
      manifest = JSON.parse(artifact.manifestBytes) as EvidenceManifest;
    } catch {
      // Manifest parsing failed
    }

    let rawContent: string | null = null;
    if (artifact.contentBytes) {
      try {
        rawContent = atob(artifact.contentBytes);
      } catch {
        rawContent = null;
      }
    }

    const verification = verifyEvidenceIntegrity(commitment, manifest ?? artifact.manifestBytes, rawContent);

    const sourcesHtml = manifest?.sources && manifest.sources.length > 0
      ? `<ul style="margin:6px 0 0;padding-left:18px;">${manifest.sources.map((s) => `<li><a href="${escapeHtml(s)}" target="_blank" rel="noopener noreferrer" class="mono" style="word-break:break-all;">${escapeHtml(s)}</a></li>`).join('')}</ul>`
      : '<span class="muted">None declared</span>';

    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop="true">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="evidence-modal-title" style="max-width:680px;width:100%;">
          <div class="modal-head">
            <h2 id="evidence-modal-title">Evidence Inspection</h2>
            <button class="icon-btn" type="button" data-action="close-modal" aria-label="Close modal">✕</button>
          </div>
          <div class="modal-body">
            <div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:14px;word-break:break-all;">
              Commitment: <strong>${escapeHtml(commitment)}</strong>
            </div>

            <div class="row" style="margin-bottom:16px;">
              ${verification.commitmentMatched
                ? '<span class="pill ok" style="padding:4px 10px;font-size:12px;">✔ Commitment Hash Matched (Keccak-256)</span>'
                : '<span class="pill err" style="padding:4px 10px;font-size:12px;">✖ Commitment Hash Mismatch</span>'}
              ${verification.contentHashMatched === true
                ? '<span class="pill ok" style="padding:4px 10px;font-size:12px;">✔ Content Hash Matched</span>'
                : verification.contentHashMatched === false
                ? '<span class="pill err" style="padding:4px 10px;font-size:12px;">✖ Content Hash Mismatch</span>'
                : ''}
              <span class="pill" style="padding:4px 10px;font-size:12px;">Local Discovery Channel</span>
            </div>

            <div class="banner warn-text" style="background:var(--warn-soft);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:18px;font-size:12px;line-height:1.6;">
              <strong>Authenticity Notice:</strong> Cryptographic verification validates that the manifest matches the on-chain commitment hash. Factual truthfulness and external source authenticity are subject to arbitrator review and local pinning status (<span class="mono">${escapeHtml(artifact.externalPinning)}</span>).
            </div>

            <div class="card" style="padding:16px;margin-bottom:16px;background:var(--bg-soft);">
              <div class="grid-2" style="font-size:13px;gap:12px;">
                <div><span class="muted">Market ID</span><div class="mono">${escapeHtml(manifest?.marketId ?? artifact.marketOnchainId ?? '—')}</div></div>
                <div><span class="muted">Kind</span><div><span class="pill">${escapeHtml(manifest?.kind ?? '—')}</span></div></div>
                <div><span class="muted">Claim</span><div><strong>${escapeHtml(manifest?.claim ?? '—')}</strong></div></div>
                <div><span class="muted">Proposed Outcome</span><div>${escapeHtml(manifest?.proposedOutcome ?? '—')}</div></div>
                <div><span class="muted">Publisher</span><div class="mono">${escapeHtml(manifest?.publisher ?? artifact.publishedBy ?? '—')}</div></div>
                <div><span class="muted">Published At</span><div>${manifest?.publishedAt ? formatDateTime(BigInt(manifest.publishedAt)) : artifact.createdAt}</div></div>
                <div><span class="muted">Media Type</span><div class="mono">${escapeHtml(manifest?.contentMediaType ?? 'text/plain')}</div></div>
                <div><span class="muted">Content Size</span><div>${artifact.contentSize} bytes</div></div>
              </div>
              <div style="margin-top:14px;font-size:13px;">
                <span class="muted">Sources:</span>
                ${sourcesHtml}
              </div>
            </div>

            ${rawContent !== null ? `
              <div style="margin-bottom:16px;">
                <div class="muted" style="font-size:12px;margin-bottom:6px;">Evidence Content:</div>
                <pre class="mono prewrap" style="max-height:180px;overflow-y:auto;background:var(--bg);padding:12px;border-radius:8px;border:1px solid var(--line);font-size:12px;">${escapeHtml(rawContent)}</pre>
              </div>
            ` : ''}

            <details style="margin-top:8px;">
              <summary class="muted" style="cursor:pointer;font-size:12px;">View Raw Manifest (RFC 8785 Canonical JSON)</summary>
              <pre class="mono prewrap" style="max-height:150px;overflow-y:auto;background:var(--bg);padding:10px;border-radius:6px;border:1px solid var(--line);font-size:11px;margin-top:6px;">${escapeHtml(artifact.manifestBytes)}</pre>
            </details>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="close-modal">Close</button>
          </div>
        </div>
      </div>
    `;
  } catch (err: unknown) {
    if (activeEvidenceCommitment !== commitment) return;
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop="true">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="evidence-modal-title">
          <div class="modal-head">
            <h2 id="evidence-modal-title">Evidence Inspection</h2>
            <button class="icon-btn" type="button" data-action="close-modal" aria-label="Close modal">✕</button>
          </div>
          <div class="modal-body">
            <div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:12px;word-break:break-all;">Commitment: ${escapeHtml(commitment)}</div>
            <div class="card" style="background:var(--bg-soft);padding:16px;border:1px solid var(--line);">
              <p class="warn-text" style="font-weight:600;margin-bottom:8px;">Artifact Not Cached Locally</p>
              <p class="muted" style="font-size:13px;line-height:1.6;">
                The on-chain commitment is valid, but no matching manifest artifact was found in the local node's discovery channel (${escapeHtml(errorMessage(err))}).
              </p>
              <p class="muted" style="font-size:12px;margin-top:8px;line-height:1.5;">
                On-chain contracts record only cryptographic Keccak-256 commitments. Off-chain discovery channels cache and share the underlying manifests.
              </p>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-action="close-modal">Close</button>
          </div>
        </div>
      </div>
    `;
  }
}

async function fetchMarketsForArbitration(): Promise<MarketViewItem[]> {
  const deployment = state.deployment;
  if (!deployment) return [];
  try {
    const res = await apiClient.getMarkets({ pageSize: 50, sort: 'id', order: 'desc' });
    return res.data.items.map(apiItemToView);
  } catch {
    try {
      const records = await readMarkets(publicClient, deployment.factory, 0, 50);
      return records.map(rpcRecordToView);
    } catch {
      return state.markets;
    }
  }
}

async function renderMarketView(view: HTMLElement, id: bigint): Promise<void> {
  const deployment = state.deployment!;
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading market #${id}…</div>`;
  await refreshChainTime();

  let apiDetail: MarketDetail | null = null;
  try {
    const res = await apiClient.getMarket(id);
    apiDetail = res.data;
  } catch {
    // API detail unavailable; read directly from contract
  }

  let challenges: MarketChallengesResult | null = null;
  try {
    const res = await apiClient.getMarketChallenges(id);
    challenges = res.data;
  } catch {
    // API challenges unavailable; RPC mode will be indicated
  }

  let market: MarketRecord;
  try {
    market = await readMarket(publicClient, deployment.factory, id);
  } catch (error) {
    view.innerHTML = `<div class="card empty-state"><h2>Market not found</h2><p class="err">${escapeHtml(errorMessage(error))}</p><a class="btn primary" href="#/">Back to markets</a></div>`;
    return;
  }
  const account = connectedAccount();
  const position = account ? await readPosition(publicClient, deployment.factory, id, account) : null;
  const claimable = account ? await readClaimable(publicClient, deployment.factory, id, account) : null;
  const [
    creationBond,
    creationEntitlement,
    proposalBond,
    proposalEntitlement,
    challengeStake,
    challengeEntitlement,
  ] = account
    ? await Promise.all([
        readBond(publicClient, deployment.factory, id, 0).catch(() => null),
        readBondEntitlement(publicClient, deployment.factory, id, 0, account).catch(() => 0n),
        readBond(publicClient, deployment.factory, id, 1).catch(() => null),
        readBondEntitlement(publicClient, deployment.factory, id, 1, account).catch(() => 0n),
        readChallengeStake(publicClient, deployment.factory, id, account).catch(() => null),
        readBondEntitlement(publicClient, deployment.factory, id, 2, account).catch(() => 0n),
      ])
    : [null, 0n, null, 0n, null, 0n];

  const now = chainNow();
  const effectiveState = (market.storedState === 0 && now >= Number(market.closeTime)) ? 1 : market.storedState;
  const stateLabel = MARKET_STATE_LABELS[effectiveState] ?? 'UNKNOWN';
  const { total, yesPct, noPct } = calculatePoolShares(market.yesPool, market.noPool);
  const isDisputed = market.storedState === 3 || !isZeroHash(market.challenger) || !isZeroHash(market.decisionEvidence);

  const cached = getLocalManifest(market.metadataHash) || getLocalManifest(market.metadataURI);
  let title = 'Market metadata unavailable';
  let descriptionHtml = '';
  let categoryPill = '';
  let verifiedBadge = '';
  let hasMetadata = false;

  if (apiDetail?.question && apiDetail.question.trim().length > 0) {
    hasMetadata = true;
    title = apiDetail.question.trim();
    if (apiDetail.description) {
      descriptionHtml = `<p style="margin:8px 0 16px;color:var(--text-secondary);font-size:14px;line-height:1.6;">${escapeHtml(apiDetail.description)}</p>`;
    }
    if (apiDetail.category) {
      categoryPill = `<span class="pill" style="margin-left:8px">${escapeHtml(apiDetail.category)}</span>`;
    }
    verifiedBadge = `<span class="pill ok" style="margin-left:8px" title="Metadata manifest cryptographically verified">Verified Question</span>`;
  } else if (cached) {
    hasMetadata = true;
    title = cached.question;
    if (cached.description) {
      descriptionHtml = `<p style="margin:8px 0 16px;color:var(--text-secondary);font-size:14px;line-height:1.6;">${escapeHtml(cached.description)}</p>`;
    }
    if (cached.category) {
      categoryPill = `<span class="pill" style="margin-left:8px">${escapeHtml(cached.category)}</span>`;
    }
    verifiedBadge = `<span class="pill ok" style="margin-left:8px" title="Commitment hash verified against local cache">Cached Question (Verified)</span>`;
  } else {
    hasMetadata = false;
    title = 'Market metadata unavailable';
    verifiedBadge = `<span class="pill warn" style="margin-left:8px">Metadata Unavailable</span>`;
  }

  const formatEvidenceField = (hash: string | null | undefined): string => {
    if (!hash || isZeroHash(hash)) return '<span class="muted">—</span>';
    return `<button class="evidence-hash-btn mono" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(hash)}" title="Inspect canonical evidence manifest">${escapeHtml(shortAddress(hash))}</button>`;
  };

  // Actions column assembly
  const actions: string[] = [];
  if (account && effectiveState === 0) {
    actions.push(`
      <div class="card">
        <h3>Predict Outcome</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Min contribution: ${formatQie(deployment.parameters.minContribution)} ETH. Pool shares represent contribution distribution, never a guaranteed payout.
        </p>
        <div class="row" style="gap:8px;">
          <button class="btn yes" type="button" data-action="predict-yes" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>
            Predict YES · ${formatQie(deployment.parameters.minContribution)}
          </button>
          <button class="btn no" type="button" data-action="predict-no" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>
            Predict NO · ${formatQie(deployment.parameters.minContribution)}
          </button>
        </div>
        <div class="row" style="margin-top:12px;gap:8px;">
          <select id="predict-side" class="input-select" aria-label="Prediction side" style="max-width:90px">
            <option value="0" selected>YES</option>
            <option value="1">NO</option>
          </select>
          <input id="predict-amount" type="text" inputmode="decimal" placeholder="Custom amount (ETH)" aria-label="Custom prediction amount" style="flex:1;" />
          <button class="btn" type="button" data-action="predict-custom" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>
            Stake
          </button>
        </div>
      </div>
    `);
  } else if (!account && effectiveState === 0) {
    actions.push(`
      <div class="card">
        <h3>Predict Outcome</h3>
        <p class="muted" style="font-size:13px;line-height:1.5;">Connect a local wallet to participate in this prediction pool.</p>
        <button class="btn primary wallet-button" type="button" data-action="connect-first">${icon('wallet', 16)} Connect Wallet</button>
      </div>
    `);
  }

  const latestProposalTime = Number(market.maxResolutionTime) - deployment.parameters.challengePeriod - deployment.parameters.arbitrationPeriod;
  const proposalClosed = now > latestProposalTime;

  if (account && effectiveState === 1) {
    actions.push(`
      <div class="card">
        <h3>Propose Result</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Required Bond: ${formatQie(deployment.parameters.proposalBond)} ETH. ${proposalClosed ? 'Proposal window has passed.' : `Proposals accepted until ${formatDateTime(BigInt(latestProposalTime))}.`}
        </p>
        <input id="propose-evidence" type="text" placeholder="Evidence hash (0x…64) or manifest text" aria-label="Proposal evidence" style="width:100%;margin-bottom:10px;" />
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn yes" type="button" data-action="propose-yes" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''}>Propose YES</button>
          <button class="btn no" type="button" data-action="propose-no" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''}>Propose NO</button>
          <button class="btn" type="button" data-action="propose-invalid" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''} style="background:var(--outcome-invalid-bg);color:var(--outcome-invalid);border-color:var(--outcome-invalid-border);">Propose INVALID</button>
        </div>
        <div style="margin-top:10px;"><a class="text-btn" href="#/evidence" style="font-size:12px;">Build manifest in Evidence Lab →</a></div>
      </div>
    `);
  }

  const challengeOpen = now < Number(market.challengeDeadline);
  if (account && (effectiveState === 2 || effectiveState === 3)) {
    actions.push(`
      <div class="card">
        <h3>Challenge Proposed Result</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Challenge Bond: ${formatQie(deployment.parameters.challengeBond)} ETH. ${challengeOpen ? `Window closes ${formatDateTime(market.challengeDeadline)}.` : 'Challenge window has closed.'}
        </p>
        <input id="challenge-evidence" type="text" placeholder="Evidence hash (0x…64) or manifest text" aria-label="Challenge evidence" style="width:100%;margin-bottom:10px;" />
        <div class="row" style="gap:8px;">
          <button class="btn danger" type="button" data-action="challenge" data-id="${market.id}" ${state.busy || !challengeOpen ? 'disabled' : ''}>Challenge Result</button>
          <button class="btn ghost" type="button" data-action="submit-evidence" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Submit Evidence Only</button>
        </div>
        <div style="margin-top:10px;"><a class="text-btn" href="#/evidence" style="font-size:12px;">Build manifest in Evidence Lab →</a></div>
      </div>
    `);
  }

  if (effectiveState === 3) {
    actions.push(`
      <div class="card" style="border:1px solid var(--accent-brand);">
        <div class="row space">
          <h3>Arbitration In Progress</h3>
          <span class="badge wait">Disputed</span>
        </div>
        <p class="muted" style="font-size:12px;margin:8px 0 14px;">
          This market is disputed and is undergoing review by the Local Arbitration Mock authority.
        </p>
        <a class="btn primary" href="#/arbitration/${market.id}" style="display:inline-block;text-align:center;">
          Review in Arbitration Workspace →
        </a>
      </div>
    `);
  }

  if (account && effectiveState === 2) {
    const canFinalize = now >= Number(market.challengeDeadline);
    actions.push(`
      <div class="card">
        <h3>Finalize Market</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Finalization is available once the challenge window closes without dispute.
        </p>
        <button class="btn primary" type="button" data-action="finalize" data-id="${market.id}" ${state.busy || !canFinalize ? 'disabled' : ''}>
          ${canFinalize ? 'Finalize Result' : `Window Open (Wait ${countdownText(Number(market.challengeDeadline) - now)})`}
        </button>
      </div>
    `);
  }

  if (account && (effectiveState === 4 || effectiveState === 5)) {
    const claimText = claimable
      ? `Reward: ${formatQie(claimable.reward)} ETH · Refund: ${formatQie(claimable.refund)} ETH`
      : 'No claimable funds recorded.';
    actions.push(`
      <div class="card">
        <h3>Settlement Payouts</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">${claimText}</p>
        <div class="row" style="gap:8px;">
          <button class="btn primary" type="button" data-action="claim" data-id="${market.id}" ${state.busy || !claimable || claimable.reward === 0n ? 'disabled' : ''}>
            Claim Reward
          </button>
          <button class="btn" type="button" data-action="claim-refund" data-id="${market.id}" ${state.busy || !claimable || claimable.refund === 0n ? 'disabled' : ''}>
            Claim Refund
          </button>
        </div>
      </div>
    `);
  }

  if (account && effectiveState !== 4 && effectiveState !== 5 && now >= Number(market.maxResolutionTime)) {
    actions.push(`
      <div class="card">
        <h3>Cancel Expired Market</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Market exceeded max resolution time unresolved. Cancellation refunds all participant stakes 1:1.
        </p>
        <button class="btn danger" type="button" data-action="cancel-expired" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>
          Cancel Expired Market
        </button>
      </div>
    `);
  }

  // Multi-Bond Claims Card
  let bondClaimsHtml = '';
  if (account && (effectiveState === 4 || effectiveState === 5)) {
    const bondSections: string[] = [];

    if (addressEq(account, market.creator) || (creationBond && addressEq(account, creationBond.owner))) {
      const isClaimed = creationBond?.claimed ?? false;
      const canClaim = !isClaimed && creationEntitlement > 0n;
      bondSections.push(`
        <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
          <div class="row space">
            <span style="font-size:13px;font-weight:600;">Creation Bond</span>
            <span>${isClaimed ? '<span class="pill ok">Claimed</span>' : (creationEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(creationEntitlement)} ETH</span>` : '<span class="pill err">No entitlement</span>')}</span>
          </div>
          <div class="row" style="margin-top:8px;gap:6px;">
            <input id="claim-bond-recipient-0" type="text" placeholder="Recipient address (optional redirection)" aria-label="Creation bond recipient" style="font-size:11px;flex:1;" />
            <button class="btn small" type="button" data-action="claim-bond-creation" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>
              Claim Bond
            </button>
          </div>
        </div>
      `);
    }

    if (addressEq(account, market.proposer) || (proposalBond && addressEq(account, proposalBond.owner))) {
      const isClaimed = proposalBond?.claimed ?? false;
      const canClaim = !isClaimed && proposalEntitlement > 0n;
      bondSections.push(`
        <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
          <div class="row space">
            <span style="font-size:13px;font-weight:600;">Proposal Bond</span>
            <span>${isClaimed ? '<span class="pill ok">Claimed</span>' : (proposalEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(proposalEntitlement)} ETH</span>` : '<span class="pill err">Forfeited / 0 ETH</span>')}</span>
          </div>
          <div class="row" style="margin-top:8px;gap:6px;">
            <input id="claim-bond-recipient-1" type="text" placeholder="Recipient address (optional redirection)" aria-label="Proposal bond recipient" style="font-size:11px;flex:1;" />
            <button class="btn small" type="button" data-action="claim-bond-proposal" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>
              Claim Bond
            </button>
          </div>
        </div>
      `);
    }

    if ((challengeStake && challengeStake.amount > 0n) || challengeEntitlement > 0n) {
      const isClaimed = challengeStake?.claimed ?? false;
      const canClaim = !isClaimed && challengeEntitlement > 0n;
      bondSections.push(`
        <div style="padding:10px 0;">
          <div class="row space">
            <span style="font-size:13px;font-weight:600;">Challenge Bond</span>
            <span>${isClaimed ? '<span class="pill ok">Claimed</span>' : (challengeEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(challengeEntitlement)} ETH</span>` : '<span class="pill err">Forfeited / 0 ETH</span>')}</span>
          </div>
          <div class="row" style="margin-top:8px;gap:6px;">
            <input id="claim-bond-recipient-2" type="text" placeholder="Recipient address (optional redirection)" aria-label="Challenge bond recipient" style="font-size:11px;flex:1;" />
            <button class="btn small" type="button" data-action="claim-bond-challenge" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>
              Claim Bond
            </button>
          </div>
        </div>
      `);
    }

    if (bondSections.length > 0) {
      bondClaimsHtml = `
        <div class="card">
          <h3>Bond Reclamation</h3>
          <p class="muted" style="font-size:12px;margin-bottom:8px;">
            Claim returned bonds to your wallet or redirect to a designated address.
          </p>
          ${bondSections.join('')}
        </div>
      `;
    }
  }

  // User position card
  const positionHtml = position && (position.yes > 0n || position.no > 0n)
    ? `
      <div class="card">
        <h3>Your Position</h3>
        <div class="row space" style="margin:8px 0;font-size:13px;">
          <span>YES: <strong>${formatQie(position.yes)} ETH</strong></span>
          <span>NO: <strong>${formatQie(position.no)} ETH</strong></span>
        </div>
        <div class="row space">
          <span class="muted" style="font-size:12px;">Position Status:</span>
          <span class="pill ${position.settled ? 'ok' : ''}">${position.settled ? 'Settled' : 'Open'}</span>
        </div>
      </div>
    `
    : '';

  // Evidence Dossier Entries
  const evidenceEntries: string[] = [];
  if (!isZeroHash(market.proposalEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-proposal">Proposal Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(market.proposer))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.proposalEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.proposalEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }
  if (!isZeroHash(market.challengeEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-challenge">Challenge Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(market.challenger))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.challengeEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.challengeEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }
  if (!isZeroHash(market.decisionEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-arbitration">Decision Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(deployment.manifest.roleMocks.arbitrator.address))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.decisionEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.decisionEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }

  const dossierHtml = evidenceEntries.length > 0
    ? `<div class="evidence-dossier-list">${evidenceEntries.join('')}</div>`
    : `<p class="muted" style="margin-top:12px;font-size:13px;">No evidence artifacts committed yet for this market.</p>`;

  // Tranche ladder
  let trancheLadderHtml = '';
  if (challenges && challenges.stakes && challenges.stakes.length > 0) {
    const trancheRows = challenges.stakes.map((stake, idx) => `
      <tr>
        <td><span class="pill">#${idx + 1}</span></td>
        <td><span class="mono" title="${escapeHtml(stake.walletAddress)}">${escapeHtml(shortAddress(stake.walletAddress))}</span></td>
        <td><strong>${formatQie(parsePoolAmount(stake.amount))} ETH</strong></td>
        <td><span class="mono">${formatQie(parsePoolAmount(stake.prefixBefore))} ETH</span></td>
        <td>
          ${!isZeroHash(stake.evidenceHash)
            ? `<button class="evidence-hash-btn mono" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(stake.evidenceHash)}" title="Inspect canonical evidence manifest">${escapeHtml(shortAddress(stake.evidenceHash))}</button>`
            : '<span class="muted">—</span>'}
        </td>
        <td><span class="pill ${stake.claimed ? 'ok' : ''}">${stake.claimed ? 'Claimed' : 'Active'}</span></td>
      </tr>
    `).join('');

    trancheLadderHtml = `
      <div class="card" style="padding:22px 24px;">
        <div class="row space">
          <h2 style="font-size:16px;margin:0;">Multi-Challenger Tranche Ladder (M1)</h2>
          <span class="pill">${challenges.stakes.length} tranche${challenges.stakes.length === 1 ? '' : 's'}</span>
        </div>
        <p class="muted" style="font-size:13px;margin:6px 0 12px;">
          Total dispute stake: <strong>${formatQie(parsePoolAmount(challenges.totalChallengeStake))} ETH</strong>
          ${challenges.disposition ? ` · Disposition: <strong>${escapeHtml(challenges.disposition)}</strong>` : ''}
          ${challenges.refundable !== null ? ` · Refundable: <strong>${challenges.refundable ? 'Yes' : 'No'}</strong>` : ''}
        </p>
        <div style="overflow-x:auto;">
          <table class="tranche-table" aria-label="Challenger Tranches">
            <thead>
              <tr>
                <th>Tranche</th>
                <th>Challenger</th>
                <th>Stake</th>
                <th>Prefix Before</th>
                <th>Evidence Hash</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${trancheRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (market.storedState === 3 || !isZeroHash(market.challenger)) {
    trancheLadderHtml = `
      <div class="card" style="padding:22px 24px;">
        <h2 style="font-size:16px;margin:0;">Multi-Challenger Tranche Ladder (M1)</h2>
        <p class="muted" style="font-size:13px;margin-top:6px;">${challenges ? 'No additional challenger tranches recorded.' : 'Detailed multi-challenger tranche history requires the API indexer service.'}</p>
      </div>
    `;
  }

  // Stepper state evaluation
  const step1Class = 'completed';
  const step2Class = effectiveState === 0 ? 'pending' : (effectiveState === 1 ? 'active' : 'completed');
  const step3Class = effectiveState < 2 ? 'pending' : (effectiveState === 2 ? 'active' : 'completed');
  const step4Class = effectiveState === 3 ? 'active' : (effectiveState >= 4 && isDisputed ? 'completed' : 'pending');
  const step5Class = effectiveState >= 4 ? 'completed' : 'pending';

  view.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">Explore Markets</a>
      ${icon('chevron', 13)}
      <span>Market #${market.id}</span>
    </div>

    <section class="page-head">
      <div class="eyebrow">
        MARKET #${market.id} · <span class="badge ${stateTone(effectiveState)}">${stateLabel}</span>
        ${categoryPill}
        ${verifiedBadge}
      </div>
      <h1 class="market-title-h1">${escapeHtml(title)}</h1>
      ${descriptionHtml}
      ${!hasMetadata ? `
        <div class="banner warn-banner" style="margin:12px 0 16px;">
          <strong>Market Metadata Unavailable:</strong> Off-chain question manifest is not available via the indexer or local storage for this market. On-chain state (ID #${market.id}, ${stateLabel}) is fully preserved. Direct RPC mode cannot recover off-chain IPFS metadata without an active indexer.
        </div>
      ` : ''}
      <div class="row" style="gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin-top:6px;">
        <span>Creator: <strong class="mono">${escapeHtml(shortAddress(market.creator))}</strong></span>
        <span>Closes: <strong class="mono">${formatDateTime(market.closeTime)}</strong></span>
        <span>Resolution: <strong class="mono">${formatDateTime(market.resolutionTime)}</strong></span>
        <span>Max Resolution: <strong class="mono">${formatDateTime(market.maxResolutionTime)}</strong></span>
      </div>
    </section>

    <div class="market-detail-layout">
      <!-- Main Content Column -->
      <div class="market-main-col">
        <!-- Resolution Rules Callout -->
        <div class="rules-callout">
          <div class="rules-callout-head">
            <span class="rules-callout-title">${icon('shield', 18)} Resolution Rules & Settlement Criteria</span>
          </div>
          <div class="rules-source-link">
            <span>Primary Observation Source:</span>
            <a href="${escapeHtml(market.metadataURI)}" target="_blank" rel="noopener noreferrer" class="mono">${escapeHtml(market.metadataURI)}</a>
          </div>
          <div class="rules-condition">
            <strong>Outcome Conditions:</strong>
            <ul style="margin:6px 0 0;padding-left:18px;">
              <li><strong>YES / NO:</strong> The criteria specified in the market question are verified to have occurred before market close according to the primary source.</li>
              <li><strong>INVALID (Neutral Refund):</strong> If the underlying event is cancelled, postponed beyond the max resolution window, or facts remain indeterminate, the market resolves to INVALID. All participant stakes are refunded 1:1, creation and challenge bonds are returned.</li>
            </ul>
          </div>
        </div>

        <!-- Pool Contribution Distribution Card -->
        <div class="pool-distribution-card">
          <div class="row space" style="margin-bottom:12px;">
            <h2 style="font-size:16px;margin:0;">Pool Contribution Distribution</h2>
            <span class="mono muted font-stat">Total: ${formatQie(total)} ETH</span>
          </div>

          ${total > 0n
            ? `<div class="dist-track" aria-hidden="true" style="height:10px;margin:12px 0;">
                <div class="dist-fill-yes" style="width: ${yesPct ?? 50}%;"></div>
                <div class="dist-fill-no" style="width: ${noPct ?? 50}%;"></div>
              </div>`
            : `<div class="dist-track empty" aria-hidden="true" style="height:10px;margin:12px 0;">
                <div class="dist-fill-empty" style="width: 100%;"></div>
              </div>`}

          <div class="pool-metric-row">
            <div>
              <span class="muted">YES Pool:</span>
              <strong style="color:var(--outcome-yes);">${formatQie(market.yesPool)} ETH</strong>
              <span class="mono">(${yesPct !== null ? yesPct.toFixed(1) + '%' : '—'})</span>
            </div>
            <div>
              <span class="muted">NO Pool:</span>
              <strong style="color:var(--outcome-no);">${formatQie(market.noPool)} ETH</strong>
              <span class="mono">(${noPct !== null ? noPct.toFixed(1) + '%' : '—'})</span>
            </div>
            <div>
              <span class="muted">Protocol Fee:</span>
              <strong class="mono">${formatQie(market.protocolFee)} ETH</strong>
            </div>
          </div>

          <div class="contribution-notice">
            ${icon('help', 15)}
            <span>Pool shares represent proportional contribution distributions across pari-mutuel outcome pools. Shares are never guaranteed probabilities or fixed payouts.</span>
          </div>
        </div>

        <!-- Interactive Stepped Timeline -->
        <div class="resolution-stepper-card">
          <div class="row space" style="margin-bottom:16px;">
            <h2 style="font-size:16px;margin:0;">Resolution Lifecycle</h2>
            <span class="pill">${stateLabel}</span>
          </div>

          <div class="stepper-list">
            <!-- Step 1: Market Creation -->
            <div class="stepper-step ${step1Class}">
              <div class="step-marker">✔</div>
              <div class="step-content">
                <div class="step-head">
                  <h3 class="step-title">1. Market Creation & Funding</h3>
                  <span class="step-time">${formatDateTime(market.closeTime)}</span>
                </div>
                <p class="step-desc">Market initialized on the local chain. Funding open until close time.</p>
                <div class="step-details-box">
                  <div class="step-details-row"><span>Creator:</span><strong class="mono">${escapeHtml(shortAddress(market.creator))}</strong></div>
                  <div class="step-details-row"><span>Creation Bond:</span><strong>${formatQie(deployment.parameters.creationBond)} ETH</strong></div>
                </div>
              </div>
            </div>

            <!-- Step 2: Result Proposal -->
            <div class="stepper-step ${step2Class}">
              <div class="step-marker">${step2Class === 'completed' ? '✔' : '2'}</div>
              <div class="step-content">
                <div class="step-head">
                  <h3 class="step-title">2. Outcome Proposal</h3>
                  <span class="step-time">${step2Class === 'completed' ? 'Submitted' : (step2Class === 'active' ? 'Active Window' : 'Pending')}</span>
                </div>
                <p class="step-desc">
                  ${step2Class === 'completed'
                    ? `Result proposed as <strong>${OUTCOME_LABELS[market.proposedOutcome]}</strong> by proposer.`
                    : (step2Class === 'active'
                      ? `Market closed. Anyone can submit an outcome proposal with ${formatQie(deployment.parameters.proposalBond)} ETH bond.`
                      : `Opens when market closes at ${formatDateTime(market.closeTime)}.`)}
                </p>
                ${step2Class === 'completed' ? `
                  <div class="step-details-box">
                    <div class="step-details-row"><span>Proposer:</span><strong class="mono">${escapeHtml(shortAddress(market.proposer))}</strong></div>
                    <div class="step-details-row"><span>Proposed Outcome:</span><strong class="pill ${market.proposedOutcome === 1 ? 'yes' : market.proposedOutcome === 2 ? 'no' : 'invalid'}">${OUTCOME_LABELS[market.proposedOutcome]}</strong></div>
                    <div class="step-details-row"><span>Evidence:</span><strong>${formatEvidenceField(market.proposalEvidence)}</strong></div>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Step 3: Challenge Window -->
            <div class="stepper-step ${step3Class}">
              <div class="step-marker">${step3Class === 'completed' ? '✔' : '3'}</div>
              <div class="step-content">
                <div class="step-head">
                  <h3 class="step-title">3. Challenge Period</h3>
                  <span class="step-time">${step3Class === 'active' ? countdownText(Number(market.challengeDeadline) - now) : (step3Class === 'completed' ? (isDisputed ? 'Challenged' : 'Closed') : 'Pending')}</span>
                </div>
                <p class="step-desc">
                  ${step3Class === 'completed'
                    ? (isDisputed ? 'Proposal challenged. Dispute escalated to arbitration authority.' : 'Challenge window elapsed without objections.')
                    : (step3Class === 'active'
                      ? `Challenge window active until ${formatDateTime(market.challengeDeadline)}. Objections require ${formatQie(deployment.parameters.challengeBond)} ETH bond.`
                      : 'Opens after an outcome is proposed.')}
                </p>
                ${isDisputed ? `
                  <div class="step-details-box">
                    <div class="step-details-row"><span>Challenger:</span><strong class="mono">${escapeHtml(shortAddress(market.challenger))}</strong></div>
                    <div class="step-details-row"><span>Challenge Evidence:</span><strong>${formatEvidenceField(market.challengeEvidence)}</strong></div>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Step 4: Local Arbitration Deliberation -->
            <div class="stepper-step ${step4Class}">
              <div class="step-marker">${step4Class === 'completed' ? '✔' : '4'}</div>
              <div class="step-content">
                <div class="step-head">
                  <h3 class="step-title">4. Arbitration Deliberation</h3>
                  <span class="step-time">${step4Class === 'active' ? 'Under Review' : (step4Class === 'completed' ? 'Arbitrated' : 'Conditional')}</span>
                </div>
                <p class="step-desc">
                  ${step4Class === 'active'
                    ? `Contested outcome under deliberation by Local Arbitration Mock until ${formatDateTime(market.arbitrationDeadline)}.`
                    : (step4Class === 'completed'
                      ? `Settled by Local Arbitration Mock with outcome ${OUTCOME_LABELS[market.finalOutcome]}.`
                      : 'Deliberation is only invoked if the proposed outcome is challenged.')}
                </p>
                ${!isZeroHash(market.decisionEvidence) ? `
                  <div class="step-details-box">
                    <div class="step-details-row"><span>Decision Evidence:</span><strong>${formatEvidenceField(market.decisionEvidence)}</strong></div>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Step 5: Final Settlement -->
            <div class="stepper-step ${step5Class}">
              <div class="step-marker">${step5Class === 'completed' ? '✔' : '5'}</div>
              <div class="step-content">
                <div class="step-head">
                  <h3 class="step-title">5. Final Settlement & Claims</h3>
                  <span class="step-time">${step5Class === 'completed' ? 'Terminal' : 'Pending'}</span>
                </div>
                <p class="step-desc">
                  ${step5Class === 'completed'
                    ? `Market finalized. Winning outcome: <strong>${OUTCOME_LABELS[market.finalOutcome]}</strong>. Stake rewards, refunds, and bonds are claimable.`
                    : 'Activates upon outcome finalization.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Evidence Dossier Panel -->
        <div class="evidence-dossier-card">
          <div class="row space">
            <h2 style="font-size:16px;margin:0;">Evidence Dossier</h2>
            <span class="pill ok">RFC 8785 Canonical JSON</span>
          </div>
          ${dossierHtml}
        </div>

        <!-- Tranche Ladder -->
        ${trancheLadderHtml}
      </div>

      <!-- Right Column: User Position & Actions -->
      <div class="market-aside-col">
        ${positionHtml}
        ${actions.join('')}
        ${bondClaimsHtml}

        <!-- Parameters Card -->
        <div class="card" style="font-size:12px;">
          <h3 style="font-size:14px;margin-bottom:10px;">Market Specifications</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div class="row space"><span class="muted">Protocol Fee:</span><strong class="mono font-stat">${(deployment.parameters.feeBps / 100).toFixed(2)}%</strong></div>
            <div class="row space"><span class="muted">Pool Cap:</span><strong class="mono font-stat">${formatQie(deployment.parameters.poolCap)} ETH</strong></div>
            <div class="row space"><span class="muted">Challenge Window:</span><strong class="mono font-stat">${deployment.parameters.challengePeriod / 3600} hours</strong></div>
            <div class="row space"><span class="muted">Arbitration Window:</span><strong class="mono font-stat">${deployment.parameters.arbitrationPeriod / 3600} hours</strong></div>
            <div class="row space"><span class="muted">Min Contribution:</span><strong class="mono font-stat">${formatQie(deployment.parameters.minContribution)} ETH</strong></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderArbitrationView(view: HTMLElement, filter: 'all' | 'disputed' | 'proposed' | 'finalized'): Promise<void> {
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading arbitration queue…</div>`;
  const deployment = state.deployment!;
  await refreshChainTime();
  const cases = await fetchMarketsForArbitration();

  const disputedCount = cases.filter(c => c.statusText === 'DISPUTED').length;
  const proposedCount = cases.filter(c => c.statusText === 'PROPOSED').length;
  const finalizedCount = cases.filter(c => c.statusText === 'FINALIZED' || c.statusText === 'CANCELLED').length;
  const disputedVolume = cases
    .filter(c => c.statusText === 'DISPUTED')
    .reduce((sum, c) => sum + c.yesPool + c.noPool, 0n);

  let filteredCases = cases;
  if (filter === 'disputed') {
    filteredCases = cases.filter(c => c.statusText === 'DISPUTED');
  } else if (filter === 'proposed') {
    filteredCases = cases.filter(c => c.statusText === 'PROPOSED');
  } else if (filter === 'finalized') {
    filteredCases = cases.filter(c => c.statusText === 'FINALIZED' || c.statusText === 'CANCELLED');
  }

  const tab = (id: string, label: string, count?: number) => {
    const active = filter === id;
    const badge = count !== undefined ? ` <span class="mono">(${count})</span>` : '';
    return `<a href="#/arbitration?filter=${id}" class="arb-tab-btn ${active ? 'active' : ''}">${label}${badge}</a>`;
  };

  let tableContent = '';
  if (filteredCases.length === 0) {
    tableContent = `
      <div class="card empty-state" style="border:none;margin:24px 0;">
        <span class="empty-icon">${icon('shield', 30)}</span>
        <h2>No cases found in this view</h2>
        <p class="muted">There are currently no prediction markets matching the <strong>${escapeHtml(filter)}</strong> filter.</p>
        <a class="btn primary" href="#/arbitration?filter=all">View all cases</a>
      </div>
    `;
  } else {
    const rows = filteredCases.map(c => {
      const totalPool = c.yesPool + c.noPool;
      let actionHtml = '';
      if (c.statusText === 'DISPUTED') {
        actionHtml = `<a class="btn small primary" href="#/arbitration/${c.id}" style="padding:4px 12px;font-size:12px;">Review Dispute →</a>`;
      } else if (c.statusText === 'PROPOSED') {
        actionHtml = `<a class="btn small secondary" href="#/market/${c.id}" style="padding:4px 12px;font-size:12px;">View Proposal →</a>`;
      } else if (c.statusText === 'OPEN') {
        actionHtml = `<a class="btn small" href="#/market/${c.id}" style="padding:4px 12px;font-size:12px;">View Market →</a>`;
      } else {
        actionHtml = `<a class="btn small" href="#/market/${c.id}" style="padding:4px 12px;font-size:12px;">View Resolution History →</a>`;
      }

      const titleDisplay = c.hasMetadata
        ? escapeHtml(c.title)
        : '<em style="color:var(--text-muted);font-weight:500;">Market metadata unavailable</em>';

      return `
        <tr>
          <td><span class="mono" style="font-weight:600">#${c.id}</span></td>
          <td>
            <div style="font-weight:600;color:var(--text-primary);max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${titleDisplay}
            </div>
            <div class="row" style="gap:6px;margin-top:4px;">
              ${c.category ? `<span class="pill" style="font-size:10px;">${escapeHtml(c.category)}</span>` : ''}
              ${!c.hasMetadata ? `<span class="pill warn" style="font-size:10px;">No Metadata</span>` : ''}
            </div>
          </td>
          <td><span class="badge ${c.statusTone}">${escapeHtml(c.statusText)}</span></td>
          <td class="mono font-stat">${formatQie(totalPool)} ETH</td>
          <td>
            <span class="mono" style="font-size:12px;">${c.closeTime > 0n ? formatDateTime(c.closeTime) : '—'}</span>
          </td>
          <td>
            ${actionHtml}
          </td>
        </tr>
      `;
    }).join('');

    tableContent = `
      <div class="dispute-table-wrap">
        <table class="dispute-table" aria-label="Dispute Queue Cases">
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Market Title</th>
              <th>Status</th>
              <th>Total Stake</th>
              <th>Closing / Deadline</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="arbitration-workspace">
      <div class="arb-header-section">
        <div>
          <div class="eyebrow">DISPUTE RESOLUTION & ARBITRATION WORKSPACE</div>
          <h1 style="margin:4px 0 8px;">Arbitration Queue</h1>
          <p class="muted" style="max-width:760px;line-height:1.6;margin:0;">
            Independent multi-sig dispute resolution workspace. Review contested outcomes, inspect RFC 8785 evidence dossiers, and deliberate with transparent on-chain multisig authority.
          </p>
        </div>
      </div>

      <div class="arb-stats-grid">
        <div class="arb-stat-card">
          <span class="arb-stat-card-label">Active Disputes</span>
          <span class="arb-stat-card-val ${disputedCount > 0 ? 'err' : ''}">${disputedCount}</span>
        </div>
        <div class="arb-stat-card">
          <span class="arb-stat-card-label">Pending Challenge Window</span>
          <span class="arb-stat-card-val">${proposedCount}</span>
        </div>
        <div class="arb-stat-card">
          <span class="arb-stat-card-label">Disputed Pool Volume</span>
          <span class="arb-stat-card-val mono">${formatQie(disputedVolume)} ETH</span>
        </div>
        <div class="arb-stat-card">
          <span class="arb-stat-card-label">Active Authority</span>
          <span class="arb-stat-card-val" style="font-size:15px;color:var(--accent-brand);">Local Arbitration Mock <small style="display:block;font-size:11px;color:var(--text-muted);font-weight:normal;">Threshold ${deployment.manifest.roleMocks.arbitrator.threshold} of ${deployment.manifest.roleMocks.arbitrator.owners.length} · <span class="mono">${escapeHtml(shortAddress(deployment.manifest.roleMocks.arbitrator.address))}</span></small></span>
        </div>
      </div>

      <div class="banner info-banner" style="margin:16px 0 20px;font-size:12px;line-height:1.6;">
        <strong>Local Simulation Disclosure:</strong> Active dispute arbitration in this local development environment is powered by <code>LocalRoleMock</code> (Threshold ${deployment.manifest.roleMocks.arbitrator.threshold}). The production protocol architecture is designed to bind to a canonical 3-of-5 Safe multisig, which is not connected in this local fixture.
      </div>

      <div class="arb-filter-bar" role="tablist" aria-label="Dispute Filters">
        ${tab('disputed', 'Active Disputes', disputedCount)}
        ${tab('proposed', 'Challenge Window', proposedCount)}
        ${tab('finalized', 'Case History', finalizedCount)}
        ${tab('all', 'All Protocol Markets', cases.length)}
      </div>

      ${tableContent}
    </div>
  `;
}

async function renderArbitrationCaseView(view: HTMLElement, id: bigint): Promise<void> {
  const deployment = state.deployment!;
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading case #${id}…</div>`;
  await refreshChainTime();

  let apiDetail: MarketDetail | null = null;
  try {
    const res = await apiClient.getMarket(id);
    apiDetail = res.data;
  } catch {
    // API detail unavailable
  }

  let market: MarketRecord;
  try {
    market = await readMarket(publicClient, deployment.factory, id);
  } catch (error) {
    view.innerHTML = `<div class="card empty-state"><h2>Case not found</h2><p class="err">${escapeHtml(errorMessage(error))}</p><a class="btn primary" href="#/arbitration">Back to Dispute Queue</a></div>`;
    return;
  }

  const now = chainNow();
  const effectiveState = (market.storedState === 0 && now >= Number(market.closeTime)) ? 1 : market.storedState;
  const stateLabel = MARKET_STATE_LABELS[effectiveState] ?? 'UNKNOWN';
  const title = apiDetail?.question || market.metadataURI;
  const account = connectedAccount();

  const arbitratorMock = deployment.manifest.roleMocks.arbitrator;
  const arbitratorOwners: string[] = arbitratorMock.owners ?? [];
  const isAuthorizedOwner = isArbitratorOwner(account, arbitratorOwners);

  const formatEvidenceField = (hash: string | null | undefined): string => {
    if (!hash || isZeroHash(hash)) return '<span class="muted">—</span>';
    return `<button class="evidence-hash-btn mono" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(hash)}" title="Inspect canonical evidence manifest">${escapeHtml(shortAddress(hash))}</button>`;
  };

  const arbitrationOpen = effectiveState === 3 && now < Number(market.arbitrationDeadline);

  // Evidence Dossier
  const evidenceEntries: string[] = [];
  if (!isZeroHash(market.proposalEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-proposal">Proposal Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(market.proposer))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.proposalEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.proposalEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }
  if (!isZeroHash(market.challengeEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-challenge">Challenge Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(market.challenger))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.challengeEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.challengeEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }
  if (!isZeroHash(market.decisionEvidence)) {
    evidenceEntries.push(`
      <div class="evidence-entry-card">
        <div class="evidence-entry-head">
          <span class="evidence-kind-badge evidence-kind-arbitration">Decision Evidence</span>
          <span class="step-time">Submitter: <span class="mono">${escapeHtml(shortAddress(arbitratorMock.address))}</span></span>
        </div>
        <div class="evidence-commitment-box">
          <span>Commitment: <strong class="mono">${escapeHtml(shortAddress(market.decisionEvidence))}</strong></span>
          <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(market.decisionEvidence)}">Inspect Manifest</button>
        </div>
      </div>
    `);
  }

  const dossierHtml = evidenceEntries.length > 0
    ? `<div class="evidence-dossier-list">${evidenceEntries.join('')}</div>`
    : `<p class="muted" style="margin-top:12px;">No evidence artifacts committed yet for this market.</p>`;

  // Owner status pill
  const ownerStatusPill = isAuthorizedOwner
    ? `<span class="pill ok" style="font-weight:600;">✔ Authorized Arbitrator Signer</span>`
    : account
      ? `<span class="pill" style="color:var(--text-muted);">Observer / Read-Only</span>`
      : `<span class="pill" style="color:var(--text-muted);">Wallet Disconnected</span>`;

  // Decision card body
  let decisionBody = '';
  if (effectiveState === 3) {
    decisionBody = `
      <div style="margin-top:16px;">
        <label for="settle-evidence" style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);">
          Arbitrator Decision Evidence (0x…64 or plain text):
        </label>
        <input id="settle-evidence" type="text" placeholder="Decision evidence hash (0x…64) or manifest text" aria-label="Decision evidence" style="width:100%;margin-bottom:12px;" />

        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn yes" type="button" data-action="settle-yes" data-id="${market.id}" ${state.busy || !arbitrationOpen || !isAuthorizedOwner ? 'disabled' : ''}>
            Decide YES
          </button>
          <button class="btn no" type="button" data-action="settle-no" data-id="${market.id}" ${state.busy || !arbitrationOpen || !isAuthorizedOwner ? 'disabled' : ''}>
            Decide NO
          </button>
          <button class="btn" type="button" data-action="settle-invalid" data-id="${market.id}" ${state.busy || !arbitrationOpen || !isAuthorizedOwner ? 'disabled' : ''} style="background:var(--outcome-invalid-bg);color:var(--outcome-invalid);border-color:var(--outcome-invalid-border);">
            Decide INVALID (Refund)
          </button>
        </div>

        ${!isAuthorizedOwner && account ? `
          <p class="muted" style="font-size:12px;margin-top:10px;">
            Your connected wallet (<span class="mono">${escapeHtml(shortAddress(account))}</span>) is not an authorized owner of the local arbitrator contract. Connect an owner wallet to sign decisions.
          </p>
        ` : ''}

        ${!account ? `
          <p class="muted" style="font-size:12px;margin-top:10px;">
            Connect an authorized arbitrator wallet to submit multisig rulings.
          </p>
        ` : ''}
      </div>
    `;
  } else {
    decisionBody = `
      <div style="margin-top:14px;padding:12px;background:var(--bg-elevated);border-radius:6px;border:1px solid var(--border-subtle);font-size:13px;line-height:1.5;">
        <span class="muted">Market is currently in <strong>${stateLabel}</strong> state. Multi-sig arbitrator rulings are only permitted when a market is actively <strong>DISPUTED</strong>.</span>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/arbitration">← Dispute Queue</a>
      ${icon('chevron', 13)}
      <span>Case #${market.id}</span>
    </div>

    <section class="page-head">
      <div class="eyebrow">DISPUTE ARBITRATION CASE #${market.id} · <span class="badge ${stateTone(effectiveState)}">${stateLabel}</span></div>
      <h1 class="market-title-h1">${escapeHtml(title)}</h1>
      ${apiDetail?.description ? `<p style="margin:8px 0 16px;color:var(--text-secondary);font-size:14px;">${escapeHtml(apiDetail.description)}</p>` : ''}
      <div class="row" style="gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);">
        <span>Creator: <strong class="mono">${escapeHtml(shortAddress(market.creator))}</strong></span>
        <span>Resolution Deadline: <strong class="mono">${formatDateTime(market.resolutionTime)}</strong></span>
        <span>Arbitration Deadline: <strong class="mono">${formatDateTime(market.arbitrationDeadline)}</strong></span>
      </div>
    </section>

    <div class="case-detail-layout">
      <!-- Left Column: Dossier, Dispute Facts, Rules -->
      <div class="market-main-col">
        <!-- Contested Claims Comparison -->
        <div class="card" style="padding:22px 24px;">
          <h2 style="font-size:16px;margin:0 0 16px;">Contested Claims & Evidence Comparison</h2>
          <div class="grid-2" style="gap:16px;">
            <div style="padding:14px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;">
              <div class="row space" style="margin-bottom:8px;">
                <span class="pill wait" style="font-size:11px;">PROPOSED RESULT</span>
                <span class="mono" style="font-size:12px;">Bond: ${formatQie(deployment.parameters.proposalBond)} ETH</span>
              </div>
              <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin:6px 0;">
                Outcome: ${OUTCOME_LABELS[market.proposedOutcome]}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
                Proposer: <span class="mono">${isZeroHash(market.proposer) ? '—' : escapeHtml(shortAddress(market.proposer))}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);">
                Evidence: ${formatEvidenceField(market.proposalEvidence)}
              </div>
            </div>

            <div style="padding:14px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;">
              <div class="row space" style="margin-bottom:8px;">
                <span class="pill err" style="font-size:11px;">CHALLENGER OBJECTION</span>
                <span class="mono" style="font-size:12px;">Bond: ${formatQie(deployment.parameters.challengeBond)} ETH</span>
              </div>
              <div style="font-size:18px;font-weight:700;color:var(--status-err);margin:6px 0;">
                Contested / Dispute
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
                Challenger: <span class="mono">${isZeroHash(market.challenger) ? '—' : escapeHtml(shortAddress(market.challenger))}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);">
                Evidence: ${formatEvidenceField(market.challengeEvidence)}
              </div>
            </div>
          </div>
        </div>

        <!-- Rules Callout -->
        <div class="rules-callout">
          <div class="rules-callout-head">
            <span class="rules-callout-title">${icon('shield', 18)} Official Resolution Criteria</span>
          </div>
          <div class="rules-source-link">
            <span>Primary Reference:</span>
            <a href="${escapeHtml(market.metadataURI)}" target="_blank" rel="noopener noreferrer" class="mono">${escapeHtml(market.metadataURI)}</a>
          </div>
          <div class="rules-condition">
            <strong>Arbitration Duty:</strong> Inspect the submitted evidence manifests against the market specification. A ruling of INVALID triggers 1:1 participant stake refunds and neutral bond returns.
          </div>
        </div>

        <!-- Evidence Dossier -->
        <div class="evidence-dossier-card">
          <div class="row space">
            <h2 style="font-size:16px;margin:0;">Evidence Dossier</h2>
            <span class="pill ok">RFC 8785 Canonical JSON</span>
          </div>
          ${dossierHtml}
        </div>
      </div>

      <!-- Right Column: Multisig Decision Console -->
      <div class="market-aside-col">
        <div class="multisig-decision-card">
          <div class="multisig-authority-title">
            <span>Arbitration Authority</span>
            ${ownerStatusPill}
          </div>

          <div class="multisig-simulation-note">
            <strong>LOCAL SIMULATION DISCLOSURE:</strong> Connected to <code>LocalRoleMock</code> at <code class="mono">${escapeHtml(shortAddress(arbitratorMock.address))}</code> (Threshold: ${arbitratorMock.threshold} of ${arbitratorOwners.length}). In local testnet mode, 2 distinct owner confirmations execute decisions. In production, this role is governed by a canonical 3-of-5 Safe multisig.
          </div>

          <div class="multisig-authority-banner">
            <span style="font-size:12px;color:var(--text-muted);font-weight:600;">Authorized Signer Addresses:</span>
            <div class="multisig-owners-list">
              ${arbitratorOwners.map((owner, idx) => {
                const isMe = account ? addressEq(owner, account) : false;
                return `
                  <div class="multisig-owner-tag">
                    <span class="mono">${escapeHtml(shortAddress(owner))} ${isMe ? '(Connected)' : ''}</span>
                    <span class="pill ${isMe ? 'ok' : ''}" style="font-size:10px;">Owner #${idx + 1}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          ${state.multisigNotice ? `<div class="banner warn-text" style="margin-bottom:14px;font-size:12px;line-height:1.5;">${escapeHtml(state.multisigNotice)}</div>` : ''}

          ${decisionBody}

          <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border-subtle);">
            <a class="text-btn" href="#/market/${market.id}" style="font-size:13px;">View Full Market Page →</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCreateView(view: HTMLElement): void {
  const deployment = state.deployment!;
  const params = deployment.parameters;
  const manifest = deployment.manifest;
  const now = chainNow();
  const toDateInput = (seconds: number) => {
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const defaultClose = now + 7 * 86400; // 7 days close
  const defaultResolution = defaultClose;
  const defaultMax = defaultResolution + params.challengePeriod + params.arbitrationPeriod + 48 * 3600 + 3600;

  view.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">Markets</a>
      ${icon('chevron', 13)}
      <span>Create market</span>
    </div>

    <section class="page-head">
      <div class="eyebrow">LOCAL SELECTED PROTOCOL · CHAIN ${LOCAL_CHAIN_ID}</div>
      <div class="split" style="align-items:flex-start;">
        <div>
          <h1 class="market-title-h1">Create Market</h1>
          <p style="font-size:15px;color:var(--text-secondary);margin:4px 0 8px;font-weight:500;">Predict What's Next. Own Your Conviction.</p>
          <p class="muted" style="margin:0;">Creation bond is <strong>${formatQie(params.creationBond)} ETH</strong> (100% refunded upon settlement). Times are evaluated against the local blockchain clock.</p>
        </div>
        <button class="btn secondary" type="button" data-action="fill-gold-preset">
          ${icon('search', 15)} <span>Load Gold Benchmark Preset</span>
        </button>
      </div>
    </section>

    <form id="create-form" class="wizard-form">
      <!-- 4-STEP PROGRESSIVE DISCLOSURE TABS -->
      <div class="wizard-steps-nav" role="tablist" aria-label="Creation Steps">
        <button type="button" class="wizard-step-tab ${state.createWizardStep === 1 ? 'active' : ''} ${state.createWizardStep > 1 ? 'completed' : ''}" data-step="1">
          <span class="wizard-step-num">1</span>
          <span>Question & Category</span>
        </button>
        <button type="button" class="wizard-step-tab ${state.createWizardStep === 2 ? 'active' : ''} ${state.createWizardStep > 2 ? 'completed' : ''}" data-step="2">
          <span class="wizard-step-num">2</span>
          <span>Rules & Sources</span>
        </button>
        <button type="button" class="wizard-step-tab ${state.createWizardStep === 3 ? 'active' : ''} ${state.createWizardStep > 3 ? 'completed' : ''}" data-step="3">
          <span class="wizard-step-num">3</span>
          <span>Timeline & Floors</span>
        </button>
        <button type="button" class="wizard-step-tab ${state.createWizardStep === 4 ? 'active' : ''}" data-step="4">
          <span class="wizard-step-num">4</span>
          <span>Review & Submit</span>
        </button>
      </div>

      <!-- STEP 1: QUESTION & CLASSIFICATION -->
      <div class="card wizard-section" id="step-1-card" style="display: ${state.createWizardStep === 1 ? 'block' : 'none'};">
        <div class="wizard-section-header">
          <div class="wizard-step-badge">01</div>
          <div>
            <h2 class="wizard-section-title">Market Question & Classification</h2>
            <p class="wizard-section-desc">Define a clear, binary proposition resolvable strictly to YES or NO.</p>
          </div>
        </div>
        <div class="wizard-body">
          <label class="field-label">
            <span>Market Question <span class="required">*</span></span>
            <span class="field-hint">Must end with a question mark (?) and contain at least 15 characters. Avoid ambiguous or subjective wording.</span>
            <input name="question" id="input-question" type="text" required minlength="15" maxlength="256" placeholder="Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?" />
          </label>

          <div class="grid-2">
            <label class="field-label">
              <span>Category <span class="required">*</span></span>
              <span class="field-hint">Select the primary domain for discovery filtering.</span>
              <select name="category" id="select-category" required>
                ${VALID_MARKET_CATEGORIES.map((c) => `<option value="${c.slug}">${c.label}</option>`).join('')}
              </select>
            </label>

            <label class="field-label">
              <span>Description & Context (Optional)</span>
              <span class="field-hint">Provide operational context, price denomination, or market scope.</span>
              <input name="description" id="input-description" type="text" maxlength="4000" placeholder="LBMA Gold Price PM benchmark settlement for December 31, 2026." />
            </label>
          </div>

          <div class="wizard-nav-buttons">
            <div></div>
            <button class="btn primary" type="button" data-action="next-step-1">
              <span>Continue to Rules & Sources</span> ${icon('chevron', 14)}
            </button>
          </div>
        </div>
      </div>

      <!-- STEP 2: RESOLUTION RULES & SOURCES -->
      <div class="card wizard-section" id="step-2-card" style="display: ${state.createWizardStep === 2 ? 'block' : 'none'};">
        <div class="wizard-section-header">
          <div class="wizard-step-badge">02</div>
          <div>
            <h2 class="wizard-section-title">Objective Resolution Rules & Criteria</h2>
            <p class="wizard-section-desc">Specify authoritative data sources and deterministic conditions for each outcome.</p>
          </div>
        </div>
        <div class="wizard-body">
          <div class="grid-2">
            <label class="field-label">
              <span>Primary Resolution Source URL <span class="required">*</span></span>
              <span class="field-hint">Publicly accessible primary reference (https://, ipfs://, or ar://).</span>
              <input name="primarySource" id="input-primarySource" type="text" required placeholder="https://www.lbma.org.uk/prices-and-data/precious-metal-prices" />
            </label>

            <label class="field-label">
              <span>Fallback Resolution Source URL (Optional)</span>
              <span class="field-hint">Backup source if the primary source is offline, corrupted, or delayed.</span>
              <input name="fallbackSource" id="input-fallbackSource" type="text" placeholder="https://www.bloomberg.com/quote/GOLD:CUR" />
            </label>
          </div>

          <div class="criteria-grid">
            <label class="field-label">
              <span>YES Resolution Criteria <span class="required">*</span></span>
              <span class="field-hint">Exact condition(s) required to settle YES.</span>
              <textarea name="yesCriteria" id="input-yesCriteria" rows="3" required placeholder="LBMA Gold Price PM (XAU/USD) is strictly greater than or equal to $2,800.00 USD on December 31, 2026."></textarea>
            </label>

            <label class="field-label">
              <span>NO Resolution Criteria <span class="required">*</span></span>
              <span class="field-hint">Exact condition(s) required to settle NO.</span>
              <textarea name="noCriteria" id="input-noCriteria" rows="3" required placeholder="LBMA Gold Price PM (XAU/USD) is strictly less than $2,800.00 USD on December 31, 2026."></textarea>
            </label>
          </div>

          <label class="field-label">
            <span>INVALID Criteria & Neutral Refund Terms <span class="required">*</span></span>
            <span class="field-hint">Protocol Invariant: INVALID returns 100% of all contributions 1:1 with 0% fee deducted.</span>
            <textarea name="invalidCriteria" id="input-invalidCriteria" rows="3" required placeholder="LBMA does not publish an official PM benchmark price for 2026-12-31 by 2027-01-02 18:00 UTC, or market trading is interrupted. Neutral refund: 100% of all contributions are refunded 1:1 with zero protocol fee deducted."></textarea>
          </label>

          <div class="rule-callout">
            <div class="rule-callout-icon">${icon('shield', 18)}</div>
            <div class="rule-callout-body">
              <div class="rule-callout-title">Neutral-INVALID Invariant (ADR-0010)</div>
              <p>If benchmark data is unavailable or the proposition cannot be verified, ORAKL guarantees full capital preservation. No creator fee, protocol fee, or slashing is assessed on INVALID outcomes.</p>
            </div>
          </div>

          <div class="wizard-nav-buttons">
            <button class="btn ghost" type="button" data-action="prev-step-2">← Back to Question</button>
            <button class="btn primary" type="button" data-action="next-step-2">
              <span>Continue to Timeline Floors</span> ${icon('chevron', 14)}
            </button>
          </div>
        </div>
      </div>

      <!-- STEP 3: PARAMETER-VALIDATED TIMELINE -->
      <div class="card wizard-section" id="step-3-card" style="display: ${state.createWizardStep === 3 ? 'block' : 'none'};">
        <div class="wizard-section-header">
          <div class="wizard-step-badge">03</div>
          <div>
            <h2 class="wizard-section-title">Parameter-Validated Timeline & Floors</h2>
            <p class="wizard-section-desc">Enforce protocol-mandated challenge and arbitration duration floors.</p>
          </div>
        </div>
        <div class="wizard-body">
          <div class="grid-3">
            <label class="field-label">
              <span>Market Close Time <span class="required">*</span></span>
              <span class="field-hint">Contributions halt at this block timestamp.</span>
              <input name="closeTime" id="input-closeTime" type="datetime-local" required value="${toDateInput(defaultClose)}" />
            </label>

            <label class="field-label">
              <span>Resolution Start Time <span class="required">*</span></span>
              <span class="field-hint">Must be >= Market Close Time.</span>
              <input name="resolutionTime" id="input-resolutionTime" type="datetime-local" required value="${toDateInput(defaultResolution)}" />
            </label>

            <label class="field-label">
              <span>Max Resolution Deadline <span class="required">*</span></span>
              <span class="field-hint">Must be >= Resolution Time + 192 hours.</span>
              <input name="maxResolutionTime" id="input-maxResolutionTime" type="datetime-local" required value="${toDateInput(defaultMax)}" />
            </label>
          </div>

          <!-- Live Timeline Floor Calculator & Diagnostic -->
          <div class="timeline-floor-card" id="timeline-floor-card">
            <div class="timeline-floor-header">
              <span class="mono" style="font-size:11px;font-weight:700;letter-spacing:0.05em;color:var(--text-muted);">PROTOCOL DEADLINE FLOOR VERIFICATION</span>
              <span id="timeline-floor-status" class="badge-status ok">FLOOR SATISFIED (+192h)</span>
            </div>
            <div class="timeline-floor-body">
              <div class="timeline-math-row">
                <span class="math-term">Challenge Window: <strong>${params.challengePeriod / 3600}h (48h)</strong></span>
                <span class="math-op">+</span>
                <span class="math-term">Arbitration Window: <strong>${params.arbitrationPeriod / 3600}h (96h)</strong></span>
                <span class="math-op">+</span>
                <span class="math-term">Safety Buffer: <strong>48h</strong></span>
                <span class="math-op">=</span>
                <span class="math-total">Minimum Span: <strong>192h (8 days)</strong></span>
              </div>
              <p id="timeline-floor-explainer" class="muted" style="margin-top:8px;font-size:12px;">
                The protocol enforces <code class="mono">maxResolutionTime >= resolutionTime + 192h</code> to guarantee sufficient liveness for multi-challenger tranches and arbitration deliberation.
              </p>
              <div style="margin-top:10px;">
                <button type="button" class="btn small" data-action="auto-floor-deadline">
                  ${icon('sparkles', 13)} <span>Auto-Set Protocol Minimum Floor (+193h)</span>
                </button>
              </div>
            </div>
          </div>

          <div class="security-lock-box" style="margin-top:16px;">
            <div class="security-lock-head">
              <div class="security-badge">${icon('shield', 15)} PROTOCOL GOVERNANCE GUARANTEE</div>
              <span class="mono" style="font-size:11px;">${escapeHtml(manifest.roleMocks.arbitrator.address)}</span>
            </div>
            <p class="security-lock-text">
              <strong>Decentralized Escalation:</strong> Unlike legacy QIE Predict where market creators could appoint arbitrary resolver wallets, ORAKL v1 enforces strict protocol-governed arbitration via an authorized Local Arbitration Mock (simulated with Threshold 2). Creators cannot designate private resolvers or manipulate dispute settlement.
            </p>
          </div>

          <div class="wizard-nav-buttons">
            <button class="btn ghost" type="button" data-action="prev-step-3">← Back to Rules</button>
            <button class="btn primary" type="button" data-action="next-step-3">
              <span>Continue to Review & Submit</span> ${icon('chevron', 14)}
            </button>
          </div>
        </div>
      </div>

      <!-- STEP 4: PRE-FLIGHT REVIEW & SUBMISSION -->
      <div class="card wizard-section" id="step-4-card" style="display: ${state.createWizardStep === 4 ? 'block' : 'none'};">
        <div class="wizard-section-header">
          <div class="wizard-step-badge">04</div>
          <div>
            <h2 class="wizard-section-title">Pre-Flight Review & Submission</h2>
            <p class="wizard-section-desc">Audit parameters and permanent on-chain metadata commitments prior to signing.</p>
          </div>
        </div>
        <div class="wizard-body">
          <div class="preflight-summary-card" id="section-review">
            <div class="preflight-grid">
              <div class="preflight-item">
                <span class="preflight-label">Market Question</span>
                <div id="review-question" class="preflight-value highlight">— (Please enter a question)</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Category</span>
                <div id="review-category" class="preflight-value mono">crypto</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Primary Source</span>
                <div id="review-source" class="preflight-value mono small-url">—</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Close Time (Chain)</span>
                <div id="review-close" class="preflight-value mono">—</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Resolution Start</span>
                <div id="review-res" class="preflight-value mono">—</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Max Resolution Deadline</span>
                <div id="review-max" class="preflight-value mono">—</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Creation Bond Required</span>
                <div class="preflight-value mono ok">${formatQie(params.creationBond)} ETH (100% Refundable)</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Network & Chain ID</span>
                <div class="preflight-value mono">${LOCAL_CHAIN_ID} (Anvil Isolated)</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Target Factory</span>
                <div class="preflight-value mono small-url">${escapeHtml(deployment.factory)}</div>
              </div>
              <div class="preflight-item">
                <span class="preflight-label">Connected Wallet</span>
                <div id="review-wallet" class="preflight-value mono small-url">${connectedAccount() ? escapeHtml(connectedAccount()!) : 'Wallet Disconnected'}</div>
              </div>
            </div>

            <div class="preflight-criteria-box">
              <span class="preflight-label">Compiled Resolution Criteria Preview:</span>
              <pre id="review-criteria-blob" class="preflight-criteria-code mono"></pre>
            </div>

            <!-- Advanced Details Cryptographic Disclosure -->
            <details class="tech-disclosure" style="margin:16px 0;">
              <summary>Advanced: Cryptographic Manifest & RFC 8785 Commitment</summary>
              <div class="tech-disclosure-body">
                <div class="publication-status-box" id="publication-status-box" style="margin:0;">
                  <div class="status-indicator">
                    <span class="status-dot"></span>
                    <span id="publication-status-text">Ready for parameter validation & canonical hashing</span>
                  </div>
                  <div id="publication-details" class="mono" style="display:none;margin-top:8px;font-size:12px;word-break:break-all;"></div>
                </div>
              </div>
            </details>

            <label class="immutability-check-label">
              <input type="checkbox" id="confirm-immutability" name="confirmImmutability" required />
              <span>I understand this market's resolution rules, sources, and timeline are permanent and cannot be modified after creation.</span>
            </label>
          </div>

          <div id="create-validation-errors" class="validation-err-container" style="display:none;margin-top:16px;"></div>

          <div class="wizard-nav-buttons">
            <button class="btn ghost" type="button" data-action="prev-step-4">← Back to Timeline</button>
            <div class="row" style="gap:8px;flex-wrap:wrap;">
              <button class="btn secondary" type="button" data-action="validate-create-form">
                ${icon('search', 15)} <span>Validate Commitment</span>
              </button>
              <button class="btn primary" type="submit" id="btn-submit-create" ${state.busy || !connectedAccount() ? 'disabled' : ''}>
                <span>Publish & Create Market · ${formatQie(params.creationBond)} ETH</span>
              </button>
            </div>
          </div>
          ${connectedAccount() ? '' : '<p class="muted" style="margin-top:10px;text-align:right;">Connect your wallet on local chain 31337 to submit the market creation transaction.</p>'}
        </div>
      </div>
    </form>
  `;

  setTimeout(updateCreateFormPreview, 0);
}

function setWizardStep(step: number): void {
  state.createWizardStep = step;
  const s1 = document.getElementById('step-1-card');
  const s2 = document.getElementById('step-2-card');
  const s3 = document.getElementById('step-3-card');
  const s4 = document.getElementById('step-4-card');
  if (s1) s1.style.display = step === 1 ? 'block' : 'none';
  if (s2) s2.style.display = step === 2 ? 'block' : 'none';
  if (s3) s3.style.display = step === 3 ? 'block' : 'none';
  if (s4) s4.style.display = step === 4 ? 'block' : 'none';

  document.querySelectorAll<HTMLButtonElement>('.wizard-step-tab').forEach((tab) => {
    const tabStep = Number(tab.dataset.step);
    tab.classList.toggle('active', tabStep === step);
    tab.classList.toggle('completed', tabStep < step);
  });
  updateCreateFormPreview();
}

function autoSetTimelineFloor(): void {
  const form = document.getElementById('create-form') as HTMLFormElement | null;
  if (!form) return;
  const deployment = state.deployment;
  if (!deployment) return;
  const resInput = form.elements.namedItem('resolutionTime') as HTMLInputElement | null;
  const maxInput = form.elements.namedItem('maxResolutionTime') as HTMLInputElement | null;
  if (resInput && maxInput && resInput.value) {
    const resSec = BigInt(Math.floor(new Date(resInput.value).getTime() / 1000));
    const minMaxSec =
      calculateMinimumMaxResolutionTime(
        resSec,
        deployment.parameters.challengePeriod,
        deployment.parameters.arbitrationPeriod,
      ) + 3600n; // +1 hour margin
    const d = new Date(Number(minMaxSec) * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    maxInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    updateCreateFormPreview();
    flash('ok', 'Timeline floor set: Max resolution time extended to meet 192h requirement.');
  }
}

function updateCreateFormPreview(): void {
  const form = document.getElementById('create-form') as HTMLFormElement | null;
  if (!form) return;
  const deployment = state.deployment;
  if (!deployment) return;

  const data = new FormData(form);
  const question = String(data.get('question') ?? '').trim();
  const category = String(data.get('category') ?? '').trim();
  const primarySource = String(data.get('primarySource') ?? '').trim();
  const fallbackSource = String(data.get('fallbackSource') ?? '').trim();
  const yesCriteria = String(data.get('yesCriteria') ?? '').trim();
  const noCriteria = String(data.get('noCriteria') ?? '').trim();
  const invalidCriteria = String(data.get('invalidCriteria') ?? '').trim();
  const closeInput = String(data.get('closeTime') ?? '');
  const resInput = String(data.get('resolutionTime') ?? '');
  const maxInput = String(data.get('maxResolutionTime') ?? '');

  const qEl = document.getElementById('review-question');
  if (qEl) qEl.textContent = question || '— (Please enter a question)';

  const catEl = document.getElementById('review-category');
  if (catEl) catEl.textContent = category || '—';

  const srcEl = document.getElementById('review-source');
  if (srcEl) srcEl.textContent = primarySource ? (fallbackSource ? `${primarySource} (Fallback: ${fallbackSource})` : primarySource) : '—';

  const closeEl = document.getElementById('review-close');
  if (closeEl) closeEl.textContent = closeInput ? new Date(closeInput).toLocaleString() : '—';

  const resEl = document.getElementById('review-res');
  if (resEl) resEl.textContent = resInput ? new Date(resInput).toLocaleString() : '—';

  const maxEl = document.getElementById('review-max');
  if (maxEl) maxEl.textContent = maxInput ? new Date(maxInput).toLocaleString() : '—';

  const blobEl = document.getElementById('review-criteria-blob');
  if (blobEl) {
    blobEl.textContent = formatResolutionCriteriaBlob({
      yes: yesCriteria || 'None specified yet',
      no: noCriteria || 'None specified yet',
      invalid: invalidCriteria || 'None specified yet',
      fallback: fallbackSource,
    });
  }

  // Check timeline floor
  const floorStatusEl = document.getElementById('timeline-floor-status');
  const floorExplainerEl = document.getElementById('timeline-floor-explainer');
  if (resInput && maxInput) {
    const resSec = BigInt(Math.floor(new Date(resInput).getTime() / 1000));
    const maxSec = BigInt(Math.floor(new Date(maxInput).getTime() / 1000));
    const minMaxSec = calculateMinimumMaxResolutionTime(
      resSec,
      deployment.parameters.challengePeriod,
      deployment.parameters.arbitrationPeriod,
    );
    const requiredHours = (deployment.parameters.challengePeriod + deployment.parameters.arbitrationPeriod) / 3600 + 48;
    if (maxSec >= minMaxSec) {
      if (floorStatusEl) {
        floorStatusEl.className = 'badge-status ok';
        floorStatusEl.textContent = 'FLOOR SATISFIED (+192h)';
      }
      if (floorExplainerEl) {
        floorExplainerEl.className = 'muted';
        floorExplainerEl.textContent = `Valid timeline floor: max resolution time provides at least ${requiredHours}h after resolution start time for challenge (48h), arbitration (96h), and safety buffer (48h).`;
      }
    } else {
      if (floorStatusEl) {
        floorStatusEl.className = 'badge-status err';
        floorStatusEl.textContent = 'FLOOR VIOLATED';
      }
      if (floorExplainerEl) {
        floorExplainerEl.className = 'err-text';
        floorExplainerEl.textContent = `REJECTION WARNING: Max resolution time must be at least ${requiredHours}h (${new Date(Number(minMaxSec) * 1000).toLocaleString()}) after resolution start time. The on-chain factory will revert with InvalidTime().`;
      }
    }
  }
}

function fillGoldPreset(): void {
  const form = document.getElementById('create-form') as HTMLFormElement | null;
  if (!form) return;
  const deployment = state.deployment;
  if (!deployment) return;

  const setVal = (name: string, val: string) => {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el) el.value = val;
  };

  setVal('question', GOLD_BENCHMARK_PRESET.question);
  setVal('category', GOLD_BENCHMARK_PRESET.category);
  setVal('description', GOLD_BENCHMARK_PRESET.description);
  setVal('primarySource', GOLD_BENCHMARK_PRESET.primarySource);
  setVal('fallbackSource', GOLD_BENCHMARK_PRESET.fallbackSource);
  setVal('yesCriteria', GOLD_BENCHMARK_PRESET.yesCriteria);
  setVal('noCriteria', GOLD_BENCHMARK_PRESET.noCriteria);
  setVal('invalidCriteria', GOLD_BENCHMARK_PRESET.invalidCriteria);

  const now = chainNow();
  const defaultClose = now + 7 * 86400; // 7 days close
  const defaultResolution = defaultClose;
  const defaultMax = defaultResolution + deployment.parameters.challengePeriod + deployment.parameters.arbitrationPeriod + 48 * 3600 + 3600;

  const toDateInput = (seconds: number) => {
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  setVal('closeTime', toDateInput(defaultClose));
  setVal('resolutionTime', toDateInput(defaultResolution));
  setVal('maxResolutionTime', toDateInput(defaultMax));

  const check = form.querySelector<HTMLInputElement>('#confirm-immutability');
  if (check) check.checked = true;

  updateCreateFormPreview();
  flash('ok', 'Loaded LBMA Gold Price PM Benchmark template with verified 192h timeline.');
}

function validateCreateFormAction(form: HTMLFormElement): void {
  const deployment = state.deployment;
  if (!deployment) return;
  const data = new FormData(form);
  const question = String(data.get('question') ?? '').trim();
  const category = String(data.get('category') ?? '').trim();
  const description = String(data.get('description') ?? '').trim();
  const primarySource = String(data.get('primarySource') ?? '').trim();
  const fallbackSource = String(data.get('fallbackSource') ?? '').trim();
  const yesCriteria = String(data.get('yesCriteria') ?? '').trim();
  const noCriteria = String(data.get('noCriteria') ?? '').trim();
  const invalidCriteria = String(data.get('invalidCriteria') ?? '').trim();

  const closeInput = String(data.get('closeTime') ?? '');
  const resolutionInput = String(data.get('resolutionTime') ?? '');
  const maxInput = String(data.get('maxResolutionTime') ?? '');

  const closeTime = BigInt(Math.floor(new Date(closeInput).getTime() / 1000));
  const resolutionTime = BigInt(Math.floor(new Date(resolutionInput).getTime() / 1000));
  const maxResolutionTime = BigInt(Math.floor(new Date(maxInput).getTime() / 1000));
  const now = BigInt(chainNow());

  const formValues: CreateMarketFormValues = {
    question,
    category,
    description,
    primarySource,
    fallbackSource,
    yesCriteria,
    noCriteria,
    invalidCriteria,
    closeTimeSec: closeTime,
    resolutionTimeSec: resolutionTime,
    maxResolutionTimeSec: maxResolutionTime,
    nowSec: now,
    challengePeriodSec: deployment.parameters.challengePeriod,
    arbitrationPeriodSec: deployment.parameters.arbitrationPeriod,
  };

  const validation = validateMarketCreationInput(formValues);
  const errorContainer = document.getElementById('create-validation-errors');
  const statusText = document.getElementById('publication-status-text');
  const statusDetails = document.getElementById('publication-details');

  if (!validation.ok) {
    if (errorContainer) {
      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `<strong>Creation Validation Failed:</strong><ul style="margin:6px 0 0;padding-left:18px;">${validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    }
    if (statusText) statusText.textContent = 'Validation failed — please review errors above';
    flash('err', validation.errors[0] || 'Validation failed.');
    return;
  }

  if (errorContainer) errorContainer.style.display = 'none';

  const manifest: MarketMetadataManifest = {
    schema: 'orakl-market-metadata-v1',
    chainId: String(LOCAL_CHAIN_ID),
    factory: deployment.factory.toLowerCase(),
    question,
    description: description || question,
    category,
    resolutionCriteria: formatResolutionCriteriaBlob({
      yes: yesCriteria,
      no: noCriteria,
      invalid: invalidCriteria,
      fallback: fallbackSource,
    }),
    sources: fallbackSource ? [primarySource, fallbackSource] : [primarySource],
    creator: (connectedAccount() ?? '0x0000000000000000000000000000000000000000').toLowerCase(),
    createdAt: String(chainNow()),
  };

  const canonicalString = canonicalizeMarketMetadata(manifest);
  const metadataHash = evidenceContentHash(canonicalString);

  if (statusText) statusText.textContent = 'All parameters validated! RFC 8785 commitment verified.';
  if (statusDetails) {
    statusDetails.style.display = 'block';
    statusDetails.innerHTML = `Verified Commitment: <code class="mono">${metadataHash}</code><br/>Canonical Bytes: ${canonicalString.length} chars`;
  }
  flash('ok', 'Form parameters are valid. Ready to sign and submit.');
}

function renderEvidenceView(view: HTMLElement): void {
  const account = connectedAccount();
  const markets = state.markets;

  const marketOptions = markets.length > 0
    ? markets.map((m) => `<option value="${m.id}">Market #${m.id}: ${escapeHtml(m.title)} (${m.statusText})</option>`).join('')
    : '<option value="0">Market #0 (Default)</option>';

  view.innerHTML = `
    <div class="breadcrumbs"><a href="#/">Markets</a>${icon('chevron', 13)}<span>Evidence lab</span></div>
    <section class="page-head">
      <div class="eyebrow">EVIDENCE PROFILE V1 · RFC 8785 CANONICAL JSON</div>
      <h1>Evidence Lab</h1>
      <p class="muted" style="max-width:760px;line-height:1.6;">
        Construct and cryptographically commit evidence manifests for market proposals, challenges, or arbitration decisions.
        Manifests are canonicalized per RFC 8785 and committed on-chain via deterministic Keccak-256 hashes.
      </p>
    </section>

    <!-- Disclaimer Alert -->
    <div class="banner warn-banner" style="margin-bottom:20px;font-size:12px;line-height:1.6;">
      <strong>Cryptographic Commitment vs Factual Truthfulness:</strong> A verified Keccak-256 commitment proves that the submitted evidence bytes have not been tampered with since publication. It does <em>not</em> prove that third-party statements or external data sources are factually true or authentic. Dispute participants and arbitrators are responsible for evaluating the credibility and veracity of all cited facts.
    </div>

    <form id="evidence-form" class="card" style="padding:24px;">
      <h2 style="font-size:16px;margin:0 0 16px;">Evidence Manifest Specification</h2>
      <div class="grid-2" style="gap:16px;margin-bottom:16px;">
        <label class="field-label">
          <span>Target Market <span class="required">*</span></span>
          <span class="field-hint">Select a local market or specify ID</span>
          <select name="marketId" id="evidence-market-select">
            ${marketOptions}
          </select>
        </label>

        <label class="field-label">
          <span>Evidence Kind & Lifecycle Stage <span class="required">*</span></span>
          <span class="field-hint">Role of this submission in the resolution process</span>
          <select name="kind">
            ${EVIDENCE_KINDS.map((k) => `<option value="${k}">${k === 'proposal' ? 'Optimistic Proposal Evidence' : k === 'objection' ? 'Challenge Objection Evidence' : k === 'decision' ? 'Arbitrator Decision Dossier' : 'Supplemental Citation'} (${k})</option>`).join('')}
          </select>
        </label>

        <label class="field-label">
          <span>Supported Outcome Claim <span class="required">*</span></span>
          <span class="field-hint">Which outcome does this evidence argue for?</span>
          <select name="claim">
            <option value="YES">YES</option>
            <option value="NO">NO</option>
            <option value="INVALID">INVALID (Neutral 100% Refund)</option>
          </select>
        </label>

        <label class="field-label">
          <span>Primary Source Citation URL <span class="required">*</span></span>
          <span class="field-hint">Publicly verifiable reference (https://, ipfs://, or ar://)</span>
          <input name="source" type="text" required placeholder="https://www.lbma.org.uk/... or official source URL" />
        </label>
      </div>

      <label class="field-label" style="margin-bottom:16px;">
        <span>Supporting Evidence Text / Exact Content Bytes <span class="required">*</span></span>
        <span class="field-hint">The content string to be canonicalized and hashed to contentHash</span>
        <textarea name="content" rows="4" required placeholder="Paste the exact settlement record, excerpt, or observational evidence here..."></textarea>
      </label>

      <!-- Advanced Technical Parameters Disclosure -->
      <details class="tech-disclosure" style="margin-bottom:20px;">
        <summary>Advanced Cryptographic Parameters</summary>
        <div class="tech-disclosure-body">
          <div class="grid-2" style="gap:12px;margin-top:6px;">
            <label class="field-label">
              <span>Proposed Outcome Tag</span>
              <select name="proposedOutcome">
                <option value="NONE">NONE (Default)</option>
                <option value="YES">YES</option>
                <option value="NO">NO</option>
                <option value="INVALID">INVALID</option>
              </select>
            </label>

            <label class="field-label">
              <span>Publisher Address</span>
              <input name="publisher" type="text" class="mono" value="${account ? account.toLowerCase() : ''}" placeholder="0x…" />
            </label>

            <label class="field-label">
              <span>Content Media Type</span>
              <input name="contentMediaType" type="text" value="text/plain" />
            </label>
          </div>
        </div>
      </details>

      <div class="row" style="gap:12px;flex-wrap:wrap;">
        <button class="btn" type="submit">Compute Commitment Hash</button>
        <button class="btn primary" type="button" data-action="publish-evidence-node">Publish Manifest to Local Node</button>
      </div>

      <div id="evidence-publish-result" style="margin-top:14px;"></div>
      <pre id="evidence-output" class="mono prewrap" style="margin-top:14px;display:none;"></pre>
    </form>
  `;
}

async function renderStatusView(view: HTMLElement): Promise<void> {
  const deployment = state.deployment!;
  view.innerHTML = `<div class="card"><span class="spinner"></span> Reading protocol accounting…</div>`;
  let accounting;
  try {
    accounting = await readAccounting(publicClient, deployment.factory);
  } catch (error) {
    view.innerHTML = `<div class="card empty-state"><h2>Accounting unreadable</h2><p class="err">${escapeHtml(errorMessage(error))}</p></div>`;
    return;
  }
  const invariant = accountingInvariant(accounting);
  const manifest = deployment.manifest;

  view.innerHTML = `
    <section class="page-head">
      <div class="eyebrow">LOCAL SIMULATION · ANVIL CHAIN ID ${LOCAL_CHAIN_ID}</div>
      <h1>Protocol Status & Accounting</h1>
      <p class="muted">
        Live on-chain ledger state read directly from the verified SelectedMarketFactory and ProtocolConfig contracts on the local Anvil development node.
      </p>
    </section>

    <div class="summary-grid">
      <div>
        <span>Financial Execution</span>
        <b class="ok" style="font-size:16px;">Enabled in local simulation</b>
      </div>
      <div>
        <span>Total Markets</span>
        <b>${accounting.marketCount}</b>
      </div>
      <div>
        <span>Contract Balance</span>
        <b>${formatQie(accounting.contractBalance)} ETH</b>
      </div>
      <div>
        <span>Invariant Accounting</span>
        <b class="${invariant.ok ? 'ok' : 'err'}">${invariant.ok ? 'Balanced (0.00 delta)' : `Delta: ${formatQie(invariant.delta)} ETH`}</b>
      </div>
    </div>

    <!-- Exposure Caps & Liabilities Card -->
    <div class="card" style="padding:24px;">
      <div class="section-label" style="margin-bottom:18px;">
        ${icon('shield', 20)}
        <h2>Exposure Caps & Protocol Liabilities</h2>
      </div>
      <div class="grid-2" style="gap:16px;">
        <div class="stat-card">
          <span>Global Unresolved Exposure Cap</span>
          <strong>${formatQie(accounting.totalUnresolvedExposure)} / ${formatQie(deployment.parameters.globalUnresolvedCap)} ETH</strong>
        </div>
        <div class="stat-card">
          <span>Unaccounted Surplus Balance</span>
          <strong>${formatQie(accounting.unaccountedBalance)} ETH</strong>
        </div>
        <div class="stat-card">
          <span>Participant Pool Liability</span>
          <strong>${formatQie(accounting.participantLiability)} ETH</strong>
        </div>
        <div class="stat-card">
          <span>Protocol Fee Liability</span>
          <strong>${formatQie(accounting.feeLiability)} ETH</strong>
        </div>
        <div class="stat-card">
          <span>Active Bond Liability</span>
          <strong>${formatQie(accounting.bondLiability)} ETH</strong>
        </div>
        <div class="stat-card">
          <span>Contributions Received / Paid Out</span>
          <strong>${formatQie(accounting.totalContributions)} ETH / ${formatQie(accounting.totalParticipantPaid)} ETH</strong>
        </div>
      </div>
    </div>

    <!-- Technical Deployment Identity -->
    <div class="card" style="padding:24px;">
      <div class="section-label" style="margin-bottom:18px;">
        ${icon('settings', 20)}
        <h2>Technical Deployment Identity & Verified Contracts</h2>
      </div>
      <div class="grid-2" style="gap:16px;font-size:13px;">
        <div><span class="muted">Factory Contract:</span> <div class="mono" style="word-break:break-all;">${escapeHtml(deployment.factory)}</div></div>
        <div><span class="muted">ProtocolConfig Contract:</span> <div class="mono" style="word-break:break-all;">${escapeHtml(deployment.config)}</div></div>
        <div><span class="muted">Active Arbitrator Authority:</span> <div class="mono" style="word-break:break-all;">${escapeHtml(manifest.roleMocks.arbitrator.address)} (LocalRoleMock · Threshold ${manifest.roleMocks.arbitrator.threshold} of ${manifest.roleMocks.arbitrator.owners.length})</div></div>
        <div><span class="muted">Release Digest:</span> <div class="mono" style="word-break:break-all;">${escapeHtml(manifest.release.digest)}</div></div>
        <div><span class="muted">Runtime Bytecode Verification:</span> <div class="ok font-stat">Verified (Keccak-256 matched bytecode)</div></div>
        <div><span class="muted">Local RPC Endpoint:</span> <div class="mono">${escapeHtml(LOCAL_RPC_URL)}</div></div>
      </div>
      <div class="banner warn-banner" style="margin-top:20px;">
        <strong>Safety & Deployment Boundary:</strong> ${escapeHtml(manifest.safety.note)}
        <div class="muted" style="margin-top:4px;font-size:11px;">publicDeployment: false · productionApproval: false · realFunds: false</div>
      </div>
    </div>
  `;
}

async function renderPortfolioView(view: HTMLElement): Promise<void> {
  const account = connectedAccount();
  if (!account) {
    view.innerHTML = `
      <section class="page-head">
        <div class="eyebrow">PORTFOLIO</div>
        <h1>Your Portfolio</h1>
        <p class="muted">Track your positions, dispute stakes, and claimable reward payouts.</p>
      </section>
      <div class="card empty-state" style="padding:48px 24px;">
        <span class="empty-icon">${icon('wallet', 36)}</span>
        <h2>Connect Wallet to View Portfolio</h2>
        <p class="muted" style="max-width:440px;margin:8px auto 20px;line-height:1.6;">
          No local wallet is connected. Connect a local development account on Anvil (Chain ID 31337) to inspect your positions and claimable bond payouts.
        </p>
        <button class="btn primary wallet-button" type="button" data-action="connect-first">
          ${icon('wallet', 16)} <span>Connect Local Wallet</span>
        </button>
      </div>`;
    return;
  }

  const deployment = state.deployment;
  if (!deployment) {
    view.innerHTML = `<div class="card"><span class="spinner"></span> Loading protocol deployment…</div>`;
    return;
  }

  view.innerHTML = `<section class="page-head"><div class="eyebrow">PORTFOLIO</div><h1>Your portfolio</h1><p class="mono">${escapeHtml(account)}</p></section>
    <div class="card"><span class="spinner"></span> Reading portfolio and on-chain accounting…</div>`;

  let portfolio: PortfolioDetail | null = null;
  try {
    const res = await apiClient.getPortfolio(account);
    portfolio = res.data;
  } catch {
    // API portfolio offline or unindexed yet
  }

  type PositionCardData = {
    marketId: bigint;
    status: string;
    yes: bigint;
    no: bigint;
    claimableReward: bigint;
    claimableRefund: bigint;
  };

  const positionCards: PositionCardData[] = [];
  if (portfolio && portfolio.positions) {
    for (const pos of portfolio.positions) {
      const mid = BigInt(pos.market.onchainMarketId);
      try {
        const onchainPos = await readPosition(publicClient, deployment.factory, mid, account);
        const claimable = await readClaimable(publicClient, deployment.factory, mid, account);
        positionCards.push({
          marketId: mid,
          status: pos.market.status,
          yes: onchainPos.yes,
          no: onchainPos.no,
          claimableReward: claimable.reward,
          claimableRefund: claimable.refund,
        });
      } catch {
        // Skip unreadable
      }
    }
  }

  type StakeCardData = {
    marketId: bigint;
    amount: bigint;
    prefixBefore: bigint;
    claimed: boolean;
    entitlement: bigint;
  };
  const stakeCards: StakeCardData[] = [];
  if (portfolio && portfolio.challengeStakes) {
    for (const stake of portfolio.challengeStakes) {
      const mid = BigInt(stake.market.onchainMarketId);
      try {
        const onchainStake = await readChallengeStake(publicClient, deployment.factory, mid, account);
        const entitlement = await readBondEntitlement(publicClient, deployment.factory, mid, 2, account);
        stakeCards.push({
          marketId: mid,
          amount: onchainStake.amount,
          prefixBefore: onchainStake.prefixBefore,
          claimed: onchainStake.claimed,
          entitlement,
        });
      } catch {
        // Skip unreadable
      }
    }
  }

  type BondCardData = {
    marketId: bigint;
    bondType: 0 | 1 | 2;
    bondTypeName: string;
    amount: bigint;
    claimed: boolean;
    entitlement: bigint;
  };
  const bondCards: BondCardData[] = [];
  if (portfolio && portfolio.bonds) {
    for (const b of portfolio.bonds) {
      const mid = BigInt(b.market.onchainMarketId);
      const bType: 0 | 1 | 2 = b.bondType === 'CREATION' ? 0 : b.bondType === 'PROPOSAL' ? 1 : 2;
      try {
        const onchainBond = await readBond(publicClient, deployment.factory, mid, bType);
        const entitlement = await readBondEntitlement(publicClient, deployment.factory, mid, bType, account);
        bondCards.push({
          marketId: mid,
          bondType: bType,
          bondTypeName: b.bondType,
          amount: onchainBond.amount,
          claimed: onchainBond.claimed,
          entitlement,
        });
      } catch {
        // Skip unreadable
      }
    }
  }

  const openRisk = portfolio ? BigInt(portfolio.openRisk) : 0n;
  const totalClaimed = portfolio ? BigInt(portfolio.totalClaimed) : 0n;

  let positionsHtml = '';
  if (positionCards.length === 0) {
    positionsHtml = `<p class="muted">No market positions recorded.</p>`;
  } else {
    positionsHtml = `<div class="grid-2">${positionCards.map(p => `
      <div class="card">
        <div class="row space">
          <span class="mono"><strong>Market #${p.marketId}</strong></span>
          <span class="pill">${escapeHtml(p.status)}</span>
        </div>
        <div class="row space" style="margin:8px 0">
          <span>YES: ${formatQie(p.yes)} ETH</span>
          <span>NO: ${formatQie(p.no)} ETH</span>
        </div>
        ${p.claimableReward > 0n || p.claimableRefund > 0n ? `
          <div class="row" style="margin-top:8px">
            ${p.claimableReward > 0n ? `<button class="btn primary" type="button" data-action="claim" data-id="${p.marketId}">Claim reward (${formatQie(p.claimableReward)} ETH)</button>` : ''}
            ${p.claimableRefund > 0n ? `<button class="btn" type="button" data-action="claim-refund" data-id="${p.marketId}">Claim refund (${formatQie(p.claimableRefund)} ETH)</button>` : ''}
          </div>
        ` : '<span class="muted" style="font-size:13px">No rewards or refunds claimable</span>'}
        <div style="margin-top:8px"><a class="text-btn" href="#/market/${p.marketId}" style="font-size:12px">View market details →</a></div>
      </div>
    `).join('')}</div>`;
  }

  let stakesHtml = '';
  if (stakeCards.length === 0) {
    stakesHtml = `<p class="muted">No challenge stakes recorded.</p>`;
  } else {
    stakesHtml = `<div class="grid-2">${stakeCards.map(s => `
      <div class="card">
        <div class="row space">
          <span class="mono"><strong>Market #${s.marketId} (Challenge)</strong></span>
          <span class="pill ${s.claimed ? 'ok' : ''}">${s.claimed ? 'Claimed' : 'Active'}</span>
        </div>
        <div style="margin:8px 0;font-size:14px">
          <div>Stake: ${formatQie(s.amount)} ETH</div>
          <div>Prefix before: ${formatQie(s.prefixBefore)} ETH</div>
          <div>Entitlement: ${formatQie(s.entitlement)} ETH</div>
        </div>
        ${!s.claimed && s.entitlement > 0n ? `
          <div class="row" style="margin-top:8px">
            <button class="btn" type="button" data-action="claim-bond-challenge" data-id="${s.marketId}">Claim challenge bond (${formatQie(s.entitlement)} ETH)</button>
          </div>
        ` : ''}
        <div style="margin-top:8px"><a class="text-btn" href="#/market/${s.marketId}" style="font-size:12px">View market details →</a></div>
      </div>
    `).join('')}</div>`;
  }

  let bondsHtml = '';
  if (bondCards.length === 0) {
    bondsHtml = `<p class="muted">No bonds recorded.</p>`;
  } else {
    bondsHtml = `<div class="grid-2">${bondCards.map(b => {
      const actionName = b.bondType === 0 ? 'claim-bond-creation' : 'claim-bond-proposal';
      return `
      <div class="card">
        <div class="row space">
          <span class="mono"><strong>Market #${b.marketId} (${b.bondTypeName} Bond)</strong></span>
          <span class="pill ${b.claimed ? 'ok' : ''}">${b.claimed ? 'Claimed' : 'Active'}</span>
        </div>
        <div style="margin:8px 0;font-size:14px">
          <div>Amount: ${formatQie(b.amount)} ETH</div>
          <div>Entitlement: ${formatQie(b.entitlement)} ETH</div>
        </div>
        ${!b.claimed && b.entitlement > 0n ? `
          <div class="row" style="margin-top:8px">
            <button class="btn" type="button" data-action="${actionName}" data-id="${b.marketId}">Claim ${b.bondTypeName} bond (${formatQie(b.entitlement)} ETH)</button>
          </div>
        ` : ''}
        <div style="margin-top:8px"><a class="text-btn" href="#/market/${b.marketId}" style="font-size:12px">View market details →</a></div>
      </div>`;
    }).join('')}</div>`;
  }

  let txHtml = '';
  if (portfolio && portfolio.recentTransactions && portfolio.recentTransactions.length > 0) {
    txHtml = `<div class="card"><h3>Recent transactions</h3><div class="table-wrap"><table>
      <thead><tr><th>Tx</th><th>Block</th><th>Status</th></tr></thead>
      <tbody>${portfolio.recentTransactions.slice(0, 10).map(tx => `
        <tr>
          <td class="mono">${escapeHtml(shortAddress(tx.txHash))}</td>
          <td>${tx.blockNumber}</td>
          <td><span class="pill ${tx.status === 'SUCCESS' ? 'ok' : 'err'}">${escapeHtml(tx.status)}</span></td>
        </tr>
      `).join('')}</tbody></table></div></div>`;
  }

  view.innerHTML = `
    <section class="page-head">
      <div class="eyebrow">PORTFOLIO</div>
      <h1>Your portfolio</h1>
      <p class="mono">${escapeHtml(account)}</p>
    </section>
    <div class="summary-grid">
      <div><span>Open risk</span><b>${formatQie(openRisk)} ETH</b></div>
      <div><span>Total claimed</span><b>${formatQie(totalClaimed)} ETH</b></div>
      <div><span>Positions</span><b>${portfolio ? portfolio.totals.positions : positionCards.length}</b></div>
      <div><span>Bonds & Stakes</span><b>${portfolio ? (portfolio.totals.challengeStakes + portfolio.totals.bonds) : (stakeCards.length + bondCards.length)}</b></div>
    </div>
    <div class="section-title" style="margin-top:24px"><h2>Active market positions</h2></div>
    ${positionsHtml}
    <div class="section-title" style="margin-top:24px"><h2>Challenge stakes</h2></div>
    ${stakesHtml}
    <div class="section-title" style="margin-top:24px"><h2>Bonds</h2></div>
    ${bondsHtml}
    ${txHtml}
  `;
}

// ------------------------------------------------------------------- events

function evidenceInputToHash(raw: string): Hex | null {
  const trimmed = raw.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  if (trimmed.length === 0) return null;
  // Treat free text as raw content and commit to its exact bytes.
  return evidenceContentHash(trimmed);
}

document.addEventListener('click', (event) => {
  const backdrop = (event.target as HTMLElement).closest<HTMLElement>('[data-modal-backdrop="true"]');
  if (backdrop && event.target === backdrop) {
    closeEvidenceModal();
    return;
  }
  const wizardTab = (event.target as HTMLElement).closest<HTMLButtonElement>('.wizard-step-tab');
  if (wizardTab && wizardTab.dataset.step) {
    setWizardStep(Number(wizardTab.dataset.step));
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id ? BigInt(target.dataset.id) : null;
  switch (action) {
    case 'next-step-1': {
      const qInput = (document.getElementById('input-question') as HTMLInputElement)?.value.trim();
      if (!qInput || qInput.length < 15 || !qInput.endsWith('?')) {
        flash('err', 'Question must contain at least 15 characters and end with a question mark (?).');
        break;
      }
      setWizardStep(2);
      break;
    }
    case 'prev-step-2': {
      setWizardStep(1);
      break;
    }
    case 'next-step-2': {
      const src = (document.getElementById('input-primarySource') as HTMLInputElement)?.value.trim();
      const yes = (document.getElementById('input-yesCriteria') as HTMLTextAreaElement)?.value.trim();
      const no = (document.getElementById('input-noCriteria') as HTMLTextAreaElement)?.value.trim();
      const inv = (document.getElementById('input-invalidCriteria') as HTMLTextAreaElement)?.value.trim();
      if (!src || !yes || !no || !inv) {
        flash('err', 'Please complete primary source and all outcome resolution criteria.');
        break;
      }
      setWizardStep(3);
      break;
    }
    case 'prev-step-3': {
      setWizardStep(2);
      break;
    }
    case 'next-step-3': {
      const resInput = (document.getElementById('input-resolutionTime') as HTMLInputElement)?.value;
      const maxInput = (document.getElementById('input-maxResolutionTime') as HTMLInputElement)?.value;
      if (resInput && maxInput && state.deployment) {
        const resSec = BigInt(Math.floor(new Date(resInput).getTime() / 1000));
        const maxSec = BigInt(Math.floor(new Date(maxInput).getTime() / 1000));
        const minMaxSec = calculateMinimumMaxResolutionTime(
          resSec,
          state.deployment.parameters.challengePeriod,
          state.deployment.parameters.arbitrationPeriod,
        );
        if (maxSec < minMaxSec) {
          flash('err', 'Max resolution time must be at least 192 hours after resolution start time.');
          break;
        }
      }
      setWizardStep(4);
      break;
    }
    case 'prev-step-4': {
      setWizardStep(3);
      break;
    }
    case 'auto-floor-deadline': {
      autoSetTimelineFloor();
      break;
    }
    case 'inspect-evidence': {
      const commitment = target.dataset.commitment;
      if (commitment && !isZeroHash(commitment)) {
        void openEvidenceModal(commitment);
      }
      break;
    }
    case 'close-modal': {
      closeEvidenceModal();
      break;
    }
    case 'publish-evidence-node': {
      const form = document.getElementById('evidence-form') as HTMLFormElement | null;
      if (form) void actPublishEvidenceForm(form);
      break;
    }
    case 'copy-commitment': {
      const commitment = target.dataset.commitment;
      if (commitment && navigator.clipboard) {
        void navigator.clipboard.writeText(commitment);
        flash('ok', 'Evidence commitment copied to clipboard.');
      }
      break;
    }
    case 'connect':
      void connectWallet(target.dataset.uuid ?? '');
      break;
    case 'connect-first':
      flash('err', 'No injected wallet was discovered. Install a wallet or open this page in the E2E harness.');
      break;
    case 'disconnect':
      disconnectWallet();
      break;
    case 'refresh-chain':
      state.session?.refreshChain().then(renderWallet);
      break;
    case 'dismiss-flash':
      state.flash = null;
      renderFlash();
      break;
    case 'refresh-markets':
      void (async () => {
        await refreshChainTime();
        await loadMarkets();
      })();
      break;
    case 'predict-yes':
      if (id !== null) void actPredict(id, 0);
      break;
    case 'predict-no':
      if (id !== null) void actPredict(id, 1);
      break;
    case 'predict-custom': {
      if (id === null) break;
      const input = document.getElementById('predict-amount') as HTMLInputElement | null;
      const sideSelect = document.getElementById('predict-side') as HTMLSelectElement | null;
      const side = (sideSelect && sideSelect.value === '1') ? 1 : 0;
      void actPredictCustom(id, side as 0 | 1, input?.value ?? '');
      break;
    }
    case 'propose-yes':
    case 'propose-no':
    case 'propose-invalid': {
      if (id === null) break;
      const input = document.getElementById('propose-evidence') as HTMLInputElement | null;
      const hash = evidenceInputToHash(input?.value ?? '');
      if (!hash) {
        flash('err', 'Enter an evidence hash or content to commit to.');
        break;
      }
      const outcome = action === 'propose-yes' ? 1 : action === 'propose-no' ? 2 : 3;
      void actPropose(id, outcome as 1 | 2 | 3, hash);
      break;
    }
    case 'challenge': {
      if (id === null) break;
      const input = document.getElementById('challenge-evidence') as HTMLInputElement | null;
      const hash = evidenceInputToHash(input?.value ?? '');
      if (!hash) {
        flash('err', 'Enter an evidence hash or content to commit to.');
        break;
      }
      void actChallenge(id, hash);
      break;
    }
    case 'submit-evidence': {
      if (id === null) break;
      const input = document.getElementById('challenge-evidence') as HTMLInputElement | null;
      const hash = evidenceInputToHash(input?.value ?? '');
      if (!hash) {
        flash('err', 'Enter an evidence hash or content to commit to.');
        break;
      }
      void actSubmitEvidence(id, hash);
      break;
    }
    case 'settle-yes':
    case 'settle-no':
    case 'settle-invalid': {
      if (id === null) break;
      const input = document.getElementById('settle-evidence') as HTMLInputElement | null;
      const hash = evidenceInputToHash(input?.value ?? '');
      if (!hash) {
        flash('err', 'Enter a decision evidence hash or content to commit to.');
        break;
      }
      const decision = action === 'settle-yes' ? 1 : action === 'settle-no' ? 2 : 3;
      void actSettle(id, decision as 1 | 2 | 3, hash);
      break;
    }
    case 'finalize':
      if (id !== null) void actFinalize(id);
      break;
    case 'claim':
      if (id !== null) void actClaim(id);
      break;
    case 'claim-refund':
      if (id !== null) void actClaimRefund(id);
      break;
    case 'claim-bond-creation': {
      if (id !== null) {
        const input = document.getElementById('claim-bond-recipient-0') as HTMLInputElement | null;
        const recipient = (input?.value?.trim() || undefined) as Address | undefined;
        void actClaimBond(id, 0, recipient);
      }
      break;
    }
    case 'claim-bond-proposal': {
      if (id !== null) {
        const input = document.getElementById('claim-bond-recipient-1') as HTMLInputElement | null;
        const recipient = (input?.value?.trim() || undefined) as Address | undefined;
        void actClaimBond(id, 1, recipient);
      }
      break;
    }
    case 'claim-bond-challenge': {
      if (id !== null) {
        const input = document.getElementById('claim-bond-recipient-2') as HTMLInputElement | null;
        const recipient = (input?.value?.trim() || undefined) as Address | undefined;
        void actClaimBond(id, 2, recipient);
      }
      break;
    }
    case 'cancel-expired':
      if (id !== null) void actCancelExpired(id);
      break;
    case 'prev-page': {
      if (state.filters.page > 1) {
        state.filters.page -= 1;
        void loadMarkets();
      }
      break;
    }
    case 'next-page': {
      const totalPages = Math.ceil(state.totalMarkets / state.filters.pageSize);
      if (state.filters.page < totalPages) {
        state.filters.page += 1;
        void loadMarkets();
      }
      break;
    }
    case 'fill-gold-preset': {
      fillGoldPreset();
      break;
    }
    case 'validate-create-form': {
      const form = document.getElementById('create-form') as HTMLFormElement | null;
      if (form) validateCreateFormAction(form);
      break;
    }
  }
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('#create-form')) {
    updateCreateFormPreview();
  }
  if (target.id === 'market-search') {
    const input = target as HTMLInputElement;
    state.filters.q = input.value;
    state.filters.page = 1;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      void loadMarkets();
    }, 250);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('#create-form')) {
    updateCreateFormPreview();
  }
  if (target.id === 'filter-category') {
    const sel = target as HTMLSelectElement;
    state.filters.category = sel.value;
    state.filters.page = 1;
    void loadMarkets();
  } else if (target.id === 'filter-status') {
    const sel = target as HTMLSelectElement;
    state.filters.status = sel.value;
    state.filters.page = 1;
    void loadMarkets();
  } else if (target.id === 'filter-sort') {
    const sel = target as HTMLSelectElement;
    const [sort, order] = sel.value.split('-') as ['id' | 'closeTime', 'asc' | 'desc'];
    state.filters.sort = sort;
    state.filters.order = order;
    state.filters.page = 1;
    void loadMarkets();
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id === 'create-form') {
    event.preventDefault();
    void actCreateMarket(form);
    return;
  }
  if (form.id === 'evidence-form') {
    event.preventDefault();
    computeEvidence(form);
  }
});

function computeEvidence(form: HTMLFormElement): void {
  const deployment = state.deployment;
  if (!deployment) return;
  const data = new FormData(form);
  const content = String(data.get('content') ?? '');
  const contentHash = evidenceContentHash(content);
  const publisherRaw = String(data.get('publisher') ?? '').trim().toLowerCase();
  const publisher = /^0x[0-9a-f]{40}$/.test(publisherRaw)
    ? publisherRaw
    : ((connectedAccount() ?? '').toLowerCase() as string);
  const source = String(data.get('source') ?? '').trim();
  const manifest: EvidenceManifest = {
    schema: 'orakl-evidence-v1',
    chainId: String(LOCAL_CHAIN_ID),
    contract: deployment.factory.toLowerCase(),
    marketId: String(data.get('marketId') ?? '0'),
    kind: String(data.get('kind') ?? 'supplement') as EvidenceKind,
    claim: String(data.get('claim') ?? 'YES') as EvidenceManifest['claim'],
    proposedOutcome: String(data.get('proposedOutcome') ?? 'NONE') as EvidenceManifest['proposedOutcome'],
    sources: source ? [source] : [],
    publishedAt: String(chainNow()),
    publisher,
    contentHash,
    contentMediaType: String(data.get('contentMediaType') ?? 'text/plain'),
    media: [],
  };
  const output = document.getElementById('evidence-output');
  if (!output) return;
  const validation = validateEvidenceManifest(manifest);
  if (!validation.ok) {
    output.textContent = `INVALID MANIFEST\n${validation.errors.join('\n')}`;
    return;
  }
  const commitment = evidenceCommitment(manifest);
  output.textContent = `contentHash: ${contentHash}\nevidenceHash (commitment): ${commitment}\n\nmanifest:\n${JSON.stringify(manifest, null, 2)}`;
}

async function actPublishEvidenceForm(form: HTMLFormElement): Promise<void> {
  const deployment = state.deployment;
  if (!deployment) return;
  const resultDiv = document.getElementById('evidence-publish-result');
  const data = new FormData(form);
  const content = String(data.get('content') ?? '');
  const contentHash = evidenceContentHash(content);
  const publisherRaw = String(data.get('publisher') ?? '').trim().toLowerCase();
  const publisher = /^0x[0-9a-f]{40}$/.test(publisherRaw)
    ? publisherRaw
    : ((connectedAccount() ?? '').toLowerCase() as string);
  const source = String(data.get('source') ?? '').trim();
  const manifest: EvidenceManifest = {
    schema: 'orakl-evidence-v1',
    chainId: String(LOCAL_CHAIN_ID),
    contract: deployment.factory.toLowerCase(),
    marketId: String(data.get('marketId') ?? '0'),
    kind: String(data.get('kind') ?? 'supplement') as EvidenceKind,
    claim: String(data.get('claim') ?? 'YES') as EvidenceManifest['claim'],
    proposedOutcome: String(data.get('proposedOutcome') ?? 'NONE') as EvidenceManifest['proposedOutcome'],
    sources: source ? [source] : [],
    publishedAt: String(chainNow()),
    publisher,
    contentHash,
    contentMediaType: String(data.get('contentMediaType') ?? 'text/plain'),
    media: [],
  };

  const validation = validateEvidenceManifest(manifest);
  if (!validation.ok) {
    if (resultDiv) {
      resultDiv.innerHTML = `<div class="card err" style="padding:14px;"><strong>Invalid Manifest:</strong><ul style="margin:6px 0 0;padding-left:18px;">${validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`;
    }
    return;
  }

  if (resultDiv) {
    resultDiv.innerHTML = `<div class="card" style="padding:14px;"><span class="spinner"></span> Publishing artifact to local API node…</div>`;
  }

  try {
    const commitment = evidenceCommitment(manifest);
    const auth = createPublicationAuth({
      action: 'evidence',
      chainId: LOCAL_CHAIN_ID,
      factory: deployment.factory,
      publisher,
      commitment,
    });
    let signature: string | undefined;
    if (state.session) {
      const msg = publicationAuthMessage(auth);
      const msgHex = `0x${Array.from(new TextEncoder().encode(msg)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
      try {
        signature = await state.session.request<string>('personal_sign', [msgHex, publisher]);
      } catch {
        // Fallback or leave undefined if user cancels
      }
    }

    const res = await apiClient.publishEvidence({
      manifest,
      auth,
      signature,
      content: content || undefined,
    });
    if (resultDiv) {
      resultDiv.innerHTML = `
        <div class="card ok" style="padding:16px;">
          <h3 style="margin-top:0;">Manifest Published to Node</h3>
          <p style="margin:8px 0;">Commitment Hash: <code class="mono" style="word-break:break-all;">${escapeHtml(res.data.commitment)}</code></p>
          <p class="muted" style="font-size:12px;margin:4px 0;">Deduped: ${res.data.deduped ? 'Yes' : 'No'} · External Pinning: ${escapeHtml(res.data.externalPinning)}</p>
          <div class="row" style="margin-top:14px;">
            <a class="btn primary tiny" href="#/market/${manifest.marketId}">Go to Market #${manifest.marketId}</a>
            <button class="btn tiny" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(res.data.commitment)}">Inspect in Modal</button>
            <button class="btn tiny ghost" type="button" data-action="copy-commitment" data-commitment="${escapeHtml(res.data.commitment)}">Copy Commitment</button>
          </div>
        </div>
      `;
    }
    const output = document.getElementById('evidence-output');
    if (output) {
      output.textContent = `contentHash: ${contentHash}\nevidenceHash (commitment): ${res.data.commitment}\n\nmanifest:\n${JSON.stringify(manifest, null, 2)}`;
    }
  } catch (err: unknown) {
    if (resultDiv) {
      resultDiv.innerHTML = `<div class="card err" style="padding:14px;"><strong>Publishing Failed:</strong> ${escapeHtml(errorMessage(err))}</div>`;
    }
  }
}

window.addEventListener('hashchange', () => {
  state.route = parseRoute();
  state.multisigNotice = null;
  state.flash = null;
  renderFlash();
  if (state.deployment) {
    void (async () => {
      await refreshChainTime();
      render();
      await loadMarkets();
    })();
  } else {
    render();
  }
});

state.route = parseRoute();
void boot();
