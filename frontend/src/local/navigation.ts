/** ORAKL — Local Navigation & Resolution State Helpers */

export type Route =
  | {name: 'list'}
  | {name: 'market'; id: bigint}
  | {name: 'arbitration'; filter?: 'all' | 'disputed' | 'proposed' | 'finalized'}
  | {name: 'arbitration-case'; id: bigint}
  | {name: 'create'}
  | {name: 'evidence'}
  | {name: 'status'}
  | {name: 'portfolio'};

/** Parses a browser location hash into an application Route. */
export function parseRoute(hashOverride?: string): Route {
  const hash = (hashOverride ?? (typeof location !== 'undefined' ? location.hash : '')).replace(/^#/, '');
  const marketMatch = /^\/market\/(\d+)$/.exec(hash);
  if (marketMatch?.[1]) return {name: 'market', id: BigInt(marketMatch[1])};
  const arbCaseMatch = /^\/arbitration\/(\d+)$/.exec(hash);
  if (arbCaseMatch?.[1]) return {name: 'arbitration-case', id: BigInt(arbCaseMatch[1])};
  if (hash.startsWith('/arbitration')) {
    const qIdx = hash.indexOf('?');
    let filter: 'all' | 'disputed' | 'proposed' | 'finalized' = 'all';
    if (qIdx !== -1) {
      const params = new URLSearchParams(hash.slice(qIdx));
      const f = params.get('filter');
      if (f === 'disputed' || f === 'proposed' || f === 'finalized' || f === 'all') {
        filter = f;
      }
    }
    return {name: 'arbitration', filter};
  }
  if (hash === '/create') return {name: 'create'};
  if (hash === '/evidence') return {name: 'evidence'};
  if (hash === '/status') return {name: 'status'};
  if (hash === '/portfolio') return {name: 'portfolio'};
  return {name: 'list'};
}

/** Maps a numerical stored market state to visual tone. */
export function stateTone(storedState: number): 'open' | 'wait' | 'done' | 'expired' {
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

/** Calculates proportional pool distribution without guaranteed probability claims. */
export function calculatePoolShares(yesPool: bigint, noPool: bigint): {
  total: bigint;
  yesPct: number | null;
  noPct: number | null;
} {
  const total = yesPool + noPool;
  if (total === 0n) {
    return {total: 0n, yesPct: null, noPct: null};
  }
  const yesPct = Number((yesPool * 10_000n) / total) / 100;
  const noPct = 100 - yesPct;
  return {total, yesPct, noPct};
}

/** Case-insensitive check if an account is in the arbitrator multisig owners list. */
export function isArbitratorOwner(account: string | null | undefined, owners: readonly string[]): boolean {
  if (!account) return false;
  const normalized = account.toLowerCase();
  return owners.some((owner) => owner.toLowerCase() === normalized);
}

// ---------------------------------------------------------------------- Create Market

export const VALID_MARKET_CATEGORIES = [
  {slug: 'crypto', label: 'Crypto & Digital Assets'},
  {slug: 'finance', label: 'Commodities, Macro & Finance'},
  {slug: 'tech', label: 'Technology, Science & AI'},
  {slug: 'geopolitics', label: 'Geopolitics & World Events'},
  {slug: 'governance', label: 'Protocol Governance'},
] as const;

export type MarketCategorySlug = (typeof VALID_MARKET_CATEGORIES)[number]['slug'];

export interface CreateMarketFormValues {
  question: string;
  category: string;
  description: string;
  primarySource: string;
  fallbackSource: string;
  yesCriteria: string;
  noCriteria: string;
  invalidCriteria: string;
  closeTimeSec: bigint;
  resolutionTimeSec: bigint;
  maxResolutionTimeSec: bigint;
  nowSec: bigint;
  challengePeriodSec: number;
  arbitrationPeriodSec: number;
}

export const GOLD_BENCHMARK_PRESET = {
  question: 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?',
  category: 'finance',
  description: 'London Bullion Market Association (LBMA) Gold Price PM benchmark settlement for December 31, 2026.',
  primarySource: 'https://www.lbma.org.uk/prices-and-data/precious-metal-prices',
  fallbackSource: 'https://www.bloomberg.com/quote/GOLD:CUR',
  yesCriteria: 'LBMA Gold Price PM (XAU/USD) is strictly greater than or equal to $2,800.00 USD on December 31, 2026.',
  noCriteria: 'LBMA Gold Price PM (XAU/USD) is strictly less than $2,800.00 USD on December 31, 2026.',
  invalidCriteria: 'LBMA does not publish an official PM benchmark price for 2026-12-31 by 2027-01-02 18:00 UTC, or trading is permanently disrupted. All positions are refunded 100% (1:1 neutral refund) with zero protocol fee deducted.',
};

/**
 * Calculates the protocol-enforced minimum maxResolutionTime floor:
 * maxTime >= resolutionTime + challengePeriod + arbitrationPeriod + 48h buffer
 */
export function calculateMinimumMaxResolutionTime(
  resolutionTimeSec: bigint,
  challengePeriodSec: number,
  arbitrationPeriodSec: number,
): bigint {
  const safetyBufferSec = 48n * 3600n;
  return resolutionTimeSec + BigInt(challengePeriodSec) + BigInt(arbitrationPeriodSec) + safetyBufferSec;
}

/** Validates inputs for the ORAKL v1 institutional market creation wizard. */
export function validateMarketCreationInput(values: CreateMarketFormValues): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const trimmedQuestion = values.question.trim();
  if (trimmedQuestion.length < 15) {
    errors.push('Question must be at least 15 characters long.');
  }
  if (!trimmedQuestion.endsWith('?')) {
    errors.push('Question must end with a question mark (?).');
  }

  const validSlugs = VALID_MARKET_CATEGORIES.map((c) => c.slug);
  if (!validSlugs.includes(values.category as MarketCategorySlug)) {
    errors.push(`Category must be one of: ${validSlugs.join(', ')}.`);
  }

  const trimmedPrimary = values.primarySource.trim();
  if (!trimmedPrimary) {
    errors.push('Primary resolution source URL is required.');
  } else if (!/^(https?:\/\/|ipfs:\/\/|ar:\/\/)/.test(trimmedPrimary)) {
    errors.push('Primary resolution source must begin with https://, http://, ipfs://, or ar://.');
  }

  if (values.fallbackSource.trim() && !/^(https?:\/\/|ipfs:\/\/|ar:\/\/)/.test(values.fallbackSource.trim())) {
    errors.push('Fallback resolution source must begin with https://, http://, ipfs://, or ar://.');
  }

  if (values.yesCriteria.trim().length < 10) {
    errors.push('YES outcome resolution criteria must be at least 10 characters.');
  }

  if (values.noCriteria.trim().length < 10) {
    errors.push('NO outcome resolution criteria must be at least 10 characters.');
  }

  if (values.invalidCriteria.trim().length < 10) {
    errors.push('INVALID outcome resolution criteria must be at least 10 characters.');
  }

  if (values.closeTimeSec <= values.nowSec) {
    errors.push('Market close time must be in the future relative to the local blockchain clock.');
  }

  if (values.resolutionTimeSec < values.closeTimeSec) {
    errors.push('Resolution start time must be at or after the market close time.');
  }

  const minMax = calculateMinimumMaxResolutionTime(
    values.resolutionTimeSec,
    values.challengePeriodSec,
    values.arbitrationPeriodSec,
  );
  if (values.maxResolutionTimeSec < minMax) {
    const totalRequiredHours = (values.challengePeriodSec + values.arbitrationPeriodSec) / 3600 + 48;
    errors.push(
      `Max resolution time must be at least ${totalRequiredHours} hours (${minMax}s) after resolution start time to accommodate challenge (${values.challengePeriodSec / 3600}h), arbitration (${values.arbitrationPeriodSec / 3600}h), and safety buffer (48h).`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export interface MarketMetadataManifest {
  schema: 'orakl-market-metadata-v1';
  chainId: string;
  factory: string;
  question: string;
  description: string;
  category: string;
  resolutionCriteria: string;
  sources: string[];
  creator: string;
  createdAt: string;
}

/** Formats structured resolution criteria into a single standardized text blob. */
export function formatResolutionCriteriaBlob(params: {
  yes: string;
  no: string;
  invalid: string;
  fallback?: string;
}): string {
  const parts = [
    `[YES OUTCOME CRITERIA]\n${params.yes.trim()}`,
    `[NO OUTCOME CRITERIA]\n${params.no.trim()}`,
    `[INVALID / NEUTRAL REFUND RULES]\n${params.invalid.trim()}`,
  ];
  if (params.fallback?.trim()) {
    parts.push(`[FALLBACK DATA SOURCES]\n${params.fallback.trim()}`);
  }
  return parts.join('\n\n');
}

/** Canonicalizes a MarketMetadataManifest according to RFC 8785 (JCS lexicographical key order). */
export function canonicalizeMarketMetadata(manifest: MarketMetadataManifest): string {
  // Alphabetical sort: category, chainId, createdAt, creator, description, factory, question, resolutionCriteria, schema, sources
  const sorted: Record<string, unknown> = {
    category: manifest.category,
    chainId: manifest.chainId,
    createdAt: manifest.createdAt,
    creator: manifest.creator.toLowerCase(),
    description: manifest.description,
    factory: manifest.factory.toLowerCase(),
    question: manifest.question,
    resolutionCriteria: manifest.resolutionCriteria,
    schema: manifest.schema,
    sources: manifest.sources,
  };
  return JSON.stringify(sorted);
}
