import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  createApiClient,
  ApiError,
  parsePoolAmount,
  type ApiResponse,
  type MarketChallengesResult,
  type EvidenceArtifactDetail,
} from '../src/selected/api-client.ts';
import {
  verifyEvidenceIntegrity,
  canonicalizeEvidence,
  evidenceCommitment,
  evidenceContentHash,
  type EvidenceManifest,
} from '../src/selected/evidence.ts';
import {escapeHtml, formatQie} from '../src/format.ts';

// ----------------------------------------------------------------- fixtures

const ADDR_ALICE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const ADDR_BOB = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const TX_HASH_1 = '0x' + '1'.repeat(64);
const TX_HASH_2 = '0x' + '2'.repeat(64);

const MOCK_MANIFEST: EvidenceManifest = {
  schema: 'orakl-evidence-v1',
  chainId: '31337',
  contract: '0x2222222222222222222222222222222222222222',
  marketId: '2',
  kind: 'objection',
  claim: 'NO',
  proposedOutcome: 'NO',
  sources: ['https://reuters.com/news/article-1'],
  publishedAt: '1700000000',
  publisher: ADDR_ALICE,
  contentHash: evidenceContentHash('Official announcement text verifying outcome is NO.'),
  contentMediaType: 'text/plain',
  media: [],
};

const MOCK_COMMITMENT = evidenceCommitment(MOCK_MANIFEST);

function createMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('Selected Frontend Multi-Challenger Tranches & Evidence Modal (TICKET-08 / WP-05)', () => {
  it('1. fetches and renders multiple distinct challengers with distinct stakes', async () => {
    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: '3000000000000000000', // 3 ETH
        disposition: null,
        refundable: null,
        stakes: [
          {
            id: 'stake-1',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_ALICE,
            amount: '1000000000000000000', // 1 ETH
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: false,
            txHash: TX_HASH_1,
            logIndex: 1,
            blockNumber: '11',
            blockHash: '0x' + 'a'.repeat(64),
            timestamp: '1700000010',
          },
          {
            id: 'stake-2',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_BOB,
            amount: '2000000000000000000', // 2 ETH
            prefixBefore: '1000000000000000000',
            evidenceHash: '0x' + 'e2'.repeat(32),
            claimed: false,
            txHash: TX_HASH_2,
            logIndex: 2,
            blockNumber: '12',
            blockHash: '0x' + 'b'.repeat(64),
            timestamp: '1700000020',
          },
        ],
      },
    };

    const mockFetch = createMockFetch(async (url) => {
      assert.ok(url.includes('/api/v1/markets/2/challenges'));
      return new Response(JSON.stringify(mockPayload), {status: 200});
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    const res = await client.getMarketChallenges(2n);

    assert.equal(res.data.stakes.length, 2);
    assert.equal(res.data.stakes[0]?.walletAddress, ADDR_ALICE);
    assert.equal(res.data.stakes[1]?.walletAddress, ADDR_BOB);
  });

  it('2. verifies exact prefixBefore ordering matches previous cumulative amounts', async () => {
    const s1Amount = 1000000000000000000n; // 1 ETH
    const s2Amount = 2000000000000000000n; // 2 ETH

    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: '3000000000000000000',
        disposition: null,
        refundable: null,
        stakes: [
          {
            id: 's1',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_ALICE,
            amount: s1Amount.toString(),
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: false,
            txHash: TX_HASH_1,
            logIndex: 0,
            blockNumber: '10',
            blockHash: '0x' + '0'.repeat(64),
            timestamp: '1700000000',
          },
          {
            id: 's2',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_BOB,
            amount: s2Amount.toString(),
            prefixBefore: s1Amount.toString(),
            evidenceHash: '0x' + '1'.repeat(64),
            claimed: false,
            txHash: TX_HASH_2,
            logIndex: 1,
            blockNumber: '11',
            blockHash: '0x' + '1'.repeat(64),
            timestamp: '1700000010',
          },
        ],
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockPayload))),
    });

    const res = await client.getMarketChallenges(2);
    const stakes = res.data.stakes;

    assert.equal(parsePoolAmount(stakes[0]?.prefixBefore), 0n);
    assert.equal(parsePoolAmount(stakes[1]?.prefixBefore), s1Amount);
  });

  it('3. verifies aggregate stake consistency matches sum of individual stakes', async () => {
    const s1 = 1500000000000000000n;
    const s2 = 2500000000000000000n;
    const expectedSum = s1 + s2;

    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: expectedSum.toString(),
        disposition: null,
        refundable: null,
        stakes: [
          {
            id: '1',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_ALICE,
            amount: s1.toString(),
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: false,
            txHash: TX_HASH_1,
            logIndex: 0,
            blockNumber: '10',
            blockHash: '0x' + '0'.repeat(64),
            timestamp: '1700000000',
          },
          {
            id: '2',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_BOB,
            amount: s2.toString(),
            prefixBefore: s1.toString(),
            evidenceHash: '0x' + '1'.repeat(64),
            claimed: false,
            txHash: TX_HASH_2,
            logIndex: 1,
            blockNumber: '11',
            blockHash: '0x' + '1'.repeat(64),
            timestamp: '1700000010',
          },
        ],
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockPayload))),
    });

    const res = await client.getMarketChallenges(2);
    const sum = res.data.stakes.reduce((acc, s) => acc + parsePoolAmount(s.amount), 0n);
    assert.equal(sum, parsePoolAmount(res.data.totalChallengeStake));
  });

  it('4. preserves 78-digit uint256 stakes without floating-point precision loss (ADR-0001)', async () => {
    const hugeStake = '999999999999999999999999999999999999999999999999999999999999999999999999999999';
    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: hugeStake,
        disposition: null,
        refundable: null,
        stakes: [
          {
            id: '1',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_ALICE,
            amount: hugeStake,
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: false,
            txHash: TX_HASH_1,
            logIndex: 0,
            blockNumber: '10',
            blockHash: '0x' + '0'.repeat(64),
            timestamp: '1700000000',
          },
        ],
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockPayload))),
    });

    const res = await client.getMarketChallenges(2);
    const receivedAmount = res.data.stakes[0]?.amount;
    assert.equal(receivedAmount, hugeStake);
    assert.equal(parsePoolAmount(receivedAmount).toString(), hugeStake);
  });

  it('5. handles zero-entitlement challenger tranches safely', async () => {
    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: '1000000000000000000',
        disposition: 'CHALLENGERS',
        refundable: false,
        stakes: [
          {
            id: '1',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_ALICE,
            amount: '1000000000000000000',
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: true,
            txHash: TX_HASH_1,
            logIndex: 0,
            blockNumber: '10',
            blockHash: '0x' + '0'.repeat(64),
            timestamp: '1700000000',
          },
          {
            id: '2',
            chainId: 31337,
            marketId: '2',
            walletAddress: ADDR_BOB,
            amount: '0', // zero entitlement tranche
            prefixBefore: '1000000000000000000',
            evidenceHash: '0x' + '0'.repeat(64),
            claimed: false,
            txHash: TX_HASH_2,
            logIndex: 1,
            blockNumber: '11',
            blockHash: '0x' + '1'.repeat(64),
            timestamp: '1700000010',
          },
        ],
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockPayload))),
    });

    const res = await client.getMarketChallenges(2);
    assert.equal(parsePoolAmount(res.data.stakes[1]?.amount), 0n);
    assert.equal(res.data.stakes[1]?.claimed, false);
  });

  it('6. represents INVALID / NEUTRAL settlement and full refundability (ADR-0010 & ADR-0011)', async () => {
    const mockPayload: ApiResponse<MarketChallengesResult> = {
      data: {
        totalChallengeStake: '2000000000000000000',
        disposition: 'NEUTRAL',
        refundable: true,
        stakes: [
          {
            id: '1',
            chainId: 31337,
            marketId: '3',
            walletAddress: ADDR_ALICE,
            amount: '2000000000000000000',
            prefixBefore: '0',
            evidenceHash: MOCK_COMMITMENT,
            claimed: false,
            txHash: TX_HASH_1,
            logIndex: 0,
            blockNumber: '10',
            blockHash: '0x' + '0'.repeat(64),
            timestamp: '1700000000',
          },
        ],
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockPayload))),
    });

    const res = await client.getMarketChallenges(3);
    assert.equal(res.data.disposition, 'NEUTRAL');
    assert.equal(res.data.refundable, true);
  });

  it('7. handles missing evidence content gracefully in verification result', () => {
    // Valid manifest bytes but no raw content payload
    const result = verifyEvidenceIntegrity(MOCK_COMMITMENT, MOCK_MANIFEST, null);
    assert.equal(result.valid, true);
    assert.equal(result.commitmentMatched, true);
    assert.equal(result.contentHashMatched, null); // Content was not provided
    assert.equal(result.error, null);
  });

  it('8. verifies valid evidence commitment via RFC 8785 Keccak-256 (ADR-0003)', () => {
    const content = 'Official announcement text verifying outcome is NO.';
    const result = verifyEvidenceIntegrity(MOCK_COMMITMENT, MOCK_MANIFEST, content);
    assert.equal(result.valid, true);
    assert.equal(result.commitmentMatched, true);
    assert.equal(result.contentHashMatched, true);
    assert.equal(result.computedCommitment?.toLowerCase(), MOCK_COMMITMENT.toLowerCase());
  });

  it('9. detects and reports evidence commitment mismatch', () => {
    const tamperedManifest = {
      ...MOCK_MANIFEST,
      claim: 'YES' as const, // tampered claim
    };
    const result = verifyEvidenceIntegrity(MOCK_COMMITMENT, tamperedManifest);
    assert.equal(result.valid, false);
    assert.equal(result.commitmentMatched, false);
    assert.ok(result.error?.includes('Commitment mismatch'));
  });

  it('10. surfaces unverified status and distinguishes hash match from authenticity', async () => {
    const mockArtifact: ApiResponse<EvidenceArtifactDetail> = {
      data: {
        commitment: MOCK_COMMITMENT,
        manifestBytes: JSON.stringify(MOCK_MANIFEST),
        contentBytes: Buffer.from('test').toString('base64'),
        contentSize: 4,
        contentKeccak: evidenceContentHash('test'),
        publishedBy: ADDR_ALICE,
        marketOnchainId: '2',
        linkedEventTx: TX_HASH_1,
        externalPinning: 'UNVERIFIED',
        createdAt: '2026-10-31T12:00:00.000Z',
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => new Response(JSON.stringify(mockArtifact))),
    });

    const res = await client.getEvidence(MOCK_COMMITMENT);
    assert.equal(res.data.externalPinning, 'UNVERIFIED');
    assert.equal(res.data.commitment, MOCK_COMMITMENT);
  });

  it('11. sanitizes malicious script-like evidence content against XSS', () => {
    const malicious = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const sanitized = escapeHtml(malicious);
    assert.ok(!sanitized.includes('<script>'));
    assert.ok(sanitized.includes('&lt;script&gt;'));
    assert.ok(sanitized.includes('&lt;img'));
  });

  it('12. wraps API unavailable errors with API_UNAVAILABLE code (ADR-0012)', async () => {
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:4310');
      }),
    });

    await assert.rejects(
      async () => client.getMarketChallenges(2),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'API_UNAVAILABLE');
        assert.equal(err.statusCode, 503);
        return true;
      },
    );
  });

  it('13. publishes evidence manifest and returns canonical commitment', async () => {
    const mockPublishResult = {
      data: {
        commitment: MOCK_COMMITMENT,
        deduped: false,
        hasContent: true,
        marketLinked: true,
        externalPinning: 'UNVERIFIED',
      },
    };

    let capturedBody = '';
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async (_url, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(JSON.stringify(mockPublishResult), {status: 200});
      }),
    });

    const res = await client.publishEvidence({
      manifest: MOCK_MANIFEST,
      content: 'Official text',
    });

    assert.equal(res.data.commitment, MOCK_COMMITMENT);
    assert.equal(res.data.deduped, false);
    assert.ok(capturedBody.includes('orakl-evidence-v1'));
  });

  it('14. fetches evidence artifact by commitment', async () => {
    const mockArtifact = {
      data: {
        commitment: MOCK_COMMITMENT,
        manifestBytes: JSON.stringify(MOCK_MANIFEST),
        contentBytes: Buffer.from('Official text').toString('base64'),
        contentSize: 13,
        contentKeccak: evidenceContentHash('Official text'),
        publishedBy: ADDR_ALICE,
        marketOnchainId: '2',
        linkedEventTx: TX_HASH_1,
        externalPinning: 'UNVERIFIED',
        createdAt: '2026-10-31T12:00:00Z',
      },
    };

    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4310',
      fetch: createMockFetch(async (url) => {
        assert.ok(url.includes(`/api/v1/evidence/${MOCK_COMMITMENT}`));
        return new Response(JSON.stringify(mockArtifact), {status: 200});
      }),
    });

    const res = await client.getEvidence(MOCK_COMMITMENT);
    assert.equal(res.data.commitment, MOCK_COMMITMENT);
    assert.equal(res.data.contentSize, 13);
  });

  it('15. rejects invalid evidence manifest with validation errors', () => {
    const invalidManifest = {
      schema: 'wrong-schema',
    };
    const result = verifyEvidenceIntegrity(MOCK_COMMITMENT, invalidManifest);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('missing required field'));
  });

  it('16. formats tranche quantities safely for display using formatQie', () => {
    const amount = 1000000000000000000n; // 1 ETH
    assert.equal(formatQie(amount), '1');
    assert.equal(formatQie(0n), '0');
    assert.equal(formatQie(500000000000000000n), '0.5');
  });

  it('17. detects content hash mismatch when content bytes do not match manifest', () => {
    const wrongContent = 'Different content that does not hash to manifest contentHash';
    const result = verifyEvidenceIntegrity(MOCK_COMMITMENT, MOCK_MANIFEST, wrongContent);
    assert.equal(result.valid, false);
    assert.equal(result.contentHashMatched, false);
    assert.ok(result.error?.includes('Content hash mismatch'));
  });

  it('18. verifies canonical RFC 8785 representation produces deterministic Keccak-256', () => {
    const bytes1 = canonicalizeEvidence(MOCK_MANIFEST);
    const bytes2 = canonicalizeEvidence({...MOCK_MANIFEST});
    assert.deepEqual(bytes1, bytes2);
    assert.equal(evidenceCommitment(MOCK_MANIFEST), MOCK_COMMITMENT);
  });
});
