import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePredict,
  encodeClaimBond,
  type BondType,
  type Address,
} from '../src/selected/chain.ts';
import { parseQie } from '../src/format.ts';
import { createApiClient } from '../src/selected/api-client.ts';

const ALICE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address;
const BOB = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address;

describe('Frontend Financial Controls (ISSUE P1-03)', () => {
  describe('A. Prediction Panel & Side Selection', () => {
    it('correctly encodes custom YES prediction with side 0', () => {
      const calldata = encodePredict(1n, 0);
      assert.ok(calldata.startsWith('0x'));
      // Function selector for predict(uint256,uint8) is 0x84ec1ed2
      assert.strictEqual(calldata.slice(0, 10), '0x84ec1ed2');
    });

    it('correctly encodes custom NO prediction with side 1', () => {
      const calldata = encodePredict(1n, 1);
      assert.ok(calldata.startsWith('0x'));
      assert.strictEqual(calldata.slice(0, 10), '0x84ec1ed2');
      // The encoded side argument in the 2nd word must end with 1
      assert.ok(calldata.endsWith('1') || calldata.slice(74).includes('1'));
      // Ensure YES and NO encodings differ
      assert.notStrictEqual(encodePredict(1n, 0), encodePredict(1n, 1));
    });

    it('parses native amounts using exact BigInt wei (never floats)', () => {
      const oneEth = parseQie('1.0');
      assert.strictEqual(oneEth, 1000000000000000000n);

      const tinyEth = parseQie('0.000000000000000001');
      assert.strictEqual(tinyEth, 1n);

      const largeEth = parseQie('1000000.5');
      assert.strictEqual(largeEth, 1000000500000000000000000n);
    });

    it('rejects invalid or negative numeric strings', () => {
      assert.throws(() => parseQie('-1.0'));
      assert.throws(() => parseQie('abc'));
      assert.throws(() => parseQie('1.2.3'));
    });
  });

  describe('B. Multi-Bond Claims & Recipient Redirection', () => {
    it('encodes CREATION bond claim directed to recipient', () => {
      const calldata = encodeClaimBond(1n, 0 as BondType, BOB);
      assert.ok(calldata.startsWith('0x'));
      // Selector for claimBond(uint256,uint8,address) is 0xa363ea5c
      assert.strictEqual(calldata.slice(0, 10), '0xa363ea5c');
    });

    it('encodes PROPOSAL bond claim directed to recipient', () => {
      const calldata = encodeClaimBond(1n, 1 as BondType, ALICE);
      assert.ok(calldata.startsWith('0x'));
      assert.strictEqual(calldata.slice(0, 10), '0xa363ea5c');
    });

    it('encodes CHALLENGE bond claim directed to recipient', () => {
      const calldata = encodeClaimBond(1n, 2 as BondType, BOB);
      assert.ok(calldata.startsWith('0x'));
      assert.strictEqual(calldata.slice(0, 10), '0xa363ea5c');
    });

    it('produces distinct calldata for each bond kind', () => {
      const cCreation = encodeClaimBond(1n, 0 as BondType, ALICE);
      const cProposal = encodeClaimBond(1n, 1 as BondType, ALICE);
      const cChallenge = encodeClaimBond(1n, 2 as BondType, ALICE);

      assert.notStrictEqual(cCreation, cProposal);
      assert.notStrictEqual(cProposal, cChallenge);
      assert.notStrictEqual(cCreation, cChallenge);
    });
  });

  describe('C. Portfolio API & Reconciliation Client', () => {
    it('fetches portfolio endpoint with correct chain id header', async () => {
      let requestedUrl = '';
      let requestedHeaders: Record<string, string> = {};

      const mockFetch: typeof fetch = async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            simulationOnly: true,
            data: {
              address: ALICE,
              projectionOnly: true,
              openRisk: '1000000000000000000',
              totalClaimed: '500000000000000000',
              totals: { positions: 1, challengeStakes: 0, bonds: 1 },
              positions: [],
              challengeStakes: [],
              bonds: [],
              claimsByType: [],
              recentTransactions: [],
            },
            sync: {
              status: 'SYNCHRONIZED',
              lastProcessedBlock: '100',
              lastProcessedBlockHash: '0x1234',
              chainId: 31337,
              lag: '0',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = createApiClient({ baseUrl: 'http://127.0.0.1:4310', chainId: 31337, fetch: mockFetch });
      const res = await client.getPortfolio(ALICE);

      assert.ok(requestedUrl.includes(`/api/v1/portfolio/${ALICE}`));
      assert.strictEqual(requestedHeaders['x-chain-id'], '31337');
      assert.strictEqual(res.data.address, ALICE);
      assert.strictEqual(res.data.totals.positions, 1);
    });
  });
});
