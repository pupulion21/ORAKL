# ORAKL Protocol — Selected Contract EVM Compatibility Report

- **Document ID**: `ORAKL-P2-SEL-001`
- **Date**: 2026-11-01
- **Status**: `VERIFIED LOCAL BENCHMARK`
- **Contracts Audited**:
  - `contracts/src/SelectedMarketFactory.sol`
  - `contracts/src/ProtocolConfig.sol`

---

## 1. Executive Summary

This report validates ORAKL's selected protocol contracts against the empirical EVM profile established in Phase 3 (`docs/p2/QIE_NETWORK_COMPATIBILITY.md` and `docs/p2/EVM_COMPATIBILITY_MATRIX.md`).

Key Findings:
1. **Opcode Safety**: ORAKL's compiler configuration strictly pins `evm_version = "paris"`. Because QIE EVM supports opcodes up to the Shanghai hardfork (including `PUSH0`), but does not support Cancun transient storage (`TSTORE`/`TLOAD`), compiling for `paris` guarantees zero unsupported opcode emissions.
2. **Bytecode Size Limits (EIP-170)**:
   - `SelectedMarketFactory`: Runtime size is **19,084 bytes** (well under the 24,576-byte limit with a **5,492-byte safety margin**). Initcode is **20,368 bytes** (under 49,152-byte EIP-3860 limit).
   - `ProtocolConfig`: Runtime size is **8,508 bytes** (well under limit with a **16,068-byte safety margin**). Initcode is **11,420 bytes**.
3. **Immutable References**: `SelectedMarketFactory` binds its immutable `ProtocolConfig` reference at deployment time. Runtime code matches the compiler template once immutable references are patched.
4. **No Financial Economic Alteration**: The validated selected contracts retain all approved economics:
   - M1 multi-challenger tranche ladder
   - Neutral INVALID settlement with 100% principal refunds and zero fee deduction
   - Immutable oracle and global exposure caps
   - Two-phase release approval and mandatory 24-hour delay

---

## 2. Compiler Settings & Verification

| Setting | Value | Rationale |
| :--- | :--- | :--- |
| **Solidity Version** | `0.8.37` | Latest pinned stable solc release |
| **EVM Target** | `paris` | Prevents Cancun opcodes (`TSTORE`, `TLOAD`, `MCOPY`) |
| **Optimizer** | `true` (50 runs) | Isolates deployment size and reduces runtime bytecode |
| **Via-IR** | `false` | Deterministic pipeline; compatible with Foundry stack |
| **Bytecode Hash** | `none` | Eliminates CBOR metadata discrepancies across build environments |

---

## 3. Contract ABI & Selector Breakdown

### A. SelectedMarketFactory
- **Functions (45)**:
  - Market Creation: `createMarket(bytes32,uint64,uint64,uint256,uint256)`
  - Trading: `predict(uint256,uint8)`
  - Proposals: `propose(uint256,uint8,uint256,bytes32)`
  - Disputes: `challenge(uint256,uint256,bytes32)`
  - Claims: `claim(uint256)`, `claimBond(uint256,uint8,address)`, `claimRefund(uint256)`
  - Views: `getMarket(uint256)`, `getDisputeState(uint256)`, `getPool(uint256)`, `getChallengerTranches(uint256)`
- **Errors (19)**:
  - `AlreadyClaimed()`: Strictly enforced on second withdrawal attempts
  - `Unauthorized()`: Enforced on role and ownership mismatches
  - `InvalidState()`: Enforced on phase timing violations
  - `MarketClosed()`, `WindowElapsed()`, `CapacityExceeded()`, `SolvencyViolation()`
- **Events (17)**:
  - `MarketCreated`, `PredictionPlaced`, `ProposalSubmitted`, `MarketChallenged`, `MarketResolved`, `MarketCancelled`, `ClaimExecuted`

### B. ProtocolConfig
- **Functions (35)**:
  - Role management: `guardian()`, `governance()`, `compliance()`, `arbitrator()`
  - Lifecycle: `pause()`, `unpause()`, `activateFinance()`, `approveRelease(uint64)`
  - Exposure: `exposureCap()`, `oracleExposureCap(address)`
- **Errors (9)**:
  - `Unauthorized()`, `Paused()`, `InvalidRelease()`, `DelayNotElapsed()`, `BindingLocked()`
- **Events (8)**:
  - `PausedStateChanged`, `ReleaseApproved`, `FinanceActivated`, `FactoryBound`
