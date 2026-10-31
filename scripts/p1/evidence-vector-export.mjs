#!/usr/bin/env node
/** Export shared evidence-profile vectors from the frontend implementation.
 *
 *  The backend re-implements the same RFC 8785 (restricted v1 profile)
 *  canonicalization. This script runs the FRONTEND implementation under Node's
 *  type stripping and emits an exact-byte fixture consumed by backend tests so
 *  both implementations must agree byte-for-byte forever.
 *
 *  Usage: node scripts/p1/evidence-vector-export.mjs > backend/test/fixtures/evidence-vectors.json
 */

const FRONT = new URL('../../frontend/src/selected/evidence.ts', import.meta.url).pathname;
const {validateEvidenceManifest, canonicalizeEvidence, evidenceCommitment} = await import(FRONT);

const manifests = [
  {
    schema: 'orakl-evidence-v1',
    chainId: '0',
    contract: '0x0000000000000000000000000000000000000001',
    marketId: '0',
    kind: 'proposal',
    claim: 'YES',
    proposedOutcome: 'YES',
    sources: [],
    publishedAt: '0',
    publisher: '0x0000000000000000000000000000000000000002',
    contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    contentMediaType: 'text/plain',
    media: [],
  },
  {
    schema: 'orakl-evidence-v1',
    chainId: '31337',
    contract: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
    marketId: '7',
    kind: 'supplement',
    claim: 'NO',
    proposedOutcome: 'NONE',
    sources: ['https://example.test/doc', 'ipfs://QmXyZ/manifest.json'],
    publishedAt: '1790000000',
    publisher: '0xef01ef01ef01ef01ef01ef01ef01ef01ef01ef01',
    contentHash: '0x25e6b620f9b58bbd4877655d0543cf8ef3c0e64b15df63239da099ac4967c74a',
    contentMediaType: 'application/orakl-evidence+json',
    media: ['ipfs://QmMedia/a.bin'],
  },
  {
    schema: 'orakl-evidence-v1',
    chainId: '1',
    contract: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    marketId: '120000000000000000000000000000000000000000000000000000000000000000',
    kind: 'objection',
    claim: 'INVALID',
    proposedOutcome: 'INVALID',
    sources: [],
    publishedAt: '12345',
    publisher: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    contentHash: '0x5950ebe73a617667a66f67d525282c827c82ef4d89ae8dcd8336d013773b6b7f',
    contentMediaType: 'text/plain',
    media: [],
  },
  {
    schema: 'orakl-evidence-v1',
    chainId: '3',
    contract: '0xcccccccccccccccccccccccccccccccccccccccc',
    marketId: '2',
    kind: 'decision',
    claim: 'YES',
    proposedOutcome: 'YES',
    sources: ['arweave://xyz/anchors'],
    publishedAt: '9',
    publisher: '0xdddddddddddddddddddddddddddddddddddddddd',
    contentHash: '0x6969696969696969696969696969696969696969696969696969696969696969',
    contentMediaType: 'text/html',
    media: ['data:INVALID-not-allowed'],
  },
];

const vectors = manifests.map((manifest) => {
  const validation = validateEvidenceManifest(manifest);
  const out = {manifest, valid: validation.ok, errors: validation.errors};
  if (validation.ok) {
    const bytes = canonicalizeEvidence(manifest);
    out.canonicalUtf8 = Buffer.from(bytes).toString('utf8');
    out.commitment = evidenceCommitment(manifest);
  }
  return out;
});

// The profile's closed field set rejects unknown/unsafe values; the 4th vector
// above is intentionally invalid (a data: URI) to pin rejection behaviour.
process.stdout.write(JSON.stringify({schema: 'orakl-evidence-vectors-1', vectors}, null, 2) + '\n');
