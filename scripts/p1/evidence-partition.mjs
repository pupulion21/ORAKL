/**
 * ORAKL P1 — E2E Scenario Evidence Partitioning & Safe Publishing Helper
 *
 * Scope: Isolated local Anvil simulation (Chain ID 31337).
 *
 * Provides deterministic partitioning of E2E verification results into:
 *   - Comprehensive (ALL_SCENARIOS): full A-D execution
 *   - Scoped A-B (SCENARIOS_A_B): strictly Scenarios A & B
 *   - Scoped C-D (SCENARIOS_C_D): strictly Scenarios C & D
 *
 * Guarantees:
 *   1. Zero synthetic or fabricated transaction receipts.
 *   2. Derived summary counts equal actual filtered transactions.
 *   3. Partial runs cannot silently overwrite the canonical 3-artifact bundle.
 *   4. Two-phase write (tmp -> validate -> rename) prevents interrupted corruptions.
 *   5. Explicit provenance tracking references exact execution or historical source.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export const LOCAL_CHAIN_ID = 31337;

/**
 * @typedef {Object} TransactionRecord
 * @property {number} step
 * @property {string} action
 * @property {string} txHash
 * @property {number} blockNumber
 * @property {string} gasUsed
 * @property {string} status
 */

/**
 * @typedef {Object} ScenarioRecord
 * @property {string} status
 * @property {string} marketId
 * @property {number} totalTransactions
 * @property {TransactionRecord[]} transactions
 * @property {Array<{step: number, action: string}>} steps
 * @property {Record<string, unknown>} [reconciliation]
 * @property {{removedBlocks: number, removedEvents: number, replayedEvents: number}} [rollbackAudit]
 * @property {Record<string, unknown>} [canonicalState]
 */

/**
 * @typedef {Object} EvidenceRecord
 * @property {string} timestamp
 * @property {number} chainId
 * @property {Record<string, string>} contracts
 * @property {Record<string, ScenarioRecord>} scenarios
 * @property {{
 *   allPassed: boolean,
 *   scenariosExecuted: string[],
 *   totalTransactions: number,
 *   executedAt: string,
 *   verifier: string,
 *   scope?: string,
 * }} summary
 * @property {{
 *   scope?: string,
 *   derivedFrom?: string,
 *   sourceSha256?: string,
 *   historicalRun?: boolean,
 *   executedAt?: string,
 * }} [provenance]
 */

/**
 * Calculate SHA-256 digest of a string or buffer.
 * @param {string | Buffer} content
 * @returns {string} hex digest
 */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Validate an evidence record for schema and transaction count consistency.
 * @param {EvidenceRecord} record
 * @param {'ALL_SCENARIOS' | 'SCENARIOS_A_B' | 'SCENARIOS_C_D'} [expectedScope]
 */
export function validateEvidenceRecord(record, expectedScope) {
  if (!record || typeof record !== 'object') {
    throw new Error('Evidence record must be a non-null object');
  }
  if (record.chainId !== LOCAL_CHAIN_ID) {
    throw new Error(`Invalid chainId: ${record.chainId} (expected ${LOCAL_CHAIN_ID})`);
  }
  if (!record.contracts || !record.contracts.factory || !record.contracts.config) {
    throw new Error('Evidence record missing contracts configuration');
  }
  if (!record.scenarios || typeof record.scenarios !== 'object') {
    throw new Error('Evidence record missing scenarios object');
  }
  if (!record.summary || typeof record.summary !== 'object') {
    throw new Error('Evidence record missing summary object');
  }

  const scenarioKeys = Object.keys(record.scenarios);
  if (expectedScope === 'SCENARIOS_A_B') {
    if (record.scenarios.scenarioC || record.scenarios.scenarioD) {
      throw new Error('SCENARIOS_A_B artifact must not contain Scenario C or D');
    }
  } else if (expectedScope === 'SCENARIOS_C_D') {
    if (record.scenarios.scenarioA || record.scenarios.scenarioB) {
      throw new Error('SCENARIOS_C_D artifact must not contain Scenario A or B');
    }
  }

  let derivedTxCount = 0;
  for (const key of scenarioKeys) {
    const sc = record.scenarios[key];
    if (!sc || !Array.isArray(sc.transactions)) {
      throw new Error(`Scenario ${key} missing transactions array`);
    }
    if (sc.totalTransactions !== sc.transactions.length) {
      throw new Error(`Scenario ${key} totalTransactions (${sc.totalTransactions}) != tx length (${sc.transactions.length})`);
    }
    derivedTxCount += sc.transactions.length;

    // Verify transaction fields and duplicate detection
    const txHashes = new Set();
    for (const tx of sc.transactions) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx.txHash)) {
        throw new Error(`Invalid txHash in scenario ${key}: ${tx.txHash}`);
      }
      if (txHashes.has(tx.txHash)) {
        throw new Error(`Duplicate transaction ${tx.txHash} detected in scenario ${key}`);
      }
      txHashes.add(tx.txHash);
    }
  }

  if (record.summary.totalTransactions !== derivedTxCount) {
    throw new Error(
      `Summary totalTransactions (${record.summary.totalTransactions}) does not match sum of scenario transactions (${derivedTxCount})`,
    );
  }

  return true;
}

/**
 * Filter and partition an evidence record into a specific scope.
 *
 * @param {EvidenceRecord} records
 * @param {'ALL_SCENARIOS' | 'SCENARIOS_A_B' | 'SCENARIOS_C_D'} scope
 * @param {{provenance?: Record<string, unknown>}} [options]
 * @returns {EvidenceRecord}
 */
export function partitionEvidence(records, scope, options = {}) {
  const allowedScenarios =
    scope === 'SCENARIOS_A_B'
      ? ['scenarioA', 'scenarioB']
      : scope === 'SCENARIOS_C_D'
        ? ['scenarioC', 'scenarioD']
        : ['scenarioA', 'scenarioB', 'scenarioC', 'scenarioD'];

  const filteredScenarios = {};
  const executedNames = [];
  let allPassed = true;
  let totalTxs = 0;

  for (const key of allowedScenarios) {
    if (records.scenarios && records.scenarios[key]) {
      const sc = records.scenarios[key];
      filteredScenarios[key] = sc;
      executedNames.push(
        key === 'scenarioA'
          ? 'Scenario A'
          : key === 'scenarioB'
            ? 'Scenario B'
            : key === 'scenarioC'
              ? 'Scenario C'
              : 'Scenario D',
      );
      if (sc.status !== 'PASSED') allPassed = false;
      totalTxs += sc.transactions ? sc.transactions.length : (sc.totalTransactions ?? 0);
    }
  }

  const partitioned = {
    timestamp: records.timestamp,
    chainId: records.chainId,
    contracts: { ...records.contracts },
    scenarios: filteredScenarios,
    summary: {
      allPassed,
      scenariosExecuted: executedNames,
      totalTransactions: totalTxs,
      scope,
      executedAt: records.summary?.executedAt ?? records.timestamp,
      verifier: records.summary?.verifier ?? 'scripts/p1/run-e2e-scenarios.mjs',
    },
    provenance: {
      scope,
      ...(options.provenance ?? {}),
    },
  };

  validateEvidenceRecord(partitioned, scope);
  return partitioned;
}

/**
 * Safely write a file using temporary file and atomic rename.
 * @param {string} targetPath
 * @param {string} content
 */
function safeWriteFile(targetPath, content) {
  const tmpPath = `${targetPath}.tmp`;
  if (existsSync(tmpPath)) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
  writeFileSync(tmpPath, content, 'utf8');
  // Verify readability before rename
  const readBack = readFileSync(tmpPath, 'utf8');
  if (readBack.length !== content.length) {
    throw new Error(`Write verification failed for ${tmpPath}`);
  }
  renameSync(tmpPath, targetPath);
}

/**
 * Publish an evidence bundle.
 * If full run (A-D), writes canonical e2e-scenarios.json, e2e-scenarios-a-b.json, and e2e-scenarios-c-d.json.
 * If partial run, saves to a partial-scoped location to protect the canonical bundle.
 *
 * @param {{
 *   outDir: string,
 *   records: EvidenceRecord,
 *   isFullRun: boolean,
 *   options?: { forcePartialPublish?: boolean }
 * }} params
 * @returns {{
 *   publishedCanonical: boolean,
 *   canonicalArtifacts?: Array<{ file: string, sha256: string, bytes: number }>,
 *   partialPath?: string,
 * }}
 */
export function publishEvidenceBundle({ outDir, records, isFullRun, options = {} }) {
  mkdirSync(outDir, { recursive: true });

  if (isFullRun) {
    const all = partitionEvidence(records, 'ALL_SCENARIOS');
    const ab = partitionEvidence(records, 'SCENARIOS_A_B');
    const cd = partitionEvidence(records, 'SCENARIOS_C_D');

    const allContent = `${JSON.stringify(all, null, 2)}\n`;
    const abContent = `${JSON.stringify(ab, null, 2)}\n`;
    const cdContent = `${JSON.stringify(cd, null, 2)}\n`;

    const allPath = join(outDir, 'e2e-scenarios.json');
    const abPath = join(outDir, 'e2e-scenarios-a-b.json');
    const cdPath = join(outDir, 'e2e-scenarios-c-d.json');

    safeWriteFile(allPath, allContent);
    safeWriteFile(abPath, abContent);
    safeWriteFile(cdPath, cdContent);

    return {
      publishedCanonical: true,
      canonicalArtifacts: [
        { file: 'e2e-scenarios.json', sha256: sha256(allContent), bytes: Buffer.byteLength(allContent) },
        { file: 'e2e-scenarios-a-b.json', sha256: sha256(abContent), bytes: Buffer.byteLength(abContent) },
        { file: 'e2e-scenarios-c-d.json', sha256: sha256(cdContent), bytes: Buffer.byteLength(cdContent) },
      ],
    };
  }

  // Partial run protection
  const partialDir = join(outDir, 'partial');
  mkdirSync(partialDir, { recursive: true });
  const partialContent = `${JSON.stringify(records, null, 2)}\n`;
  const partialPath = join(partialDir, 'e2e-scenarios-partial.json');
  safeWriteFile(partialPath, partialContent);

  return {
    publishedCanonical: false,
    partialPath,
  };
}

/**
 * Deterministically derive scoped A-B and C-D records from the historical
 * comprehensive artifact without altering any original transaction data.
 *
 * @param {EvidenceRecord} comprehensiveArtifact
 * @returns {{ ab: EvidenceRecord, cd: EvidenceRecord }}
 */
export function deriveHistoricalPartitions(comprehensiveArtifact) {
  validateEvidenceRecord(comprehensiveArtifact, 'ALL_SCENARIOS');
  const sourceHash = sha256(JSON.stringify(comprehensiveArtifact, null, 2) + '\n');

  const ab = partitionEvidence(comprehensiveArtifact, 'SCENARIOS_A_B', {
    provenance: {
      historicalRun: true,
      derivedFrom: 'docs/p1/evidence/e2e-scenarios.json',
      sourceSha256: sourceHash,
      executedAt: comprehensiveArtifact.summary.executedAt,
    },
  });

  const cd = partitionEvidence(comprehensiveArtifact, 'SCENARIOS_C_D', {
    provenance: {
      historicalRun: true,
      derivedFrom: 'docs/p1/evidence/e2e-scenarios.json',
      sourceSha256: sourceHash,
      executedAt: comprehensiveArtifact.summary.executedAt,
    },
  });

  return { ab, cd };
}
