import { keccak256, toHex } from 'viem';
import type { MarketMetadataManifest } from './navigation.ts';
import { canonicalizeMarketMetadata } from './navigation.ts';

export const MANIFEST_CACHE_KEY = 'orakl_local_manifest_cache_v1';

export type MetadataTrustStatus = 'verified' | 'unverified' | 'unavailable';

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
  onchainHash: string;
  onchainURI: string;
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
 */
export function verifyMetadataIntegrity(params: VerifyMetadataParams): MetadataVerificationResult {
  const onchainHash = (params.onchainHash || '').trim().toLowerCase();
  const onchainURI = (params.onchainURI || '').trim();
  const { apiItem, cachedManifest } = params;

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
          metadataHash: params.onchainHash,
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
          metadataHash: params.onchainHash,
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
        metadataHash: params.onchainHash,
        metadataURI: onchainURI,
        hasMetadata: false,
        isTampered: true,
        reason: `Canonicalization error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Case 2: Indexed API item
  if (apiItem && apiItem.question && apiItem.question.trim().length > 0) {
    const apiHash = (apiItem.metadataHash || '').trim().toLowerCase();

    // Verify API's metadataHash matches on-chain metadataHash
    if (onchainHash && apiHash && apiHash !== onchainHash) {
      return {
        status: 'unverified',
        question: 'Market metadata commitment mismatch',
        description: null,
        category: null,
        resolutionCriteria: null,
        sources: [],
        metadataHash: params.onchainHash,
        metadataURI: onchainURI,
        hasMetadata: false,
        isTampered: true,
        reason: `API metadata commitment mismatch: API returned hash ${apiHash} while on-chain commitment is ${onchainHash}.`,
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
        metadataHash: params.onchainHash || apiItem.metadataHash || '',
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
        metadataHash: params.onchainHash || apiItem.metadataHash || '',
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
    metadataHash: params.onchainHash,
    metadataURI: onchainURI,
    hasMetadata: false,
    isTampered: false,
    reason: 'Off-chain question manifest is unavailable via the indexer or local storage for this market. On-chain state and ID are preserved.',
  };
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
