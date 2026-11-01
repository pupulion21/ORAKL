export interface TransactionRecord {
  step: number;
  action: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  status: string;
}

export interface ScenarioRecord {
  status: string;
  marketId: string;
  totalTransactions: number;
  transactions: TransactionRecord[];
  steps: Array<{ step: number; action: string }>;
  reconciliation?: Record<string, unknown>;
  rollbackAudit?: { removedBlocks: number; removedEvents: number; replayedEvents: number };
  canonicalState?: Record<string, unknown>;
}

export interface EvidenceRecord {
  timestamp: string;
  chainId: number;
  contracts: {
    factory: string;
    config: string;
    arbitrator?: string;
    compliance?: string;
    governance?: string;
    [key: string]: string | undefined;
  };
  scenarios: Record<string, ScenarioRecord | undefined>;
  summary: {
    allPassed: boolean;
    scenariosExecuted: string[];
    totalTransactions: number;
    executedAt: string;
    verifier: string;
    scope?: string;
  };
  provenance?: {
    scope?: string;
    derivedFrom?: string;
    sourceSha256?: string;
    historicalRun?: boolean;
    executedAt?: string;
  };
}

export function sha256(content: string | Buffer): string;

export function validateEvidenceRecord(
  record: EvidenceRecord,
  expectedScope?: 'ALL_SCENARIOS' | 'SCENARIOS_A_B' | 'SCENARIOS_C_D',
): boolean;

export function partitionEvidence(
  records: EvidenceRecord,
  scope: 'ALL_SCENARIOS' | 'SCENARIOS_A_B' | 'SCENARIOS_C_D',
  options?: { provenance?: Record<string, unknown> },
): EvidenceRecord;

export function publishEvidenceBundle(params: {
  outDir: string;
  records: EvidenceRecord;
  isFullRun: boolean;
  options?: { forcePartialPublish?: boolean };
}): {
  publishedCanonical: boolean;
  canonicalArtifacts?: Array<{ file: string; sha256: string; bytes: number }>;
  partialPath?: string;
};

export function deriveHistoricalPartitions(comprehensiveArtifact: EvidenceRecord): {
  ab: EvidenceRecord;
  cd: EvidenceRecord;
};
