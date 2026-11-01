# ORAKL-P2-03: Safe Multisig 3-of-5 Governance Architecture & Local Anvil Fixture

Status: resolved
Type: task
Blocked by: 02

## Description

Design a production-grade multi-signature governance architecture replacing `LocalRoleMock` assumptions with canonical Safe 3-of-5 contracts. Assess Safe availability on QIE, design role separation across Governance, Compliance, and Arbitration, and build a local Anvil 3-of-5 integration test fixture.

## Objectives
1. Research Safe canonical contracts (v1.3.0 / v1.4.1), factory contracts, and availability on QIE networks. - RESOLVED
2. Formulate governance architecture separating Governance, Compliance, Arbitration, Guardian. - RESOLVED (`docs/p2/SAFE_GOVERNANCE_ARCHITECTURE.md`, `docs/p2/GOVERNANCE_AUTHORITY_MATRIX.md`)
3. Assess QIE compatibility with Safe singleton and off-chain indexing infrastructure. - RESOLVED (`docs/p2/SAFE_COMPATIBILITY_ASSESSMENT.md`)
4. Create emergency response and key rotation procedures. - RESOLVED (`docs/p2/EMERGENCY_RECOVERY_RUNBOOK.md`)
5. Implement a local Anvil Safe 3-of-5 integration test fixture in Foundry:
   - 5 independent disposable owner accounts.
   - Threshold strictly enforced at 3.
   - 2 signatures strictly fail / revert.
   - 3 valid signatures execute successfully.
   - Nonce increment and replay prevention verified.
   - Unauthorized caller execution fails.
   - Integration with `ProtocolConfig` actions: unpause, activateFinance, and 24h delay enforcement.
   - Emergency pause invalidation and full re-approval cycle verified.
   - 9/9 tests PASS (`contracts/test/governance/SafeGovernance.t.sol`). - RESOLVED (`docs/p2/SAFE_LOCAL_VERIFICATION.md`)

## Acceptance Criteria
- Genuine 3-of-5 threshold mechanics tested (not simplified mock boolean return) - VERIFIED.
- Replay protection, invalid signature order, and threshold violations fail closed - VERIFIED.
- Protocol liabilities and exposure constraints remain untouched - VERIFIED.
