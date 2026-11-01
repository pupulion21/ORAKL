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
import {encodeFunctionData} from 'viem';
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

// ---------------------------------------------------------------------- state

type Route =
  | {name: 'list'}
  | {name: 'market'; id: bigint}
  | {name: 'create'}
  | {name: 'evidence'}
  | {name: 'status'}
  | {name: 'portfolio'};

export interface MarketViewItem {
  id: bigint;
  title: string;
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
};

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

function parseRoute(): Route {
  const hash = location.hash.replace(/^#/, '');
  const marketMatch = /^\/market\/(\d+)$/.exec(hash);
  if (marketMatch?.[1]) return {name: 'market', id: BigInt(marketMatch[1])};
  if (hash === '/create') return {name: 'create'};
  if (hash === '/evidence') return {name: 'evidence'};
  if (hash === '/status') return {name: 'status'};
  if (hash === '/portfolio') return {name: 'portfolio'};
  return {name: 'list'};
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

function apiItemToView(item: MarketListItem): MarketViewItem {
  const tone =
    item.status === 'OPEN'
      ? 'open'
      : item.status === 'CLOSED'
        ? 'wait'
        : item.status === 'FINALIZED'
          ? 'done'
          : 'expired';
  return {
    id: BigInt(item.id),
    title: item.question || item.metadataURI,
    description: item.description,
    category: item.category,
    metadataURI: item.metadataURI,
    statusText: item.status,
    statusTone: tone,
    yesPool: parsePoolAmount(item.yesPool),
    noPool: parsePoolAmount(item.noPool),
    closeTime: BigInt(item.closeTime || '0'),
    fromApi: true,
  };
}

function rpcRecordToView(m: MarketRecord): MarketViewItem {
  const now = chainNow();
  const effectiveState = (m.storedState === 0 && now >= Number(m.closeTime)) ? 1 : m.storedState;
  const label = MARKET_STATE_LABELS[effectiveState] ?? 'UNKNOWN';
  return {
    id: m.id,
    title: m.metadataURI,
    description: null,
    category: null,
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
  const metadataURI = String(data.get('metadataURI') ?? '').trim();
  const metadataHashInput = String(data.get('metadataHash') ?? '').trim();
  const closeInput = String(data.get('closeTime') ?? '');
  const resolutionInput = String(data.get('resolutionTime') ?? '');
  const maxInput = String(data.get('maxResolutionTime') ?? '');

  if (!/^ipfs:\/\//.test(metadataURI) || metadataURI.length < 8 || metadataURI.length > 256) {
    flash('err', 'Metadata URI must start with ipfs:// and be 8–256 bytes.');
    return;
  }
  let metadataHash: Hex;
  if (metadataHashInput) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(metadataHashInput)) {
      flash('err', 'Metadata hash must be 0x + 64 hex characters.');
      return;
    }
    metadataHash = metadataHashInput as Hex;
  } else {
    // Local convenience: commit to the exact URI bytes. This is a local fixture
    // convenience, NOT a substitute for publishing content on IPFS.
    metadataHash = evidenceContentHash(metadataURI);
  }
  if (metadataHash.toLowerCase() === `0x${'0'.repeat(64)}`) {
    flash('err', 'Metadata hash cannot be the zero hash.');
    return;
  }

  const closeTime = BigInt(Math.floor(new Date(closeInput).getTime() / 1000));
  const resolutionTime = BigInt(Math.floor(new Date(resolutionInput).getTime() / 1000));
  const maxResolutionTime = BigInt(Math.floor(new Date(maxInput).getTime() / 1000));
  const now = BigInt(chainNow());
  if (closeTime <= now) {
    flash('err', 'Closing time must be in the future on the local chain.');
    return;
  }
  if (resolutionTime < closeTime) {
    flash('err', 'Resolution time must be at or after the closing time.');
    return;
  }
  const minMax = resolutionTime + BigInt(deployment.parameters.challengePeriod + deployment.parameters.arbitrationPeriod + 48 * 3600);
  if (maxResolutionTime < minMax) {
    flash(
      'err',
      `Max resolution time must be at least ${formatDateTime(minMax)} (resolution + challenge + arbitration + 48h).`,
    );
    return;
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
  return `
    <a href="#view" class="skip-link">Skip to content</a>
    <aside class="sidebar">
      <a class="brand" href="#/" aria-label="ORAKL Predict home">
        <span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 23a11 11 0 1 0-7 3h12l-7-7"/><path d="m10 18 5-6 4 3 5-7"/></svg></span>
        <span class="brand-text">ORAKL<span>Predict</span></span>
      </a>
      <div class="workspace-label">WORKSPACE <span>LOCAL</span></div>
      <nav class="sidebar-primary nav" aria-label="Main navigation">
        ${navItem('#/', 'Markets', 'grid', listActive)}
        ${navItem('#/create', 'Create market', 'plus', route.name === 'create')}
        ${navItem('#/portfolio', 'Portfolio', 'wallet', route.name === 'portfolio')}
        ${navItem('#/evidence', 'Evidence lab', 'shield', route.name === 'evidence')}
        ${navItem('#/status', 'Protocol status', 'settings', route.name === 'status')}
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-network"><span class="status-dot ${state.deploymentPhase === 'ready' ? 'connected' : ''}"></span><span>${NETWORK_LABEL}<small>${state.deploymentPhase === 'ready' ? 'Deployment verified' : state.deploymentPhase === 'checking' ? 'Verifying deployment…' : 'Deployment unavailable'}</small></span></div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <a class="brand mobile-brand" href="#/" aria-label="ORAKL Predict home"><span class="brand-text">ORAKL<span>Predict</span></span></a>
        <div class="search" aria-hidden="true"></div>
        <div class="header-actions"><span class="network-pill"><span class="status-dot ${state.deploymentPhase === 'ready' ? 'connected' : ''}"></span> ${NETWORK_LABEL} · ${LOCAL_CHAIN_ID}</span><div class="wallet-panel" id="wallet-panel"></div></div>
      </header>
      <div class="shell">
        <div id="flash"></div>
        <main id="view" class="view" tabindex="-1"></main>
        <div id="tx-panel"></div>
        <footer class="footer"><div><span class="footer-wordmark">ORAKL Predict</span><span>Local selected-protocol fixture. Not a public deployment.</span></div><div class="footer-links"><a href="#/status">Protocol status</a><span class="testnet-label">LOCAL · ${LOCAL_CHAIN_ID}</span></div></footer>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      ${navItem('#/', 'Markets', 'grid', listActive)}
      ${navItem('#/create', 'Create', 'plus', route.name === 'create')}
      ${navItem('#/portfolio', 'Portfolio', 'wallet', route.name === 'portfolio')}
      ${navItem('#/evidence', 'Evidence', 'shield', route.name === 'evidence')}
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

function stateTone(storedState: number): string {
  switch (storedState) {
    case 0:
      return 'open';
    case 1:
      return 'wait';
    case 2:
    case 3:
      return 'expired';
    default:
      return 'done';
  }
}

function marketCardHtml(market: MarketViewItem): string {
  const total = market.yesPool + market.noPool;
  const yesPct = total > 0n ? Number((market.yesPool * 10_000n) / total) / 100 : null;
  const categoryPill = market.category
    ? `<span class="pill">${escapeHtml(market.category)}</span>`
    : '';
  const desc = market.description
    ? `<p class="muted line-clamp" style="font-size:12px;margin:4px 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(market.description)}</p>`
    : '';

  return `<a class="card market-card" href="#/market/${market.id}">
    <div class="row space">
      <div class="row" style="gap:6px">
        <span class="badge ${market.statusTone}">${escapeHtml(market.statusText)}</span>
        ${categoryPill}
      </div>
      <span class="mono muted">#${market.id}</span>
    </div>
    <h3 style="margin-top:8px">${escapeHtml(market.title)}</h3>
    ${desc}
    <div class="pool-bar" aria-hidden="true"><i style="width:${yesPct ?? 50}%"></i></div>
    <div class="row space muted"><span>YES ${formatQie(market.yesPool)}</span><span>NO ${formatQie(market.noPool)}</span></div>
    <div class="row space muted"><span>Closes ${formatDateTime(market.closeTime)}</span><span>${icon('chevron', 15)}</span></div>
  </a>`;
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
      <div><span>Challenge window</span><b>${countdownText(0) === 'elapsed' ? '' : ''}${params.challengePeriod / 3600}h</b></div>
      <div><span>Arbitration window</span><b>${params.arbitrationPeriod / 3600}h</b></div>
    </div>
    <div class="row space" style="flex-wrap:wrap;gap:12px;margin:24px 0 16px">
      <div class="row" style="gap:8px;flex:1;min-width:240px">
        <div class="search" style="height:38px;background:var(--bg-soft);border:1px solid var(--line);border-radius:6px;padding:0 10px;width:100%">
          ${icon('search', 16)}
          <input id="market-search" type="search" placeholder="Search markets by title..." value="${escapeHtml(state.filters.q)}" aria-label="Search markets" />
        </div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="filter-category" aria-label="Filter by category" style="height:38px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="all" ${state.filters.category === 'all' ? 'selected' : ''}>All Categories</option>
          <option value="crypto" ${state.filters.category === 'crypto' ? 'selected' : ''}>Crypto</option>
          <option value="macro" ${state.filters.category === 'macro' ? 'selected' : ''}>Macro</option>
          <option value="tech" ${state.filters.category === 'tech' ? 'selected' : ''}>Tech</option>
          <option value="other" ${state.filters.category === 'other' ? 'selected' : ''}>Other</option>
        </select>
        <select id="filter-status" aria-label="Filter by status" style="height:38px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>All Statuses</option>
          <option value="OPEN" ${state.filters.status === 'OPEN' ? 'selected' : ''}>Open</option>
          <option value="CLOSED" ${state.filters.status === 'CLOSED' ? 'selected' : ''}>Closed</option>
          <option value="PROPOSED" ${state.filters.status === 'PROPOSED' ? 'selected' : ''}>Proposed</option>
          <option value="DISPUTED" ${state.filters.status === 'DISPUTED' ? 'selected' : ''}>Disputed</option>
          <option value="FINALIZED" ${state.filters.status === 'FINALIZED' ? 'selected' : ''}>Finalized</option>
          <option value="CANCELLED" ${state.filters.status === 'CANCELLED' ? 'selected' : ''}>Cancelled</option>
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
  const total = market.yesPool + market.noPool;
  const yesPct = total > 0n ? Number((market.yesPool * 10_000n) / total) / 100 : null;

  const title = apiDetail?.question || market.metadataURI;
  const descriptionHtml = apiDetail?.description
    ? `<p style="margin:8px 0 16px;color:var(--text);font-size:14px">${escapeHtml(apiDetail.description)}</p>`
    : '';
  const categoryPill = apiDetail?.category
    ? `<span class="pill" style="margin-left:8px">${escapeHtml(apiDetail.category)}</span>`
    : '';
  const verifiedBadge = apiDetail?.verifiedMetadata
    ? `<span class="pill ok" style="margin-left:8px" title="Metadata manifest cryptographically verified">Verified Manifest</span>`
    : '';

  const formatEvidenceField = (hash: string | null | undefined): string => {
    if (!hash || isZeroHash(hash)) return '<span class="muted">—</span>';
    return `<button class="evidence-hash-btn mono" type="button" data-action="inspect-evidence" data-commitment="${escapeHtml(hash)}" title="Inspect canonical evidence manifest">${escapeHtml(hash)}</button>`;
  };

  const actions: string[] = [];
  if (account && effectiveState === 0) {
    actions.push(`<div class="card"><h3>Predict</h3><p class="muted">Minimum ${formatQie(deployment.parameters.minContribution)} ETH. A pool share is a contribution distribution, not a guaranteed payout.</p>
      <div class="row"><button class="btn yes" type="button" data-action="predict-yes" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Predict YES · ${formatQie(deployment.parameters.minContribution)}</button>
      <button class="btn no" type="button" data-action="predict-no" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Predict NO · ${formatQie(deployment.parameters.minContribution)}</button></div>
      <div class="row" style="margin-top:12px">
        <select id="predict-side" class="input-select" aria-label="Prediction side" style="max-width:110px">
          <option value="0" selected>YES</option>
          <option value="1">NO</option>
        </select>
        <input id="predict-amount" type="text" inputmode="decimal" placeholder="Custom amount (ETH)" aria-label="Custom prediction amount" />
        <button class="btn" type="button" data-action="predict-custom" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Send custom stake</button>
      </div></div>`);
  }
  if (account && effectiveState === 1) {
    const latest = Number(market.maxResolutionTime) - deployment.parameters.challengePeriod - deployment.parameters.arbitrationPeriod;
    const proposalClosed = now > latest;
    actions.push(`<div class="card"><h3>Propose result</h3>
      <p class="muted">Bond ${formatQie(deployment.parameters.proposalBond)} ETH. ${proposalClosed ? 'Proposal window has passed.' : `Proposals accepted until ${formatDateTime(BigInt(latest))}.`}</p>
      <div class="row"><input id="propose-evidence" type="text" placeholder="Evidence hash (0x…64) or manifest text" aria-label="Proposal evidence" />
      <button class="btn" type="button" data-action="propose-yes" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''}>Propose YES</button>
      <button class="btn" type="button" data-action="propose-no" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''}>Propose NO</button>
      <button class="btn" type="button" data-action="propose-invalid" data-id="${market.id}" ${state.busy || proposalClosed ? 'disabled' : ''}>Propose INVALID</button></div>
      <div class="row" style="margin-top:8px"><a class="text-btn" href="#/evidence" style="font-size:12px;">Build manifest in Evidence Lab →</a></div></div>`);
  }
  if (account && (effectiveState === 2 || effectiveState === 3)) {
    const challengeOpen = now < Number(market.challengeDeadline);
    actions.push(`<div class="card"><h3>Challenge</h3>
      <p class="muted">Bond ${formatQie(deployment.parameters.challengeBond)} ETH. ${challengeOpen ? `Window closes ${formatDateTime(market.challengeDeadline)}.` : 'The challenge window has closed.'}</p>
      <div class="row"><input id="challenge-evidence" type="text" placeholder="Evidence hash (0x…64) or manifest text" aria-label="Challenge evidence" />
      <button class="btn danger" type="button" data-action="challenge" data-id="${market.id}" ${state.busy || !challengeOpen ? 'disabled' : ''}>Challenge result</button>
      <button class="btn ghost" type="button" data-action="submit-evidence" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Submit evidence only</button></div>
      <div class="row" style="margin-top:8px"><a class="text-btn" href="#/evidence" style="font-size:12px;">Build manifest in Evidence Lab →</a></div></div>`);
  }
  if (account && effectiveState === 3) {
    const arbitrationOpen = now < Number(market.arbitrationDeadline);
    actions.push(`<div class="card"><h3>Arbitrator decision</h3>
      <p class="muted">The arbitrator is an n-of-m local role mock (threshold 2). Each confirmation is a separate wallet; the call executes on the second distinct confirmation. ${arbitrationOpen ? `Arbitration window closes ${formatDateTime(market.arbitrationDeadline)}.` : 'The arbitration window has closed.'}</p>
      ${state.multisigNotice ? `<p class="warn-text">${escapeHtml(state.multisigNotice)}</p>` : ''}
      <div class="row"><input id="settle-evidence" type="text" placeholder="Decision evidence hash (0x…64) or manifest text" aria-label="Decision evidence" />
      <button class="btn" type="button" data-action="settle-yes" data-id="${market.id}" ${state.busy || !arbitrationOpen ? 'disabled' : ''}>Decide YES</button>
      <button class="btn" type="button" data-action="settle-no" data-id="${market.id}" ${state.busy || !arbitrationOpen ? 'disabled' : ''}>Decide NO</button>
      <button class="btn" type="button" data-action="settle-invalid" data-id="${market.id}" ${state.busy || !arbitrationOpen ? 'disabled' : ''}>Decide INVALID</button></div></div>`);
  }
  if (account && effectiveState === 2) {
    actions.push(`<div class="card"><h3>Finalize</h3><p class="muted">Available once the challenge window closes without a challenge.</p><button class="btn primary" type="button" data-action="finalize" data-id="${market.id}" ${state.busy || now < Number(market.challengeDeadline) ? 'disabled' : ''}>Finalize result</button></div>`);
  }
  if (account && (effectiveState === 4 || effectiveState === 5)) {
    const claimText = claimable
      ? `Claimable now: reward ${formatQie(claimable.reward)} ETH · refund ${formatQie(claimable.refund)} ETH.`
      : '';
    actions.push(`<div class="card"><h3>Settlement</h3><p class="muted">${claimText}</p><div class="row">
      <button class="btn primary" type="button" data-action="claim" data-id="${market.id}" ${state.busy || !claimable || claimable.reward === 0n ? 'disabled' : ''}>Claim reward</button>
      <button class="btn" type="button" data-action="claim-refund" data-id="${market.id}" ${state.busy || !claimable || claimable.refund === 0n ? 'disabled' : ''}>Claim refund</button></div></div>`);
    if (addressEq(account, market.creator) || (creationBond && addressEq(account, creationBond.owner))) {
      const isClaimed = creationBond?.claimed ?? false;
      const canClaim = !isClaimed && creationEntitlement > 0n;
      actions.push(`<div class="card"><h3>Creation bond</h3>
        <p class="muted">Deposit: ${formatQie(creationBond ? creationBond.amount : deployment.parameters.creationBond)} ETH. Status: ${isClaimed ? '<span class="pill ok">Claimed</span>' : (creationEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(creationEntitlement)} ETH</span>` : '<span class="pill err">No entitlement</span>')}</p>
        <div class="row" style="margin-top:8px">
          <input id="claim-bond-recipient-0" type="text" placeholder="Recipient address (optional, default: your wallet)" aria-label="Creation bond recipient" />
          <button class="btn" type="button" data-action="claim-bond-creation" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>${isClaimed ? 'Bond claimed' : 'Claim creation bond'}</button>
        </div></div>`);
    }
    if (addressEq(account, market.proposer) || (proposalBond && addressEq(account, proposalBond.owner))) {
      const isClaimed = proposalBond?.claimed ?? false;
      const canClaim = !isClaimed && proposalEntitlement > 0n;
      actions.push(`<div class="card"><h3>Proposal bond</h3>
        <p class="muted">Deposit: ${formatQie(proposalBond ? proposalBond.amount : deployment.parameters.proposalBond)} ETH. Status: ${isClaimed ? '<span class="pill ok">Claimed</span>' : (proposalEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(proposalEntitlement)} ETH</span>` : '<span class="pill err">Forfeited / 0 ETH</span>')}</p>
        <div class="row" style="margin-top:8px">
          <input id="claim-bond-recipient-1" type="text" placeholder="Recipient address (optional, default: your wallet)" aria-label="Proposal bond recipient" />
          <button class="btn" type="button" data-action="claim-bond-proposal" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>${isClaimed ? 'Bond claimed' : 'Claim proposal bond'}</button>
        </div></div>`);
    }
    if ((challengeStake && challengeStake.amount > 0n) || challengeEntitlement > 0n) {
      const isClaimed = challengeStake?.claimed ?? false;
      const canClaim = !isClaimed && challengeEntitlement > 0n;
      actions.push(`<div class="card"><h3>Challenge bond</h3>
        <p class="muted">Deposit: ${formatQie(challengeStake ? challengeStake.amount : deployment.parameters.challengeBond)} ETH. Status: ${isClaimed ? '<span class="pill ok">Claimed</span>' : (challengeEntitlement > 0n ? `<span class="pill ok">Claimable ${formatQie(challengeEntitlement)} ETH</span>` : '<span class="pill err">Forfeited / 0 ETH</span>')}</p>
        <div class="row" style="margin-top:8px">
          <input id="claim-bond-recipient-2" type="text" placeholder="Recipient address (optional, default: your wallet)" aria-label="Challenge bond recipient" />
          <button class="btn" type="button" data-action="claim-bond-challenge" data-id="${market.id}" ${state.busy || !canClaim ? 'disabled' : ''}>${isClaimed ? 'Bond claimed' : 'Claim challenge bond'}</button>
        </div></div>`);
    }
  }
  if (account && effectiveState !== 4 && effectiveState !== 5 && now >= Number(market.maxResolutionTime)) {
    actions.push(`<div class="card"><h3>Expired</h3><p class="muted">The market passed its max resolution time unresolved and can be cancelled; stakes become refundable.</p><button class="btn danger" type="button" data-action="cancel-expired" data-id="${market.id}" ${state.busy ? 'disabled' : ''}>Cancel expired market</button></div>`);
  }

  const positionHtml = position && (position.yes > 0n || position.no > 0n)
    ? `<div class="card"><h3>Your position</h3><div class="row space"><span>YES ${formatQie(position.yes)} ETH</span><span>NO ${formatQie(position.no)} ETH</span><span class="muted">${position.settled ? 'settled' : 'open'}</span></div></div>`
    : '';

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
      <div class="card">
        <div class="row space">
          <h3>Multi-Challenger Tranche Ladder (M1)</h3>
          <span class="pill">${challenges.stakes.length} tranche${challenges.stakes.length === 1 ? '' : 's'}</span>
        </div>
        <p class="muted">
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
      <div class="card">
        <h3>Multi-Challenger Tranche Ladder (M1)</h3>
        <p class="muted">${challenges ? 'No additional challenger tranches recorded.' : 'Detailed multi-challenger tranche history requires the API indexer service.'}</p>
      </div>
    `;
  }

  view.innerHTML = `<div class="breadcrumbs"><a href="#/">Markets</a>${icon('chevron', 13)}<span>Market #${market.id}</span></div>
    <section class="page-head"><div class="eyebrow">MARKET #${market.id} · ${stateLabel}${categoryPill}${verifiedBadge}</div>
    <h1 class="mono">${escapeHtml(title)}</h1>
    ${descriptionHtml}
    <p>Creator ${escapeHtml(shortAddress(market.creator))} · closes ${formatDateTime(market.closeTime)} · resolves by ${formatDateTime(market.resolutionTime)} · max ${formatDateTime(market.maxResolutionTime)}</p></section>
    <div class="summary-grid">
      <div><span>YES pool</span><b>${formatQie(market.yesPool)} ETH</b></div>
      <div><span>NO pool</span><b>${formatQie(market.noPool)} ETH</b></div>
      <div><span>Pool share (YES)</span><b>${yesPct === null ? '—' : `${yesPct.toFixed(1)}%`}</b></div>
      <div><span>Protocol fee</span><b>${formatQie(market.protocolFee)} ETH</b></div>
    </div>
    <div class="pool-bar" aria-hidden="true"><i style="width:${yesPct ?? 50}%"></i></div>
    <div class="card"><h3>On-chain record</h3><div class="grid-2">
      <div><span class="muted">Proposer</span><div class="mono">${escapeHtml(market.proposer)}</div></div>
      <div><span class="muted">Challenger</span><div class="mono">${escapeHtml(market.challenger)}</div></div>
      <div><span class="muted">Proposed outcome</span><div>${OUTCOME_LABELS[market.proposedOutcome]}</div></div>
      <div><span class="muted">Final outcome</span><div>${OUTCOME_LABELS[market.finalOutcome]}</div></div>
      <div><span class="muted">Proposal evidence</span><div>${formatEvidenceField(market.proposalEvidence)}</div></div>
      <div><span class="muted">Challenge evidence</span><div>${formatEvidenceField(market.challengeEvidence)}</div></div>
      <div><span class="muted">Decision evidence</span><div>${formatEvidenceField(market.decisionEvidence)}</div></div>
      <div><span class="muted">Paid out / refunded</span><div>${formatQie(market.paidOut)} / ${formatQie(market.refunded)} ETH</div></div>
    </div></div>
    ${trancheLadderHtml}
    ${positionHtml}
    ${actions.join('')}`;
}

function renderCreateView(view: HTMLElement): void {
  const deployment = state.deployment!;
  const params = deployment.parameters;
  const now = chainNow();
  const toDateInput = (seconds: number) => {
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const defaultClose = now + 3600;
  const defaultResolution = defaultClose;
  const defaultMax = defaultResolution + params.challengePeriod + params.arbitrationPeriod + 48 * 3600;
  view.innerHTML = `<div class="breadcrumbs"><a href="#/">Markets</a>${icon('chevron', 13)}<span>Create market</span></div>
    <section class="page-head"><div class="eyebrow">LOCAL SELECTED PROTOCOL</div><h1>Create market</h1>
    <p>The creation bond is ${formatQie(params.creationBond)} ETH and is returned once the market reaches a terminal state. Times are evaluated against the local chain clock, not your system clock.</p></section>
    <form id="create-form" class="card">
      <label>Metadata URI (ipfs://…)<input name="metadataURI" type="text" required placeholder="ipfs://bafy…" maxlength="256" /></label>
      <label>Metadata hash (0x…64, optional — defaults to keccak of the URI)<input name="metadataHash" type="text" placeholder="0x…" /></label>
      <div class="grid-2">
        <label>Close time<input name="closeTime" type="datetime-local" required value="${toDateInput(defaultClose)}" /></label>
        <label>Resolution time<input name="resolutionTime" type="datetime-local" required value="${toDateInput(defaultResolution)}" /></label>
      </div>
      <label>Max resolution time<input name="maxResolutionTime" type="datetime-local" required value="${toDateInput(defaultMax)}" /></label>
      <p class="muted">Constraint: max ≥ resolution + ${params.challengePeriod / 3600}h challenge + ${params.arbitrationPeriod / 3600}h arbitration + 48h.</p>
      <div class="row"><button class="btn primary" type="submit" ${state.busy || !connectedAccount() ? 'disabled' : ''}>Create market · ${formatQie(params.creationBond)} ETH</button>${connectedAccount() ? '' : '<span class="muted">Connect a wallet to create a market.</span>'}</div>
    </form>`;
}

function renderEvidenceView(view: HTMLElement): void {
  const account = connectedAccount();
  view.innerHTML = `<div class="breadcrumbs"><a href="#/">Markets</a>${icon('chevron', 13)}<span>Evidence lab</span></div>
    <section class="page-head"><div class="eyebrow">EVIDENCE PROFILE V1</div><h1>Evidence lab</h1>
    <p>Builds an RFC 8785 canonical manifest and its Keccak-256 commitment, exactly as the on-chain <span class="mono">evidenceHash</span> expects. The commitment is deterministic: the same manifest always produces the same hash.</p></section>
    <form id="evidence-form" class="card">
      <div class="grid-2">
        <label>Market ID<input name="marketId" type="text" inputmode="numeric" required placeholder="0" /></label>
        <label>Kind<select name="kind">${EVIDENCE_KINDS.map((kind: string) => `<option value="${kind}">${kind}</option>`).join('')}</select></label>
        <label>Claim<select name="claim"><option>YES</option><option>NO</option><option>INVALID</option></select></label>
        <label>Proposed outcome<select name="proposedOutcome"><option>YES</option><option>NO</option><option>INVALID</option><option>NONE</option></select></label>
        <label>Publisher (defaults to connected account)<input name="publisher" type="text" value="${account ? account.toLowerCase() : ''}" placeholder="0x…" /></label>
        <label>Source URI<input name="source" type="text" placeholder="https://… or ipfs://…" /></label>
      </div>
      <label>Raw content (hashed to contentHash)<textarea name="content" rows="4" placeholder="Paste the exact evidence content bytes"></textarea></label>
      <label>Media type<input name="contentMediaType" type="text" value="text/plain" /></label>
      <div class="row">
        <button class="btn" type="submit">Compute commitment</button>
        <button class="btn primary" type="button" data-action="publish-evidence-node">Publish to local node</button>
      </div>
      <div id="evidence-publish-result" style="margin-top:14px;"></div>
      <pre id="evidence-output" class="mono prewrap"></pre>
    </form>`;
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
  view.innerHTML = `<section class="page-head"><div class="eyebrow">PROTOCOL STATUS</div><h1>Protocol status</h1>
    <p>Local fixture state, read directly from the verified contracts on chain ${LOCAL_CHAIN_ID}.</p></section>
    <div class="summary-grid">
      <div><span>Financial activity</span><b class="ok">ACTIVE</b></div>
      <div><span>Markets</span><b>${accounting.marketCount}</b></div>
      <div><span>Contract balance</span><b>${formatQie(accounting.contractBalance)} ETH</b></div>
      <div><span>Accounting</span><b class="${invariant.ok ? 'ok' : 'err'}">${invariant.ok ? 'balanced' : `delta ${formatQie(invariant.delta)} ETH`}</b></div>
    </div>
    <div class="card"><h3>Exposure caps</h3><div class="grid-2">
      <div><span class="muted">Unresolved exposure</span><div>${formatQie(accounting.totalUnresolvedExposure)} / ${formatQie(deployment.parameters.globalUnresolvedCap)} ETH</div></div>
      <div><span class="muted">Unaccounted balance</span><div>${formatQie(accounting.unaccountedBalance)} ETH</div></div>
      <div><span class="muted">Participant liability</span><div>${formatQie(accounting.participantLiability)} ETH</div></div>
      <div><span class="muted">Fee liability</span><div>${formatQie(accounting.feeLiability)} ETH</div></div>
      <div><span class="muted">Bond liability</span><div>${formatQie(accounting.bondLiability)} ETH</div></div>
      <div><span class="muted">Contributions / paid</span><div>${formatQie(accounting.totalContributions)} / ${formatQie(accounting.totalParticipantPaid)} ETH</div></div>
    </div></div>
    <div class="card"><h3>Deployment identity</h3><div class="grid-2">
      <div><span class="muted">Factory</span><div class="mono">${escapeHtml(deployment.factory)}</div></div>
      <div><span class="muted">ProtocolConfig</span><div class="mono">${escapeHtml(deployment.config)}</div></div>
      <div><span class="muted">Release digest</span><div class="mono">${escapeHtml(manifest.release.digest)}</div></div>
      <div><span class="muted">Runtime code verified</span><div class="ok">yes (keccak-256 matched)</div></div>
      <div><span class="muted">Arbitrator mock</span><div class="mono">${escapeHtml(manifest.roleMocks.arbitrator.address)} · threshold ${manifest.roleMocks.arbitrator.threshold}</div></div>
      <div><span class="muted">RPC</span><div class="mono">${escapeHtml(LOCAL_RPC_URL)}</div></div>
    </div></div>
    <div class="card"><h3>Safety</h3><p class="warn-text">${escapeHtml(manifest.safety.note)}</p><p class="muted">publicDeployment: false · productionApproval: false · realFunds: false</p></div>`;
}

async function renderPortfolioView(view: HTMLElement): Promise<void> {
  const account = connectedAccount();
  if (!account) {
    view.innerHTML = `<section class="page-head"><div class="eyebrow">PORTFOLIO</div><h1>Your portfolio</h1></section>
      <div class="card empty-state"><h2>Wallet disconnected</h2><p class="muted">Connect your wallet to inspect your positions, challenge stakes, and claimable bonds.</p></div>`;
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
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id ? BigInt(target.dataset.id) : null;
  switch (action) {
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
  }
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
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
  const target = event.target as HTMLSelectElement;
  if (target.id === 'filter-category') {
    state.filters.category = target.value;
    state.filters.page = 1;
    void loadMarkets();
  } else if (target.id === 'filter-status') {
    state.filters.status = target.value;
    state.filters.page = 1;
    void loadMarkets();
  } else if (target.id === 'filter-sort') {
    const [sort, order] = target.value.split('-') as ['id' | 'closeTime', 'asc' | 'desc'];
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
    if (state.session?.provider) {
      const msg = publicationAuthMessage(auth);
      const msgHex = `0x${Array.from(new TextEncoder().encode(msg)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
      try {
        signature = (await state.session.provider.request({
          method: 'personal_sign',
          params: [msgHex, publisher],
        })) as string;
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
