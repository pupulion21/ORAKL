# TICKET-10: Automated End-to-End Scenarios Runner — Scenarios C and D

- **Ticket ID**: `ORAKL-TICKET-10`
- **Work Package**: `WP-06` (Automated End-to-End Verification)
- **Relevant ADRs**: [ADR-0002](file:///home/pupulion/orakl/docs/adr/0002-bounded-reorg-rollback-strategy.md), [ADR-0004](file:///home/pupulion/orakl/docs/adr/0004-local-simulation-boundary-enforcement.md), [ADR-0008](file:///home/pupulion/orakl/docs/adr/0008-end-to-end-verification-test-gates.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved. Automated resilience testing for emergency pause transitions (Scenario C) and deep chain reorganization rollback/replay (Scenario D) is now fully implemented in `scripts/p1/run-e2e-scenarios.mjs` and verified on the isolated Anvil testbed (chainId 31337).

### 2. Exact Files / Modules Affected
- `scripts/p1/run-e2e-scenarios.mjs`
- `backend/src/indexer/project.ts`
- `docs/p1/evidence/e2e-scenarios-c-d.json`
- `docs/p1/evidence/e2e-scenarios.json`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Implement automated runner executing **Scenario C (Emergency & Resilience)**:
    1. Create market and deposit YES/NO predictions.
    2. Propose outcome and deposit challenge stake.
    3. Simulate emergency guardian pause on `ProtocolConfig` (`pause()`).
    4. Assert that new prediction deposits revert with `FinancialActivityDisabled()`.
    5. Assert that evidence submission remains functional through deadline.
    6. Advance Anvil time past maximum resolution window.
    7. Execute `cancelExpiredMarket(id)` permissionlessly.
    8. Verify participants claim 100% refunds; creator, proposer, and challenger claim full neutral bond returns.
    9. Assert exposure released exactly once with zero double-release reverts.
  - Implement automated runner executing **Scenario D (Reorganization & Restart)**:
    1. Ingest canonical event stream into local PostgreSQL.
    2. Simulate a 10-block Anvil chain reorganisation (using `evm_revert` to pre-mined snapshot or mining a fork with distinct block hashes).
    3. Trigger indexer cycle -> assert detection of block hash divergence at height $N$.
    4. Assert indexer executes atomic rollback: prunes orphaned blocks/events and writes `IndexerRollback` log.
    5. Ingest canonical alternative branch -> assert projections re-fold identically.
    6. Verify database row counts match exact canonical on-chain counts with zero duplicate stakes or phantom claims.
    7. Verify Fastify API sync metadata updates to the new canonical block hash.
- **Explicit Non-Goals**:
  - Do NOT test deep reorganizations exceeding 4,096 blocks without fail-closed shutdown (fail-closed is mandatory per ADR-0002).
  - Do NOT deploy external chain nodes.

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-03 (Indexer Bounded Reorg Recovery and Transactional Isolation), TICKET-09 (Automated End-to-End Scenarios Runner — Scenarios A and B).
- **Gates**: TICKET-11.

### 5. Testable Acceptance Criteria
- [x] Scenario C executes successfully, proving paused market cancellation and neutral refund claims.
- [x] Scenario D executes a simulated 10-block reorg rollback and canonical replay without duplicates.
- [x] Database state reconciles byte-for-byte with on-chain storage after reorg recovery.
- [x] Indexer checkpoint resumes after process kill without duplicating historical events.

### 6. Required Tests and Verification Commands
```bash
node scripts/p1/run-e2e-scenarios.mjs --scenarios C,D
```

### 7. Expected Evidence Artifacts
- Scenario C & D execution transcripts.
- `IndexerRollback` database record proving detected divergence and removed block count.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Medium.
- **Rollback Consideration**: Uses local Anvil snapshots (`evm_snapshot` / `evm_revert`), leaving clean state upon test completion.
