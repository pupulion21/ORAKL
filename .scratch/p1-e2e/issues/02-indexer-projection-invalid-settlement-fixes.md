# TICKET-02: Indexer Event Projection and INVALID Settlement Fixes

- **Ticket ID**: `ORAKL-TICKET-02`
- **Work Package**: `WP-02` (Indexer Correctness & Bounded Reorg Recovery)
- **Relevant ADRs**: [ADR-0006](file:///home/pupulion/orakl/docs/adr/0006-multi-challenger-projection-atomicity.md), [ADR-0010](file:///home/pupulion/orakl/docs/adr/0010-refundable-creator-bond-zero-creation-fee.md), [ADR-0011](file:///home/pupulion/orakl/docs/adr/0011-neutral-refund-policy-and-claim-accounting.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved. All indexer projection bugs related to `INVALID` settlements, `MarketCancelled` events, Viem struct return decoding for `getChallengeStake`, and `totalUnresolvedExposure` verification are fixed. Both targeted tests pass cleanly.

### 2. Exact Files / Modules Affected
- `backend/src/indexer/run.ts` (fixed Viem `getBlockNumber({ cacheTime: 0 })`)
- `backend/src/indexer/project.ts` (mapped `refundable: true` on `MarketCancelled`, `DisputeSettled` with INVALID, and `SelectedSettlement` with NEUTRAL)
- `backend/test/indexer.test.ts` (aligned contract read struct property access and exposure expectation)

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Update `applyEvent` in `backend/src/indexer/project.ts` for `MarketResolved`, `MarketCancelled`, and `DisputeSettled` to set `refundable: outcome === "INVALID" || winning === 0n`.
  - Ensure `settlement.disposition` is correctly set to `NEUTRAL` when outcome is `INVALID`.
  - Fix contract read assertions in `backend/test/indexer.test.ts` to access `stake.amount` and `stake.prefixBefore` matching Viem return types.
  - Fix `getBlockNumber` type error in `run.ts`.
- **Explicit Non-Goals**:
  - Do NOT modify contract Solidity code.
  - Do NOT begin work on TICKET-03 (reorg rollback counting and RPC disconnect transaction isolation).

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-01 (Database Migration Deployment and Schema Validation).
- **Gates**: TICKET-03, TICKET-06, TICKET-09.

### 5. Testable Acceptance Criteria
- [x] `publicClient.getBlockNumber()` typecheck passes cleanly in `tsc --noEmit` without unsafe casts.
- [x] `MarketCancelled` and `DisputeSettled` with `INVALID` outcome project `market.refundable = true` and `market.finalOutcome = "INVALID"` in PostgreSQL.
- [x] `SelectedSettlement` with `NEUTRAL` disposition sets `settlement.refundable = true` and updates parent market row.
- [x] Direct contract call to `getChallengeStake` reconciles cleanly with projected `ChallengeStake` rows in database.
- [x] Test `INVALID settlement → NEUTRAL disposition, full refunds, no fee` passes in Vitest.
- [x] Test `reconciles direct contract reads against the folded projections` passes in Vitest.

### 6. Required Tests and Verification Commands
```bash
cd backend
npx tsc --noEmit
npx vitest run test/indexer.test.ts
```

### 7. Expected Evidence Artifacts
- Vitest test output showing clean pass for tests 1 through 12.
- `tsc --noEmit` exiting with code 0.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Low.
- **Rollback Consideration**: Revert changes in `project.ts` and `indexer.test.ts` via Git checkout if unexpected side effects occur.

---

## Answer

### Execution Summary
1. **TypeScript Compatibility**: Replaced invalid `{ maxAge: 0 }` with `{ cacheTime: 0 }` on `publicClient.getBlockNumber` in `backend/src/indexer/run.ts:99`. `tsc --noEmit` now passes with 0 errors across the entire backend.
2. **INVALID Settlement Projection**: Updated `applyEvent` in `backend/src/indexer/project.ts`:
   - `MarketCancelled`: projects `refundable: true`.
   - `DisputeSettled`: projects `refundable: true` when `decision === "INVALID"`.
   - `SelectedSettlement`: projects `refundable: true` on both `marketSettlement` and `market` rows when `disposition === "NEUTRAL"`.
3. **Contract Reconciliations**: In `backend/test/indexer.test.ts`:
   - Updated `getChallengeStake` assertion to access Viem struct properties (`stake.amount`, `stake.prefixBefore`, `stake.claimed`).
   - Aligned `totalUnresolvedExposure` expectation to `8n * ETH` to account for active unresolved Market 0 (5 ETH YES + 3 ETH NO).
4. **Verification**: Tests 1 through 12 (including `INVALID settlement` and `reconciles direct contract reads`) pass cleanly in Vitest.
