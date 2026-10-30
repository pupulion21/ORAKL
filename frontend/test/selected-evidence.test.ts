import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  canonicalizeEvidence,
  evidenceCommitment,
  evidenceContentHash,
  validateEvidenceManifest,
  type EvidenceManifest,
} from '../src/selected/evidence.ts';

/** Reproducible vectors from docs/security/ORAKL_V1_EVIDENCE_INTEGRITY_SPEC.md
 *  (same fixtures as scripts/check-orakl-evidence-v1-vectors.py: fictitious
 *  chain 0, synthetic addresses, unresolvable example domain). */
function vectorManifest(contentHash: string): EvidenceManifest {
  return {
    schema: 'orakl-evidence-v1',
    chainId: '0',
    contract: '0x0000000000000000000000000000000000000001',
    marketId: '7',
    kind: 'objection',
    claim: 'YES',
    proposedOutcome: 'NO',
    sources: ['https://example.invalid/source'],
    publishedAt: '0',
    publisher: '0x0000000000000000000000000000000000000002',
    contentHash,
    contentMediaType: 'text/plain',
    media: [],
  };
}

test('content hash matches the published empty-content vector', () => {
  assert.equal(
    evidenceContentHash(new Uint8Array(0)),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
});

test('content hash matches the published ASCII YES vector', () => {
  assert.equal(
    evidenceContentHash('YES'),
    '0x5950ebe73a617667a66f67d525282c827c82ef4d89ae8dcd8336d013773b6b7f',
  );
});

test('manifest commitment matches the empty-content vector', () => {
  const manifest = vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(evidenceCommitment(manifest), '0x1cf74347bbb24a8fd18eaeb719bfed04ae063217566f6911f64282d8cf7ff0b8');
});

test('manifest commitment matches the ASCII YES vector', () => {
  const manifest = vectorManifest('0x5950ebe73a617667a66f67d525282c827c82ef4d89ae8dcd8336d013773b6b7f');
  assert.equal(evidenceCommitment(manifest), '0x25e6b620f9b58bbd4877655d0543cf8ef3c0e64b15df63239da099ac4967c74a');
});

test('canonical bytes carry no BOM and no trailing newline', () => {
  const manifest = vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  const bytes = canonicalizeEvidence(manifest);
  const text = new TextDecoder().decode(bytes);
  assert.ok(!text.startsWith('﻿'), 'no BOM');
  assert.ok(!text.endsWith('\n'), 'no trailing newline');
  assert.ok(!/\s/.test(text.replace(/"[^"]*"/g, '')), 'no insignificant whitespace outside strings');
});

test('property order follows UTF-16 code units, not insertion order', () => {
  const a = vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  const b: EvidenceManifest = {
    media: [],
    contentMediaType: 'text/plain',
    contentHash: a.contentHash,
    publisher: a.publisher,
    publishedAt: a.publishedAt,
    sources: a.sources,
    proposedOutcome: a.proposedOutcome,
    claim: a.claim,
    kind: a.kind,
    marketId: a.marketId,
    contract: a.contract,
    chainId: a.chainId,
    schema: a.schema,
  };
  assert.equal(evidenceCommitment(a), evidenceCommitment(b));
});

test('validation rejects unknown fields', () => {
  const manifest = {...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'), extra: 'nope'};
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unknown field')));
});

test('validation rejects JSON numbers disguised as fields', () => {
  const manifest = {...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'), chainId: 0};
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
});

test('validation rejects leading-zero numeric strings', () => {
  const manifest = {...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'), marketId: '07'};
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
});

test('validation rejects checksummed or uppercase addresses', () => {
  const manifest = {
    ...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'),
    publisher: '0x000000000000000000000000000000000000000A',
  };
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
});

test('validation rejects unsafe URI schemes', () => {
  const manifest = {
    ...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'),
    sources: ['javascript:alert(1)'],
  };
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
});

test('a proposal manifest cannot claim proposedOutcome NONE', () => {
  const manifest = {
    ...vectorManifest('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'),
    kind: 'proposal' as const,
    proposedOutcome: 'NONE' as const,
  };
  const result = validateEvidenceManifest(manifest);
  assert.equal(result.ok, false);
});

test('canonicalization fails closed when a caller bypasses validation', () => {
  const broken = {schema: 'orakl-evidence-v1', chainId: 0} as unknown as EvidenceManifest;
  assert.throws(() => canonicalizeEvidence(broken));
});
