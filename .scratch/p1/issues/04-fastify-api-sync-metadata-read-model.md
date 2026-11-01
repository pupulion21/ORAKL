# TICKET-04: Fastify API Synchronization Metadata and Read Model Freshness

- **Ticket ID**: `ORAKL-TICKET-04`
- **Work Package**: `WP-03` (Fastify API Standardization & Security Hardening)
- **Relevant ADRs**: [ADR-0001](file:///home/pupulion/orakl/docs/adr/0001-postgresql-numeric-uint256.md), [ADR-0007](file:///home/pupulion/orakl/docs/adr/0007-api-freshness-and-reorg-metadata.md)
- **Status**: `ready-for-agent`

---

### 1. Current Implementation Status
Partially implemented. Fastify server in [`backend/src/api/server.ts`](file:///home/pupulion/orakl/backend/src/api/server.ts) serves direct PostgreSQL queries for 18 endpoints, but market read models (`GET /api/v1/markets`, `GET /api/v1/markets/:id`, `GET /api/v1/markets/:id/activity`, etc.) omit explicit block synchronization metadata properties mandated by ADR-0007.

### 2. Exact Files / Modules Affected
- `backend/src/api/server.ts`
- `backend/src/lib/format.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Update API response envelope helper `ok(data, sync?)` to attach block synchronization metadata:
    ```typescript
    {
      simulationOnly: true,
      sync: {
        lastProcessedBlock: string;
        lastProcessedBlockHash: string;
        chainId: number;
      },
      data: serialize(data)
    }
    ```
  - Fetch latest `IndexerCheckpoint` in read handlers (or inject from checkpoint cache) to annotate responses.
  - Ensure all EVM `uint256` quantities in returned data remain strictly formatted as base-10 unsigned decimal strings (ADR-0001).
  - Enforce strict pagination limits (`pageSize <= 100`, default `20`) on all collection routes.
- **Explicit Non-Goals**:
  - Do NOT implement an in-memory Redis or response caching layer (prohibited by ADR-0007).
  - Do NOT allow client-side modification of synchronization headers.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-01 (Database Migration Deployment and Schema Validation), TICKET-02 (Indexer Event Projection and INVALID Settlement Fixes).
- **Gates**: TICKET-05, TICKET-06, TICKET-07.

### 5. Testable Acceptance Criteria
- [ ] `GET /api/v1/markets` includes `sync.lastProcessedBlock`, `sync.lastProcessedBlockHash`, and `sync.chainId` in response JSON.
- [ ] `GET /api/v1/markets/:id` includes exact synchronization metadata matching the latest checkpoint.
- [ ] All numeric fields in JSON responses match regular expression `/^(0|[1-9]\d*)$/`.
- [ ] Querying `pageSize=1000` is clamped to maximum allowed limit (100).

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
