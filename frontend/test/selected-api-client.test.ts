import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  createApiClient,
  ApiError,
  parsePoolAmount,
  type ApiResponse,
  type MarketListResult,
  type MarketDetail,
  type SyncMetadata,
} from '../src/selected/api-client.ts';

// ----------------------------------------------------------------- mock data

const MOCK_SYNC_SYNCHRONIZED: SyncMetadata = {
  status: 'SYNCHRONIZED',
  lastProcessedBlock: '100',
  lastProcessedBlockHash: '0x' + 'a'.repeat(64),
  lag: '0',
  indexedEvents: '25',
  chainId: 31337,
  contractAddress: '0x2222222222222222222222222222222222222222',
  headBlock: '100',
  checkedAt: '2026-10-31T12:00:00.000Z',
  referenceSource: 'rpc',
};

const MOCK_SYNC_LAGGING: SyncMetadata = {
  status: 'LAGGING',
  lastProcessedBlock: '90',
  lastProcessedBlockHash: '0x' + 'b'.repeat(64),
  lag: '10',
  indexedEvents: '20',
  chainId: 31337,
  contractAddress: '0x2222222222222222222222222222222222222222',
  headBlock: '100',
  checkedAt: '2026-10-31T12:00:00.000Z',
  referenceSource: 'rpc',
};

const MOCK_MARKET_ITEM = {
  id: '1',
  chainId: 31337,
  contractAddress: '0x2222222222222222222222222222222222222222',
  creator: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  question: 'Will Bitcoin reach $100k in 2026?',
  description: 'Spot price confirmation.',
  category: 'crypto',
  metadataHash: '0x' + '1'.repeat(64),
  metadataURI: 'ipfs://mock-uri-1',
  verifiedMetadata: true,
  status: 'OPEN' as const,
  finalOutcome: 'UNRESOLVED' as const,
  proposer: null,
  challenger: null,
  proposedOutcome: null,
  proposalEvidence: null,
  challengeEvidence: null,
  decisionEvidence: null,
  yesPool: '2000000000000000000', // 2 ETH
  noPool: '5000000000000000000',  // 5 ETH
  totalChallengeStake: '0',
  refundable: null,
  challengeDeadline: null,
  closeTime: '1735689600',
  resolutionTime: '1735776000',
  maxResolutionTime: '1738368000',
  createdAtBlock: '10',
};

// Helper mock fetch factory
function createMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

describe('Selected Frontend API Client (TICKET-07 / WP-05)', () => {
  it('1. fetches successful market listing and propagates x-chain-id header', async () => {
    let capturedUrl = '';
    let capturedChainHeader: string | null = null;

    const mockFetch = createMockFetch(async (url, init) => {
      capturedUrl = url;
      capturedChainHeader = (init?.headers as Record<string, string>)?.[
        'x-chain-id'
      ] ?? null;

      const payload: ApiResponse<MarketListResult> = {
        data: {
          page: 1,
          pageSize: 20,
          total: 1,
          items: [MOCK_MARKET_ITEM],
        },
        sync: MOCK_SYNC_SYNCHRONIZED,
        simulationOnly: true,
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      });
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', chainId: 31337, fetch: mockFetch});
    const res = await client.getMarkets();

    assert.equal(capturedUrl, 'http://127.0.0.1:4310/api/v1/markets');
    assert.equal(capturedChainHeader, '31337');
    assert.equal(res.data.total, 1);
    assert.ok(res.data.items[0]);
    assert.equal(res.data.items[0]?.id, '1');
    assert.equal(res.data.items[0]?.question, 'Will Bitcoin reach $100k in 2026?');
    assert.equal(res.sync?.status, 'SYNCHRONIZED');
  });

  it('2. retrieves market detail with relations and bigint values preserved', async () => {
    const mockDetail: MarketDetail = {
      ...MOCK_MARKET_ITEM,
      resolution: null,
      positions: [
        {
          id: 'pos-1',
          walletAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
          yesContribution: '2000000000000000000',
          noContribution: '0',
          claimedAmount: '0',
          refundedAmount: '0',
          updatedBlock: '10',
        },
      ],
      contributions: [
        {
          id: 'contrib-1',
          walletAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
          side: 'YES',
          amount: '2000000000000000000',
          predictCount: 1,
        },
      ],
      challengeStakes: [],
      settlement: null,
      claimsByType: [],
    };

    const mockFetch = createMockFetch(async (url) => {
      assert.equal(url, 'http://127.0.0.1:4310/api/v1/markets/1');
      return new Response(JSON.stringify({data: mockDetail, sync: MOCK_SYNC_SYNCHRONIZED}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      });
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    const res = await client.getMarket(1n);

    assert.equal(res.data.id, '1');
    assert.equal(res.data.positions.length, 1);
    assert.ok(res.data.positions[0]);
    assert.equal(res.data.positions[0]?.yesContribution, '2000000000000000000');
  });

  it('3. handles empty market results cleanly', async () => {
    const mockFetch = createMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: {page: 1, pageSize: 20, total: 0, items: []},
          sync: MOCK_SYNC_SYNCHRONIZED,
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    const res = await client.getMarkets({status: 'FINALIZED'});

    assert.equal(res.data.total, 0);
    assert.equal(res.data.items.length, 0);
  });

  it('4. correctly formats query string for search and category filters', async () => {
    let capturedUrl = '';
    const mockFetch = createMockFetch(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({data: {page: 1, pageSize: 10, total: 0, items: []}}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      });
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    await client.getMarkets({category: 'crypto', q: 'bitcoin & ethereum'});

    const parsed = new URL(capturedUrl);
    assert.equal(parsed.pathname, '/api/v1/markets');
    assert.equal(parsed.searchParams.get('category'), 'crypto');
    assert.equal(parsed.searchParams.get('q'), 'bitcoin & ethereum');
  });

  it('5. formats sorting and pagination parameters', async () => {
    let capturedUrl = '';
    const mockFetch = createMockFetch(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({data: {page: 2, pageSize: 50, total: 100, items: []}}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      });
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    await client.getMarkets({page: 2, pageSize: 50, sort: 'closeTime', order: 'asc'});

    const parsed = new URL(capturedUrl);
    assert.equal(parsed.searchParams.get('page'), '2');
    assert.equal(parsed.searchParams.get('pageSize'), '50');
    assert.equal(parsed.searchParams.get('sort'), 'closeTime');
    assert.equal(parsed.searchParams.get('order'), 'asc');
  });

  it('6. parses standardized 400 WRONG_CHAIN error envelope (ADR-0012)', async () => {
    const mockFetch = createMockFetch(async () => {
      return new Response(
        JSON.stringify({
          error: 'Chain mismatch: requested 1 but server is configured for 31337',
          code: 'WRONG_CHAIN',
          statusCode: 400,
          requestId: 'req-chain-err-1',
        }),
        {status: 400, headers: {'Content-Type': 'application/json'}},
      );
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', chainId: 1, fetch: mockFetch});
    await assert.rejects(
      async () => client.getMarkets(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'WRONG_CHAIN');
        assert.equal(err.statusCode, 400);
        assert.equal(err.requestId, 'req-chain-err-1');
        assert.ok(err.message.includes('Chain mismatch'));
        return true;
      },
    );
  });

  it('7. wraps network connectivity failures in ApiError with API_UNAVAILABLE code', async () => {
    const mockFetch = createMockFetch(async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:4310');
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    await assert.rejects(
      async () => client.getMarkets(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'API_UNAVAILABLE');
        assert.equal(err.statusCode, 503);
        assert.ok(err.message.includes('unavailable'));
        return true;
      },
    );
  });

  it('8. preserves and surfaces LAGGING synchronization metadata (ADR-0007)', async () => {
    const mockFetch = createMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: {page: 1, pageSize: 20, total: 1, items: [MOCK_MARKET_ITEM]},
          sync: MOCK_SYNC_LAGGING,
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    const res = await client.getMarkets();

    assert.equal(res.sync?.status, 'LAGGING');
    assert.equal(res.sync?.lag, '10');
    assert.equal(res.sync?.lastProcessedBlock, '90');
    assert.equal(res.sync?.headBlock, '100');
  });

  it('9. preserves 78-digit uint256 strings and parsePoolAmount uses exact BigInt (ADR-0001)', async () => {
    const largeAmount = '100000000000000000000000000000000000000000000000000'; // 10^50 wei
    const itemWithLargeAmount = {
      ...MOCK_MARKET_ITEM,
      yesPool: largeAmount,
    };

    const mockFetch = createMockFetch(async () => {
      return new Response(
        JSON.stringify({
          data: {page: 1, pageSize: 20, total: 1, items: [itemWithLargeAmount]},
          sync: MOCK_SYNC_SYNCHRONIZED,
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      );
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    const res = await client.getMarkets();

    const item = res.data.items[0];
    assert.ok(item);
    const receivedYesPool = item.yesPool;
    assert.equal(receivedYesPool, largeAmount);

    const asBigInt = parsePoolAmount(receivedYesPool);
    assert.equal(asBigInt, 100000000000000000000000000000000000000000000000000n);
    // Ensure helper handles empty/null gracefully without throwing
    assert.equal(parsePoolAmount(null), 0n);
    assert.equal(parsePoolAmount(''), 0n);
  });

  it('10. records and exposes requestId from error responses for correlation (ADR-0012)', async () => {
    const mockFetch = createMockFetch(async () => {
      return new Response(
        JSON.stringify({
          error: 'Market not indexed',
          code: 'NOT_FOUND',
          statusCode: 404,
          requestId: 'req-test-trace-999',
        }),
        {status: 404, headers: {'Content-Type': 'application/json'}},
      );
    });

    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});
    await assert.rejects(
      async () => client.getMarket(999n),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.statusCode, 404);
        assert.equal(err.requestId, 'req-test-trace-999');
        return true;
      },
    );
  });

  it('11. respects AbortSignal for request cancellation', async () => {
    const controller = new AbortController();
    const mockFetch = createMockFetch(async (_url, init) => {
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return new Response(JSON.stringify({data: {items: []}}), {status: 200});
    });

    controller.abort();
    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310', fetch: mockFetch});

    await assert.rejects(
      async () => client.getMarkets({signal: controller.signal}),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });

  it('12. keeps environment isolation: defaults strictly to local simulation chain 31337', async () => {
    const client = createApiClient({baseUrl: 'http://127.0.0.1:4310'});
    assert.equal(client.getChainId(), 31337);
    assert.equal(client.getBaseUrl(), 'http://127.0.0.1:4310');
  });
});
