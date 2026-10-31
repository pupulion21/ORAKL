-- The predecessor used the wrong source table (its IF EXISTS swallowed the
-- error). The stray FK lives on IndexedEvent; after it is gone the singleton
-- unique that propped it up can finally be dropped. Schema truth: exactly
-- (chainId, blockNumber) and (chainId, blockHash) are unique on IndexedBlock.
ALTER TABLE "IndexedEvent"
    DROP CONSTRAINT IF EXISTS "IndexedEvent_blockNumber_fkey";

DROP INDEX IF EXISTS "IndexedBlock_blockNumber_key";
