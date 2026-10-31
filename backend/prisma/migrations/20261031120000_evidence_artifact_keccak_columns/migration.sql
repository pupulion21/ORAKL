-- ORAKL P1 — rename EvidenceArtifact SHA256 columns to Keccak-256 (ADR-0003 & ADR-0010).
-- LOCAL SIMULATION ONLY.

ALTER TABLE "EvidenceArtifact" RENAME COLUMN "manifestSha256" TO "manifestKeccak";
ALTER TABLE "EvidenceArtifact" RENAME COLUMN "contentSha256" TO "contentKeccak";

ALTER INDEX "EvidenceArtifact_manifestSha256_key" RENAME TO "EvidenceArtifact_manifestKeccak_key";
ALTER INDEX "EvidenceArtifact_contentSha256_idx" RENAME TO "EvidenceArtifact_contentKeccak_idx";

DROP INDEX IF EXISTS "IndexedBlock_chainId_blockNumber_idx";
CREATE INDEX IF NOT EXISTS "IndexedBlock_chainId_idx" ON "IndexedBlock"("chainId");
