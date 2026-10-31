# TICKET-05: Fastify API Centralized Error Envelopes and Security Hardening

- **Ticket ID**: `ORAKL-TICKET-05`
- **Work Package**: `WP-03` (Fastify API Standardization & Security Hardening)
- **Relevant ADRs**: [ADR-0004](file:///home/pupulion/orakl/docs/adr/0004-local-simulation-boundary-enforcement.md), [ADR-0012](file:///home/pupulion/orakl/docs/adr/0012-centralized-fastify-error-handling.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved and verified. In [`backend/src/api/server.ts`](file:///home/pupulion/orakl/backend/src/api/server.ts), centralized error handling strictly formats all failure envelopes as `{ error: string, code: string, statusCode: number, requestId: string }`. Unhandled database and RPC exceptions map to HTTP 500 `INTERNAL_ERROR` with generic client messages while redacting SQL, connection strings, credentials, and paths via `redactSecrets`. `x-request-id` header is attached to all responses.

### 2. Exact Files / Modules Affected
- `backend/src/api/server.ts`
- `backend/src/lib/format.ts`
- `backend/test/api-sync.test.ts`
- `backend/test/api-error.test.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Standardized error envelopes across all status codes (400, 403, 404, 413, 429, 500):
    ```json
    {
      "error": "Sanitized human-readable message",
      "code": "MACHINE_READABLE_CODE",
      "statusCode": 400,
      "requestId": "req-xxx"
    }
    ```
  - `x-request-id` header propagation: client-provided ID is validated (`/^[a-zA-Z0-9_-]{1,64}$/`) and preserved; unsupplied/malicious IDs are replaced with generated `req-<rand>`. Every response carries `x-request-id`.
  - Unhandled exceptions and database driver errors map to HTTP status 500 with code `INTERNAL_ERROR` and generic message ("an internal server error occurred").
  - `redactSecrets` strips database URLs (`postgres://...`), RPC secret URLs, private keys, passwords, and local file paths.
  - Strict CORS origin filtering: allows only configured local simulation origins (e.g., `http://localhost:5176`, `http://127.0.0.1:5176`), rejecting unauthorized origins with 403 `ORIGIN_FORBIDDEN`.
  - Body size limit enforced at 256KB returning 413 `PAYLOAD_TOO_LARGE`.
- **Explicit Non-Goals**:
  - No secret keys, mnemonic phrases, or RPC connection secrets in any log sink.
  - No alteration of smart contract economics or public deployment.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-04 (Fastify API Synchronization Metadata and Read Model Freshness).
- **Gates**: TICKET-06, TICKET-07.

### 5. Testable Acceptance Criteria
- [x] Every error response (400, 403, 404, 413, 429, 500) contains a non-empty `requestId` string.
- [x] Throwing a synthetic database connection error returns HTTP 500 without leaking connection credentials, passwords, or SQL query strings.
- [x] Submitting a POST request from an unauthorized Origin header returns HTTP 403 with `ORIGIN_FORBIDDEN`.
- [x] Submitting a malformed hex commitment returns HTTP 400 with `INVALID_PARAM`.
- [x] Malformed JSON payloads return 400 `INVALID_PAYLOAD` without dumping V8 parser internals.
- [x] Payloads exceeding 256KB return 413 `PAYLOAD_TOO_LARGE`.

### 6. Required Tests and Verification Commands
- `npm --prefix backend test -- test/api-error.test.ts` (17/17 passed)
- `npm --prefix backend test` (58/58 passed across all 5 suites)
- `cd backend && npx tsc --noEmit` (0 errors)
- `npm --prefix frontend test` (52/52 passed)

### 6. Required Tests and Verification Commands
```bash
cd backend
npm run api &
API_PID=$!
sleep 2
# Test 404 error envelope format
curl -s http://127.0.0.1:4310/api/v1/nonexistent | jq '.'
# Test invalid parameter error envelope
curl -s http://127.0.0.1:4310/api/v1/markets/not-a-number | jq '.'
kill $API_PID
```

### 7. Expected Evidence Artifacts
- JSON response captures verifying the `{ error, statusCode, requestId }` structure.
- Redaction verification logs demonstrating zero database credential leakage.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: Ensure `requestId` generation does not introduce significant CPU overhead (use Fastify built-in request ID generator or lightweight UUID/crypto random).
