/** Deterministic evidence hashing — ORAKL evidence integrity profile v1.
 *
 *  Profile (docs/security/ORAKL_V1_EVIDENCE_INTEGRITY_SPEC.md):
 *   - the manifest is an RFC 8785 (JCS) object encoded UTF-8, no BOM, no
 *     trailing newline;
 *   - `evidenceHash = keccak256(exact manifest bytes)` (Ethereum Keccak-256);
 *   - JSON numbers are disallowed: numeric fields are unsigned base-10 strings;
 *   - addresses are lowercase 0x + 40 hex; content hashes lowercase 0x + 64 hex;
 *   - `schema` is the literal `orakl-evidence-v1`; unknown fields are rejected.
 *
 *  This module is shared by the local UI and by tests. It is intentionally
 *  small: it canonicalizes a validated manifest object, never raw user JSON.
 */

import {keccak256, stringToBytes, type Hex} from 'viem';

export const EVIDENCE_SCHEMA = 'orakl-evidence-v1';
export const EVIDENCE_KINDS = ['proposal', 'objection', 'supplement', 'decision'] as const;
export const EVIDENCE_CLAIMS = ['YES', 'NO', 'INVALID'] as const;
export const EVIDENCE_PROPOSED_OUTCOMES = ['YES', 'NO', 'INVALID', 'NONE'] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceClaim = (typeof EVIDENCE_CLAIMS)[number];
export type EvidenceProposedOutcome = (typeof EVIDENCE_PROPOSED_OUTCOMES)[number];

export interface EvidenceManifest {
  schema: typeof EVIDENCE_SCHEMA;
  chainId: string;
  contract: string;
  marketId: string;
  kind: EvidenceKind;
  claim: EvidenceClaim;
  proposedOutcome: EvidenceProposedOutcome;
  sources: string[];
  publishedAt: string;
  publisher: string;
  contentHash: string;
  contentMediaType: string;
  media: string[];
}

const UINT_RE = /^(0|[1-9]\d*)$/;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const MEDIA_TYPE_RE = /^[\x21-\x7e]+$/;
const URI_SCHEMES = ['ipfs://', 'https://', 'http://', 'ar://'] as const;
const MAX_URIS = 32;
const MAX_URI_LENGTH = 512;
const MAX_MEDIA_TYPE_LENGTH = 128;

export interface EvidenceValidation {
  ok: boolean;
  errors: string[];
}

function checkUint(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'string' || !UINT_RE.test(value)) {
    errors.push(`${field} must be an unsigned base-10 string without a leading zero`);
    return;
  }
  try {
    const asBig = BigInt(value);
    if (asBig < 0n || asBig > 2n ** 256n - 1n) errors.push(`${field} exceeds uint256`);
  } catch {
    errors.push(`${field} is not a valid integer`);
  }
}

function checkUriList(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (value.length > MAX_URIS) {
    errors.push(`${field} exceeds ${MAX_URIS} entries`);
    return;
  }
  for (const [index, uri] of value.entries()) {
    if (typeof uri !== 'string' || uri.length > MAX_URI_LENGTH) {
      errors.push(`${field}[${index}] must be a string of at most ${MAX_URI_LENGTH} characters`);
      continue;
    }
    if (!URI_SCHEMES.some((scheme) => uri.startsWith(scheme))) {
      errors.push(`${field}[${index}] must use an allowed scheme (${URI_SCHEMES.join(', ')})`);
    }
    if (/[\x00-\x1f\x7f]/.test(uri)) errors.push(`${field}[${index}] contains control characters`);
  }
}

const REQUIRED_FIELDS = [
  'schema',
  'chainId',
  'contract',
  'marketId',
  'kind',
  'claim',
  'proposedOutcome',
  'sources',
  'publishedAt',
  'publisher',
  'contentHash',
  'contentMediaType',
  'media',
] as const;

/** Validate the exact v1 field set. Unknown fields are rejected. */
export function validateEvidenceManifest(input: unknown): EvidenceValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {ok: false, errors: ['manifest must be a JSON object']};
  }
  const value = input as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`missing required field: ${field}`);
  }
  for (const key of Object.keys(value)) {
    if (!(REQUIRED_FIELDS as readonly string[]).includes(key)) errors.push(`unknown field: ${key}`);
  }
  if (errors.length > 0) return {ok: false, errors};

  if (value.schema !== EVIDENCE_SCHEMA) errors.push(`schema must be "${EVIDENCE_SCHEMA}"`);
  checkUint(value.chainId, 'chainId', errors);
  checkUint(value.marketId, 'marketId', errors);
  checkUint(value.publishedAt, 'publishedAt', errors);

  if (typeof value.contract !== 'string' || !ADDRESS_RE.test(value.contract)) {
    errors.push('contract must be a lowercase 0x address (40 hex)');
  }
  if (typeof value.publisher !== 'string' || !ADDRESS_RE.test(value.publisher)) {
    errors.push('publisher must be a lowercase 0x address (40 hex)');
  }
  if (typeof value.contentHash !== 'string' || !HASH_RE.test(value.contentHash)) {
    errors.push('contentHash must be a lowercase 0x 64-hex Keccak-256 hash');
  }
  if (typeof value.contentMediaType !== 'string' ||
      value.contentMediaType.length === 0 ||
      value.contentMediaType.length > MAX_MEDIA_TYPE_LENGTH ||
      !MEDIA_TYPE_RE.test(value.contentMediaType)) {
    errors.push('contentMediaType must be an ASCII media type of at most 128 characters');
  }
  if (!EVIDENCE_KINDS.includes(value.kind as EvidenceKind)) {
    errors.push(`kind must be one of ${EVIDENCE_KINDS.join(', ')}`);
  }
  if (!EVIDENCE_CLAIMS.includes(value.claim as EvidenceClaim)) {
    errors.push(`claim must be one of ${EVIDENCE_CLAIMS.join(', ')}`);
  }
  if (!EVIDENCE_PROPOSED_OUTCOMES.includes(value.proposedOutcome as EvidenceProposedOutcome)) {
    errors.push(`proposedOutcome must be one of ${EVIDENCE_PROPOSED_OUTCOMES.join(', ')}`);
  }
  checkUriList(value.sources, 'sources', errors);
  checkUriList(value.media, 'media', errors);

  if (errors.length > 0) return {ok: false, errors};

  // kind/proposedOutcome consistency: only objection/supplement name an outcome.
  if (value.kind === 'proposal' && value.proposedOutcome === 'NONE') {
    errors.push('a proposal manifest must declare a proposedOutcome other than NONE');
  }
  if (value.kind === 'decision' && value.proposedOutcome === 'NONE') {
    errors.push('a decision manifest must declare a decision outcome');
  }
  return {ok: errors.length === 0, errors};
}

/** RFC 8785 string serialization: minimal escapes, \u00XX for controls. */
function jcsString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') out += '\\"';
    else if (char === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += char;
  }
  return `${out}"`;
}

/** RFC 8785 property ordering: UTF-16 code units. */
function sortKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const diff = a.charCodeAt(i) - b.charCodeAt(i);
      if (diff !== 0) return diff;
    }
    return a.length - b.length;
  });
}

function jcsValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return jcsString(value);
  if (Array.isArray(value)) return `[${value.map(jcsValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = sortKeys(record);
    return `{${keys.map((key) => `${jcsString(key)}:${jcsValue(record[key])}`).join(',')}}`;
  }
  // The v1 profile disallows JSON numbers. Reaching here means a caller bypassed
  // validation; failing closed is the correct behaviour.
  throw new Error('evidence profile v1 does not allow JSON numbers');
}

/** Canonical UTF-8 bytes of a validated manifest. No BOM, no trailing newline. */
export function canonicalizeEvidence(manifest: EvidenceManifest): Uint8Array {
  const validation = validateEvidenceManifest(manifest);
  if (!validation.ok) throw new Error(`invalid evidence manifest: ${validation.errors.join('; ')}`);
  return stringToBytes(jcsValue(manifest));
}

/** Keccak-256 of the exact canonical manifest bytes — the on-chain commitment. */
export function evidenceCommitment(manifest: EvidenceManifest): Hex {
  return keccak256(canonicalizeEvidence(manifest));
}

/** Keccak-256 of exact raw content bytes. */
export function evidenceContentHash(content: Uint8Array | string): Hex {
  return keccak256(typeof content === 'string' ? stringToBytes(content) : content);
}

export interface EvidenceVerificationResult {
  valid: boolean;
  computedCommitment: Hex | null;
  expectedCommitment: string;
  commitmentMatched: boolean;
  contentHashMatched: boolean | null;
  error: string | null;
  manifest: EvidenceManifest | null;
}

/** Verify evidence integrity against an expected commitment hash (ADR-0003).
 *
 *  Note: Cryptographic commitment matching confirms content integrity relative
 *  to the published hash; it does NOT attest to factual truthfulness or
 *  authenticity of external claims (which remains subject to arbitration).
 */
export function verifyEvidenceIntegrity(
  expectedCommitment: string,
  manifestInput: string | unknown,
  contentBytes?: Uint8Array | string | null,
): EvidenceVerificationResult {
  try {
    let manifestObj: unknown;
    if (typeof manifestInput === 'string') {
      try {
        manifestObj = JSON.parse(manifestInput);
      } catch (parseErr: unknown) {
        return {
          valid: false,
          computedCommitment: null,
          expectedCommitment,
          commitmentMatched: false,
          contentHashMatched: null,
          error: `Malformed manifest JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          manifest: null,
        };
      }
    } else {
      manifestObj = manifestInput;
    }

    const validation = validateEvidenceManifest(manifestObj);
    if (!validation.ok) {
      return {
        valid: false,
        computedCommitment: null,
        expectedCommitment,
        commitmentMatched: false,
        contentHashMatched: null,
        error: `Invalid manifest: ${validation.errors.join('; ')}`,
        manifest: null,
      };
    }

    const manifest = manifestObj as EvidenceManifest;
    const computedCommitment = evidenceCommitment(manifest);
    const commitmentMatched = computedCommitment.toLowerCase() === expectedCommitment.toLowerCase();

    let contentHashMatched: boolean | null = null;
    if (contentBytes != null) {
      const computedContentHash = evidenceContentHash(contentBytes);
      contentHashMatched = computedContentHash.toLowerCase() === manifest.contentHash.toLowerCase();
    }

    const valid = commitmentMatched && (contentHashMatched !== false);
    const error = !commitmentMatched
      ? `Commitment mismatch: expected ${expectedCommitment} but computed ${computedCommitment}`
      : contentHashMatched === false
        ? 'Content hash mismatch: content bytes do not match manifest contentHash'
        : null;

    return {
      valid,
      computedCommitment,
      expectedCommitment,
      commitmentMatched,
      contentHashMatched,
      error,
      manifest,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      computedCommitment: null,
      expectedCommitment,
      commitmentMatched: false,
      contentHashMatched: null,
      error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
      manifest: null,
    };
  }
}
