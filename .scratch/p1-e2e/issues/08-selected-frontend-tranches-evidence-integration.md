# TICKET-08: Selected Frontend Multi-Challenger Tranches and Evidence Modal Integration

- **Ticket ID**: `ORAKL-TICKET-08`
- **Work Package**: `WP-05` (Selected Frontend API Integration)
- **Relevant ADRs**: [ADR-0003](file:///home/pupulion/orakl/docs/adr/0003-rfc8785-canonical-evidence-profile.md), [ADR-0006](file:///home/pupulion/orakl/docs/adr/0006-multi-challenger-projection-atomicity.md), [ADR-0011](file:///home/pupulion/orakl/docs/adr/0011-neutral-refund-policy-and-claim-accounting.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved.
1. `frontend/src/selected/api-client.ts`: Implemented typed methods `getMarketChallenges`, `getEvidence`, and `publishEvidence` matching backend schemas.
2. `frontend/src/selected/evidence.ts`: Exported `verifyEvidenceIntegrity` validating RFC 8785 canonical JSON Keccak-256 commitments and raw content hashes.
3. `frontend/src/local/main.ts`:
   - Renders M1 Multi-Challenger Tranche Ladder table under dispute states with exact `prefixBefore` ordering and stakes.
   - Preserves non-fabrication rule: when in RPC mode or when no tranches are indexed, indicates that detailed tranches require the indexer service.
   - Built full Evidence Inspection Modal displaying commitment verification status (`Commitment Hash Matched (Keccak-256)`), authenticity disclaimers (distinguishing cryptographic match from factual truthfulness/arbitrator review), sanitized manifest claims/sources, and safe raw content display.
   - Added evidence authoring publication flow in Evidence Lab (`POST /api/v1/evidence`) returning canonical commitments.
4. Comprehensive test suite in `frontend/test/selected-tranches-evidence.test.ts` (18/18 passing).
5. All 82 frontend unit tests passing; TypeScript typecheck 0 errors; Vite production build succeeds; all 93 backend tests pass.

### 2. Exact Files / Modules Affected
- `frontend/src/selected/api-client.ts`
- `frontend/src/local/main.ts`
- `frontend/src/selected/evidence.ts`
- `frontend/test/selected-evidence.test.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Integrate evidence publishing flow:
    1. User fills evidence form (sources, description, claim).
    2. Frontend builds and validates `orakl-evidence-v1` manifest.
    3. Frontend publishes manifest to backend `POST /api/v1/evidence`.
    4. Backend confirms storage and returns canonical Keccak-256 commitment hash.
    5. Frontend populates transaction input with verified hash for proposal or challenge.
  - Implement evidence modal/viewer:
    - User clicks on an on-chain `evidenceHash`.
    - UI fetches manifest from `GET /api/v1/evidence/:commitment`.
    - UI verifies retrieved manifest hashes to expected commitment and renders canonical claims and sources.
  - Implement M1 dispute tranche ladder:
    - On DISPUTED markets, fetch `GET /api/v1/markets/:id/challenges`.
    - Render table of challenger tranches showing challenger address, deposited amount, and `prefixBefore` offset.
- **Explicit Non-Goals**:
  - Do NOT modify contract ABI or event structures.
  - Do NOT allow uploading unverified arbitrary binary files to evidence API.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-06 (Fastify API Automated Integration Test Suite), TICKET-07 (Selected Frontend API Client and Market Browsing Integration).
- **Gates**: TICKET-09, TICKET-10.

### 5. Testable Acceptance Criteria
- [x] User can author and submit evidence via UI; manifest is successfully posted to `POST /api/v1/evidence`.
- [x] Submitted evidence commitment matches hash in on-chain transaction calldata.
- [x] Clicking an evidence hash fetches manifest from API and verifies commitment integrity.
- [x] Disputed markets display ordered challenger tranches with accurate `prefixBefore` values.
- [x] All 10 existing evidence vector tests continue to pass in frontend and backend.

### 6. Required Tests and Verification Commands
```bash
cd frontend
npm test
npm run typecheck
```

### 7. Expected Evidence Artifacts
- Passing test logs in `frontend/test/selected-evidence.test.ts`.
- UI rendering proof of challenger tranche ladder and evidence inspection modal.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: If evidence publication fails, UI allows user to proceed with on-chain hash commitment directly, providing offline hash generation tools.
