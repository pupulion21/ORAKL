# TICKET-06: Fastify API Automated Integration Test Suite

- **Ticket ID**: `ORAKL-TICKET-06`
- **Work Package**: `WP-04` (Fastify API Integration Testing)
- **Relevant ADRs**: [ADR-0007](file:///home/pupulion/orakl/docs/adr/0007-api-freshness-and-reorg-metadata.md), [ADR-0008](file:///home/pupulion/orakl/docs/adr/0008-end-to-end-verification-test-gates.md), [ADR-0012](file:///home/pupulion/orakl/docs/adr/0012-centralized-fastify-error-handling.md)
- **Status**: `ready-for-agent`

---

### 1. Current Implementation Status
Missing. While unit tests exist for evidence parsing and indexer projection, there is currently no dedicated automated integration test suite for the Fastify server in `backend/test/`. All 18 endpoints rely on manual curls.

### 2. Exact Files / Modules Affected
- `backend/test/api.test.ts` (new file)
- `backend/test/harness.ts`
- `backend/package.json`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Implement comprehensive Vitest test suite in `backend/test/api.test.ts` using Fastify `app.inject()`.
  - Cover all 18 API routes:
    - `GET /api/v1/health`, `/network`, `/deployment`, `/indexer/status`
    - `GET /api/v1/markets`, `/markets/:id`, `/markets/:id/activity`, `/markets/:id/challenges`, `/markets/:id/evidence`, `/markets/:id/settlement`, `/markets/:id/metadata`
    - `GET /api/v1/evidence/:commitment`, `/metadata/:commitment`
    - `GET /api/v1/portfolio/:address`, `/transactions/:hash`, `/exposure`
    - `POST /api/v1/evidence`, `POST /api/v1/markets/metadata`
  - Test positive status codes (200, 201) and JSON payload structures.
  - Test negative conditions:
    - 404 on missing market, transaction, or evidence commitment.
    - 400 on malformed address, non-bigint market ID, or invalid hash format.
    - 429 when publication rate limit is exceeded.
    - 403 when origin header is not in configured `allowedOrigins`.
    - Verification of `requestId` and error message sanitization in error envelopes.
- **Explicit Non-Goals**:
  - Do NOT test live public internet APIs.
  - Do NOT spin up external HTTP listeners during unit tests (use Fastify `inject()` for fast, deterministic in-memory execution).

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-04 (Fastify API Synchronization Metadata and Read Model Freshness), TICKET-05 (Fastify API Centralized Error Envelopes and Security Hardening).
- **Gates**: TICKET-07, TICKET-09, TICKET-10.

### 5. Testable Acceptance Criteria
- [ ] `npx vitest run test/api.test.ts` executes all route tests with 100% pass rate.
- [ ] Positive tests verify block synchronization metadata is present on market responses.
- [ ] Negative tests verify that internal exceptions return 500 without leaking stack traces or SQL strings.
- [ ] Rate limiting tests verify 429 response when exceeding publication threshold.
- [ ] CORS test verifies 403 on unauthorized origins for mutation endpoints.

### 6. Required Tests and Verification Commands
```bash
cd backend
npx vitest run test/api.test.ts
```

### 7. Expected Evidence Artifacts
- Vitest test output displaying all passing API test suites.
- Code coverage report showing $\ge 90\%$ branch and line coverage for `backend/src/api/server.ts`.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: New test file only; no production runtime code changes.
