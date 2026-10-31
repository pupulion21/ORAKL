-- ORAKL P1: Support EVM uint256 / wei quantities (> 9.22 ether) without bigint overflow.
-- PostgreSQL BIGINT is signed 64-bit (-9.22e18 to +9.22e18), which overflows at 10 ether (proposalBond).
-- NUMERIC(78, 0) provides exact integer precision up to 2^256-1 with zero overflow.

ALTER TABLE "Bond" ALTER COLUMN "deposited" TYPE NUMERIC(78, 0);
ALTER TABLE "Bond" ALTER COLUMN "returned" TYPE NUMERIC(78, 0);
ALTER TABLE "Bond" ALTER COLUMN "slashed" TYPE NUMERIC(78, 0);
ALTER TABLE "Market" ALTER COLUMN "totalChallengeStake" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketPosition" ALTER COLUMN "yesContribution" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketPosition" ALTER COLUMN "noContribution" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketPosition" ALTER COLUMN "claimedAmount" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketPosition" ALTER COLUMN "refundedAmount" TYPE NUMERIC(78, 0);
ALTER TABLE "Contribution" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "Claim" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketActivity" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "Prediction" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "Resolution" ALTER COLUMN "proposalBond" TYPE NUMERIC(78, 0);
ALTER TABLE "Resolution" ALTER COLUMN "challengeBond" TYPE NUMERIC(78, 0);
ALTER TABLE "Dispute" ALTER COLUMN "bondAmount" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalContributions" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalParticipantPaid" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalFeesAccrued" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalFeesWithdrawn" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalBondsDeposited" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalBondsPaid" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "bondLiability" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "feeLiability" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "participantLiability" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "totalUnresolvedExposure" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "unaccountedBalance" TYPE NUMERIC(78, 0);
ALTER TABLE "AccountingSnapshot" ALTER COLUMN "contractBalance" TYPE NUMERIC(78, 0);
ALTER TABLE "ChallengeStake" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "ChallengeStake" ALTER COLUMN "prefixBefore" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketSettlement" ALTER COLUMN "totalChallengeStake" TYPE NUMERIC(78, 0);
ALTER TABLE "MarketSettlement" ALTER COLUMN "proposalBond" TYPE NUMERIC(78, 0);
ALTER TABLE "ExposureSnapshot" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "ProtocolFeeAccrual" ALTER COLUMN "amount" TYPE NUMERIC(78, 0);
ALTER TABLE "TransactionRecord" ALTER COLUMN "value" TYPE NUMERIC(78, 0);
ALTER TABLE "TransactionRecord" ALTER COLUMN "gasUsed" TYPE NUMERIC(78, 0);
