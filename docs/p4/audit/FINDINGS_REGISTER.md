# ORAKL Protocol — Cumulative Security Findings Register

This register documents all security findings identified, remediated, and verified across internal development phases P0 through P4.

---

## 1. Findings Summary Table

| Finding ID | Phase | Severity | Title | Status | Verification Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ORAKL-SEC-01** | P2 | Critical | Custom test double masquerading as canonical Safe Global | **CLOSED** | `scripts/p3/safe-lib.mjs`, Scenarios 1–28 |
| **ORAKL-SEC-02** | P2 | High | Deployment verifier reporting PASS on offline RPC | **CLOSED** | `scripts/p2/verify-deployment.mjs`, Mutation 11 |
| **ORAKL-SEC-03** | P2 | High | Deployment trust anchor circularity | **CLOSED** | `verify-deployment.mjs`, Mutation 10 |
| **ORAKL-SEC-04** | P3 | Medium | Broad catch blocks concealing unintended revert reasons | **CLOSED** | `scripts/p3/test-real-safe.mjs`, Scenarios 3–23 |
| **ORAKL-SEC-05** | P3 | High | False-positive arbitration isolation test on finalized Market 0 | **CLOSED** | `scripts/p3/test-real-safe.mjs`, Scenario 25 |
| **ORAKL-SEC-06** | P3 | Medium | Lack of Safe event emission and nonce progression checks | **CLOSED** | `safe-lib.mjs`, Scenarios 4, 13, 27 |
| **ORAKL-SEC-07** | P1 | High | Exposure accounting overflow under rapid market creation | **CLOSED** | `SelectedMarketFactory.sol`, Foundry Invariant Suite |
| **ORAKL-SEC-08** | P1 | Medium | Database publication nonce race condition | **CLOSED** | `backend/test/publication-auth.test.ts` |
| **ORAKL-SEC-09** | P3 | Medium | Premature unpause bypass attempt without fresh compliance approval | **CLOSED** | `test-real-safe.mjs`, Scenario 23, Mutation 9 |
| **ORAKL-SEC-10** | P4 | High | Absence of controlled security mutation regression defense | **CLOSED** | `scripts/p4/test-security-mutations.mjs` (12/12) |

---

## 2. Detailed Findings & Remediation Analysis

### ORAKL-SEC-01: Canonical Safe Global Upstream Replacement
- **Issue**: P2 test tooling utilized a simplified Solidity mock (`Safe3Of5.sol`) that did not execute official Safe Global bytecode, omitting EIP-712 domain hashing, fallback handler logic, and proxy mastercopy storage slots.
- **Remediation**: P3 integrated unmodified official Safe Global v1.4.1 contracts (`Safe.sol`, `SafeProxyFactory.sol`). On-chain bytecode hashing (`keccak256`) verifies exact parity against upstream releases before any test execution.
- **Verification**: Verified across all 28 scenarios in `scripts/p3/test-real-safe.mjs`.

---

### ORAKL-SEC-02: Deployment Verifier False-Positive on Network Failure
- **Issue**: `verify-deployment.mjs` previously caught RPC exceptions and recorded `rpc-observation: PASS`, potentially allowing deployments to be certified when no on-chain verification occurred.
- **Remediation**: Introduced explicit `--mode onchain-required` and `--mode artifact-only`. In `onchain-required` mode, any RPC failure immediately aborts with exit code 1 and records `RPC_FAILED`.
- **Verification**: Mutation 11 in `scripts/p4/test-security-mutations.mjs` proves fail-closed behavior on offline RPC.

---

### ORAKL-SEC-03: Independent Trust Anchor Decoupling
- **Issue**: Runtime codehashes were derived dynamically from deployment manifest outputs rather than independent external trust anchors.
- **Remediation**: Hardcoded immutable `CANONICAL_TRUST_ANCHORS` in `verify-deployment.mjs`. Manifest runtime codehashes must match the independent anchor byte-for-byte.
- **Verification**: Mutation 10 proves that modified manifest codehashes are detected and rejected.

---

### ORAKL-SEC-04: Negative Test Assertion Hardening
- **Issue**: Multiple integration tests wrapped contract calls in `try { ... } catch { pass(); }`, which would falsely pass if a transaction failed due to out-of-gas, insufficient balance, or unrelated errors.
- **Remediation**: Replaced all broad catch blocks with `assertRevertMatches(err, expectedPattern, testId, contextDesc)`. Every test now enforces exact 4-byte custom error selectors (`Unauthorized`, `InvalidMultisig`, `ControlChanged`, `NotApproved`, `InvalidTimelock`) or Safe standard strings (`GS020`, `GS026`, `GS013`). Safe nonces are asserted before and after every failed call.
- **Verification**: Scenarios 3, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 21, 23 in `test-real-safe.mjs`.

---

### ORAKL-SEC-05: Unauthorized Arbitration Isolation Fix
- **Issue**: Scenario 25 previously tested unauthorized settlement on Market 0, which had already reached `FINALIZED` state in Scenario 24. Consequently, unauthorized calls were reverting due to `InvalidState()` rather than `Unauthorized()`.
- **Remediation**: Built a dedicated fixture Market 1 in Scenario 25. Transitioned Market 1 to `DISPUTED` state within its active 48-hour arbitration window. Confirmed that external EOAs, Governance Safe, and Compliance Safe cannot settle and revert strictly with `Unauthorized()` / `GS013`, leaving state and exposure completely unchanged. Then settled Market 1 with the authorized Arbitration Safe.
- **Verification**: Scenario 25 in `scripts/p3/test-real-safe.mjs` and Mutation 7 in `test-security-mutations.mjs`.
