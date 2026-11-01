# ORAKL Protocol — Canonical Safe v1.4.1 Real Integration Test Results

**Document ID:** `ORAKL-P3-SAFE-TEST-RESULTS`  
**Execution Context:** Isolated Local Anvil (`chainId: 31337`, Port `8547`)  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Safe Global Contract Version:** `v1.4.1` (Canonical Singletons & Proxies)  
**Total Scenarios Tested:** 28 / 28 Passed (100% Green)  
**Date:** 2026-11-01  

> [!NOTE]
> All 28 test scenarios were executed directly against genuine, official Safe Global Core Protocol v1.4.1 smart contracts (`Safe.sol` and `SafeProxy.sol`) bound to `ProtocolConfig.sol` and `SelectedMarketFactory.sol` on local Anvil. The legacy `Safe3Of5.sol` fixture was NOT used for these integration tests.

---

## Executive Summary Matrix

| ID | Category | Scenario Description | Expected Result | Actual Result | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **01** | Safe Config | 5 distinct owners configured on Governance Safe | Exactly 5 distinct addresses | 5 distinct addresses confirmed | **PASS** |
| **02** | Safe Config | Threshold configured to exactly 3 | `threshold == 3` | `getThreshold() == 3` | **PASS** |
| **03** | Quorum Safety | 2 valid signatures attempt execution | Revert with `GS020` | Reverted with `GS020` | **PASS** |
| **04** | Quorum Safety | 3 valid signatures authorize execution | Execution succeeds | `execTransaction` succeeded | **PASS** |
| **05** | Signer Auth | 2 valid signatures + 1 unregistered signer | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **06** | Signer Auth | Duplicate signature from valid owner | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **07** | Signature Order | Signatures ordered descending (unsorted) | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **08** | EIP-712 Digest | Signatures computed over invalid/tampered hash | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **09** | Payload Integrity | Signatures over calldata A executed with calldata B | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **10** | Domain Separation | Signatures for Compliance Safe executed on Gov Safe | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **11** | Chain ID Defense | Signatures computed with `chainId != 31337` | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **12** | Replay Protection | Replay previously executed transaction payload | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **13** | Nonce Tracking | Nonce increments monotonically after execution | Nonce advances 0 -> 1 -> 2 | Nonce advanced monotonically | **PASS** |
| **14** | Nonce Integrity | Signatures computed with future nonce `nonce + 99` | Revert with `GS026` | Reverted with `GS026` | **PASS** |
| **15** | Role Gating | Direct EOA call to `ProtocolConfig.bindFactory` | Revert `Unauthorized()` | Reverted `Unauthorized()` | **PASS** |
| **16** | Governance Exec | Governance Safe executes `bindFactory()` | Factory bound to config | Factory successfully bound | **PASS** |
| **17** | Compliance Exec | Compliance Safe executes `approveRelease()` | Release tag approved | `approvedRelease` recorded | **PASS** |
| **18** | Timelock Gate | Governance Safe executes `activateFinance()` early | Subcall revert `GS013` | Reverted `GS013` | **PASS** |
| **19** | Timelock Gate | Governance Safe activates finance after 24h delay | Finance activated | `financialActive == true` | **PASS** |
| **20** | Emergency Pause | Guardian calls `pause()` without multisig | Immediate pause | `paused == true` immediately | **PASS** |
| **21** | Guardian Limit | Guardian attempts `unpause()` | Revert `Unauthorized()` | Reverted `Unauthorized()` | **PASS** |
| **22** | Epoch Reset | Emergency pause clears release approval | Approval zeroed | `approvedRelease == 0x0` | **PASS** |
| **23** | Recovery Gate | Governance attempts unpause without re-approval | Subcall revert `GS013` | Reverted `GS013` (NotApproved) | **PASS** |
| **24** | Arbitration Role | Arbitrator Safe registered in parameters | Arbitrator matches Safe | Arbitrator address verified | **PASS** |
| **25** | Disjoint Gate | Non-arbitrator / overlapping wallet arbitration | Revert `ControlChanged` | Disjoint authority enforced | **PASS** |
| **26** | Safe Self-Auth | Direct EOA call to `addOwnerWithThreshold` | Revert `GS031` / auth error | Direct owner change blocked | **PASS** |
| **27** | Atomic Rollback | Reverting Safe subcall does not mutate state | Zero state modification | Target state unchanged | **PASS** |
| **28** | Invariants Audit | Post-test financial & exposure parameters intact | All parameters valid | All caps & bounds verified | **PASS** |

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
[PASS 10] Wrong Safe proxy address invalidates signature (domain separator defense)
[PASS 11] Wrong chain ID invalidates signature (EIP-712 domain binds chainId 31337)
[PASS 12] Replayed transaction rejected (nonce advanced)
[PASS 13] Safe nonce increments monotonically on successful execution
[PASS 14] Invalid nonce signatures rejected
[PASS 15] Unauthorized direct call to ProtocolConfig rejected (onlyGovernance)
[PASS 16] Governance Safe successfully executed bindFactory() via 3-of-5 multisig
[PASS 17] Compliance Safe successfully executed approveRelease() via 3-of-5 multisig
[PASS 18] Governance Safe cannot bypass 24-hour timelock (subcall reverted GS013/InvalidTimelock)
[PASS 19] Governance Safe successfully activated finance after 24-hour timelock
[PASS 20] Guardian paused protocol immediately without multisig quorum delay
[PASS 21] Guardian cannot unpause (restricted strictly to Governance Safe)
[PASS 22] Emergency pause invalidates prior release approval (epoch interrupted)
[PASS 23] New compliance approval and timelock strictly precede unpause
[PASS 24] Arbitrator Safe is bound and authorized in ProtocolConfig
[PASS 25] Unauthorized arbitration decisions rejected (disjoint authority checked)
[PASS 26] Changes to Safe ownership follow strict self-authorized Safe execution rules
[PASS 27] Safe execution failure does not silently create successful state change
[PASS 28] All financial invariants and timelock safeguards remain intact

=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===
```

---

## Key Security Observations

1. **Official Error Codes**: Real Safe Global v1.4.1 emits standard upstream error codes:
   - `GS020`: Not enough signatures.
   - `GS026`: Invalid owner provided / signatures out of order / unauthorized signer.
   - `GS013`: Safe transaction execution failed (when `safeTxGas` and `gasPrice` are 0).
2. **EIP-712 Domain Isolation**: Signatures generated for one Safe proxy cannot be replayed against another Safe proxy, even when sharing identical owners, due to the contract-address-specific domain separator.
3. **Cross-Chain Replay Immunity**: The EIP-712 domain separator includes `block.chainid`, preventing cross-chain signature replays.
4. **Disjoint Multi-Role Architecture**: `ProtocolConfig` successfully interfaces with genuine Safe proxies through standard `getOwners()` and `getThreshold()` calls, enforcing that no single entity holds keys across governance, compliance, and arbitration roles.
