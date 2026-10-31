# Direct Database Read Model with Block Synchronization Metadata

To ensure frontend clients and consumers never read stale projections during or immediately after blockchain reorganizations, the Fastify API serves responses directly from PostgreSQL tables without an in-memory caching layer. All market and ledger read payloads include explicit synchronization metadata (`lastProcessedBlock`, `lastProcessedBlockHash`, `chainId`) enabling client-side staleness detection and safe cache invalidation.
