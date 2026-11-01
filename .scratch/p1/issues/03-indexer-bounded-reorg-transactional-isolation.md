# TICKET-03: Indexer Bounded Reorg Recovery and Transactional Isolation

- **Ticket ID**: `ORAKL-TICKET-03`
- **Work Package**: `WP-02` (Indexer Correctness & Bounded Reorg Recovery)
- **Relevant ADRs**: [ADR-0002](file:///home/pupulion/orakl/docs/adr/0002-bounded-reorg-rollback-strategy.md), [ADR-0006](file:///home/pupulion/orakl/docs/adr/0006-multi-challenger-projection-atomicity.md)
- **Status**: `ready-for-agent`

---

### 1. Current Implementation Status
Partially implemented with 2 known test regressions in [`backend/test/indexer.test.ts`](file:///home/pupulion/orakl/backend/test/indexer.test.ts):
1. `rolls back a fork and replays the canonical branch without duplicates`: `r2.rollbacks` received 5 instead of 1 due to persistent rollback counter accumulation across multiple ingest cycles.
2. `never half-commits when the RPC connection dies mid-cycle`: `countsOf()` mismatched before vs. after because block records were partially committed before RPC exception handling executed complete transaction rollback.

### 2. Exact Files / Modules Affected
- `backend/src/indexer/run.ts`
- `backend/src/indexer/reorg.ts`
- `backend/src/indexer/replay.ts`
- `backend/test/indexer.test.ts`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Fix rollback counting in `reorg.ts` to accurately report rollbacks executed during the current ingestion cycle.
  - Ensure all database writes in `run.ts` (`IndexedBlock`, `IndexedEvent`, projections, checkpoint) are wrapped in a single strict Prisma `$transaction` client or explicit rollback boundary so that unexpected RPC transport errors abort all changes atomically.
  - Verify that reorg rollback up to 4,096 blocks deletes orphaned projections and refolds canonical events deterministically.
  - Verify fail-closed behavior if fork divergence exceeds 4,096 blocks (ADR-0002).
- **Explicit Non-Goals**:
  - Do NOT remove or modify existing `IndexerRollback` audit logging.
  - Do NOT rely on in-memory event buffering across process restarts.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-01 (Database Migration Deployment and Schema Validation), TICKET-02 (Indexer Event Projection and INVALID Settlement Fixes).
- **Gates**: TICKET-04, TICKET-06, TICKET-10.

### 5. Testable Acceptance Criteria
- [ ] Test `rolls back a fork and replays the canonical branch without duplicates` passes with `rollbacks === 1`.
- [ ] Test `never half-commits when the RPC connection dies mid-cycle` passes with exact pre-failure table row counts.
- [ ] All 15 tests in `backend/test/indexer.test.ts` pass cleanly (15/15 passed).
- [ ] A 10-block reorg test produces zero orphaned event records and zero duplicate `ChallengeStake` rows.

### 6. Required Tests and Verification Commands
```bash
cd backend
npx vitest run test/indexer.test.ts
```

### 7. Expected Evidence Artifacts
- Vitest run log showing 15/15 passing tests for `test/indexer.test.ts`.
- `IndexerRollback` audit records captured in PostgreSQL.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Medium.
- **Rollback Consideration**: Reverting transaction boundaries in `run.ts` could restore partial write behavior; must verify that transaction timeout configuration accommodates batch size.
