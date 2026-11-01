# ORAKL Protocol — Empirical Test Evidence & Verification Dossier

---

## 1. Test Execution Summary

| Verification Gate | Command | Tests Executed | Passed | Failed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Foundry Contract Regression** | `forge test --root contracts` | 244 | 244 | 0 | **PASS** |
| **Safe v1.4.1 Governance** | `node scripts/p3/test-real-safe.mjs` | 28 | 28 | 0 | **PASS** |
| **Security Mutation Defense** | `node scripts/p4/test-security-mutations.mjs` | 12 | 12 | 0 | **12/12 DETECTED** |
| **Artifact & Deployment Gate** | `node scripts/p2/verify-deployment.mjs --mode artifact-only` | 8 checks | 8 | 0 | **PASS** |
| **Evidence Manifest Integrity** | `node scripts/p1/verify-evidence-manifest.mjs` | 13 artifacts | 13 | 0 | **PASS** |
| **Backend Vitest & Indexer** | `npm --prefix backend test` | 167 | 167 | 0 | **PASS** |
| **Frontend Test & Build** | `npm --prefix frontend test && build` | 91 | 91 | 0 | **PASS** |

---

## 2. Canonical Safe v1.4.1 Scenario Verification Matrix (28/28 PASS)

| ID | Scenario Name | Primary Gate / Assertion | Outcome |
| :--- | :--- | :--- | :--- |
| **01** | Five distinct owners configured | `verifySafeInstance` owners equality | `PASS` |
| **02** | Threshold exactly three | `getThreshold() == 3` | `PASS` |
| **03** | Under-quorum rejection (2 signatures) | Safe reverts `GS020`, nonce unmutated | `PASS` |
| **04** | Valid quorum execution (3 signatures) | `ExecutionSuccess` event emitted, nonce advanced | `PASS` |
| **05** | Unregistered signer rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **06** | Duplicate signer rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **07** | Unsorted signatures rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **08** | Invalid EIP-712 digest rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **09** | Tampered calldata rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **10** | Cross-proxy replay rejected | EIP-712 domain separation `GS026` | `PASS` |
| **11** | Wrong chain ID signature rejected | EIP-712 domain binds chain 31337 | `PASS` |
| **12** | Replayed transaction rejected | Digest bound to previous nonce `GS026` | `PASS` |
| **13** | Monotonic nonce progression | Strict `nonceAfter == nonceBefore + 1` | `PASS` |
| **14** | Future nonce signature rejected | Safe reverts `GS026`, nonce unmutated | `PASS` |
| **15** | Direct call to config rejected | `ProtocolConfig` reverts `Unauthorized()` | `PASS` |
| **16** | Authorized `bindFactory()` execution | Factory address stored in config | `PASS` |
| **17** | Authorized `approveRelease()` execution | Release tag stored in config | `PASS` |
| **18** | Timelock bypass attempt rejected | Reverts `GS013` / `InvalidTimelock()` | `PASS` |
| **19** | Timelocked `activateFinance()` execution | Financial activity enabled after 24 hours | `PASS` |
| **20** | Guardian emergency pause | Immediate pause without quorum delay | `PASS` |
| **21** | Guardian unpause rejected | `Unauthorized()`, only Governance Safe | `PASS` |
| **22** | Release approval cleared on pause | Prior approval cleared immediately | `PASS` |
| **23** | Fresh approval & timelock before unpause | Timelock strictly enforced on unpause cycle | `PASS` |
| **24** | Arbitration Safe settles dispute (Market 0) | Settle dispute to `FINALIZED (4)` | `PASS` |
| **25** | Unauthorized dispute settlement rejected | Dedicated Market 1 fixture, `Unauthorized()` / `GS013` | `PASS` |
| **26** | Safe ownership rules strictly enforced | Direct call `GS031`, under-quorum `GS020` | `PASS` |
| **27** | Safe execution failure rollback | Atomic rollback `GS013`, `ExecutionFailure` event | `PASS` |
| **28** | Financial invariants quantitatively intact | Caps, zero residual exposure, role bindings | `PASS` |

---

## 3. Security Mutation Regression Matrix (12/12 DETECTED)

| ID | Mutation Injected | Expected Revert / Failure | Gate That Caught It | Status |
| :--- | :--- | :--- | :--- | :--- |
| **01** | Wrong Safe singleton codehash | Codehash mismatch | `deploySafeInfrastructure` codehash check | **DETECTED** |
| **02** | Wrong proxy mastercopy | Mastercopy mismatch | `verifySafeInstance` slot 0 check | **DETECTED** |
| **03** | Unauthorized owner | Revert `GS026` | `Safe.checkNSignatures` | **DETECTED** |
| **04** | Incorrect threshold | Revert `GS020` | `Safe.checkNSignatures` | **DETECTED** |
| **05** | Wrong-chain signature | Revert `GS026` | Safe EIP-712 domain separator | **DETECTED** |
| **06** | Replayed signature | Revert `GS026` | Safe nonce digest binding | **DETECTED** |
| **07** | Incorrect arbitrator authority | Revert `Unauthorized()` (`0x82b42900`) | `MarketResolver.settleDispute` | **DETECTED** |
| **08** | Premature finance activation | Revert `InvalidTimelock()` / `GS013` | `ProtocolConfig.activateFinance` | **DETECTED** |
| **09** | Missing compliance approval | Revert `NotApproved()` / `GS013` | `ProtocolConfig.activateFinance` | **DETECTED** |
| **10** | Changed runtime deployment identity | Codehash mismatch | `verifyDeployment` trust anchor gate | **DETECTED** |
| **11** | Offline RPC | Fail closed on unreachable RPC | `verifyDeployment` network gate | **DETECTED** |
| **12** | Incorrect release fingerprint | Revert `ControlChanged()` (`0xe1eb243c`) | `ProtocolConfig.requireArbitrator` | **DETECTED** |
