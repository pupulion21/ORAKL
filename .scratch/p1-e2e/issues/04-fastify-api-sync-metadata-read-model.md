# TICKET-04: Fastify API Synchronization Metadata and Read Model Freshness

- **Ticket ID**: `ORAKL-TICKET-04`
- **Work Package**: `WP-03` (Fastify API Standardization & Security Hardening)
- **Relevant ADRs**: [ADR-0001](file:///home/pupulion/orakl/docs/adr/0001-postgresql-numeric-uint256.md), [ADR-0007](file:///home/pupulion/orakl/docs/adr/0007-api-freshness-and-reorg-metadata.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved and verified. Fastify server in [`backend/src/api/server.ts`](file:///home/pupulion/orakl/backend/src/api/server.ts) serves direct PostgreSQL queries for all endpoints with full block synchronization metadata (`lastProcessedBlock`, `lastProcessedBlockHash`, `chainId`, `status`, `updatedAt`, `referenceHead`, `lag`) derived from persisted indexer checkpoints per ADR-0007. Financial quantities are strictly formatted as base-10 unsigned decimal strings without scientific notation per ADR-0001.

### 2. Exact Files / Modules Affected
- `backend/src/api/server.ts`
- `backend/src/lib/format.ts`
- `backend/src/db.ts`
- `backend/test/api-sync.test.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Implemented `getSyncMetadata(prisma, chainId, getReferenceHead)` with 3-state evaluation: `SYNCHRONIZED`, `LAGGING`, and `UNAVAILABLE`.
  - Updated API response envelope helper `ok(data, sync?)` to attach block synchronization metadata across all 10 read endpoints:
    ```typescript
    {
      simulationOnly: true,
      sync: {
        lastProcessedBlock: string;
        lastProcessedBlockHash: string;
        chainId: number;
        status: "SYNCHRONIZED" | "LAGGING" | "UNAVAILABLE";
        updatedAt: string | null;
        referenceHead: string | null;
        lag: string | null;
      },
      data: serialize(data)
    }
    ```
  - Fixed `toBigInt` in `backend/src/db.ts` and `transform` in `backend/src/lib/format.ts` to call `.toFixed()` on Prisma Decimals, preventing scientific notation (`1e+50`) on uint256 quantities.
  - Enforced strict pagination limits (`pageSize <= 100`, default `20`) on all collection routes.
  - Enforced `x-chain-id` header validation hook rejecting foreign chain IDs with 400 `WRONG_CHAIN`.
  - Incomplete projection responses return clean `null` and `[]` values without 500 crashes.
- **Explicit Non-Goals**:
  - No in-memory Redis or response caching layer (strictly prohibited by ADR-0007).
  - No client-side modification of synchronization headers.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-01 (Database Migration Deployment and Schema Validation), TICKET-02 (Indexer Event Projection and INVALID Settlement Fixes).
- **Gates**: TICKET-05, TICKET-06, TICKET-07.

### 5. Testable Acceptance Criteria
- [x] `GET /api/v1/markets` includes `sync.lastProcessedBlock`, `sync.lastProcessedBlockHash`, and `sync.chainId` in response JSON.
- [x] `GET /api/v1/markets/:id` includes exact synchronization metadata matching the latest checkpoint.
- [x] All numeric fields in JSON responses match regular expression `/^(0|[1-9]\d*)$/`.
- [x] Querying `pageSize=1000` is clamped to maximum allowed limit (100).
- [x] `x-chain-id` header mismatch is rejected with 400 `WRONG_CHAIN`.
- [x] Read model freshness accurately differentiates `SYNCHRONIZED`, `LAGGING`, and `UNAVAILABLE` without fabricating metadata.

### 6. Required Tests and Verification Commands
- `npm --prefix backend test -- test/api-sync.test.ts` (11/11 passed)
- `npm --prefix backend test` (41/41 passed across all 4 suites)
- `cd backend && npx tsc --noEmit` (0 errors)
- `npm --prefix frontend test` (52/52 passed)

### 6. Required Tests and Verification Commands
```bash
cd backend
npm run api &
API_PID=$!
sleep 2
curl -s http://127.0.0.1:4310/api/v1/markets | jq '.sync'
curl -s http://127.0.0.1:4310/api/v1/indexer/status | jq '.checkpoint'
kill $API_PID
```

### 7. Expected Evidence Artifacts
- JSON response samples showing the `sync` block metadata.
- Unit assertion confirming base-10 string serialization for all uint256 columns.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: Checkpoint lookup adds a fast single-row DB index read; if it impacts latency, read checkpoint from shared memory updated on indexer tick.
