import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  partitionEvidence,
  validateEvidenceRecord,
  publishEvidenceBundle,
  deriveHistoricalPartitions,
  type EvidenceRecord,
} from '../../scripts/p1/evidence-partition.mjs';

function createMockFullRecords(): EvidenceRecord {
  const mkTx = (hash: string, step: number, action: string, block = 100) => ({
    step,
    action,
    txHash: hash,
    blockNumber: block,
    gasUsed: '50000',
    status: 'success',
  });

  return {
    timestamp: '2026-10-31T16:10:00.000Z',
    chainId: 31337,
    contracts: {
      factory: '0x8f86403A4DE0BB5791fa46B8e795C547942fE4Cf',
      config: '0x0E801D84Fa97b50751Dbf25036d067dCf18858bF',
      arbitrator: '0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf',
      compliance: '0x4826533B4897376654Bb4d4AD88B7faFD0C98528',
      governance: '0x70e0bA845a1A0F2DA3359C97E0285013525FFC49',
    },
    scenarios: {
      scenarioA: {
        status: 'PASSED',
        marketId: '0',
        totalTransactions: 2,
        transactions: [
          mkTx('0x1111111111111111111111111111111111111111111111111111111111111111', 1, 'Market A Creation'),
          mkTx('0x2222222222222222222222222222222222222222222222222222222222222222', 2, 'Bet YES'),
        ],
        steps: [{ step: 1, action: 'Market A Creation' }, { step: 2, action: 'Bet YES' }],
        reconciliation: { totalDeposits: '44000000000000000000' },
      },
      scenarioB: {
        status: 'PASSED',
        marketId: '1',
        totalTransactions: 2,
        transactions: [
          mkTx('0x3333333333333333333333333333333333333333333333333333333333333333', 1, 'Market B Creation'),
          mkTx('0x4444444444444444444444444444444444444444444444444444444444444444', 2, 'Bet NO'),
        ],
        steps: [{ step: 1, action: 'Market B Creation' }, { step: 2, action: 'Bet NO' }],
        reconciliation: { totalDeposits: '34000000000000000000' },
      },
      scenarioC: {
        status: 'PASSED',
        marketId: '2',
        totalTransactions: 3,
        transactions: [
          mkTx('0x5555555555555555555555555555555555555555555555555555555555555555', 1, 'Market C Creation'),
          mkTx('0x6666666666666666666666666666666666666666666666666666666666666666', 2, 'Pause'),
          mkTx('0x7777777777777777777777777777777777777777777777777777777777777777', 3, 'Cancel'),
        ],
        steps: [{ step: 1, action: 'Market C' }, { step: 2, action: 'Pause' }, { step: 3, action: 'Cancel' }],
        reconciliation: { totalDeposits: '42000000000000000000' },
      },
      scenarioD: {
        status: 'PASSED',
        marketId: '3',
        totalTransactions: 2,
        transactions: [
          mkTx('0x8888888888888888888888888888888888888888888888888888888888888888', 1, 'Market D Branch 1 (orphaned)', 101),
          mkTx('0x9999999999999999999999999999999999999999999999999999999999999999', 2, 'Market D Branch 2 (canonical)', 101),
        ],
        steps: [{ step: 1, action: 'Branch 1' }, { step: 2, action: 'Branch 2' }],
        rollbackAudit: { removedBlocks: 12, removedEvents: 9, replayedEvents: 84 },
        canonicalState: { status: 'OPEN' },
      },
    },
    summary: {
      allPassed: true,
      scenariosExecuted: ['Scenario A', 'Scenario B', 'Scenario C', 'Scenario D'],
      totalTransactions: 9,
      executedAt: '2026-10-31T16:10:07.667Z',
      verifier: 'scripts/p1/run-e2e-scenarios.mjs',
    },
  };
}

describe('E2E Evidence Partitioning & Provenance (H2)', () => {
  it('1. Full A-D input produces correct scenario sets', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    const all = partitionEvidence(full, 'ALL_SCENARIOS');

    expect(Object.keys(ab.scenarios)).toEqual(['scenarioA', 'scenarioB']);
    expect(Object.keys(cd.scenarios)).toEqual(['scenarioC', 'scenarioD']);
    expect(Object.keys(all.scenarios)).toEqual(['scenarioA', 'scenarioB', 'scenarioC', 'scenarioD']);
  });

  it('2. A-B contains no C or D records', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    expect(ab.scenarios.scenarioC).toBeUndefined();
    expect(ab.scenarios.scenarioD).toBeUndefined();
  });

  it('3. C-D contains no A or B records', () => {
    const full = createMockFullRecords();
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    expect(cd.scenarios.scenarioA).toBeUndefined();
    expect(cd.scenarios.scenarioB).toBeUndefined();
  });

  it('4. Scoped transaction counts match their actual records', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    const all = partitionEvidence(full, 'ALL_SCENARIOS');

    expect(ab.summary.totalTransactions).toBe(4); // 2 + 2
    expect(cd.summary.totalTransactions).toBe(5); // 3 + 2
    expect(all.summary.totalTransactions).toBe(9); // 4 + 5
  });

  it('5. Scoped transaction hashes match the corresponding originals', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    expect(ab.scenarios.scenarioA?.transactions[0]?.txHash).toBe(full.scenarios.scenarioA?.transactions[0]?.txHash);
    expect(ab.scenarios.scenarioB?.transactions[1]?.txHash).toBe(full.scenarios.scenarioB?.transactions[1]?.txHash);

    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    expect(cd.scenarios.scenarioC?.transactions[0]?.txHash).toBe(full.scenarios.scenarioC?.transactions[0]?.txHash);
    expect(cd.scenarios.scenarioD?.transactions[1]?.txHash).toBe(full.scenarios.scenarioD?.transactions[1]?.txHash);
  });

  it('6. No transaction is invented (no phantom records)', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const abHashes = new Set([
      ...ab.scenarios.scenarioA!.transactions.map((t) => t.txHash),
      ...ab.scenarios.scenarioB!.transactions.map((t) => t.txHash),
    ]);
    const fullHashes = new Set([
      ...full.scenarios.scenarioA!.transactions.map((t) => t.txHash),
      ...full.scenarios.scenarioB!.transactions.map((t) => t.txHash),
    ]);
    expect(abHashes).toEqual(fullHashes);
  });

  it('7. No transaction is accidentally duplicated within an artifact', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const allTxs = [
      ...ab.scenarios.scenarioA!.transactions.map((t) => t.txHash),
      ...ab.scenarios.scenarioB!.transactions.map((t) => t.txHash),
    ];
    const uniqueTxs = new Set(allTxs);
    expect(uniqueTxs.size).toBe(allTxs.length);
  });

  it('8. Combined transaction count equals the sum of the scoped counts', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    const all = partitionEvidence(full, 'ALL_SCENARIOS');

    expect(all.summary.totalTransactions).toBe(ab.summary.totalTransactions + cd.summary.totalTransactions);
  });

  it('9. Execution provenance is consistent across partitioned views', () => {
    const full = createMockFullRecords();
    const ab = partitionEvidence(full, 'SCENARIOS_A_B');
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');

    expect(ab.provenance?.scope).toBe('SCENARIOS_A_B');
    expect(cd.provenance?.scope).toBe('SCENARIOS_C_D');
    expect(ab.contracts.factory).toBe(full.contracts.factory);
    expect(cd.contracts.factory).toBe(full.contracts.factory);
    expect(ab.chainId).toBe(full.chainId);
  });

  it('10. Partial runs cannot silently overwrite the canonical bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'orakl-e2e-test-'));
    try {
      const full = createMockFullRecords();
      // Write initial canonical bundle
      publishEvidenceBundle({ outDir: tmp, records: full, isFullRun: true });
      const initialAll = readFileSync(join(tmp, 'e2e-scenarios.json'), 'utf8');

      // Now attempt a partial run with only A & B
      const partial: EvidenceRecord = {
        ...full,
        scenarios: { scenarioA: full.scenarios.scenarioA, scenarioB: full.scenarios.scenarioB },
        summary: {
          allPassed: true,
          scenariosExecuted: ['Scenario A', 'Scenario B'],
          totalTransactions: 4,
          executedAt: '2026-11-01T00:00:00.000Z',
          verifier: 'scripts/p1/run-e2e-scenarios.mjs',
        },
      };

      const result = publishEvidenceBundle({ outDir: tmp, records: partial, isFullRun: false });
      expect(result.publishedCanonical).toBe(false);
      expect(result.partialPath).toBeDefined();

      // Canonical e2e-scenarios.json must remain unchanged!
      const afterAll = readFileSync(join(tmp, 'e2e-scenarios.json'), 'utf8');
      expect(afterAll).toBe(initialAll);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('11. Interrupted publication is detectable (no orphaned .tmp files accepted)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'orakl-e2e-test-'));
    try {
      // Simulate an abandoned .tmp file from an interrupted process
      writeFileSync(join(tmp, 'e2e-scenarios.json.tmp'), '{"incomplete": true}');
      expect(existsSync(join(tmp, 'e2e-scenarios.json.tmp'))).toBe(true);

      const full = createMockFullRecords();
      // Publishing cleans up any stale tmp files and verifies completed output
      publishEvidenceBundle({ outDir: tmp, records: full, isFullRun: true });
      expect(existsSync(join(tmp, 'e2e-scenarios.json.tmp'))).toBe(false);
      expect(existsSync(join(tmp, 'e2e-scenarios.json'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('12. Invalid or incomplete records cause a nonzero validation failure', () => {
    const invalidRecord: unknown = {
      chainId: 1, // Wrong chain id!
      contracts: {},
      scenarios: {},
      summary: { totalTransactions: 10 }, // Mismatched tx count!
    };
    expect(() => validateEvidenceRecord(invalidRecord as EvidenceRecord, 'ALL_SCENARIOS')).toThrow();
  });

  it('13. Orphaned and canonical transaction evidence in Scenario D retains its distinction', () => {
    const full = createMockFullRecords();
    const cd = partitionEvidence(full, 'SCENARIOS_C_D');
    const txsD = cd.scenarios.scenarioD!.transactions;
    const branch1Tx = txsD.find((t) => t.action.includes('Branch 1'));
    const branch2Tx = txsD.find((t) => t.action.includes('Branch 2'));

    expect(branch1Tx).toBeDefined();
    expect(branch1Tx?.action).toContain('orphaned');
    expect(branch2Tx).toBeDefined();
    expect(branch2Tx?.action).toContain('canonical');
    expect(cd.scenarios.scenarioD!.rollbackAudit).toBeDefined();
    expect(cd.scenarios.scenarioD!.rollbackAudit?.removedBlocks).toBe(12);
  });

  it('14. Deterministically derives scoped A-B (28 txs) and C-D (28 txs) from historical evidence', () => {
    const historicalPath = join(__dirname, '../../docs/p1/evidence/e2e-scenarios.json');
    const raw = readFileSync(historicalPath, 'utf8');
    const historicalComprehensive = JSON.parse(raw);

    const { ab, cd } = deriveHistoricalPartitions(historicalComprehensive);

    // Verify scenario separation
    expect(Object.keys(ab.scenarios)).toEqual(['scenarioA', 'scenarioB']);
    expect(Object.keys(cd.scenarios)).toEqual(['scenarioC', 'scenarioD']);

    // Verify transaction counts
    expect(ab.scenarios.scenarioA?.transactions.length).toBe(14);
    expect(ab.scenarios.scenarioB?.transactions.length).toBe(14);
    expect(ab.summary.totalTransactions).toBe(28);

    expect(cd.scenarios.scenarioC?.transactions.length).toBe(20);
    expect(cd.scenarios.scenarioD?.transactions.length).toBe(8);
    expect(cd.summary.totalTransactions).toBe(28);

    expect(ab.summary.totalTransactions + cd.summary.totalTransactions).toBe(56);
    expect(historicalComprehensive.summary.totalTransactions).toBe(56);

    // Verify provenance metadata
    expect(ab.provenance?.historicalRun).toBe(true);
    expect(ab.provenance?.derivedFrom).toBe('docs/p1/evidence/e2e-scenarios.json');
    expect(ab.provenance?.scope).toBe('SCENARIOS_A_B');
    expect(cd.provenance?.scope).toBe('SCENARIOS_C_D');
  });
});
