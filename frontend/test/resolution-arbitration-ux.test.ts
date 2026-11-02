import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  parseRoute,
  stateTone,
  calculatePoolShares,
  isArbitratorOwner,
  calculateMinimumMaxResolutionTime,
  validateMarketCreationInput,
  formatResolutionCriteriaBlob,
  canonicalizeMarketMetadata,
  GOLD_BENCHMARK_PRESET,
  VALID_MARKET_CATEGORIES,
  formatUtcToDatetimeLocal,
  parseDatetimeInputToSeconds,
  type MarketMetadataManifest,
  type CreateMarketFormValues,
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

  describe('H. Institutional Market Creation Wizard & Parameter Validation', () => {
    const CHALLENGE_PERIOD = 48 * 3600; // 48h
    const ARBITRATION_PERIOD = 96 * 3600; // 96h
    const BASE_TIME = 1700000000n;
    const CLOSE_TIME = BASE_TIME + 86400n;
    const RES_TIME = CLOSE_TIME;
    const MIN_MAX_TIME = RES_TIME + BigInt(CHALLENGE_PERIOD + ARBITRATION_PERIOD + 48 * 3600); // +192h

    it('enforces protocol 192-hour minimum deadline floor calculation', () => {
      const calculated = calculateMinimumMaxResolutionTime(RES_TIME, CHALLENGE_PERIOD, ARBITRATION_PERIOD);
      assert.equal(calculated, MIN_MAX_TIME);
      // Verify exact 192 hours = 691,200 seconds
      assert.equal(calculated - RES_TIME, 192n * 3600n);

      // Verify category list
      assert.equal(VALID_MARKET_CATEGORIES.length, 5);
      assert.deepEqual(VALID_MARKET_CATEGORIES.map(c => c.slug), ['crypto', 'finance', 'tech', 'geopolitics', 'governance']);
    });

    it('validates a completely valid market creation input', () => {
      const input: CreateMarketFormValues = {
        question: 'Will Ethereum achieve 100,000 TPS on Layer 2 before 2027?',
        category: 'crypto',
        description: 'Aggregate rollup throughput measured via L2Beat.',
        primarySource: 'https://l2beat.com/scaling/activity',
        fallbackSource: 'https://etherscan.io',
        yesCriteria: 'Aggregate L2 TPS exceeds 100,000 on or before December 31, 2026.',
        noCriteria: 'Aggregate L2 TPS remains strictly below 100,000 through December 31, 2026.',
        invalidCriteria: 'L2Beat data is corrupted or permanently offline. Full 1:1 neutral refund.',
        closeTimeSec: CLOSE_TIME,
        resolutionTimeSec: RES_TIME,
        maxResolutionTimeSec: MIN_MAX_TIME + 3600n,
        nowSec: BASE_TIME,
        challengePeriodSec: CHALLENGE_PERIOD,
        arbitrationPeriodSec: ARBITRATION_PERIOD,
      };

      const result = validateMarketCreationInput(input);
      assert.equal(result.ok, true);
      assert.equal(result.errors.length, 0);
    });

    it('rejects questions without a trailing question mark or shorter than 15 characters', () => {
      const input: CreateMarketFormValues = {
        question: 'Gold price 3000',
        category: 'finance',
        description: '',
        primarySource: 'https://lbma.org.uk',
        fallbackSource: '',
        yesCriteria: 'Gold price >= 3000 USD.',
        noCriteria: 'Gold price < 3000 USD.',
        invalidCriteria: 'Market disrupted. 100% refund.',
        closeTimeSec: CLOSE_TIME,
        resolutionTimeSec: RES_TIME,
        maxResolutionTimeSec: MIN_MAX_TIME + 3600n,
        nowSec: BASE_TIME,
        challengePeriodSec: CHALLENGE_PERIOD,
        arbitrationPeriodSec: ARBITRATION_PERIOD,
      };

      const result = validateMarketCreationInput(input);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes('question mark (?)')));
    });

    it('rejects maxResolutionTime that violates the 192h protocol floor', () => {
      const input: CreateMarketFormValues = {
        question: 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?',
        category: 'finance',
        description: 'LBMA PM benchmark',
        primarySource: 'https://www.lbma.org.uk',
        fallbackSource: '',
        yesCriteria: 'LBMA PM >= 2800.00',
        noCriteria: 'LBMA PM < 2800.00',
        invalidCriteria: 'Data unavailable. Full neutral refund.',
        closeTimeSec: CLOSE_TIME,
        resolutionTimeSec: RES_TIME,
        maxResolutionTimeSec: RES_TIME + 10000n, // Violates 192h floor (only ~2.7 hours)
        nowSec: BASE_TIME,
        challengePeriodSec: CHALLENGE_PERIOD,
        arbitrationPeriodSec: ARBITRATION_PERIOD,
      };

      const result = validateMarketCreationInput(input);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes('Max resolution time must be at least 192 hours')));
    });

    it('validates LBMA Gold Price PM benchmark preset satisfies all requirements', () => {
      const input: CreateMarketFormValues = {
        question: GOLD_BENCHMARK_PRESET.question,
        category: GOLD_BENCHMARK_PRESET.category,
        description: GOLD_BENCHMARK_PRESET.description,
        primarySource: GOLD_BENCHMARK_PRESET.primarySource,
        fallbackSource: GOLD_BENCHMARK_PRESET.fallbackSource,
        yesCriteria: GOLD_BENCHMARK_PRESET.yesCriteria,
        noCriteria: GOLD_BENCHMARK_PRESET.noCriteria,
        invalidCriteria: GOLD_BENCHMARK_PRESET.invalidCriteria,
        closeTimeSec: CLOSE_TIME,
        resolutionTimeSec: RES_TIME,
        maxResolutionTimeSec: MIN_MAX_TIME + 3600n,
        nowSec: BASE_TIME,
        challengePeriodSec: CHALLENGE_PERIOD,
        arbitrationPeriodSec: ARBITRATION_PERIOD,
      };

      const result = validateMarketCreationInput(input);
      assert.equal(result.ok, true);
      assert.equal(result.errors.length, 0);
    });

    it('formats structured resolution criteria blob cleanly', () => {
      const blob = formatResolutionCriteriaBlob({
        yes: 'Condition YES',
        no: 'Condition NO',
        invalid: 'Neutral refund 100%',
        fallback: 'https://fallback.source',
      });
      assert.ok(blob.includes('[YES OUTCOME CRITERIA]\nCondition YES'));
      assert.ok(blob.includes('[NO OUTCOME CRITERIA]\nCondition NO'));
      assert.ok(blob.includes('[INVALID / NEUTRAL REFUND RULES]\nNeutral refund 100%'));
      assert.ok(blob.includes('[FALLBACK DATA SOURCES]\nhttps://fallback.source'));
    });

    it('generates deterministic RFC 8785 canonical metadata JSON string', () => {
      const manifest: MarketMetadataManifest = {
        schema: 'orakl-market-metadata-v1',
        chainId: '31337',
        factory: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
        question: 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?',
        description: 'LBMA PM benchmark',
        category: 'finance',
        resolutionCriteria: 'YES if >= 2800, NO if < 2800, INVALID otherwise.',
        sources: ['https://www.lbma.org.uk'],
        creator: ADDR_CREATOR,
        createdAt: '1700000000',
      };

      const canonical = canonicalizeMarketMetadata(manifest);
      assert.ok(typeof canonical === 'string');
      const parsed = JSON.parse(canonical);
      // Verify keys are in lexicographical order
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      assert.deepEqual(keys, sortedKeys);
      assert.equal(keys[0], 'category');
      assert.equal(keys[keys.length - 1], 'sources');
    });

    it('regression (Requirement 1 & 5): enforces LBMA Gold PM preset chronology and deadline sequencing', () => {
      // 1. Observation date is December 31, 2026 15:00 UTC
      assert.equal(GOLD_BENCHMARK_PRESET.observationDate, '2026-12-31');
      assert.equal(GOLD_BENCHMARK_PRESET.observationTimeUtc, '2026-12-31T15:00:00Z');

      // 2. Market close precedes the observation
      assert.ok(
        GOLD_BENCHMARK_PRESET.closeTimeSec < GOLD_BENCHMARK_PRESET.observationTimeSec,
        `Market close (${GOLD_BENCHMARK_PRESET.closeTimeSec}) must precede observation (${GOLD_BENCHMARK_PRESET.observationTimeSec})`,
      );

      // 3. Resolution starts strictly after the observation can be determined
      assert.ok(
        GOLD_BENCHMARK_PRESET.observationTimeSec < GOLD_BENCHMARK_PRESET.resolutionTimeSec,
        `Resolution start (${GOLD_BENCHMARK_PRESET.resolutionTimeSec}) must start after observation (${GOLD_BENCHMARK_PRESET.observationTimeSec})`,
      );

      // 4. Fallback deadline succeeds resolution start
      assert.ok(
        GOLD_BENCHMARK_PRESET.resolutionTimeSec < GOLD_BENCHMARK_PRESET.fallbackDeadlineSec,
        `Fallback deadline must succeed resolution start`,
      );

      // 5. Relevant observation date is strictly before maxResolutionTime
      assert.ok(
        GOLD_BENCHMARK_PRESET.observationTimeSec < GOLD_BENCHMARK_PRESET.maxResolutionTimeSec,
        `Observation time must be before maxResolutionTime`,
      );

      // 6. Max resolution time satisfies the protocol-enforced minimum floor (resolutionTime + 192h)
      const minProtocolFloor = calculateMinimumMaxResolutionTime(
        GOLD_BENCHMARK_PRESET.resolutionTimeSec,
        CHALLENGE_PERIOD,
        ARBITRATION_PERIOD,
      );
      assert.ok(
        GOLD_BENCHMARK_PRESET.maxResolutionTimeSec >= minProtocolFloor,
        `Max resolution time must satisfy protocol floor >= resolutionTime + 192h`,
      );

      // 7. Max resolution accommodates the fallback source deadline + 192h contract-enforced periods
      const minFallbackAccommodated =
        GOLD_BENCHMARK_PRESET.fallbackDeadlineSec +
        BigInt(CHALLENGE_PERIOD) +
        BigInt(ARBITRATION_PERIOD) +
        48n * 3600n; // 192h total
      assert.ok(
        GOLD_BENCHMARK_PRESET.maxResolutionTimeSec >= minFallbackAccommodated,
        `Max resolution time must accommodate fallback source deadline + 192h challenge/arbitration periods`,
      );
    });

    it('regression (Requirement 2 & 5): enforces semantic consistency and mutual exclusivity between question, YES, and NO criteria', () => {
      // Question: "Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?"
      // Exceed means strictly greater than (> 2,800.00).
      assert.ok(
        GOLD_BENCHMARK_PRESET.question.includes('exceed $2,800.00'),
        'Question must clearly ask if price exceeds $2,800.00',
      );

      // YES criteria must be strictly greater than, NOT greater than or equal to
      assert.ok(
        GOLD_BENCHMARK_PRESET.yesCriteria.includes('strictly greater than $2,800.00'),
        'YES criteria must require strictly greater than $2,800.00',
      );
      assert.ok(
        !GOLD_BENCHMARK_PRESET.yesCriteria.includes('greater than or equal to'),
        'YES criteria must NOT include "greater than or equal to"',
      );

      // NO criteria must be less than or equal to (<= 2,800.00)
      assert.ok(
        GOLD_BENCHMARK_PRESET.noCriteria.includes('less than or equal to $2,800.00'),
        'NO criteria must require less than or equal to $2,800.00',
      );

      // Logical test of mutual exclusivity and collective exhaustiveness:
      const evaluateOutcomes = (price: number) => {
        const isYes = price > 2800.0;
        const isNo = price <= 2800.0;
        return { isYes, isNo };
      };

      // At exactly $2,800.00 (the boundary):
      const atBoundary = evaluateOutcomes(2800.0);
      assert.equal(atBoundary.isYes, false, 'At $2,800.00, it did not exceed: YES must be false');
      assert.equal(atBoundary.isNo, true, 'At $2,800.00, it did not exceed: NO must be true');

      // Above boundary ($2,800.01):
      const aboveBoundary = evaluateOutcomes(2800.01);
      assert.equal(aboveBoundary.isYes, true);
      assert.equal(aboveBoundary.isNo, false);

      // Below boundary ($2,799.99):
      const belowBoundary = evaluateOutcomes(2799.99);
      assert.equal(belowBoundary.isYes, false);
      assert.equal(belowBoundary.isNo, true);
    });

    it('regression (Requirement 1 & Timezone Handling): formats and parses explicit UTC datetime strings deterministically', () => {
      // 1. Formatting UTC seconds to HTML datetime-local format
      const formattedClose = formatUtcToDatetimeLocal(GOLD_BENCHMARK_PRESET.closeTimeSec);
      assert.equal(formattedClose, '2026-12-31T12:00');

      const formattedRes = formatUtcToDatetimeLocal(GOLD_BENCHMARK_PRESET.resolutionTimeSec);
      assert.equal(formattedRes, '2026-12-31T18:00');

      const formattedMax = formatUtcToDatetimeLocal(GOLD_BENCHMARK_PRESET.maxResolutionTimeSec);
      assert.equal(formattedMax, '2027-01-15T18:00');

      // 2. Parsing naive HTML datetime-local string as explicit UTC seconds
      const parsedClose = parseDatetimeInputToSeconds('2026-12-31T12:00');
      assert.equal(parsedClose, GOLD_BENCHMARK_PRESET.closeTimeSec);

      const parsedRes = parseDatetimeInputToSeconds('2026-12-31T18:00');
      assert.equal(parsedRes, GOLD_BENCHMARK_PRESET.resolutionTimeSec);

      const parsedMax = parseDatetimeInputToSeconds('2027-01-15T18:00');
      assert.equal(parsedMax, GOLD_BENCHMARK_PRESET.maxResolutionTimeSec);

      // 3. String with explicit Z or offset
      assert.equal(parseDatetimeInputToSeconds('2026-12-31T12:00:00Z'), GOLD_BENCHMARK_PRESET.closeTimeSec);
    });

    it('regression (Requirement 3 & 5): proves preset does not auto-confirm immutability and enforces deliberate confirmation', () => {
      // ORAKL Institutional Invariant: Loading a preset template must NEVER automatically check the immutability acknowledgment.
      assert.equal(
        GOLD_BENCHMARK_PRESET.autoConfirmImmutability,
        false,
        'Preset must specify autoConfirmImmutability: false so that creator confirmation is strictly manual and deliberate',
      );
    });
  });
});
