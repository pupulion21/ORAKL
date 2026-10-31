-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "decisionEvidenceHash" TEXT,
ADD COLUMN     "refundable" BOOLEAN,
ADD COLUMN     "totalChallengeStake" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ChallengeStake" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "prefixBefore" BIGINT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeStake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSettlement" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'NONE',
    "totalChallengeStake" BIGINT NOT NULL DEFAULT 0,
    "proposalBond" BIGINT NOT NULL DEFAULT 0,
    "refundable" BOOLEAN NOT NULL DEFAULT false,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExposureSnapshot" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "marketId" TEXT NOT NULL,
    "arbitrator" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExposureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolFeeAccrual" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "marketId" TEXT,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'accrued',
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolFeeAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRecord" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT,
    "value" BIGINT NOT NULL,
    "gasUsed" BIGINT NOT NULL,
    "status" INTEGER NOT NULL,
    "kind" TEXT,
    "contractAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceVerification" (
    "id" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,
    "availabilityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "observer" TEXT NOT NULL DEFAULT 'backend-local',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "EvidenceVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "manifestBytes" BYTEA NOT NULL,
    "contentBytes" BYTEA NOT NULL,
    "contentSize" INTEGER NOT NULL,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeStake_walletAddress_idx" ON "ChallengeStake"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeStake_marketId_walletAddress_key" ON "ChallengeStake"("marketId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeStake_chainId_txHash_logIndex_key" ON "ChallengeStake"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSettlement_marketId_key" ON "MarketSettlement"("marketId");

-- CreateIndex
CREATE INDEX "ExposureSnapshot_marketId_idx" ON "ExposureSnapshot"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "ExposureSnapshot_chainId_txHash_logIndex_key" ON "ExposureSnapshot"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "ProtocolFeeAccrual_marketId_idx" ON "ProtocolFeeAccrual"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolFeeAccrual_chainId_txHash_logIndex_key" ON "ProtocolFeeAccrual"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionRecord_txHash_key" ON "TransactionRecord"("txHash");

-- CreateIndex
CREATE INDEX "TransactionRecord_chainId_blockNumber_idx" ON "TransactionRecord"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "TransactionRecord_fromAddress_idx" ON "TransactionRecord"("fromAddress");

-- CreateIndex
CREATE INDEX "EvidenceVerification_evidenceRecordId_idx" ON "EvidenceVerification"("evidenceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_commitment_key" ON "EvidenceArtifact"("commitment");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_manifestSha256_key" ON "EvidenceArtifact"("manifestSha256");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_contentSha256_idx" ON "EvidenceArtifact"("contentSha256");

-- AddForeignKey
ALTER TABLE "ChallengeStake" ADD CONSTRAINT "ChallengeStake_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeStake" ADD CONSTRAINT "ChallengeStake_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlement" ADD CONSTRAINT "MarketSettlement_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExposureSnapshot" ADD CONSTRAINT "ExposureSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolFeeAccrual" ADD CONSTRAINT "ProtocolFeeAccrual_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceVerification" ADD CONSTRAINT "EvidenceVerification_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
