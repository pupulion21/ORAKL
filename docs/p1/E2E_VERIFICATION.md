# ORAKL P1 End-to-End Verification Report

This document records the execution results, arithmetic reconciliations, and empirical invariant demonstrations obtained from the automated E2E test suite running against the isolated Anvil simulation environment (Chain ID 31337).

> [!NOTE]
> Empirical test execution and finite E2E reconciliations confirm arithmetic consistency within simulated execution paths; they do not constitute an exhaustive mathematical security proof across all possible states, nor do they replace an independent external security audit.

- **Execution Script**: [`scripts/p1/run-e2e-scenarios.mjs`](file:///home/pupulion/orakl/scripts/p1/run-e2e-scenarios.mjs)
- **Target Contracts**:
  - `SelectedMarketFactory`: `0x998abeb3E57409262aE5b751f60747921B33613E`
  - `ProtocolConfig`: `0x95401dc811bb5740090279Ba06cfA8fcF6113778`
- **Execution Date**: 2026-10-31
- **Overall Status**: `PASSED` (56/56 On-Chain Transactions Verified)

---

## 1. Executive Summary Table

| Scenario | Market ID | Transactions | Status | Total Deposits | Payouts / Refunds | Retained Fee | Residual Dust |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Scenario A** (Binary Reversal) | 0 | 14 | **PASSED** | 44.0 ETH | 43.4 ETH | 0.6 ETH (2%) | **0 WEI** |
| **Scenario B** (Neutral INVALID) | 1 | 14 | **PASSED** | 34.0 ETH | 34.0 ETH | 0.0 ETH (0%) | **0 WEI** |
| **Scenario C** (Emergency Pause) | 2 | 20 | **PASSED** | 42.0 ETH | 42.0 ETH | 0.0 ETH (0%) | **0 WEI** |
| **Scenario D** (10-Block Reorg) | 3 | 8 | **PASSED** | 13.0 ETH | Replay Verified | Bounded Rollback | **0 WEI** |

---

## 2. Detailed Scenario Breakdown

### Scenario A: Binary Reversal with Fee Deduction & Remainder-Free Claims
- **Objective**: Verify that when a proposed `YES` outcome is challenged by multiple challengers and overturned to `NO` by the arbitrator:
  1. Winning prediction holders (`NO`) receive correct pool share minus 2% protocol fee.
  2. Protocol fee (0.6 ETH) is retained as an accrued liability.
  3. Creator bond (1.0 ETH) returns in full.
  4. Proposal bond (10.0 ETH) is split among challengers strictly according to the M1 remainder-free formula with **0 dust**.
- **Challenger Distribution Verification**:
  - Total Proposal Bond: $P = 10\text{ ETH}$
  - Challenger A ($C_1 = 1\text{ ETH}$):
    $$\text{Entitlement}(C_1) = 1 + \left\lfloor \frac{10 \cdot 1}{3} \right\rfloor - 0 = 1 + 3.333333333333333333 = 4.333333333333333333\text{ ETH}$$
  - Challenger B ($C_2 = 2\text{ ETH}$):
    $$\text{Entitlement}(C_2) = 2 + \left\lfloor \frac{10 \cdot 3}{3} \right\rfloor - \left\lfloor \frac{10 \cdot 1}{3} \right\rfloor = 2 + 10 - 3.333333333333333333 = 8.666666666666666667\text{ ETH}$$
  - Sum of challenger rewards: $3.333... + 6.666... = 10.0\text{ ETH}$ exactly.
- **Mathematical Reconciliation**:
  $$\text{Deposits}(44.0) = \text{Payouts}(29.4) + \text{CreatorBond}(1.0) + \text{ChallengerShares}(13.0) + \text{Fee}(0.6)$$
  **Net Delta**: Exactly $0\text{ WEI}$.

---

### Scenario B: Neutral INVALID Resolution with 100% Principal Refunds and Zero Fees
- **Objective**: Verify that when arbitrator rules `INVALID`:
  1. Protocol fee deduction is strictly $0\%$ ($\text{feeBps} = 0$).
  2. All prediction stakes are $100\%$ refundable: Alice (5 ETH), Bob (15 ETH).
  3. Proposer bond (10 ETH) returns in full to proposer.
  4. Challenger stakes (Challenger A: 1 ETH, Challenger B: 2 ETH) return in full.
  5. Creator bond (1 ETH) returns in full.
- **Mathematical Reconciliation**:
  $$\text{Total Deposits}(34.0\text{ ETH}) = \text{Total Refunds}(34.0\text{ ETH})$$
  **Contract Balance Delta**: Exactly $0\text{ WEI}$.

---

### Scenario C: Emergency Resilience, Pause, Cancellation & Reactivation
- **Objective**: Verify circuit breaker controls, deposit blocking, evidence availability during pause, and expired dispute cancellation.
- **Key Verification Points**:
  1. `ProtocolConfig.pause()` called by guardian: `paused = true`, `financialActive = false`.
  2. Financial writes (`predict()`) revert with `FinancialActivityDisabled`.
  3. Off-chain and on-chain dispute evidence submission (`submitEvidence()`) **remains operational** while paused.
  4. Premature cancellation before `arbitrationDeadline` reverts (`InvalidTime`).
  5. After `arbitrationDeadline` expires without a ruling, `cancelExpiredMarket()` cancels the market to `INVALID`.
  6. All participants receive $100\%$ refunds (Alice: 10 ETH, Bob: 20 ETH, Proposer: 10 ETH, Challenger A: 1 ETH, Creator: 1 ETH).
  7. 24-hour compliance time-lock approval (`approveRelease()`) and governance `unpause()` cleanly restore `financialActive = true`.

---

### Scenario D: 10-Block Reorganization Rollback, Pruning & Canonical Replay
- **Objective**: Verify indexer reorg detection, transactional database rollback, and canonical replay without state corruption.
- **Reorg Execution**:
  1. Anvil snapshot taken at block 607.
  2. Orphan branch mined 12 blocks ahead with predictions and dispute tranches.
  3. Database ingests orphan branch.
  4. Anvil reverted to snapshot 607, mining canonical branch with different predictions.
  5. Indexer detects `parentHash` divergence and executes atomic rollback:
     - Removed blocks: 12
     - Removed events: 9
     - Replayed canonical events: 68
  6. Fastify API sync metadata updates to canonical tip with zero duplicate records.
  7. Process restart verification proves checkpoint resumes idempotently.
