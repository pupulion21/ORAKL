/** Typed chain layer. All reads go through the verified official QIE testnet RPC;
 *  writes are signed by the user's wallet session in `wallet.ts`.
 */

import {
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import {QIE_PREDICTION_MARKET_ABI} from './abi.ts';
import {publicClient} from './config.ts';
import {QIE_CHAIN_ID} from './constants.ts';
import {
  parseManifestJson,
  type DeploymentManifest,
  type ManifestParseResult,
} from './manifest.ts';

export type Address = `0x${string}`;
export type Outcome = 0 | 1 | 2 | 3; // UNRESOLVED | YES | NO | INVALID
export type Side = 0 | 1; // YES | NO

export interface MarketRecord {
  id: bigint;
  creator: Address;
  resolver: Address;
  closeTime: bigint;
  resolveDeadline: bigint;
  outcome: Outcome;
  cancelled: boolean;
  yesStake: bigint;
  noStake: bigint;
  paidOut: bigint;
  remainingEscrow: bigint;
  refundable: boolean;
  question: string;
  criteria: string;
  source: string;
}

export interface PositionRecord {
  yes: bigint;
  no: bigint;
  settled: boolean;
}

export interface MarketAccountState {
  position: PositionRecord;
  projectedPayout: bigint;
  projectedRefund: bigint;
}

export interface GlobalStats {
  marketCount: bigint;
  totalStakeReceived: bigint;
  totalPaidOut: bigint;
  totalEscrow: bigint;
  unaccountedBalance: bigint;
  contractBalance: bigint;
}

export interface DeploymentVerification {
  runtimeCodeMatches: true;
  marketCountReadable: true;
  marketCount: bigint;
  stats: GlobalStats;
  blockNumber: bigint;
  verifiedAt: string;
}

export type DeploymentLoad =
  | {kind: 'NOT_DEPLOYED'}
  | {kind: 'INVALID'; reason: string}
  | {kind: 'ERROR'; reason: string}
  | {kind: 'ACTIVE'; manifest: DeploymentManifest; verification: DeploymentVerification};

export interface CreateMarketInput {
  question: string;
  criteria: string;
  source: string;
  resolver: Address;
  closeTime: bigint;
  resolveDeadline: bigint;
}

// --------------------------------------------------------------------- reads

export async function readMarketCount(address: Address, blockNumber?: bigint): Promise<bigint> {
  return publicClient.readContract({
    address,
    blockNumber,
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'marketCount',
  });
}

export async function readMarket(address: Address, id: bigint): Promise<MarketRecord> {
  const [view, meta] = await Promise.all([
    publicClient.readContract({
      address,
      abi: QIE_PREDICTION_MARKET_ABI,
      functionName: 'getMarket',
      args: [id],
    }),
    publicClient.readContract({
      address,
      abi: QIE_PREDICTION_MARKET_ABI,
      functionName: 'getMarketMeta',
      args: [id],
    }),
  ]);

  return {
    id,
    creator: view.creator as Address,
    resolver: view.resolver as Address,
    closeTime: BigInt(view.closeTime),
    resolveDeadline: BigInt(view.resolveDeadline),
    outcome: Number(view.outcome) as Outcome,
    cancelled: view.cancelled,
    yesStake: view.yesStake,
    noStake: view.noStake,
    paidOut: view.paidOut,
    remainingEscrow: view.remainingEscrow,
    refundable: view.refundable,
    question: meta[0],
    criteria: meta[1],
    source: meta[2],
  };
}

/** Read markets in descending id order, in caller-provided chunks. */
export async function readMarketRange(
  address: Address,
  fromInclusive: bigint,
  toInclusive: bigint,
): Promise<MarketRecord[]> {
  if (fromInclusive > toInclusive) return [];
  const ids: bigint[] = [];
  for (let id = fromInclusive; id <= toInclusive; id += 1n) ids.push(id);
  const records = await Promise.all(ids.map((id) => readMarket(address, id)));
  return records.reverse();
}

export async function readPosition(
  address: Address,
  id: bigint,
  account: Address,
): Promise<PositionRecord> {
  const result = await publicClient.readContract({
    address,
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'getPosition',
    args: [id, account],
  });
  return {yes: result[0], no: result[1], settled: result[2]};
}

export async function readMarketAccountState(
  address: Address,
  id: bigint,
  account: Address,
): Promise<MarketAccountState> {
  const [position, projectedPayout, projectedRefund] = await Promise.all([
    readPosition(address, id, account),
    publicClient.readContract({
      address,
      abi: QIE_PREDICTION_MARKET_ABI,
      functionName: 'projectedPayout',
      args: [id, account],
    }),
    publicClient.readContract({
      address,
      abi: QIE_PREDICTION_MARKET_ABI,
      functionName: 'projectedRefund',
      args: [id, account],
    }),
  ]);
  return {position, projectedPayout, projectedRefund};
}

export async function readGlobalStats(address: Address, atBlock?: bigint): Promise<GlobalStats> {
  const blockNumber = atBlock ?? await publicClient.getBlockNumber({cacheTime: 0});
  const [marketCount, totalStakeReceived, totalPaidOut, totalEscrow, unaccountedBalance, contractBalance] =
    await Promise.all([
      readMarketCount(address, blockNumber),
      publicClient.readContract({
        address,
        abi: QIE_PREDICTION_MARKET_ABI,
        functionName: 'totalStakeReceived',
        blockNumber,
      }),
      publicClient.readContract({
        address,
        abi: QIE_PREDICTION_MARKET_ABI,
        functionName: 'totalPaidOut',
        blockNumber,
      }),
      publicClient.readContract({
        address,
        abi: QIE_PREDICTION_MARKET_ABI,
        functionName: 'totalEscrow',
        blockNumber,
      }),
      publicClient.readContract({
        address,
        abi: QIE_PREDICTION_MARKET_ABI,
        functionName: 'unaccountedBalance',
        blockNumber,
      }),
      publicClient.getBalance({address, blockNumber}),
    ]);

  return {
    marketCount,
    totalStakeReceived,
    totalPaidOut,
    totalEscrow,
    unaccountedBalance,
    contractBalance,
  };
}

export async function readNativeBalance(account: Address): Promise<bigint> {
  return publicClient.getBalance({address: account});
}

export async function readBlockNumber(): Promise<bigint> {
  return publicClient.getBlockNumber();
}

// ------------------------------------------------------------- verification

export async function verifyContractRuntime(
  address: Address,
  expectedRuntimeHash: string,
): Promise<DeploymentVerification> {
  const chainId = await publicClient.getChainId();
  if (chainId !== QIE_CHAIN_ID) {
    throw new Error(`RPC reported chain ${chainId}, instead of ${QIE_CHAIN_ID}; verification cancelled`);
  }

  const blockNumber = await publicClient.getBlockNumber({cacheTime: 0});
  const code = await publicClient.getCode({address, blockNumber});
  if (!code || code === '0x') {
    throw new Error(`No bytecode at ${address}`);
  }
  const observedRuntimeHash = keccak256(code).toLowerCase();
  if (observedRuntimeHash !== expectedRuntimeHash.toLowerCase()) {
    throw new Error(
      `Runtime bytecode mismatch: on-chain ${observedRuntimeHash}, expected ${expectedRuntimeHash}`,
    );
  }

  const stats = await readGlobalStats(address, blockNumber);
  if (stats.totalStakeReceived - stats.totalPaidOut !== stats.totalEscrow) {
    throw new Error('Inconsistent contract accounting: received - paidOut != totalEscrow');
  }
  if (stats.contractBalance < stats.totalEscrow) {
    throw new Error('Contract balance is less than totalEscrow');
  }
  if (stats.unaccountedBalance !== stats.contractBalance - stats.totalEscrow) {
    throw new Error('unaccountedBalance does not equal contract balance - totalEscrow');
  }

  return {
    runtimeCodeMatches: true,
    marketCountReadable: true,
    marketCount: stats.marketCount,
    stats,
    blockNumber,
    verifiedAt: new Date().toISOString(),
  };
}

export async function verifyDeployment(manifest: DeploymentManifest): Promise<DeploymentVerification> {
  return verifyContractRuntime(manifest.address as Address, manifest.artifact.runtimeBytecodeKeccak256);
}

/** Fetch the manifest, validate its shape, then verify the on-chain runtime code.
 *  A missing file / SPA fallback is NOT_DEPLOYED; a malformed or mismatching
 *  manifest is INVALID and never used for reads. */
export async function loadAndVerifyDeployment(url: string): Promise<DeploymentLoad> {
  let response: Response;
  try {
    response = await fetch(url, {cache: 'no-store'});
  } catch (error) {
    return {kind: 'ERROR', reason: `Could not load manifest: ${error instanceof Error ? error.message : String(error)}`};
  }

  if (!response.ok) {
    if (response.status === 404) return {kind: 'NOT_DEPLOYED'};
    return {kind: 'ERROR', reason: `manifest HTTP ${response.status}`};
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    // Vite/SPA servers often answer unknown paths with index.html. That means
    // "no manifest", not "a contract at the HTML file".
    return {kind: 'NOT_DEPLOYED'};
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return {kind: 'ERROR', reason: `Could not read manifest: ${error instanceof Error ? error.message : String(error)}`};
  }

  const parsed: ManifestParseResult = parseManifestJson(raw);
  if (parsed.kind === 'NOT_DEPLOYED') return {kind: 'NOT_DEPLOYED'};
  if (parsed.kind === 'INVALID') return {kind: 'INVALID', reason: parsed.reason};

  try {
    const verification = await verifyDeployment(parsed.manifest);
    return {kind: 'ACTIVE', manifest: parsed.manifest, verification};
  } catch (error) {
    return {
      kind: 'INVALID',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// --------------------------------------------------------------- transaction

export function encodeStake(id: bigint, side: Side): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'stake',
    args: [id, side],
  });
}

export function encodeCreateMarket(input: CreateMarketInput): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'createMarket',
    args: [input.question, input.criteria, input.source, input.resolver, input.closeTime, input.resolveDeadline],
  });
}

export function encodeResolve(id: bigint, outcome: 1 | 2 | 3): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'resolve',
    args: [id, outcome],
  });
}

export function encodeClaim(id: bigint): Hex {
  return encodeFunctionData({abi: QIE_PREDICTION_MARKET_ABI, functionName: 'claim', args: [id]});
}

export function encodeClaimTo(id: bigint, recipient: Address): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'claimTo',
    args: [id, recipient],
  });
}

export function encodeRefund(id: bigint): Hex {
  return encodeFunctionData({abi: QIE_PREDICTION_MARKET_ABI, functionName: 'refund', args: [id]});
}

export function encodeRefundTo(id: bigint, recipient: Address): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'refundTo',
    args: [id, recipient],
  });
}

export function encodeCancelIfExpired(id: bigint): Hex {
  return encodeFunctionData({
    abi: QIE_PREDICTION_MARKET_ABI,
    functionName: 'cancelIfExpired',
    args: [id],
  });
}

// ------------------------------------------------------------------ receipts

export async function waitForReceipt(hash: string): Promise<TransactionReceipt> {
  return publicClient.waitForTransactionReceipt({
    hash: hash as Hex,
    confirmations: 1,
    timeout: 180_000,
    pollingInterval: 2_000,
  });
}

export async function getReceipt(hash: string): Promise<TransactionReceipt> {
  return publicClient.getTransactionReceipt({hash: hash as Hex});
}

/** Bind the market ID to the creation event emitted by the supplied contract. */
export function marketIdFromReceipt(receipt: TransactionReceipt, address: Address): bigint | null {
  try {
    const events = parseEventLogs({
      abi: QIE_PREDICTION_MARKET_ABI,
      logs: receipt.logs.filter((log) => sameAddress(log.address, address)),
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

export async function blockTimestamp(blockNumber: bigint): Promise<bigint> {
  const block = await publicClient.getBlock({blockNumber});
  return block.timestamp;
}

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
