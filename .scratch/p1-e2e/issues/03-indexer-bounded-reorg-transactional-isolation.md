# TICKET-03: Indexer Bounded Reorg Recovery and Transactional Isolation

- **Ticket ID**: `ORAKL-TICKET-03`
- **Work Package**: `WP-02` (Indexer Correctness & Bounded Reorg Recovery)
- **Relevant ADRs**: [ADR-0002](file:///home/pupulion/orakl/docs/adr/0002-bounded-reorg-rollback-strategy.md), [ADR-0006](file:///home/pupulion/orakl/docs/adr/0006-multi-challenger-projection-atomicity.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved.
All 15 tests in `backend/test/indexer.test.ts` pass cleanly (15/15 passed).
All 5 tests in `backend/test/reorg.test.ts` pass cleanly (5/5 passed).
All 10 tests in `backend/test/evidence.test.ts` pass cleanly (10/10 passed).
All 52 frontend tests in `frontend` pass cleanly (52/52 passed).

### 2. Exact Files / Modules Affected
- `backend/src/indexer/run.ts`
- `backend/src/indexer/reorg.ts`
- `backend/test/indexer.test.ts`
- `backend/test/reorg.test.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Configured maximum rollback depth of 4,096 blocks with fail-closed halt when divergence exceeds depth (ADR-0002).
  - Newest→oldest scanning algorithm to locate the canonical common ancestor.
  - Per-invocation rollback accounting (`rollbacks: 1` per reorg recovery).
  - Configured 60s timeout and 10s maxWait on interactive Prisma `$transaction` calls in `ingestOnce` and `recoverFromFork`.
  - Atomicity of block/event ingestion, projection fold, and checkpoint advance.
- **Explicit Non-Goals**:
  - Do NOT remove or modify existing `IndexerRollback` audit logging.
  - Do NOT rely on in-memory event buffering across process restarts.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-01, TICKET-02.
- **Gates**: TICKET-04, TICKET-06, TICKET-10.

### 5. Testable Acceptance Criteria
- [x] Test `rolls back a fork and replays the canonical branch without duplicates` passes with `rollbacks === 1`.
- [x] Test `never half-commits when the RPC connection dies mid-cycle` passes with exact pre-failure table row counts.
- [x] All 15 tests in `backend/test/indexer.test.ts` pass cleanly (15/15 passed).
- [x] A 10-block reorg test produces zero orphaned event records and zero duplicate `ChallengeStake` rows (verified in `backend/test/reorg.test.ts` and `backend/test/indexer.test.ts`).

### 6. Required Tests and Verification Commands
```bash
cd backend
npx vitest run test/indexer.test.ts
npx vitest run test/reorg.test.ts
npx vitest run test/evidence.test.ts
npx tsc --noEmit
```

### 7. Verified Evidence Artifacts
- Vitest run log: 15/15 passing tests for `test/indexer.test.ts`.
- Vitest run log: 5/5 passing tests for `test/reorg.test.ts`.
- Vitest run log: 10/10 passing tests for `test/evidence.test.ts`.
- TypeScript compiler output: 0 errors (`tsc --noEmit`).
- `IndexerRollback` audit row creation verified during fork rollback.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Medium.
- **Rollback Consideration**: Reverting transaction boundaries in `run.ts` could restore partial write behavior; must verify that transaction timeout configuration accommodates batch size.
