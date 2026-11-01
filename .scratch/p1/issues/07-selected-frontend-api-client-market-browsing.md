# TICKET-07: Selected Frontend API Client and Market Browsing Integration

- **Ticket ID**: `ORAKL-TICKET-07`
- **Work Package**: `WP-05` (Selected Frontend API Integration)
- **Relevant ADRs**: [ADR-0007](file:///home/pupulion/orakl/docs/adr/0007-api-freshness-and-reorg-metadata.md), [ADR-0009](file:///home/pupulion/orakl/docs/adr/0009-environment-segregation-legacy-preservation.md)
- **Status**: `ready-for-agent`

---

### 1. Current Implementation Status
Partially implemented. In [`frontend/src/local/main.ts`](file:///home/pupulion/orakl/frontend/src/local/main.ts), the UI reads state directly from the local Anvil RPC via Viem `readContract`. It does not yet connect to the Fastify API endpoints for indexed market browsing, category filtering, or block synchronization tracking.

### 2. Exact Files / Modules Affected
- `frontend/src/selected/api-client.ts` (new module)
- `frontend/src/local/main.ts`
- `frontend/src/local/config.ts`
- `frontend/test/selected-api-client.test.ts` (new test)

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Implement type-safe HTTP client in `frontend/src/selected/api-client.ts` interfacing with:
    - `GET /api/v1/markets` (with status, category, pagination query params)
    - `GET /api/v1/markets/:id`
    - `GET /api/v1/indexer/status`
    - `GET /api/v1/exposure`
  - Update `frontend/src/local/main.ts` to load market lists from the API, falling back to direct RPC calls only when indexer is syncing or unavailable.
  - Implement indexer staleness indicator in the UI header: compares API `sync.lastProcessedBlock` against RPC `eth_blockNumber`. If difference $> 5$ blocks, render a subtle non-blocking "Indexer Syncing" badge.
  - Ensure all numeric values received from API are handled as native JavaScript `BigInt` or formatted via `formatQie` without floating-point truncation (ADR-0001).
- **Explicit Non-Goals**:
  - Do NOT rewrite UI into React or another framework (preserve Vanilla TS + Vite).
  - Do NOT modify legacy QIE testnet modules (`frontend/src/main.ts`, `manifest.ts`).

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-04 (Fastify API Synchronization Metadata and Read Model Freshness), TICKET-06 (Fastify API Automated Integration Test Suite).
- **Gates**: TICKET-08, TICKET-09, TICKET-10.

### 5. Testable Acceptance Criteria
- [ ] API client successfully fetches and parses market listings from `GET /api/v1/markets`.
- [ ] UI renders market list with accurate title, status badge, pool totals, and contribution shares.
- [ ] UI displays indexer synchronization height and displays warning when indexer is $> 5$ blocks behind tip.
- [ ] Direct RPC fallback functions if backend API is temporarily offline.
- [ ] Unit tests in `frontend/test/selected-api-client.test.ts` pass with mocked fetch responses.

### 6. Required Tests and Verification Commands
```bash
cd frontend
npm run typecheck
npm test
```

### 7. Expected Evidence Artifacts
- Successful TypeScript compilation (`tsc --noEmit`).
- Passing test logs in `frontend/test/`.
- UI rendering verification of market list loaded via API.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: The direct RPC read logic remains preserved as a graceful fallback path if API client encounters network failure.
