# ORAKL Protocol — Canonical Safe v1.4.1 Real Integration Test Results

**Document ID:** `ORAKL-P3-SAFE-TEST-RESULTS`  
**Execution Context:** Isolated Local Anvil (`chainId: 31337`, Port `8547`, Standard EIP-170 24KB limit, No Impersonation)  
**Status:** `P3 CANONICAL SAFE EVIDENCE VERIFIED — PUBLIC RELEASE BLOCKED`  
**Safe Global Contract Version:** `v1.4.1` (Canonical Singletons & Proxies)  
**Total Scenarios Tested:** 28 / 28 Executed and Passed (100% Green)  
**Date:** 2026-11-01  

> [!NOTE]
> All 28 test scenarios were executed directly against genuine, official Safe Global Core Protocol v1.4.1 smart contracts (`Safe.sol` and `SafeProxy.sol`) bound to `ProtocolConfig.sol` and `SelectedMarketFactory.sol` on local Anvil. Every scenario is fully executable on-chain with zero mocked or placeholder passes. Standard EIP-170 code size limits and standard authentication rules are strictly enforced.

---

## Executive Summary Matrix

| ID | Category | Scenario Description | Expected Result | Actual Result | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **01** | Safe Config | 5 distinct owners configured on Governance Safe | Exactly 5 distinct addresses | 5 distinct addresses confirmed | `EXECUTED_PASS` |
| **02** | Safe Config | Threshold configured to exactly 3 | `threshold == 3` | `getThreshold() == 3` | `EXECUTED_PASS` |
| **03** | Quorum Safety | 2 valid signatures attempt execution | Revert with `GS020` | Reverted with `GS020`, nonce unmutated | `EXECUTED_PASS` |
| **04** | Quorum Safety | 3 valid signatures authorize execution | Execution succeeds | `execTransaction` succeeded, `ExecutionSuccess` emitted | `EXECUTED_PASS` |
| **05** | Signer Auth | 2 valid signatures + 1 unregistered signer | Revert with `GS026` | Reverted with `GS026` | `EXECUTED_PASS` |
| **06** | Signer Auth | Duplicate signature from valid owner | Revert with `GS026` | Reverted with `GS026` | `EXECUTED_PASS` |
| **07** | Signature Order | Signatures ordered descending (unsorted) | Revert with `GS026` | Reverted with `GS026` | `EXECUTED_PASS` |
| **08** | EIP-712 Digest | Signatures computed over invalid/tampered hash | Revert with `GS026` | Reverted with `GS026` | `EXECUTED_PASS` |
| **09** | Payload Integrity | Signatures over calldata A executed with calldata B | Revert with `GS026` | Reverted with `GS026` | `EXECUTED_PASS` |
| **10** | Domain Separation | Signatures on `domainSafeA` executed on `domainSafeB` (identical 5 owners) | Revert with `GS026` on B; succeeds on A | Address domain separation strictly enforced (`GS026`) | `EXECUTED_PASS` |
| **11** | Chain ID Defense | Signatures computed with `chainId == 1` (Mainnet digest) | Revert with `GS026` on Anvil (31337) | EIP-712 chainId domain defense verified (`GS026`) | `EXECUTED_PASS` |
| **12** | Replay Protection | Replay previously executed transaction payload | Revert with `GS026` | Reverted with `GS026` (nonce advanced) | `EXECUTED_PASS` |
| **13** | Nonce Tracking | Nonce increments monotonically after execution | Nonce advances 0 -> 1 -> 2 | Monotonic nonce progression verified | `EXECUTED_PASS` |
| **14** | Nonce Integrity | Signatures computed with future nonce `nonce + 10` | Revert with `GS026` | Reverted with `GS026`, storage nonce unmutated | `EXECUTED_PASS` |
| **15** | Role Gating | Direct EOA call to `ProtocolConfig.bindFactory` | Revert `Unauthorized()` | Reverted `Unauthorized()` | `EXECUTED_PASS` |
| **16** | Governance Exec | Governance Safe executes `bindFactory()` | Factory bound to config | Factory successfully bound via 3-of-5 Safe | `EXECUTED_PASS` |
| **17** | Compliance Exec | Compliance Safe executes `approveRelease()` | Release tag approved | `approvedRelease` recorded via 3-of-5 Safe | `EXECUTED_PASS` |
| **18** | Timelock Gate | Governance Safe executes `activateFinance()` early | Subcall revert `GS013`/`InvalidTimelock()` | Reverted `GS013`, finance unactivated | `EXECUTED_PASS` |
| **19** | Timelock Gate | Governance Safe activates finance after 24h delay | Finance activated | `financialActive == true` verified | `EXECUTED_PASS` |
| **20** | Emergency Pause | Guardian calls `pause()` without multisig | Immediate pause | `paused == true` immediately | `EXECUTED_PASS` |
| **21** | Guardian Limit | Guardian attempts `unpause()` | Revert `Unauthorized()` | Reverted `Unauthorized()` (only Governance Safe) | `EXECUTED_PASS` |
| **22** | Epoch Reset | Emergency pause clears release approval | Approval zeroed | `approvedRelease == 0x0` | `EXECUTED_PASS` |
| **23** | Recovery Gate | Full recovery: approval, 24h timelock, unpause & finance reactivation | Safe unpause + reactivation | `paused == false` & `financialActive == true` verified | `EXECUTED_PASS` |
| **24** | Arbitration Role | Full dispute lifecycle: create, propose, challenge, Arbitration Safe settles | Settle dispute NO (2) via 3-of-5 Safe | `storedState == FINALIZED (4)`, `outcome == NO (2)` | `EXECUTED_PASS` |
| **25** | Disjoint Gate | Unauthorized arbitration & non-multisig rejection | Reverts across 4 vectors | `Unauthorized`, `GS013`, `InvalidMultisig`, `ControlChanged` | `EXECUTED_PASS` |
| **26** | Safe Self-Auth | Safe self-call threshold increase 3->4, quorum check, restore 4->3 | Authorized Safe threshold transitions | Direct EOA blocked; 3->4 verified; 4->3 restored | `EXECUTED_PASS` |
| **27** | Atomic Rollback | Reverting Safe subcalls leave target state unmutated | Zero target state modification | `GS013` rollback & `ExecutionFailure` verified | `EXECUTED_PASS` |
| **28** | Invariants Audit | Post-test financial & exposure parameters intact | All parameters valid | All caps, bonds, fees & role bindings verified | `EXECUTED_PASS` |

---

## Detailed Test Logs & Execution Trace

```text
=== ORAKL P3 Canonical Safe v1.4.1 Execution Test Suite ===
Starting isolated Anvil on port 8547 (chainId 31337)...
[TEST init] Deploying official Safe singleton and SafeProxyFactory...
[TEST init] Deploying Governance Safe (3-of-5)...
[TEST init] Deploying Compliance Safe (3-of-5)...
[TEST init] Deploying Arbitration Safe (3-of-5)...
[TEST init] Deploying ProtocolConfig and SelectedMarketFactory bound to Safes...
[PASS 01] Five distinct owners configured on Governance Safe
[PASS 02] Threshold exactly three verified on Governance Safe
[PASS 03] Two signatures cannot authorize execution (reverted with GS020)
[PASS 04] Three valid signatures can authorize execution
[PASS 05] Unregistered signer rejected (reverted with GS026)
[PASS 06] Duplicate signer rejected (reverted with GS026)
[PASS 07] Incorrect signature order rejected (reverted with GS026)
[PASS 08] Invalid EIP-712 digest rejected
[PASS 09] Tampered calldata rejected
[TEST test 10] Deploying domainSafeA and domainSafeB with identical 5 owners...
[PASS 10] Wrong Safe proxy address invalidates signature with identical signers (EIP-712 domain separation GS026)
[PASS 11] Wrong chain ID invalidates signature (EIP-712 domain binds chainId 31337)
[PASS 12] Replayed transaction rejected (nonce advanced)
[PASS 13] Safe nonce increments monotonically on successful execution
[PASS 14] Invalid nonce signatures rejected (reverted with GS026, nonce unmutated)
[PASS 15] Unauthorized direct call to ProtocolConfig rejected (onlyGovernance)
[PASS 16] Governance Safe successfully executed bindFactory() via 3-of-5 multisig
[PASS 17] Compliance Safe successfully executed approveRelease() via 3-of-5 multisig
[PASS 18] Governance Safe cannot bypass 24-hour timelock (subcall reverted GS013/InvalidTimelock)
[PASS 19] Governance Safe successfully activated finance after 24-hour timelock
[PASS 20] Guardian paused protocol immediately without multisig quorum delay
[PASS 21] Guardian cannot unpause (restricted strictly to Governance Safe)
[PASS 22] Emergency pause invalidates prior release approval (epoch interrupted)
[PASS 23] New compliance approval and 24-hour timelock strictly precede unpause (unpause & finance reactivation succeeded)
[TEST test 24] Creating market fixture on SelectedMarketFactory...
[PASS 24] Arbitrator Safe successfully executed settleDispute() on disputed market via 3-of-5 multisig
[PASS 25] Unauthorized arbitration decisions rejected (disjoint authority checked)
[PASS 26] Changes to Safe ownership follow strict self-authorized Safe execution rules
[PASS 27] Safe execution failure does not silently create state changes (atomic rollback & subcall revert verified)
[PASS 28] All financial invariants, role bindings, and safety invariants quantitatively verified

=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===
```

---

## Detailed Remediation Evidence

### 1. Cross-Proxy Domain Separation (Scenario 10)
Two dedicated test Safe proxies (`domainSafeA` and `domainSafeB`) were deployed with **100% identical 5 signers** and identical threshold 3. Signatures generated for `domainSafeA` were submitted to `domainSafeB.execTransaction()`.
- Result: Reverted with `GS026`.
- Nonce on `domainSafeB` remained 0.
- The exact same signatures were then submitted to `domainSafeA.execTransaction()`, where they executed with status `success` and advanced `domainSafeA` nonce to 1.
- Proves conclusively that rejection is driven strictly by proxy address domain separation, not owner set mismatch.

### 2. Cross-Chain EIP-712 Domain Defense (Scenario 11)
A Safe transaction digest was calculated using the official Safe EIP-712 domain separator configured with `chainId: 1` (Ethereum Mainnet) while executing on Anvil (`chainId: 31337`).
- Result: Reverted with `GS026`.
- Nonce remained unchanged.

### 3. Future Nonce Signature Defense (Scenario 14)
A transaction was signed against future nonce `N + 10`. Submitted to `govSafeAddress.execTransaction()`.
- Result: Reverted with `GS026`.
- Nonce remained strictly at `N`.

### 4. Emergency Recovery & Unpause Lifecycle (Scenario 23)
1. Governance Safe attempted `unpause()` without prior Compliance approval -> reverted `GS013` (inner call `NotApproved()`).
2. Compliance Safe executed `approveRelease(recoveryTag)` via 3-of-5 multisig -> `approvedRelease` recorded.
3. Governance Safe attempted `unpause()` before the 24-hour timelock -> reverted `GS013` (inner call `InvalidTimelock()`).
4. Clock warped 24 hours + 10 seconds.
5. Governance Safe executed `unpause()` via 3-of-5 multisig -> `paused == false` and `ExecutionSuccess` event emitted.
6. Governance Safe executed `activateFinance(recoveryTag)` -> `financialActive == true` restored.

### 5. Genuine Market Arbitration (Scenario 24)
1. Created real market fixture on `SelectedMarketFactory` with 1 ETH creation bond.
2. Warped time past market `closeTime` and `resolutionTime`.
3. Proposer called `proposeResult` with 10 ETH proposal bond -> state transitioned to `PROPOSED (2)`.
4. Challenger called `challengeResult` with 1 ETH challenge bond -> state transitioned to `DISPUTED (3)`.
5. Warped time past 48-hour `challengeDeadline`.
6. Arbitration Safe executed `settleDispute(marketId, NO, evidenceHash)` via genuine 3-of-5 multisig.
7. Verified: `market.storedState == FINALIZED (4)`, `market.finalOutcome == NO (2)`, `market.decisionEvidence == evidenceHash`.

### 6. Unauthorized Arbitration Rejection (Scenario 25)
Tested 4 distinct unauthorized arbitration access vectors:
- Direct EOA call to `settleDispute` reverted `Unauthorized()`.
- Compliance Safe call to `settleDispute` reverted `GS013` (inner `Unauthorized()`).
- EOA checked against `protocolConfig.requireArbitrator()` reverted `InvalidMultisig()`.
- Tampered fingerprint checked against `protocolConfig.requireArbitrator()` reverted `ControlChanged()`.

### 7. Authorized Safe Self-Call Threshold Changes (Scenario 26)
- Direct EOA call to `govSafe.changeThreshold(4)` reverted.
- Governance Safe executed authorized self-call `govSafe.changeThreshold(4)` with 3 signatures.
- Verified: `getThreshold() == 4`.
- Attempted transaction with 3 signatures under threshold 4 reverted `GS020`.
- Governance Safe executed authorized self-call `govSafe.changeThreshold(3)` with 4 signatures.
- Verified: `getThreshold() == 3`.

### 8. Atomic Rollback on Subcall Failure (Scenario 27)
- Governance Safe signed call to `ProtocolConfig.setParameters` with invalid `feeBps = 1500` (> 1000).
- When `safeTxGas == 0`: reverted with `GS013`. Target `ProtocolConfig` parameters remained 200 bps, Safe nonce unmutated.
- When `safeTxGas == 300,000`: outer tx succeeded, Safe emitted `ExecutionFailure`, target `ProtocolConfig` parameters remained strictly unmodified at 200 bps.

### 9. Quantitative Financial Invariants (Scenario 28)
Direct on-chain assertions verified:
- `pilotPoolCap`: 100 ETH (`100000000000000000000n`)
- `globalUnresolvedCap`: 300 ETH (`300000000000000000000n`)
- `perArbitratorUnresolvedCap`: 200 ETH (`200000000000000000000n`)
- `totalUnresolvedExposure`: 0 ETH (released upon market resolution)
- `exposureReleased(marketId)`: `true`
- `paused`: `false`
- `financialActive`: `true`
- `parameters.feeBps`: 200
- `parameters.creationBond`: 1 ETH
- `parameters.proposalBond`: 10 ETH
- `parameters.challengeBond`: 1 ETH
- `parameters.minContribution`: 0.01 ETH
- `parameters.poolCap`: 100 ETH
- `parameters.challengePeriod`: 172800 (48h)
- `parameters.arbitrationPeriod`: 345600 (96h)
- Bound roles: `governance` is `govSafeAddress`, `complianceApprover` is `compSafeAddress`, `arbitrator` is `arbSafeAddress`, `guardian` is `guardian.address`.
