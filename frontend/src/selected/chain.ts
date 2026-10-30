/** Typed chain layer for the ORAKL SELECTED protocol on the local Anvil chain.
 *
 *  Everything here is fail-closed:
 *   - reads/writes only run against an address set that passed
 *     `verifyLocalDeployment` (manifest + runtime code + linkage + financial state);
 *   - the ABI is the candidate ABI generated from
 *     contracts/abi/orakl-v1-selected-candidate, never the legacy factory;
 *   - the public client refuses any chain id other than 31337.
 *
 *  This module is shared by the local UI and by scenario tooling. It never
 *  signs anything: writes are encoded here and sent through the wallet session
 *  (or an unlocked Anvil account in tooling).
 */

import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import {SELECTED_CONFIG_ABI, SELECTED_FACTORY_ABI} from './abi.ts';
import {
  LOCAL_CHAIN_ID,
  LOCAL_NATIVE_DECIMALS,
  LOCAL_NATIVE_SYMBOL,
  LOCAL_RPC_DEFAULT,
  type LocalManifestLoad,
  type LocalParameters,
  type LocalSelectedManifest,
  localParameters,
} from './manifest.ts';

export type {Address, Hex, LocalParameters, LocalSelectedManifest};
export {LOCAL_CHAIN_ID, LOCAL_RPC_DEFAULT, localParameters};

export type Side = 0 | 1; // YES | NO
export type Outcome = 0 | 1 | 2 | 3; // UNRESOLVED | YES | NO | INVALID
export type BondType = 0 | 1 | 2; // CREATION | PROPOSAL | CHALLENGE
export type MarketStateValue = 0 | 1 | 2 | 3 | 4 | 5; // OPEN..CANCELLED

export const MARKET_STATE_LABELS: Record<number, string> = {
  0: 'OPEN',
  1: 'CLOSED',
  2: 'PROPOSED',
  3: 'DISPUTED',
  4: 'FINALIZED',
  5: 'CANCELLED',
};

export const SIDE_LABELS: Record<number, string> = {0: 'YES', 1: 'NO'};
export const OUTCOME_LABELS: Record<number, string> = {
  0: 'UNRESOLVED',
  1: 'YES',
  2: 'NO',
  3: 'INVALID — REFUND',
};
export const BOND_LABELS: Record<number, string> = {0: 'CREATION', 1: 'PROPOSAL', 2: 'CHALLENGE'};

export const FACTORY_ABI = SELECTED_FACTORY_ABI as unknown as Abi;
export const CONFIG_ABI = SELECTED_CONFIG_ABI as unknown as Abi;

export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: 'ORAKL Local Selected (Anvil)',
  nativeCurrency: {name: 'Ether', symbol: LOCAL_NATIVE_SYMBOL, decimals: LOCAL_NATIVE_DECIMALS},
  rpcUrls: {default: {http: [LOCAL_RPC_DEFAULT]}},
  testnet: true,
});

export function createLocalPublicClient(rpcUrl = LOCAL_RPC_DEFAULT): PublicClient {
  return createPublicClient({chain: localChain, transport: http(rpcUrl, {timeout: 20_000, retryCount: 1})});
}

// --------------------------------------------------------------- verified set

export interface VerifiedDeployment {
  manifest: LocalSelectedManifest;
  factory: Address;
  config: Address;
  parameters: LocalParameters;
  blockNumber: bigint;
  verifiedAt: string;
}

export type DeploymentCheck =
  | {kind: 'ACTIVE'; deployment: VerifiedDeployment}
  | {kind: 'NOT_DEPLOYED'}
  | {kind: 'INVALID'; reason: string}
  | {kind: 'ERROR'; reason: string};

/** Full pre-activation gate: manifest shape -> chain id -> runtime code hash ->
 *  bidirectional linkage -> financial state -> parameter agreement. Any failure
 *  is INVALID and the UI must not read or write the contracts. */
export async function verifyLocalDeployment(
  client: PublicClient,
  manifestUrl?: string,
): Promise<DeploymentCheck> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (error) {
    return {kind: 'ERROR', reason: `Local RPC unreachable: ${error instanceof Error ? error.message : String(error)}`};
  }
  if (chainId !== LOCAL_CHAIN_ID) {
    return {kind: 'INVALID', reason: `RPC reported chain ${chainId}, expected ${LOCAL_CHAIN_ID}`};
  }

  let load: LocalManifestLoad;
  try {
    const {loadLocalManifest} = await import('./manifest.ts');
    load = await loadLocalManifest(manifestUrl);
  } catch (error) {
    return {kind: 'ERROR', reason: error instanceof Error ? error.message : String(error)};
  }
  if (load.kind !== 'ACTIVE') return load;

  const manifest = load.manifest;
  const factory = manifest.contracts.selectedMarketFactory.address as Address;
  const config = manifest.contracts.protocolConfig.address as Address;
  const blockNumber = await client.getBlockNumber({cacheTime: 0});

  const [factoryCode, configCode] = await Promise.all([
    client.getCode({address: factory, blockNumber}),
    client.getCode({address: config, blockNumber}),
  ]);
  if (!factoryCode || factoryCode === '0x') return {kind: 'INVALID', reason: `No runtime code at factory ${factory}`};
  if (!configCode || configCode === '0x') return {kind: 'INVALID', reason: `No runtime code at config ${config}`};

  const factoryKeccak = keccak256(factoryCode).toLowerCase();
  const expectedFactoryKeccak = manifest.contracts.selectedMarketFactory.runtimeCodeKeccak256.toLowerCase();
  if (factoryKeccak !== expectedFactoryKeccak) {
    return {
      kind: 'INVALID',
      reason: `Factory runtime code mismatch: chain ${factoryKeccak}, manifest ${expectedFactoryKeccak}`,
    };
  }
  const configKeccak = keccak256(configCode).toLowerCase();
  const expectedConfigKeccak = manifest.contracts.protocolConfig.runtimeCodeKeccak256.toLowerCase();
  if (configKeccak !== expectedConfigKeccak) {
    return {
      kind: 'INVALID',
      reason: `Config runtime code mismatch: chain ${configKeccak}, manifest ${expectedConfigKeccak}`,
    };
  }

  const [boundConfig, boundFactory, financialActive, paused, deploymentChainId, onChainParamsRaw] = await Promise.all([
    client.readContract({address: factory, abi: FACTORY_ABI, functionName: 'protocolConfig'}),
    client.readContract({address: config, abi: CONFIG_ABI, functionName: 'factory'}),
    client.readContract({address: config, abi: CONFIG_ABI, functionName: 'financialActive'}),
    client.readContract({address: config, abi: CONFIG_ABI, functionName: 'paused'}),
    client.readContract({address: config, abi: CONFIG_ABI, functionName: 'deploymentChainId'}),
    client.readContract({address: config, abi: CONFIG_ABI, functionName: 'parameters'}),
  ]);
  if (String(boundConfig).toLowerCase() !== config.toLowerCase()) {
    return {kind: 'INVALID', reason: 'factory.protocolConfig() does not match the manifest config address'};
  }
  if (String(boundFactory).toLowerCase() !== factory.toLowerCase()) {
    return {kind: 'INVALID', reason: 'config.factory() does not match the manifest factory address'};
  }
  if (financialActive !== true) return {kind: 'INVALID', reason: 'The protocol is not financially active'};
  if (paused !== false) return {kind: 'INVALID', reason: 'The protocol is paused'};
  if (Number(deploymentChainId) !== LOCAL_CHAIN_ID) {
    return {kind: 'INVALID', reason: `deploymentChainId ${deploymentChainId} != ${LOCAL_CHAIN_ID}`};
  }

  const parameters = localParameters(manifest);
  // viem types struct getters as unknown against a generic Abi; narrow once.
  const onChainParameters = onChainParamsRaw as {
    feeBps: number;
    creationBond: bigint;
    proposalBond: bigint;
    challengeBond: bigint;
    minContribution: bigint;
    poolCap: bigint;
    challengePeriod: bigint;
    arbitrationPeriod: bigint;
  };
  if (
    onChainParameters.feeBps !== parameters.feeBps ||
    onChainParameters.creationBond !== parameters.creationBond ||
    onChainParameters.proposalBond !== parameters.proposalBond ||
    onChainParameters.challengeBond !== parameters.challengeBond ||
    onChainParameters.minContribution !== parameters.minContribution ||
    onChainParameters.poolCap !== parameters.poolCap ||
    Number(onChainParameters.challengePeriod) !== parameters.challengePeriod ||
    Number(onChainParameters.arbitrationPeriod) !== parameters.arbitrationPeriod
  ) {
    return {kind: 'INVALID', reason: 'On-chain parameters do not match the manifest'};
  }

  return {
    kind: 'ACTIVE',
    deployment: {
      manifest,
      factory,
      config,
      parameters,
      blockNumber,
      verifiedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------- reads

export interface MarketRecord {
  id: bigint;
  creator: Address;
  metadataHash: Hex;
  metadataURI: string;
  closeTime: bigint;
  resolutionTime: bigint;
  maxResolutionTime: bigint;
  storedState: MarketStateValue;
  proposedOutcome: Outcome;
  finalOutcome: Outcome;
  proposer: Address;
  challenger: Address;
  proposalEvidence: Hex;
  challengeEvidence: Hex;
  decisionEvidence: Hex;
  challengeDeadline: bigint;
  arbitrationDeadline: bigint;
  yesPool: bigint;
  noPool: bigint;
  distributablePool: bigint;
  protocolFee: bigint;
  paidOut: bigint;
  refunded: bigint;
  refundable: boolean;
  arbitratorFingerprint: Hex;
}

export interface PositionRecord {
  yes: bigint;
  no: bigint;
  settled: boolean;
}

const EMPTY_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** The candidate ABI is loaded as JSON, so viem's readContract resolves to
 *  `unknown`. All reads in this module go through this helper, which keeps the
 *  fail-closed address/ABI selection but gives callers a predictable type. */
function read<T>(client: PublicClient, address: Address, abi: Abi, functionName: string, args?: unknown[]): Promise<T> {
  return client.readContract({address, abi, functionName, args} as never) as Promise<T>;
}

export async function readMarketCount(client: PublicClient, factory: Address): Promise<bigint> {
  return read<bigint>(client, factory, FACTORY_ABI, 'marketCount');
}

export async function readMarket(client: PublicClient, factory: Address, id: bigint): Promise<MarketRecord> {
  const m = (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'getMarket',
    args: [id],
  })) as {
    creator: Address;
    metadataHash: Hex;
    metadataURI: string;
    closeTime: bigint;
    resolutionTime: bigint;
    maxResolutionTime: bigint;
    storedState: bigint;
    proposedOutcome: bigint;
    finalOutcome: bigint;
    proposer: Address;
    challenger: Address;
    proposalEvidence: Hex;
    challengeEvidence: Hex;
    decisionEvidence: Hex;
    challengeDeadline: bigint;
    arbitrationDeadline: bigint;
    yesPool: bigint;
    noPool: bigint;
    distributablePool: bigint;
    protocolFee: bigint;
    paidOut: bigint;
    refunded: bigint;
    refundable: boolean;
    arbitratorFingerprint: Hex;
  };
  return {
    id,
    creator: m.creator,
    metadataHash: m.metadataHash,
    metadataURI: m.metadataURI,
    closeTime: m.closeTime,
    resolutionTime: m.resolutionTime,
    maxResolutionTime: m.maxResolutionTime,
    storedState: Number(m.storedState) as MarketStateValue,
    proposedOutcome: Number(m.proposedOutcome) as Outcome,
    finalOutcome: Number(m.finalOutcome) as Outcome,
    proposer: m.proposer,
    challenger: m.challenger,
    proposalEvidence: m.proposalEvidence,
    challengeEvidence: m.challengeEvidence,
    decisionEvidence: m.decisionEvidence,
    challengeDeadline: m.challengeDeadline,
    arbitrationDeadline: m.arbitrationDeadline,
    yesPool: m.yesPool,
    noPool: m.noPool,
    distributablePool: m.distributablePool,
    protocolFee: m.protocolFee,
    paidOut: m.paidOut,
    refunded: m.refunded,
    refundable: m.refundable,
    arbitratorFingerprint: m.arbitratorFingerprint,
  };
}

/** Newest-first market list in caller-provided chunks. */
export async function readMarkets(
  client: PublicClient,
  factory: Address,
  offset = 0,
  limit = 12,
): Promise<MarketRecord[]> {
  const count = await readMarketCount(client, factory);
  const records: MarketRecord[] = [];
  for (let index = offset; index < Math.min(Number(count), offset + limit); index += 1) {
    const id = count - 1n - BigInt(index - offset);
    records.push(await readMarket(client, factory, id));
  }
  return records;
}

export async function readPosition(
  client: PublicClient,
  factory: Address,
  id: bigint,
  account: Address,
): Promise<PositionRecord> {
  const p = (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'getPosition',
    args: [id, account],
  })) as {yes: bigint; no: bigint; settled: boolean};
  return {yes: p.yes, no: p.no, settled: p.settled};
}

export async function readClaimable(
  client: PublicClient,
  factory: Address,
  id: bigint,
  account: Address,
): Promise<{reward: bigint; refund: bigint}> {
  const [reward, refund] = (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'getClaimable',
    args: [id, account],
  })) as [bigint, bigint];
  return {reward, refund};
}

export async function readChallengeStake(
  client: PublicClient,
  factory: Address,
  id: bigint,
  challenger: Address,
): Promise<{amount: bigint; prefixBefore: bigint; claimed: boolean}> {
  return (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: 'getChallengeStake',
    args: [id, challenger],
  })) as {amount: bigint; prefixBefore: bigint; claimed: boolean};
}

export async function readBondEntitlement(
  client: PublicClient,
  factory: Address,
  id: bigint,
  bondType: BondType,
  account: Address,
): Promise<bigint> {
  return read<bigint>(client, factory, FACTORY_ABI, 'getBondEntitlement', [id, bondType, account]);
}

export interface GlobalAccounting {
  marketCount: bigint;
  totalContributions: bigint;
  totalParticipantPaid: bigint;
  totalFeesAccrued: bigint;
  totalFeesWithdrawn: bigint;
  totalBondsDeposited: bigint;
  totalBondsPaid: bigint;
  bondLiability: bigint;
  feeLiability: bigint;
  participantLiability: bigint;
  totalUnresolvedExposure: bigint;
  unaccountedBalance: bigint;
  contractBalance: bigint;
}

export async function readAccounting(
  client: PublicClient,
  factory: Address,
  atBlock?: bigint,
): Promise<GlobalAccounting> {
  const blockNumber = atBlock ?? (await client.getBlockNumber({cacheTime: 0}));
  const [
    marketCount,
    totalContributions,
    totalParticipantPaid,
    totalFeesAccrued,
    totalFeesWithdrawn,
    totalBondsDeposited,
    totalBondsPaid,
    bondLiability,
    feeLiability,
    participantLiability,
    totalUnresolvedExposure,
    unaccountedBalance,
    contractBalance,
  ] = await Promise.all([
    read<bigint>(client, factory, FACTORY_ABI, 'marketCount'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalContributions'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalParticipantPaid'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalFeesAccrued'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalFeesWithdrawn'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalBondsDeposited'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalBondsPaid'),
    read<bigint>(client, factory, FACTORY_ABI, 'bondLiability'),
    read<bigint>(client, factory, FACTORY_ABI, 'feeLiability'),
    read<bigint>(client, factory, FACTORY_ABI, 'participantLiability'),
    read<bigint>(client, factory, FACTORY_ABI, 'totalUnresolvedExposure'),
    read<bigint>(client, factory, FACTORY_ABI, 'unaccountedBalance'),
    client.getBalance({address: factory, blockNumber}),
  ]);
  return {
    marketCount,
    totalContributions,
    totalParticipantPaid,
    totalFeesAccrued,
    totalFeesWithdrawn,
    totalBondsDeposited,
    totalBondsPaid,
    bondLiability,
    feeLiability,
    participantLiability,
    totalUnresolvedExposure,
    unaccountedBalance,
    contractBalance,
  };
}

/** Accounting invariant: every wei in the contract is owned by somebody. */
export function accountingInvariant(a: GlobalAccounting): {ok: boolean; delta: bigint} {
  const liability = a.participantLiability + a.feeLiability + a.bondLiability;
  const delta = a.contractBalance - liability;
  return {ok: delta === 0n && a.unaccountedBalance === 0n, delta};
}

export async function readBlockTimestamp(client: PublicClient, blockNumber?: bigint): Promise<bigint> {
  const block = await client.getBlock({blockNumber});
  return block.timestamp;
}

export async function readNativeBalance(client: PublicClient, account: Address): Promise<bigint> {
  return client.getBalance({address: account});
}

// --------------------------------------------------------------- transaction

export interface CreateMarketInput {
  metadataHash: Hex;
  metadataURI: string;
  closeTime: bigint;
  resolutionTime: bigint;
  maxResolutionTime: bigint;
}

export function encodeCreateMarket(input: CreateMarketInput): Hex {
  return encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: 'createMarket',
    args: [input.metadataHash, input.metadataURI, input.closeTime, input.resolutionTime, input.maxResolutionTime],
  });
}

export function encodePredict(id: bigint, side: Side): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'predict', args: [id, side]});
}

export function encodeProposeResult(id: bigint, outcome: 1 | 2 | 3, evidenceHash: Hex): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'proposeResult', args: [id, outcome, evidenceHash]});
}

export function encodeChallengeResult(id: bigint, evidenceHash: Hex): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'challengeResult', args: [id, evidenceHash]});
}

export function encodeSubmitEvidence(id: bigint, evidenceHash: Hex): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'submitEvidence', args: [id, evidenceHash]});
}

export function encodeSettleDispute(id: bigint, decision: 1 | 2 | 3, evidenceHash: Hex): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'settleDispute', args: [id, decision, evidenceHash]});
}

export function encodeFinalizeResult(id: bigint): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'finalizeResult', args: [id]});
}

export function encodeClaim(id: bigint): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'claim', args: [id]});
}

export function encodeClaimRefund(id: bigint): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'claimRefund', args: [id]});
}

export function encodeClaimBond(id: bigint, bondType: BondType, recipient: Address): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'claimBond', args: [id, bondType, recipient]});
}

export function encodeCancelExpiredMarket(id: bigint): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'cancelExpiredMarket', args: [id]});
}

export function encodeCancelInterruptedMarket(id: bigint): Hex {
  return encodeFunctionData({abi: FACTORY_ABI, functionName: 'cancelInterruptedMarket', args: [id]});
}

/** The bond that must accompany each payable entry point. */
export function requiredValue(functionName: string, parameters: LocalParameters): bigint {
  switch (functionName) {
    case 'createMarket':
      return parameters.creationBond;
    case 'proposeResult':
      return parameters.proposalBond;
    case 'challengeResult':
      return parameters.challengeBond;
    default:
      return 0n;
  }
}

// ------------------------------------------------------------------ receipts

export async function waitForReceipt(client: PublicClient, hash: string): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({
    hash: hash as Hex,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 500,
  });
}

export function marketIdFromReceipt(receipt: TransactionReceipt, factory: Address): bigint | null {
  try {
    const events = parseEventLogs({
      abi: FACTORY_ABI,
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === factory.toLowerCase()),
      eventName: 'MarketCreated',
    });
    const first = events[0];
    if (!first || first.eventName !== 'MarketCreated') return null;
    const args = first.args as {marketId?: unknown};
    return typeof args.marketId === 'bigint' ? args.marketId : null;
  } catch {
    return null;
  }
}

export {EMPTY_ADDRESS};

// ------------------------------------------------------------------- errors

const SELECTED_ERROR_TEXT: Array<[RegExp, string]> = [
  [/MarketNotFound/, 'Market not found.'],
  [/InvalidState/, 'The market is not in a state that allows this action.'],
  [/InvalidTime/, 'The market timing does not allow this action right now.'],
  [/InvalidOutcome/, 'That outcome is not valid.'],
  [/InvalidEvidence/, 'An evidence hash is required and cannot be the zero hash.'],
  [/InvalidMetadata/, 'Metadata must be a non-zero hash with an ipfs:// URI of 8–256 bytes.'],
  [/InvalidSelectedTerms/, 'Market terms do not match the approved local parameters.'],
  [/InvalidRecipient/, 'Invalid recipient (zero address or the factory itself).'],
  [/IncorrectValue/, 'The attached value does not match the required bond or contribution.'],
  [/BelowMinimum/, 'The contribution is below the protocol minimum.'],
  [/PoolCapExceeded/, 'This market pool is at its cap.'],
  [/ExposureExceeded/, 'The unresolved exposure cap would be exceeded.'],
  [/DuplicateStake/, 'This account has already staked on this market.'],
  [/AlreadyClaimed/, 'Already claimed.'],
  [/NothingToClaim/, 'There is nothing to claim for this account.'],
  [/DirectTransferRejected/, 'Direct transfers to the contract are rejected. Use the app actions.'],
  [/TransferFailed/, 'The native transfer failed.'],
  [/ReentrancyGuardReentrantCall/, 'Reentrant call rejected.'],
  [/Unauthorized/, 'Your wallet does not hold this role.'],
  [/FinancialActivityDisabled/, 'Financial activity is disabled on this protocol.'],
  [/NotApproved/, 'The release has not been approved.'],
  [/AlreadyBound/, 'The factory is already bound.'],
  [/InvalidMultisig/, 'The role check rejected this wallet (disjoint-owner or threshold rule).'],
  [/InsufficientCheckGas/, 'The role check ran out of gas.'],
  [/ControlUnchanged/, 'The control state is already what you requested.'],
];

export function selectedErrorText(message: string): string {
  for (const [pattern, text] of SELECTED_ERROR_TEXT) {
    if (pattern.test(message)) return text;
  }
  return message;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const anyError = error as {
      shortMessage?: string;
      message?: string;
      code?: number;
      details?: string;
      cause?: {shortMessage?: string; message?: string};
    };
    if (anyError.code === 4001) return 'Cancelled in your wallet. No transaction was sent.';
    if (anyError.code === -32002) return 'Your wallet has a pending request. Finish it first.';
    return selectedErrorText(
      anyError.shortMessage ?? anyError.cause?.shortMessage ?? anyError.message ?? anyError.details ?? String(error),
    );
  }
  return selectedErrorText(String(error));
}

export {EMPTY_ADDRESS as ZERO_ADDRESS};
