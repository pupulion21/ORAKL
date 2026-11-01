# ORAKL Protocol — Cumulative Security Findings Register

> **VERDICT**: `INTERNAL REMEDIATIONS VERIFIED — INDEPENDENT AUDIT PENDING — PUBLIC RELEASE BLOCKED`

This register documents all security findings identified, remediated, and internally regression-tested across protocol development phases P0 through P4.

> [!IMPORTANT]
> **Audit Status Clarification**: The status "Regression Verified" denotes that internal automated tests pass deterministically on isolated Anvil chain 31337. No finding in this register has been audited or certified by an independent third-party auditor. Independent audit verification remains **PENDING** across all items.

---

## 1. Findings Matrix

| Finding ID | Phase | Severity | Title | Remediation Implemented | Regression Verified | Independent Verification | Open Risk / Residual Risk |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ORAKL-SEC-01** | P2 | Critical | Test double masquerading as Safe Global | Replaced `Safe3Of5.sol` with unmodified official Safe Global v1.4.1 | `scripts/p3/safe-lib.mjs`, Scenarios 1–28, Mutations 1–6 | **PENDING** | Upstream Safe vulnerabilities, signer key management |
| **ORAKL-SEC-02** | P2 | High | Deployment verifier false-positive on offline RPC | Fail-closed network gate (`onchain-required` mode requires active RPC) | `scripts/p2/verify-deployment.mjs`, Mutation 11 | **PENDING** | RPC proxy spoofing on untrusted networks |
| **ORAKL-SEC-03** | P2 | High | Circular trust anchor in deployment verification | Independent external `CANONICAL_TRUST_ANCHORS` decoupled from manifest | `scripts/p2/verify-deployment.mjs`, Mutation 10 | **PENDING** | Local trust anchor file integrity |
| **ORAKL-SEC-04** | P3 | Medium | Broad catch blocks concealing unexpected revert causes | Enforce exact error selectors (`Unauthorized`, `GS026`, etc.) & state asserts | `scripts/p3/test-real-safe.mjs`, Scenarios 3–23 | **PENDING** | Future EVM revert format variations |
| **ORAKL-SEC-05** | P3 | High | False-positive arbitration isolation test on finalized market | Dedicated Market 1 fixture in active `DISPUTED` state | `scripts/p3/test-real-safe.mjs`, Scenario 25, Mutation 7 | **PENDING** | Market state manipulation under high concurrency |
| **ORAKL-SEC-06** | P3 | Medium | Missing Safe event emission and nonce progression checks | Assert `ExecutionSuccess`/`ExecutionFailure` and monotonic nonce progression | `scripts/p3/safe-lib.mjs`, Scenarios 4, 13, 27 | **PENDING** | Event filtering reliability across diverse RPC providers |
| **ORAKL-SEC-07** | P1 | High | Exposure accounting overflow risk under rapid market creation | Global (300 ETH) and per-arbitrator (200 ETH) exposure accounting bounds | `SelectedMarketFactory.sol`, Foundry Invariant Suite | **PENDING** | Parameter tuning under extreme market volume |
| **ORAKL-SEC-08** | P1 | Medium | Off-chain publication nonce race condition | Atomic database nonce progression in indexer publication pipeline | `backend/test/publication-auth.test.ts` | **PENDING** | Distributed database replica lag |
| **ORAKL-SEC-09** | P3 | Medium | Timelock bypass attempt without fresh compliance approval | Pause clears `approvedRelease`; unpause requires fresh 24h timelocked approval | `test-real-safe.mjs`, Scenario 23, Mutation 9 | **PENDING** | Governance signer collusion |
| **ORAKL-SEC-10** | P4 | High | Lack of negative security mutation regression defense | 12 controlled on-chain fault injections with genuine detection gates | `scripts/p4/test-security-mutations.mjs` (12/12 DETECTED) | **PENDING** | Compiler optimization side-effects |

---

## 2. Detailed Findings, Remediation & Risk Analysis

### ORAKL-SEC-01: Canonical Safe Global Upstream Replacement
- **Issue**: P2 test tooling utilized a custom test double (`Safe3Of5.sol`) that did not execute official Safe Global bytecode, omitting EIP-712 domain hashing, fallback handler logic, and proxy mastercopy storage slots.
- **Remediation Implemented**: Integrated unmodified official Safe Global v1.4.1 contracts (`Safe.sol`, `SafeProxyFactory.sol`, `SafeProxy.sol`). On-chain bytecode hashing (`keccak256`) enforces exact parity against upstream releases before any contract is admitted into protocol governance.
- **Regression Verified**: Verified across all 28 canonical Safe scenarios (`scripts/p3/test-real-safe.mjs`) and Mutations 1–6 (`scripts/p4/test-security-mutations.mjs`).
- **Pending Independent Verification**: External auditors must independently review Safe proxy deployment patterns, mastercopy slot 0 binding, delegatecall boundaries, and multi-sig authorization flow.
- **Open Risk**: Operational key security for 15 hardware signers across 3 Safes; risk of zero-day vulnerabilities in upstream Safe v1.4.1.

---

### ORAKL-SEC-02: Deployment Verifier False-Positive on Network Failure
- **Issue**: `verify-deployment.mjs` previously caught RPC connection exceptions and recorded `rpc-observation: PASS`, potentially allowing deployments to be certified when no live on-chain checks occurred.
- **Remediation Implemented**: Introduced explicit `--mode onchain-required`. In this mode, any network unreachable state, dropped socket, or non-200 HTTP response immediately aborts with exit code 1 and records `rpc-connectivity: FAIL`.
- **Regression Verified**: Mutation 11 in `scripts/p4/test-security-mutations.mjs` exercises an unreachable RPC endpoint against a valid manifest and proves fail-closed rejection.
- **Pending Independent Verification**: External auditors must verify that the deployment verification script fails closed under all network partition scenarios and cannot be bypassed via corrupted configuration.
- **Open Risk**: Malicious or compromised local RPC proxy returning forged state responses.

---

### ORAKL-SEC-03: Independent Trust Anchor Decoupling
- **Issue**: Runtime codehashes were previously validated only against the manifest's own self-reported fields, creating circular trust.
- **Remediation Implemented**: Established independent immutable trust anchors (`CANONICAL_TRUST_ANCHORS`) in `verify-deployment.mjs`. On-chain runtime codehashes must match both the manifest and the independent anchor.
- **Regression Verified**: Mutation 10 in `scripts/p4/test-security-mutations.mjs` proves that altering `contracts.selectedMarketFactory.runtimeCodeKeccak256` triggers an exact failure on `onchain-factory-codehash`.
- **Pending Independent Verification**: External auditors must verify the integrity of the trust anchor generation and verification pipeline.
- **Open Risk**: Out-of-band corruption of deployment trust anchor definitions.

---

### ORAKL-SEC-04: Negative Test Assertion Hardening
- **Issue**: Previous negative test scenarios caught generic exceptions (`try { ... } catch { pass(); }`), allowing irrelevant errors (e.g. out-of-gas, RPC timeout, malformed ABI) to pass as security assertions.
- **Remediation Implemented**: Replaced all broad catch blocks with strict error matching enforcing exact 4-byte custom error selectors (`Unauthorized` `0x82b42900`, `InvalidMultisig` `0x2e0bb1b4`, `ControlChanged` `0xe1eb243c`, `NotApproved` `0xc19f17a9`, `InvalidTimelock` `0xf8d10e82`) or Safe error codes (`GS020`, `GS026`, `GS013`). Safe nonces are asserted before and after every negative test to confirm state immutability.
- **Regression Verified**: Scenarios 3, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 21, 23 in `scripts/p3/test-real-safe.mjs`.
- **Pending Independent Verification**: External auditors must verify that custom error selectors match compiled ABI specifications across all compiler optimization profiles.
- **Open Risk**: EVM client version differences in revert data framing.

---

### ORAKL-SEC-05: Unauthorized Arbitration Isolation Fix
- **Issue**: Scenario 25 previously tested unauthorized dispute settlement on Market 0, which had already reached `FINALIZED` in Scenario 24. Consequently, unauthorized callers reverted with `InvalidState()` rather than `Unauthorized()`.
- **Remediation Implemented**: Created a dedicated Market 1 fixture in Scenario 25, transitioning it to `DISPUTED` state within its active 48-hour arbitration window. Demonstrated that external EOAs, Governance Safe, and Compliance Safe revert strictly with `Unauthorized()` / `GS013`, leaving market state and exposure unchanged. Then settled Market 1 with the authorized Arbitration Safe.
- **Regression Verified**: Scenario 25 in `scripts/p3/test-real-safe.mjs` and Mutation 7 in `scripts/p4/test-security-mutations.mjs`.
- **Pending Independent Verification**: External auditors must review the state machine transition logic in `MarketResolver.sol` and `SelectedMarketFactory.sol` to ensure no race conditions allow premature finalization.
- **Open Risk**: Arbiter key compromise allowing malicious dispute outcomes up to the per-arbitrator exposure cap.

---

### ORAKL-SEC-06: Missing Safe Event Emission & Nonce Progression Checks
- **Issue**: Tests verified return values but did not inspect emitted events or monotonic nonce progression, allowing silent execution failures to go unnoticed.
- **Remediation Implemented**: Added receipt event parsing for `ExecutionSuccess` and `ExecutionFailure` on all Safe transactions. Added strict monotonic nonce assertions (`nonceAfter === nonceBefore + 1n`) on success and nonce immutability (`nonceAfter === nonceBefore`) on failure.
- **Regression Verified**: Scenarios 4, 13, 27 in `scripts/p3/test-real-safe.mjs`.
- **Pending Independent Verification**: External auditors must review event emission coverage and ensure off-chain indexers strictly validate Safe receipts.
- **Open Risk**: RPC event drop or log reordering during chain reorganization.

---

### ORAKL-SEC-07: Exposure Accounting Overflow Risk
- **Issue**: Unbounded market creation could theoretically saturate or overflow exposure counters, leading to denial-of-service or incorrect capital allocation.
- **Remediation Implemented**: Enforced immutable global exposure caps (300 ETH) and per-arbitrator caps (200 ETH) in `SelectedMarketFactory._beforePrediction()`. Unresolved exposure is tracked and decremented upon market settlement or neutral cancellation.
- **Regression Verified**: Foundry invariant test suite (`contracts/test/invariants/`) and Scenario 28 in `scripts/p3/test-real-safe.mjs`.
- **Pending Independent Verification**: External auditors must perform formal invariant analysis of exposure accounting under arbitrary deposit, challenge, and resolution sequences.
- **Open Risk**: Economic griefing where a malicious actor fills global exposure caps with low-value markets.

---

### ORAKL-SEC-08: Off-Chain Publication Nonce Race Condition
- **Issue**: Concurrent publication requests could race on nonce calculation in off-chain database models.
- **Remediation Implemented**: Implemented atomic transaction sequencing with database row locking and explicit signature verification in `backend/src/api/`.
- **Regression Verified**: `backend/test/publication-auth.test.ts` (all 16 tests pass).
- **Pending Independent Verification**: External auditors must inspect backend API concurrency handling and database isolation levels.
- **Open Risk**: Database connection pool exhaustion during extreme request bursts.

---

### ORAKL-SEC-09: Timelock Bypass Attempt Without Fresh Compliance Approval
- **Issue**: If the protocol was paused and unpaused, an attacker might attempt to reuse a stale compliance release approval without undergoing the 24-hour timelock delay.
- **Remediation Implemented**: `ProtocolConfig.pause()` unconditionally clears `approvedRelease = bytes32(0)` and increments `activityEpoch`. Unpausing requires a fresh Compliance Safe approval and an elapsed 24-hour timelock before `activateFinance()` can succeed.
- **Regression Verified**: Scenario 23 in `scripts/p3/test-real-safe.mjs` and Mutation 9 in `scripts/p4/test-security-mutations.mjs`.
- **Pending Independent Verification**: External auditors must verify the temporal ordering of governance actions across epoch boundaries.
- **Open Risk**: Collusion between 3 Governance signers and 3 Compliance signers to execute malicious parameter upgrades after the 24-hour delay.

---

### ORAKL-SEC-10: Absence of Controlled Security Mutation Regression Defense
- **Issue**: Regression suites previously tested only happy paths or simple mocks without validating that deliberate bytecode or storage mutations are detected by the security gates.
- **Remediation Implemented**: Built `scripts/p4/test-security-mutations.mjs`, implementing 12 genuine on-chain negative mutations covering bytecode hashes, storage slot 0 mastercopy pointer, signers, thresholds, EIP-712 chain IDs, nonces, dispute authority, timelocks, compliance gates, manifest identity, and network failure.
- **Regression Verified**: 12/12 mutations detected by dedicated fault gates (`scripts/p4/test-security-mutations.mjs`).
- **Pending Independent Verification**: External auditors must review the mutation test suite for negative-control validity and test boundary completeness.
- **Open Risk**: Unforeseen EVM execution differences when moving from local Anvil to target blockchain network.
