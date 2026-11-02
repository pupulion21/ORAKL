import { keccak256, toHex } from 'viem';
import type { MarketMetadataManifest } from './navigation.ts';
import { canonicalizeMarketMetadata } from './navigation.ts';
import type { MarketListItem } from '../selected/api-client.ts';
import { parsePoolAmount } from '../selected/api-client.ts';

export const MANIFEST_CACHE_KEY = 'orakl_local_manifest_cache_v1';

export type MetadataTrustStatus = 'verified' | 'unverified' | 'unavailable';

export interface MarketViewItem {
  id: bigint;
  title: string;
  hasMetadata: boolean;
  metadataStatus: MetadataTrustStatus;
  metadataUnavailableReason?: string;
  metadataHash: string;
  description: string | null;
  category: string | null;
  metadataURI: string;
  statusText: string;
  statusTone: 'open' | 'wait' | 'done' | 'expired';
  yesPool: bigint;
  noPool: bigint;
  closeTime: bigint;
  fromApi: boolean;
  isTampered: boolean;
}

export interface MetadataVerificationResult {
  status: MetadataTrustStatus;
  question: string;
  description: string | null;
  category: string | null;
  resolutionCriteria: string | null;
  sources: string[];
  metadataHash: string; // on-chain commitment (0x...)
  metadataURI: string; // on-chain or published URI
  computedHash?: string; // computed RFC 8785 hash
  hasMetadata: boolean;
  reason?: string;
  isTampered: boolean;
  manifest?: MarketMetadataManifest;
}

export interface VerifyMetadataParams {
  onchainHash?: string | null;
  onchainURI?: string | null;
  apiItem?: {
    question?: string | null;
    description?: string | null;
    category?: string | null;
    metadataHash?: string | null;
    metadataURI?: string | null;
    verifiedMetadata?: boolean | null;
  } | null;
  cachedManifest?: MarketMetadataManifest | null;
}

/**
 * Computes canonical RFC 8785 representation and Keccak-256 hash commitment of a manifest,
 * verifying whether it matches the expected on-chain commitment.
 */
export function verifyMetadataCommitment(
  manifest: MarketMetadataManifest,
  expectedCommitment: string,
): { verified: boolean; computedHash: string; canonical: string } {
  const canonical = canonicalizeMarketMetadata(manifest);
  const computedHash = keccak256(toHex(canonical)).toLowerCase();
  const target = (expectedCommitment || '').trim().toLowerCase();
  return {
    verified: computedHash === target,
    computedHash,
    canonical,
  };
}

/**
 * Cryptographically verifies market metadata against the on-chain metadataHash commitment.
 * Enforces RFC 8785 JCS canonicalization and detects tampering, corruption, or unverified claims.
 *
 * CRITICAL RULE: Never accept an API-reported metadataHash as independent proof of on-chain
 * commitment. If independent on-chain verification (contract read or verified provenance) is
 * unavailable, it does NOT claim on-chain cryptographic verification.
 */
export function verifyMetadataIntegrity(params: VerifyMetadataParams): MetadataVerificationResult {
  const onchainHash = (params.onchainHash || '').trim().toLowerCase();
  const onchainURI = (params.onchainURI || '').trim();
  const { apiItem, cachedManifest } = params;

  // Case 0: Independent on-chain commitment is unavailable!
  // Do NOT use API-provided metadataHash as independent proof of on-chain commitment.
  if (!onchainHash) {
    if (apiItem && apiItem.question && apiItem.question.trim().length > 0) {
      return {
        status: 'unverified',
        question: apiItem.question.trim(),
        description: apiItem.description || null,
        category: apiItem.category || null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: apiItem.metadataHash || '',
        metadataURI: onchainURI || apiItem.metadataURI || '',
        hasMetadata: false,
        isTampered: false,
        reason: 'Independent verification unavailable: Metadata is reported by API indexer without verified on-chain contract read or canonical provenance.',
      };
    }
    return {
      status: 'unavailable',
      question: 'Market metadata unavailable',
      description: null,
      category: null,
      resolutionCriteria: null,
      sources: [],
      metadataHash: '',
      metadataURI: onchainURI,
      hasMetadata: false,
      isTampered: false,
      reason: 'Off-chain question manifest is unavailable. Independent on-chain contract read is not established.',
    };
  }

  // Case 1: Cached or directly supplied MarketMetadataManifest
  if (cachedManifest) {
    try {
      const { verified, computedHash } = verifyMetadataCommitment(cachedManifest, onchainHash);

      if (verified) {
        return {
          status: 'verified',
          question: cachedManifest.question,
          description: cachedManifest.description || null,
          category: cachedManifest.category || null,
          resolutionCriteria: cachedManifest.resolutionCriteria || null,
          sources: cachedManifest.sources || [],
          metadataHash: params.onchainHash!,
          metadataURI: onchainURI || `ipfs://orakl-local-artifact/${computedHash.slice(2)}`,
          computedHash,
          hasMetadata: true,
          isTampered: false,
          manifest: cachedManifest,
        };
      } else {
        // Cache tampering or commitment mismatch detected!
        return {
          status: 'unverified',
          question: 'Market metadata commitment mismatch',
          description: null,
          category: null,
          resolutionCriteria: null,
          sources: [],
          metadataHash: params.onchainHash!,
          metadataURI: onchainURI,
          computedHash,
          hasMetadata: false,
          isTampered: true,
          reason: `Metadata commitment mismatch: Computed hash ${computedHash} does not match on-chain commitment ${onchainHash}. Content may be tampered or corrupted.`,
        };
      }
    } catch (err) {
      return {
        status: 'unverified',
        question: 'Market metadata corrupted',
        description: null,
        category: null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: params.onchainHash!,
        metadataURI: onchainURI,
        hasMetadata: false,
        isTampered: true,
        reason: `Canonicalization error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Case 2: Indexed API item with verified on-chain commitment
  if (apiItem && apiItem.question && apiItem.question.trim().length > 0) {
    const apiHash = (apiItem.metadataHash || '').trim().toLowerCase();

    // Verify API's metadataHash matches genuine on-chain metadataHash
    if (apiHash && apiHash !== onchainHash) {
      return {
        status: 'unverified',
        question: 'Market metadata commitment mismatch',
        description: null,
        category: null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: params.onchainHash!,
        metadataURI: onchainURI,
        hasMetadata: false,
        isTampered: true,
        reason: `API metadata commitment mismatch: API returned hash ${apiHash} while verified on-chain commitment is ${onchainHash}.`,
      };
    }

    if (apiItem.verifiedMetadata === true) {
      return {
        status: 'verified',
        question: apiItem.question.trim(),
        description: apiItem.description || null,
        category: apiItem.category || null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: params.onchainHash!,
        metadataURI: onchainURI || apiItem.metadataURI || '',
        hasMetadata: true,
        isTampered: false,
      };
    } else {
      // API returned question, but marked verifiedMetadata: false
      return {
        status: 'unverified',
        question: apiItem.question.trim(),
        description: apiItem.description || null,
        category: apiItem.category || null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: params.onchainHash!,
        metadataURI: onchainURI || apiItem.metadataURI || '',
        hasMetadata: false,
        isTampered: false,
        reason: 'Off-chain question manifest is unverified against on-chain hash commitment.',
      };
    }
  }

  // Case 3: Metadata unavailable
  return {
    status: 'unavailable',
    question: 'Market metadata unavailable',
    description: null,
    category: null,
    resolutionCriteria: null,
    sources: [],
    metadataHash: params.onchainHash!,
    metadataURI: onchainURI,
    hasMetadata: false,
    isTampered: false,
    reason: 'Off-chain question manifest is unavailable via the indexer or local storage for this market. On-chain state and ID are preserved.',
  };
}

/**
 * Verifies a metadata artifact retrieved via readback against the expected commitment and manifest.
 * Enforces RFC 8785 canonicalization and Keccak-256 hash match before on-chain submission.
 */
export function verifyMetadataArtifactReadback(
  artifact: unknown,
  expectedCommitment: string,
  expectedManifest?: MarketMetadataManifest,
): { ok: boolean; error?: string; computedHash?: string; canonical?: string } {
  if (!artifact || typeof artifact !== 'object') {
    return { ok: false, error: 'Readback artifact is not an object' };
  }
  const art = artifact as Record<string, unknown>;
  const rawManifest = (art.formData || art) as MarketMetadataManifest;
  if (!rawManifest || typeof rawManifest !== 'object') {
    return { ok: false, error: 'Persisted artifact missing manifest data' };
  }
  if (art.commitment && typeof art.commitment === 'string') {
    if (art.commitment.toLowerCase() !== expectedCommitment.toLowerCase()) {
      return {
        ok: false,
        error: `Server readback commitment mismatch: Artifact commitment ${art.commitment} does not match expected commitment ${expectedCommitment}`,
      };
    }
  }
  try {
    const { verified, computedHash, canonical } = verifyMetadataCommitment(rawManifest, expectedCommitment);
    if (!verified) {
      return {
        ok: false,
        computedHash,
        error: `Readback hash mismatch: Computed hash ${computedHash} does not match expected commitment ${expectedCommitment}`,
      };
    }
    if (expectedManifest) {
      if (rawManifest.question !== expectedManifest.question) {
        return { ok: false, error: 'Readback question does not match submitted manifest' };
      }
      if (rawManifest.resolutionCriteria !== expectedManifest.resolutionCriteria) {
        return { ok: false, error: 'Readback resolution criteria does not match submitted manifest' };
      }
      if (rawManifest.factory && rawManifest.factory.toLowerCase() !== expectedManifest.factory?.toLowerCase()) {
        return { ok: false, error: 'Readback factory does not match submitted manifest' };
      }
    }
    return { ok: true, computedHash, canonical };
  } catch (err) {
    return { ok: false, error: `Canonicalization error during readback: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Cache a validated market manifest in client-side localStorage. */
export function saveLocalManifest(manifest: MarketMetadataManifest, hashOrUri?: string | null): void {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MANIFEST_CACHE_KEY) : null;
    const store: Record<string, MarketMetadataManifest> = raw ? JSON.parse(raw) : {};
    if (hashOrUri) {
      store[hashOrUri.toLowerCase()] = manifest;
    }
    try {
      const canonical = canonicalizeMarketMetadata(manifest);
      const computedHash = keccak256(toHex(canonical));
      store[computedHash.toLowerCase()] = manifest;
    } catch {}
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(store));
    }
  } catch (e) {
    console.warn('[ORAKL] Failed to cache local manifest in localStorage:', e);
  }
}

/** Retrieve a cached market manifest from localStorage by metadataHash or metadataURI. */
export function getLocalManifest(hashOrUri?: string | null): MarketMetadataManifest | null {
  if (!hashOrUri) return null;
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const store: Record<string, MarketMetadataManifest> = JSON.parse(raw);
    const key = hashOrUri.toLowerCase();
    return store[key] || null;
  } catch {
    return null;
  }
}

/** Reset the local manifest cache (used in testing or state refresh). */
export function clearLocalManifestCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(MANIFEST_CACHE_KEY);
    }
  } catch {}
}

/**
 * Maps an indexed API MarketListItem to a validated MarketViewItem.
 *
 * CRITICAL RULE (Finding 1): Never accept an API-reported metadataHash as independent
 * proof of on-chain commitment. If trustedOnchainHash is missing (e.g. no contract read
 * was performed), the view item is marked with status 'unverified'.
 */
export function apiItemToView(item: MarketListItem, trustedOnchainHash?: string | null): MarketViewItem {
  const tone =
    item.status === 'OPEN'
      ? 'open'
      : item.status === 'CLOSED'
        ? 'wait'
        : item.status === 'FINALIZED'
          ? 'done'
          : 'expired';

  const verifiedHash = trustedOnchainHash ? trustedOnchainHash.trim().toLowerCase() : null;
  const cached = (verifiedHash ? getLocalManifest(verifiedHash) : null) || getLocalManifest(item.metadataHash) || getLocalManifest(item.metadataURI);
  const verification = verifyMetadataIntegrity({
    onchainHash: verifiedHash,
    onchainURI: item.metadataURI,
    apiItem: item,
    cachedManifest: cached,
  });

  return {
    id: BigInt(item.id),
    title: verification.question,
    hasMetadata: verification.hasMetadata,
    metadataStatus: verification.status,
    metadataUnavailableReason: verification.reason,
    metadataHash: verifiedHash || item.metadataHash,
    description: verification.description,
    category: verification.category,
    metadataURI: item.metadataURI,
    statusText: item.status,
    statusTone: tone,
    yesPool: parsePoolAmount(item.yesPool),
    noPool: parsePoolAmount(item.noPool),
    closeTime: BigInt(item.closeTime || '0'),
    fromApi: true,
    isTampered: verification.isTampered,
  };
}
