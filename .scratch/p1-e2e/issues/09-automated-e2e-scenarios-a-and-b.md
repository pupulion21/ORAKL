# TICKET-09: Automated End-to-End Scenarios Runner — Scenarios A and B

- **Ticket ID**: `ORAKL-TICKET-09`
- **Work Package**: `WP-06` (Automated End-to-End Verification)
- **Relevant ADRs**: [ADR-0008](file:///home/pupulion/orakl/docs/adr/0008-end-to-end-verification-test-gates.md), [ADR-0010](file:///home/pupulion/orakl/docs/adr/0010-refundable-creator-bond-zero-creation-fee.md), [ADR-0011](file:///home/pupulion/orakl/docs/adr/0011-neutral-refund-policy-and-claim-accounting.md)
- **Status**: `resolved`

---

### 1. Current Implementation Status
Resolved. Standalone deterministic automated runner implemented in `scripts/p1/run-e2e-scenarios.mjs` with exact integer BigInt math and zero dust reconciliation. Scenario A (Binary Reversal with Fee Deduction & Remainder-Free Challenger Entitlements) and Scenario B (Neutral INVALID Resolution with 100% Principal Refunds and Zero Fees) both pass against the local Anvil and PostgreSQL stack.

### 2. Exact Files / Modules Affected
- `scripts/p1/run-e2e-scenarios.mjs` (new automated runner)
- `scripts/p1/lib.mjs`
- `package.json`

### 3. Implementation Scope and Explicit Non-Goals
- **In-Scope**:
  - Implement automated runner executing **Scenario A** against local Anvil (31337):
    1. Deployer confirms active deployment manifest.
    2. Creator wallet deploys market ($K = 1\text{ ETH}$, $F = 0$).
    3. Alice deposits $10\text{ ETH}$ on YES; Bob deposits $20\text{ ETH}$ on NO.
    4. Fast-forward local Anvil time (`evm_increaseTime`) past trading deadline.
    5. Proposer deposits $P = 10\text{ ETH}$ proposing YES with RFC 8785 evidence hash.
    6. Challenger A bonds $C_A = 1\text{ ETH}$; Challenger B bonds $C_B = 2\text{ ETH}$.
    7. Verify total challenge stake $S = 3\text{ ETH}$ and prefix offsets ($S_0 = 0, S_1 = 1\text{ ETH}$).
    8. Attempt premature arbitration -> assert transaction reverts.
    9. Advance time past `challengeDeadline`.
    10. Arbitrator settles NO with decision evidence hash.
    11. Bob claims winning payout net of 2% protocol fee ($20/20 \times 29.4\text{ ETH} = 29.4\text{ ETH}$).
    12. Creator claims full creation bond $K = 1\text{ ETH}$.
    13. Challenger A claims $1\text{ ETH} + 1/3 \times 10\text{ ETH} = 4.333333333333333333\text{ ETH}$.
    14. Challenger B claims $2\text{ ETH} + 2/3 \times 10\text{ ETH} = 8.666666666666666667\text{ ETH}$.
    15. Verify contract balance equals remaining fee liability ($0.6\text{ ETH}$) with zero leaked dust.
  - Implement automated runner executing **Scenario B (Neutral INVALID)**:
    1. Create market, deposit YES/NO predictions, submit proposal and 2 challenges.
    2. Advance time; Arbitrator settles to `INVALID`.
    3. Verify every participant claims 100% principal refunds with zero fee deduction ($feeBps = 0$).
    4. Proposer claims full $P = 10\text{ ETH}$; Challengers claim full $C_A, C_B$.
    5. Creator claims full $K = 1\text{ ETH}$.
    6. Verify contract native balance returns to exactly 0 ETH (or pre-market level).
    7. Indexer and API reflect `status: "CANCELLED"`, `refundable: true`, `disposition: "NEUTRAL"`.
- **Explicit Non-Goals**:
  - Do NOT broadcast transactions to public QIE testnet or mainnet.
  - Do NOT modify contract bytecode to bypass time delays (use Anvil RPC time travel methods).

### 4. Dependencies and Execution Order
- **Blocked By**: TICKET-02 (Indexer Event Projection and INVALID Settlement Fixes), TICKET-06 (Fastify API Automated Integration Test Suite), TICKET-08 (Selected Frontend Tranches and Evidence Modal Integration).
- **Gates**: TICKET-10, TICKET-11.

### 5. Testable Acceptance Criteria
- [x] Scenario A executes all 21 steps on local Anvil, yielding confirmed transaction receipts for every action.
- [x] Scenario A verifies exact integer mathematical equality: $\sum \text{claims} + \text{feeLiability} == \text{totalDeposits}$.
- [x] Scenario B executes and confirms 100% principal refunds with zero fee accrual.
- [x] Post-settlement exposure release is emitted and verified in database projections.

### 6. Required Tests and Verification Commands
```bash
node scripts/p1/run-e2e-scenarios.mjs --scenarios A,B
```

### 7. Expected Evidence Artifacts
- Scenario execution log containing block numbers, transaction hashes, gas used, and account balance diffs.
- Final balance reconciliation table confirming zero insolvency and zero dust leakage.

### 8. Risk Level and Rollback Considerations
- **Risk Level**: Medium.
- **Rollback Consideration**: Automated runner is non-destructive to local source code; operates against isolated Anvil state snapshots.
