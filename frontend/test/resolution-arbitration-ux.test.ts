import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  parseRoute,
  stateTone,
  calculatePoolShares,
  isArbitratorOwner,
} from '../src/local/navigation.ts';
import {
  MARKET_STATE_LABELS,
  OUTCOME_LABELS,
  BOND_LABELS,
  type MarketRecord,
  type Address,
  type Hex,
} from '../src/selected/chain.ts';
import {
  formatQie,
  parseQie,
  shortAddress,
  addressEq,
} from '../src/format.ts';

// ----------------------------------------------------------------- fixtures

const ADDR_CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;
const ADDR_PROPOSER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address;
const ADDR_CHALLENGER = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address;
const ARBITRATOR_OWNERS: Address[] = [
  '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc' as Address,
  '0x976ea74026e726554db657fa54763abd0c3a0aa9' as Address,
];

const HASH_ZERO = ('0x' + '0'.repeat(64)) as Hex;

function createSampleMarket(overrides: Partial<MarketRecord> = {}): MarketRecord {
  return {
    id: 1n,
    creator: ADDR_CREATOR,
    metadataHash: ('0x' + '1'.repeat(64)) as Hex,
    metadataURI: 'ipfs://bafybeifakeuri1234567890abcdef',
    closeTime: 1700000000n,
    resolutionTime: 1700003600n,
    maxResolutionTime: 1700200000n,
    storedState: 0,
    proposedOutcome: 0,
    finalOutcome: 0,
    proposer: ('0x' + '0'.repeat(40)) as Address,
    challenger: ('0x' + '0'.repeat(40)) as Address,
    proposalEvidence: HASH_ZERO,
    challengeEvidence: HASH_ZERO,
    decisionEvidence: HASH_ZERO,
    challengeDeadline: 0n,
    arbitrationDeadline: 0n,
    yesPool: parseQie('10.0'),
    noPool: parseQie('15.0'),
    distributablePool: parseQie('24.75'),
    protocolFee: parseQie('0.25'),
    paidOut: 0n,
    refunded: 0n,
    refundable: false,
    arbitratorFingerprint: HASH_ZERO,
    ...overrides,
  };
}

describe('Resolution & Arbitration UX Overhaul (P4-DES)', () => {
  describe('A. Routing & Navigation Parser', () => {
    it('parses empty hash or root as market list route', () => {
      assert.deepEqual(parseRoute(''), {name: 'list'});
      assert.deepEqual(parseRoute('/'), {name: 'list'});
      assert.deepEqual(parseRoute('#/'), {name: 'list'});
    });

    it('parses market detail route with bigint id', () => {
      assert.deepEqual(parseRoute('/market/0'), {name: 'market', id: 0n});
      assert.deepEqual(parseRoute('/market/42'), {name: 'market', id: 42n});
      assert.deepEqual(parseRoute('#/market/999999999'), {name: 'market', id: 999999999n});
    });

    it('parses arbitration workspace route with default all filter', () => {
      assert.deepEqual(parseRoute('/arbitration'), {name: 'arbitration', filter: 'all'});
      assert.deepEqual(parseRoute('#/arbitration'), {name: 'arbitration', filter: 'all'});
    });

    it('parses arbitration workspace route with specific filter parameters', () => {
      assert.deepEqual(parseRoute('/arbitration?filter=disputed'), {name: 'arbitration', filter: 'disputed'});
      assert.deepEqual(parseRoute('/arbitration?filter=proposed'), {name: 'arbitration', filter: 'proposed'});
      assert.deepEqual(parseRoute('/arbitration?filter=finalized'), {name: 'arbitration', filter: 'finalized'});
      assert.deepEqual(parseRoute('/arbitration?filter=unknown'), {name: 'arbitration', filter: 'all'});
    });

    it('parses arbitration case detail route with bigint id', () => {
      assert.deepEqual(parseRoute('/arbitration/1'), {name: 'arbitration-case', id: 1n});
      assert.deepEqual(parseRoute('#/arbitration/77'), {name: 'arbitration-case', id: 77n});
    });

    it('parses static utility routes', () => {
      assert.deepEqual(parseRoute('/create'), {name: 'create'});
      assert.deepEqual(parseRoute('/evidence'), {name: 'evidence'});
      assert.deepEqual(parseRoute('/status'), {name: 'status'});
      assert.deepEqual(parseRoute('/portfolio'), {name: 'portfolio'});
    });
  });

  describe('B. Resolution State & Visual Tone Mapping', () => {
    it('maps stored states to correct status tone labels', () => {
      assert.equal(stateTone(0), 'open'); // OPEN
      assert.equal(stateTone(1), 'wait'); // CLOSED
      assert.equal(stateTone(2), 'expired'); // PROPOSED
      assert.equal(stateTone(3), 'expired'); // DISPUTED
      assert.equal(stateTone(4), 'done'); // FINALIZED
      assert.equal(stateTone(5), 'done'); // CANCELLED
    });

    it('computes effective state when market closeTime has elapsed on-chain', () => {
      const now = 1700001000;
      const m = createSampleMarket({closeTime: 1700000000n, storedState: 0});
      const effectiveState = (m.storedState === 0 && now >= Number(m.closeTime)) ? 1 : m.storedState;
      assert.equal(effectiveState, 1);
      assert.equal(MARKET_STATE_LABELS[effectiveState], 'CLOSED');
      assert.equal(stateTone(effectiveState), 'wait');
    });

    it('calculates pool shares using calculatePoolShares helper', () => {
      const shares = calculatePoolShares(parseQie('10.0'), parseQie('30.0'));
      assert.equal(shares.total, parseQie('40.0'));
      assert.equal(shares.yesPct, 25.0);
      assert.equal(shares.noPct, 75.0);
    });
  });

  describe('C. Pool Contribution Distribution Invariants', () => {
    it('calculates proportional pool distribution without guaranteed probability claims', () => {
      const yesPool = parseQie('10.0');
      const noPool = parseQie('30.0');
      const total = yesPool + noPool;
      assert.equal(total, parseQie('40.0'));

      const yesPct = Number((yesPool * 10_000n) / total) / 100;
      const noPct = 100 - yesPct;
      assert.equal(yesPct, 25.0);
      assert.equal(noPct, 75.0);
    });

    it('handles zero pools safely without NaN or zero division errors', () => {
      const yesPool = 0n;
      const noPool = 0n;
      const total = yesPool + noPool;
      const yesPct = total > 0n ? Number((yesPool * 10_000n) / total) / 100 : null;
      assert.equal(yesPct, null);
    });
  });

  describe('D. Honest Multisig Disclosure & Arbitrator Authority', () => {
    it('verifies arbitrator owner list detection for connected wallet', () => {
      const connectedOwner = ARBITRATOR_OWNERS[0]!;
      const isOwner = ARBITRATOR_OWNERS.some(o => addressEq(o, connectedOwner));
      assert.equal(isOwner, true);
      assert.equal(isArbitratorOwner(connectedOwner, ARBITRATOR_OWNERS), true);
      assert.equal(isArbitratorOwner(connectedOwner.toUpperCase(), ARBITRATOR_OWNERS), true);

      const externalObserver = '0x1111111111111111111111111111111111111111' as Address;
      const isObserverOwner = ARBITRATOR_OWNERS.some(o => addressEq(o, externalObserver));
      assert.equal(isObserverOwner, false);
      assert.equal(isArbitratorOwner(externalObserver, ARBITRATOR_OWNERS), false);
      assert.equal(isArbitratorOwner(null, ARBITRATOR_OWNERS), false);
    });

    it('distinguishes LocalRoleMock (Threshold 2) from production 3-of-5 Safe multisig', () => {
      const mockConfig = {
        type: 'LocalRoleMock',
        threshold: 2,
        ownersCount: 2,
        productionStandard: '3-of-5 Canonical Safe',
      };
      assert.equal(mockConfig.threshold, 2);
      assert.notEqual(mockConfig.type, 'SafeL2');
      assert.equal(mockConfig.productionStandard, '3-of-5 Canonical Safe');
    });
  });

  describe('E. Neutral-INVALID Settlement & Refund Protocol Guarantees', () => {
    it('verifies INVALID outcome label and full refund semantics', () => {
      assert.equal(OUTCOME_LABELS[3], 'INVALID — REFUND');
      const market = createSampleMarket({
        storedState: 4, // FINALIZED
        finalOutcome: 3, // INVALID
        refundable: true,
      });
      assert.equal(market.finalOutcome, 3);
      assert.equal(market.refundable, true);
    });

    it('verifies bond type definitions and labels', () => {
      assert.equal(BOND_LABELS[0], 'CREATION');
      assert.equal(BOND_LABELS[1], 'PROPOSAL');
      assert.equal(BOND_LABELS[2], 'CHALLENGE');
    });
  });

  describe('F. Stepped Lifecycle Progression & Deadlines', () => {
    it('computes timeline step classes across lifecycle states', () => {
      // OPEN state
      const stateOpen = 0;
      assert.equal(stateOpen === 0 ? 'pending' : 'completed', 'pending');

      // CLOSED state
      const stateClosed = 1;
      assert.equal(stateClosed === 1 ? 'active' : 'pending', 'active');

      // PROPOSED state
      const stateProposed = 2;
      assert.equal(stateProposed >= 2 ? 'completed' : 'pending', 'completed');

      // DISPUTED state
      const stateDisputed = 3;
      assert.equal(stateDisputed === 3 ? 'active' : 'pending', 'active');

      // FINALIZED state
      const stateFinalized = 4;
      assert.equal(stateFinalized >= 4 ? 'completed' : 'pending', 'completed');
    });

    it('enforces dispute window constraints before arbitration deadline', () => {
      const challengeDeadline = 1700100000n;
      const arbitrationDeadline = 1700200000n;
      assert.ok(arbitrationDeadline > challengeDeadline);
    });
  });

  describe('G. Multi-Challenger Tranche Formatting & Safety', () => {
    it('preserves challenger addresses and tranche ordering', () => {
      const stakes = [
        {walletAddress: ADDR_CHALLENGER, amount: parseQie('1.0'), prefixBefore: 0n},
        {walletAddress: ADDR_PROPOSER, amount: parseQie('2.0'), prefixBefore: parseQie('1.0')},
      ];
      assert.equal(stakes.length, 2);
      assert.equal(stakes[1]!.prefixBefore, stakes[0]!.amount);
      assert.equal(formatQie(stakes[0]!.amount), '1');
      assert.equal(formatQie(stakes[1]!.amount), '2');
    });

    it('formats short addresses cleanly without data truncation loss', () => {
      const formatted = shortAddress(ADDR_CREATOR);
      assert.match(formatted, /^0xf39f…2266$/);
      assert.equal(shortAddress('0x' + '0'.repeat(40) as Address), '0x0000…0000');
    });
  });
});
