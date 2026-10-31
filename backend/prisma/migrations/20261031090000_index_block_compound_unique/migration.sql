-- ORAKL P1 — IndexedBlock compound identity patch.
--
-- Drift found by the REAL indexer integration suite: the deployed schema
-- carried only a singleton UNIQUE(blockNumber) plus a plain composite btree,
-- so `IndexedBlock.upsert({ where: { chainId_blockNumber } })` failed with
-- Postgres 42P10 (no matching ON CONFLICT target) and no ingest could commit.
-- The stray singleton unique also propped up an accidental FK from
-- IndexedEvent.blockNumber → IndexedBlock.blockNumber; that FK has no Prisma
-- schema equivalent and must not gate block pruning on the event layer.
ALTER TABLE "IndexedBlock"
    DROP CONSTRAINT IF EXISTS "IndexedEvent_blockNumber_fkey";

ALTER TABLE "IndexedBlock"
    DROP CONSTRAINT IF EXISTS "IndexedBlock_blockNumber_key";

CREATE UNIQUE INDEX IF NOT EXISTS "IndexedBlock_chainId_blockNumber_key"
    ON "IndexedBlock"("chainId", "blockNumber");
