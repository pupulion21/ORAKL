# TICKET-05: Fastify API Centralized Error Envelopes and Security Hardening

- **Ticket ID**: `ORAKL-TICKET-05`
- **Work Package**: `WP-03` (Fastify API Standardization & Security Hardening)
- **Relevant ADRs**: [ADR-0004](file:///home/pupulion/orakl/docs/adr/0004-local-simulation-boundary-enforcement.md), [ADR-0012](file:///home/pupulion/orakl/docs/adr/0012-centralized-fastify-error-handling.md)
- **Status**: `ready-for-agent`

---

### 1. Current Implementation Status
Partially implemented. In [`backend/src/api/server.ts`](file:///home/pupulion/orakl/backend/src/api/server.ts), `setErrorHandler` sends `{ error: { code, message }, statusCode }`, but omits the required `requestId` field. Furthermore, unhandled exceptions default to status 400 rather than 500, and internal error messages could potentially leak raw SQL or database details.

### 2. Exact Files / Modules Affected
- `backend/src/api/server.ts`
- `backend/src/lib/format.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Update `setErrorHandler` to generate or extract a unique request identifier (`request.id`) and format error responses strictly as:
    ```json
    {
      "error": { "code": "STRING_CODE", "message": "Sanitized client message" },
      "statusCode": 400,
      "requestId": "req-xxx"
    }
    ```
  - Map unhandled exceptions and database driver errors to HTTP status 500 with code `INTERNAL_ERROR` and a generic message ("an internal server error occurred"), logging the real error and stack trace exclusively to internal diagnostic logs (ADR-0012).
  - Enforce strict CORS origin filtering: allow only configured local simulation origins (e.g., `http://localhost:5176`, `http://127.0.0.1:5176`), rejecting any non-local or wildcard origins with 403 Forbidden.
  - Enforce input schema validation on all POST payloads (`/api/v1/evidence` and `/api/v1/markets/metadata`), rejecting oversized bodies (> 256KB) and invalid property formats.
- **Explicit Non-Goals**:
  - Do NOT log private keys, mnemonic phrases, or RPC connection secrets in any internal or external log sink.
  - Do NOT disable error handling in test environments.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-04 (Fastify API Synchronization Metadata and Read Model Freshness).
- **Gates**: TICKET-06, TICKET-07.

### 5. Testable Acceptance Criteria
- [ ] Every error response (400, 403, 404, 429, 500) contains a non-empty `requestId` string.
- [ ] Throwing a synthetic database connection error returns HTTP 500 without leaking connection credentials, passwords, or SQL query strings.
- [ ] Submitting a POST request from an unauthorized Origin header returns HTTP 403 with `ORIGIN_FORBIDDEN`.
- [ ] Submitting a malformed hex commitment returns HTTP 400 with `INVALID_PARAM`.

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
