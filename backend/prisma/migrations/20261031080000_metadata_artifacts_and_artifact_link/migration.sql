-- ORAKL P1 — market metadata discovery artifacts + evidence artifact link columns.
-- LOCAL SIMULATION ONLY (isolated Anvil chain 31337).

CREATE TABLE "MarketMetadata" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "commitment" TEXT NOT NULL,
    "uriKeccak" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "question" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "categorySlug" TEXT,
    "resolutionCriteria" TEXT,
    "evidenceSources" JSONB,
    "formData" JSONB NOT NULL,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketMetadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketMetadata_commitment_key" ON "MarketMetadata"("commitment");
CREATE UNIQUE INDEX "MarketMetadata_uriKeccak_key" ON "MarketMetadata"("uriKeccak");
CREATE INDEX "MarketMetadata_chainId_commitment_idx" ON "MarketMetadata"("chainId", "commitment");

ALTER TABLE "EvidenceArtifact" ADD COLUMN     "chainId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EvidenceArtifact" ADD COLUMN     "marketOnchainId" TEXT;
ALTER TABLE "EvidenceArtifact" ADD COLUMN     "linkedEventTx" TEXT;
ALTER TABLE "EvidenceArtifact" ADD COLUMN     "linkedEventLogIndex" INTEGER;

CREATE INDEX "EvidenceArtifact_chainId_marketOnchainId_idx" ON "EvidenceArtifact"("chainId", "marketOnchainId");
