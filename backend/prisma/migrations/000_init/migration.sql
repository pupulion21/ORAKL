-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'CLOSED', 'PROPOSED', 'DISPUTED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('UNRESOLVED', 'YES', 'NO', 'INVALID');

-- CreateEnum
CREATE TYPE "BondType" AS ENUM ('CREATION', 'PROPOSAL', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('PAYOUT', 'REFUND', 'BOND_RETURN', 'BOND_SLASH');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('NONE', 'PROPOSED', 'CHALLENGED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SOURCE', 'ATTESTATION', 'ANALYSIS', 'DATASET', 'OTHER');

-- CreateEnum
CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('OPEN', 'REVIEWING', 'DISMISSED', 'ACTIONED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexedBlock" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "parentHash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexedBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexedEvent" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerRollback" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "fromBlock" BIGINT NOT NULL,
    "toBlock" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "removedBlocks" INTEGER NOT NULL,
    "removedEvents" INTEGER NOT NULL,
    "replayedEvents" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexerRollback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "lastProcessedBlock" BIGINT NOT NULL,
    "lastProcessedBlockHash" TEXT NOT NULL,
    "eventsIndexed" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "onchainMarketId" BIGINT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "metadataHash" TEXT NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "question" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "categoryId" TEXT,
    "closeTime" BIGINT NOT NULL,
    "resolutionTime" BIGINT NOT NULL,
    "maxResolutionTime" BIGINT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'OPEN',
    "finalOutcome" "Outcome" NOT NULL DEFAULT 'UNRESOLVED',
    "proposerAddress" TEXT,
    "challengerAddress" TEXT,
    "proposalEvidenceHash" TEXT,
    "challengeEvidenceHash" TEXT,
    "challengeDeadline" BIGINT,
    "createdAtBlock" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPosition" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "yesContribution" BIGINT NOT NULL DEFAULT 0,
    "noContribution" BIGINT NOT NULL DEFAULT 0,
    "claimedAmount" BIGINT NOT NULL DEFAULT 0,
    "refundedAmount" BIGINT NOT NULL DEFAULT 0,
    "updatedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "predictCount" INTEGER NOT NULL DEFAULT 0,
    "updatedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bond" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "bondType" "BondType" NOT NULL,
    "deposited" BIGINT NOT NULL DEFAULT 0,
    "returned" BIGINT NOT NULL DEFAULT 0,
    "slashed" BIGINT NOT NULL DEFAULT 0,
    "updatedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bond_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketActivity" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "amount" BIGINT,
    "side" "Side",
    "outcome" "Outcome",
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "marketId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "amount" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resolution" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "status" "ResolutionStatus" NOT NULL DEFAULT 'NONE',
    "proposerAddress" TEXT,
    "proposedOutcome" "Outcome" NOT NULL DEFAULT 'UNRESOLVED',
    "proposalEvidenceHash" TEXT,
    "proposalBond" BIGINT NOT NULL DEFAULT 0,
    "challengeDeadline" BIGINT,
    "challengerAddress" TEXT,
    "challengeEvidenceHash" TEXT,
    "challengeBond" BIGINT NOT NULL DEFAULT 0,
    "finalOutcome" "Outcome" NOT NULL DEFAULT 'UNRESOLVED',
    "finalizedTxHash" TEXT,
    "finalizedAtBlock" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "challengerAddress" TEXT NOT NULL,
    "evidenceHash" TEXT,
    "bondAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "decision" "Outcome",
    "settledTxHash" TEXT,
    "settledAtBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "publisher" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "source" TEXT,
    "claim" "Outcome",
    "proposedOutcome" "Outcome",
    "contentMediaType" TEXT NOT NULL DEFAULT 'text/plain',
    "txHash" TEXT,
    "logIndex" INTEGER,
    "blockNumber" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSnapshot" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "marketCount" BIGINT NOT NULL,
    "totalContributions" BIGINT NOT NULL,
    "totalParticipantPaid" BIGINT NOT NULL,
    "totalFeesAccrued" BIGINT NOT NULL,
    "totalFeesWithdrawn" BIGINT NOT NULL,
    "totalBondsDeposited" BIGINT NOT NULL,
    "totalBondsPaid" BIGINT NOT NULL,
    "bondLiability" BIGINT NOT NULL,
    "feeLiability" BIGINT NOT NULL,
    "participantLiability" BIGINT NOT NULL,
    "totalUnresolvedExposure" BIGINT NOT NULL,
    "unaccountedBalance" BIGINT NOT NULL,
    "contractBalance" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDeployment" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "factoryAddress" TEXT NOT NULL,
    "protocolConfigAddress" TEXT NOT NULL,
    "roleMockAddress" TEXT,
    "startBlock" BIGINT NOT NULL,
    "manifestPath" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "status" "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationReport" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "reporterAddress" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedBlock_blockNumber_key" ON "IndexedBlock"("blockNumber");

-- CreateIndex
CREATE INDEX "IndexedBlock_chainId_blockNumber_idx" ON "IndexedBlock"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedBlock_chainId_blockHash_key" ON "IndexedBlock"("chainId", "blockHash");

-- CreateIndex
CREATE INDEX "IndexedEvent_chainId_eventName_blockNumber_idx" ON "IndexedEvent"("chainId", "eventName", "blockNumber");

-- CreateIndex
CREATE INDEX "IndexedEvent_chainId_blockNumber_logIndex_idx" ON "IndexedEvent"("chainId", "blockNumber", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedEvent_chainId_txHash_logIndex_key" ON "IndexedEvent"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "IndexerRollback_chainId_detectedAt_idx" ON "IndexerRollback"("chainId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCheckpoint_chainId_key" ON "IndexerCheckpoint"("chainId");

-- CreateIndex
CREATE INDEX "IndexerCheckpoint_chainId_idx" ON "IndexerCheckpoint"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_onchainMarketId_key" ON "Market"("onchainMarketId");

-- CreateIndex
CREATE INDEX "Market_chainId_status_idx" ON "Market"("chainId", "status");

-- CreateIndex
CREATE INDEX "Market_closeTime_idx" ON "Market"("closeTime");

-- CreateIndex
CREATE INDEX "Market_creatorAddress_idx" ON "Market"("creatorAddress");

-- CreateIndex
CREATE INDEX "MarketPosition_walletAddress_idx" ON "MarketPosition"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPosition_marketId_walletAddress_key" ON "MarketPosition"("marketId", "walletAddress");

-- CreateIndex
CREATE INDEX "Contribution_marketId_side_idx" ON "Contribution"("marketId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_marketId_walletAddress_side_key" ON "Contribution"("marketId", "walletAddress", "side");

-- CreateIndex
CREATE INDEX "Bond_walletAddress_bondType_idx" ON "Bond"("walletAddress", "bondType");

-- CreateIndex
CREATE UNIQUE INDEX "Bond_marketId_walletAddress_bondType_key" ON "Bond"("marketId", "walletAddress", "bondType");

-- CreateIndex
CREATE INDEX "Claim_walletAddress_claimType_idx" ON "Claim"("walletAddress", "claimType");

-- CreateIndex
CREATE INDEX "Claim_marketId_idx" ON "Claim"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_txHash_logIndex_key" ON "Claim"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "MarketActivity_marketId_blockNumber_logIndex_idx" ON "MarketActivity"("marketId", "blockNumber", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MarketActivity_txHash_logIndex_key" ON "MarketActivity"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "Prediction_walletAddress_idx" ON "Prediction"("walletAddress");

-- CreateIndex
CREATE INDEX "Prediction_marketId_blockNumber_idx" ON "Prediction"("marketId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_chainId_txHash_logIndex_key" ON "Prediction"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Resolution_marketId_key" ON "Resolution"("marketId");

-- CreateIndex
CREATE INDEX "Dispute_marketId_status_idx" ON "Dispute"("marketId", "status");

-- CreateIndex
CREATE INDEX "Dispute_challengerAddress_idx" ON "Dispute"("challengerAddress");

-- CreateIndex
CREATE INDEX "EvidenceRecord_evidenceHash_idx" ON "EvidenceRecord"("evidenceHash");

-- CreateIndex
CREATE INDEX "EvidenceRecord_publisher_idx" ON "EvidenceRecord"("publisher");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_marketId_evidenceHash_key" ON "EvidenceRecord"("marketId", "evidenceHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSnapshot_blockNumber_key" ON "AccountingSnapshot"("blockNumber");

-- CreateIndex
CREATE INDEX "AccountingSnapshot_chainId_blockNumber_idx" ON "AccountingSnapshot"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "ContractDeployment_chainId_status_idx" ON "ContractDeployment"("chainId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDeployment_chainId_factoryAddress_manifestSha256_key" ON "ContractDeployment"("chainId", "factoryAddress", "manifestSha256");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_walletAddress_idx" ON "AuthNonce"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_walletAddress_status_idx" ON "AuthSession"("walletAddress", "status");

-- CreateIndex
CREATE INDEX "ModerationReport_marketId_status_idx" ON "ModerationReport"("marketId", "status");

-- AddForeignKey
ALTER TABLE "IndexedEvent" ADD CONSTRAINT "IndexedEvent_blockNumber_fkey" FOREIGN KEY ("blockNumber") REFERENCES "IndexedBlock"("blockNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_creatorAddress_fkey" FOREIGN KEY ("creatorAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPosition" ADD CONSTRAINT "MarketPosition_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPosition" ADD CONSTRAINT "MarketPosition_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bond" ADD CONSTRAINT "Bond_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bond" ADD CONSTRAINT "Bond_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketActivity" ADD CONSTRAINT "MarketActivity_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketActivity" ADD CONSTRAINT "MarketActivity_actor_fkey" FOREIGN KEY ("actor") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthNonce" ADD CONSTRAINT "AuthNonce_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reporterAddress_fkey" FOREIGN KEY ("reporterAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

