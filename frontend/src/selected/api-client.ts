/** ORAKL P1 — Selected Frontend API Client.
 *
 *  Type-safe client communicating strictly with the local Fastify backend (ADR-0007).
 *  Propagates chain isolation headers (x-chain-id: 31337), preserves exact uint256
 *  quantities as decimal strings/BigInt without JavaScript Number truncation (ADR-0001),
 *  standardizes error handling (ADR-0012), and supports AbortSignal cancellation.
 */

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4310';
export const LOCAL_CHAIN_ID = 31337;

// ---------------------------------------------------------------------- types

export type SyncStatus =
  | 'SYNCHRONIZED'
  | 'LAGGING'
  | 'INITIALIZING'
  | 'HALTED'
  | 'STALE'
  | 'UNAVAILABLE';

export interface SyncMetadata {
  status: SyncStatus;
  lastProcessedBlock: string;
  lastProcessedBlockHash: string;
  lag: string;
  indexedEvents: string;
  chainId: number;
  contractAddress: string;
  headBlock: string;
  checkedAt: string;
  referenceSource: string;
}

export interface ApiResponse<T> {
  data: T;
  sync?: SyncMetadata;
  simulationOnly?: boolean;
}

export interface ApiErrorDetail {
  error: string;
  code: string;
  statusCode: number;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId?: string;

  constructor(detail: ApiErrorDetail) {
    super(detail.error);
    this.name = 'ApiError';
    this.code = detail.code;
    this.statusCode = detail.statusCode;
    this.requestId = detail.requestId;
  }
}

export interface MarketListItem {
  id: string;
  chainId: number;
  contractAddress: string;
  creator: string;
  question: string;
  description: string | null;
  category: string | null;
  metadataHash: string;
  metadataURI: string;
  verifiedMetadata: boolean;
  status: 'OPEN' | 'CLOSED' | 'PROPOSED' | 'DISPUTED' | 'FINALIZED' | 'CANCELLED';
  finalOutcome: 'UNRESOLVED' | 'YES' | 'NO' | 'INVALID';
  proposer: string | null;
  challenger: string | null;
  proposedOutcome: string | null;
  proposalEvidence: string | null;
  challengeEvidence: string | null;
  decisionEvidence: string | null;
  yesPool: string;
  noPool: string;
  totalChallengeStake: string;
  refundable: boolean | null;
  challengeDeadline: string | null;
  closeTime: string;
  resolutionTime: string;
  maxResolutionTime: string;
  createdAtBlock: string;
}

export interface MarketListResult {
  page: number;
  pageSize: number;
  total: number;
  items: MarketListItem[];
}

export interface MarketListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  category?: string;
  q?: string;
  sort?: 'id' | 'closeTime';
  order?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export interface MarketDetail extends MarketListItem {
  resolution: {
    status: string;
    proposerAddress: string | null;
    proposedOutcome: string;
    proposalBond: string;
    challengeDeadline: string | null;
    challengerAddress: string | null;
    challengeEvidenceHash: string | null;
    challengeBond: string;
    finalOutcome: string;
  } | null;
  positions: Array<{
    id: string;
    walletAddress: string;
    yesContribution: string;
    noContribution: string;
    claimedAmount: string;
    refundedAmount: string;
    updatedBlock: string;
  }>;
  contributions: Array<{
    id: string;
    walletAddress: string;
    side: 'YES' | 'NO';
    amount: string;
    predictCount: number;
  }>;
  challengeStakes: Array<{
    id: string;
    walletAddress: string;
    amount: string;
    prefixBefore: string;
    evidenceHash: string;
    claimed: boolean;
    blockNumber: string;
  }>;
  settlement: {
    id: string;
    disposition: string;
    totalChallengeStake: string;
    proposalBond: string;
    refundable: boolean;
    txHash: string;
  } | null;
  claimsByType: Array<{
    claimType: string;
    _count: { _all: number };
  }>;
}

export interface IndexerStatus {
  checkpoint: {
    chainId: number;
    contractAddress: string;
    lastProcessedBlock: string;
    lastProcessedBlockHash: string;
    eventsIndexed: string;
  } | null;
  latestBlock: {
    blockNumber: string;
    blockHash: string;
    timestamp: string;
  } | null;
  rollbacksCount: number;
  sync: SyncMetadata;
}

export interface ExposureSummary {
  latestAccountingSnapshot: Record<string, unknown> | null;
  feeAccrued: string | null;
  feeWithdrawn: string | null;
  exposureReleasedSum: string | null;
}

export interface ChallengeStakeItem {
  id: string;
  chainId: number;
  marketId: string;
  walletAddress: string;
  amount: string;
  prefixBefore: string;
  evidenceHash: string;
  claimed: boolean;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
}

export interface MarketChallengesResult {
  totalChallengeStake: string;
  disposition: string | null;
  refundable: boolean | null;
  stakes: ChallengeStakeItem[];
}

export interface EvidenceArtifactDetail {
  commitment: string;
  manifestBytes: string;
  contentBytes: string | null;
  contentSize: number;
  contentKeccak: string;
  publishedBy: string | null;
  marketOnchainId: string | null;
  linkedEventTx: string | null;
  externalPinning: string;
  createdAt: string;
}

export interface PublicationAuth {
  app: string;
  version: string;
  action: 'evidence' | 'metadata';
  chainId: number;
  factory: string;
  publisher: string;
  commitment: string;
  nonce: string;
  deadline: number;
}

export interface PublishEvidencePayload {
  manifest: unknown;
  auth?: PublicationAuth;
  signature?: string;
  content?: string;
}

export interface PublishEvidenceResult {
  commitment: string;
  deduped: boolean;
  hasContent?: boolean;
  marketLinked?: boolean;
  externalPinning: string;
}

export interface PortfolioPosition {
  id: string;
  marketId: string;
  walletAddress: string;
  yesContribution: string;
  noContribution: string;
  claimedAmount: string;
  refundedAmount: string;
  settled: boolean;
  market: {
    onchainMarketId: string;
    status: string;
    finalOutcome: string;
    refundable: boolean;
    closeTime: string;
  };
}

export interface PortfolioChallengeStake {
  id: string;
  marketId: string;
  walletAddress: string;
  amount: string;
  prefixBefore: string;
  claimed: boolean;
  market: {
    onchainMarketId: string;
    status: string;
    finalOutcome: string;
    settlement?: {
      disposition: string;
    } | null;
  };
}

export interface PortfolioBond {
  id: string;
  marketId: string;
  walletAddress: string;
  bondType: 'CREATION' | 'PROPOSAL' | 'CHALLENGE';
  amount: string;
  claimed: boolean;
  market: {
    onchainMarketId: string;
    status: string;
    finalOutcome: string;
    settlement?: {
      disposition: string;
    } | null;
  };
}

export interface PortfolioDetail {
  address: string;
  projectionOnly: boolean;
  note: string;
  openRisk: string;
  totalClaimed: string;
  totals: {
    positions: number;
    challengeStakes: number;
    bonds: number;
  };
  positions: PortfolioPosition[];
  challengeStakes: PortfolioChallengeStake[];
  bonds: PortfolioBond[];
  claimsByType: Array<{ claimType: string; _count: { _all: number } }>;
  recentTransactions: Array<{
    txHash: string;
    fromAddress: string;
    toAddress?: string;
    blockNumber: string;
    status: string;
    createdAt: string;
  }>;
}

export interface ApiClientConfig {
  baseUrl?: string;
  chainId?: number;
  fetch?: typeof fetch;
}

export interface ApiClient {
  getBaseUrl(): string;
  getChainId(): number;
  getMarkets(params?: MarketListParams): Promise<ApiResponse<MarketListResult>>;
  getMarket(id: bigint | number | string, signal?: AbortSignal): Promise<ApiResponse<MarketDetail>>;
  getMarketChallenges(id: bigint | number | string, signal?: AbortSignal): Promise<ApiResponse<MarketChallengesResult>>;
  getEvidence(commitment: string, signal?: AbortSignal): Promise<ApiResponse<EvidenceArtifactDetail>>;
  publishEvidence(payload: PublishEvidencePayload, signal?: AbortSignal): Promise<ApiResponse<PublishEvidenceResult>>;
  getIndexerStatus(signal?: AbortSignal): Promise<ApiResponse<IndexerStatus>>;
  getExposure(signal?: AbortSignal): Promise<ApiResponse<ExposureSummary>>;
  getPortfolio(address: string, signal?: AbortSignal): Promise<ApiResponse<PortfolioDetail>>;
}

// ----------------------------------------------------------------- arithmetic

/** Convert a pool quantity string safely to BigInt without floating-point precision loss. */
export function parsePoolAmount(value: string | null | undefined): bigint {
  if (!value || typeof value !== 'string') return 0n;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '0') return 0n;
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

// ----------------------------------------------------------------- implementation

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = (config.baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const chainId = config.chainId ?? LOCAL_CHAIN_ID;
  const fetchFn = config.fetch ?? fetch;

  async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'x-chain-id': String(chainId),
      ...((options.headers as Record<string, string>) || {}),
    };

    let response: Response;
    try {
      response = await fetchFn(url, {...options, headers});
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw new ApiError({
        error: `API unavailable: ${err instanceof Error ? err.message : String(err)}`,
        code: 'API_UNAVAILABLE',
        statusCode: 503,
      });
    }

    if (!response.ok) {
      let errorPayload: ApiErrorDetail | null = null;
      try {
        const json = await response.json();
        if (json && typeof json === 'object') {
          errorPayload = {
            error: typeof json.error === 'string' ? json.error : response.statusText,
            code: typeof json.code === 'string' ? json.code : 'HTTP_ERROR',
            statusCode: typeof json.statusCode === 'number' ? json.statusCode : response.status,
            requestId: typeof json.requestId === 'string' ? json.requestId : undefined,
          };
        }
      } catch {
        // Not a JSON response
      }

      throw new ApiError(
        errorPayload ?? {
          error: response.statusText || `Request failed with status ${response.status}`,
          code: response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
          statusCode: response.status,
        },
      );
    }

    return (await response.json()) as ApiResponse<T>;
  }

  return {
    getBaseUrl(): string {
      return baseUrl;
    },
    getChainId(): number {
      return chainId;
    },
    async getMarkets(params: MarketListParams = {}): Promise<ApiResponse<MarketListResult>> {
      const searchParams = new URLSearchParams();
      if (params.page != null) searchParams.set('page', String(params.page));
      if (params.pageSize != null) searchParams.set('pageSize', String(params.pageSize));
      if (params.status) searchParams.set('status', params.status);
      if (params.category) searchParams.set('category', params.category);
      if (params.q) searchParams.set('q', params.q);
      if (params.sort) searchParams.set('sort', params.sort);
      if (params.order) searchParams.set('order', params.order);

      const qs = searchParams.toString();
      const path = `/api/v1/markets${qs ? `?${qs}` : ''}`;
      return request<MarketListResult>(path, {signal: params.signal});
    },
    async getMarket(id: bigint | number | string, signal?: AbortSignal): Promise<ApiResponse<MarketDetail>> {
      const idStr = id.toString();
      return request<MarketDetail>(`/api/v1/markets/${encodeURIComponent(idStr)}`, {signal});
    },
    async getMarketChallenges(id: bigint | number | string, signal?: AbortSignal): Promise<ApiResponse<MarketChallengesResult>> {
      const idStr = id.toString();
      return request<MarketChallengesResult>(`/api/v1/markets/${encodeURIComponent(idStr)}/challenges`, {signal});
    },
    async getEvidence(commitment: string, signal?: AbortSignal): Promise<ApiResponse<EvidenceArtifactDetail>> {
      return request<EvidenceArtifactDetail>(`/api/v1/evidence/${encodeURIComponent(commitment)}`, {signal});
    },
    async publishEvidence(payload: PublishEvidencePayload, signal?: AbortSignal): Promise<ApiResponse<PublishEvidenceResult>> {
      return request<PublishEvidenceResult>('/api/v1/evidence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    },
    async getIndexerStatus(signal?: AbortSignal): Promise<ApiResponse<IndexerStatus>> {
      return request<IndexerStatus>('/api/v1/indexer/status', {signal});
    },
    async getExposure(signal?: AbortSignal): Promise<ApiResponse<ExposureSummary>> {
      return request<ExposureSummary>('/api/v1/exposure', {signal});
    },
    async getPortfolio(address: string, signal?: AbortSignal): Promise<ApiResponse<PortfolioDetail>> {
      return request<PortfolioDetail>(`/api/v1/portfolio/${encodeURIComponent(address)}`, {signal});
    },
  };
}
