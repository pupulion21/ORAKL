# ORAKL Protocol — Skill Execution Evidence: Matt Pocock & QIE-FORGE

**Document ID:** `ORAKL-P3-SKILL-EXECUTION-EVIDENCE`  
**Execution Context:** `feature/orakl-p3-canonical-safe`  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Date:** 2026-11-01  

---

## 1. Matt Pocock Skills Execution

### 1.1 `diagnosing-bugs`
- **Defect 1 — SelectedMarketFactory Constructor Signature:**
  - *Observation:* Viem reported `AbiEncodingLengthMismatchError: Expected length (params): 1 Given length (values): 2`.
  - *Root Cause:* `SelectedMarketFactory.sol` inherits `MarketFactory(config)` and takes only 1 constructor parameter (`IProtocolConfig config`). The cap is derived directly from `config.parameters().poolCap`.
  - *Remediation:* Updated runner to pass only `[configAddress]`.
- **Defect 2 — Parameter Requirements in `SelectedMarketFactory._validateTerms`:**
  - *Observation:* Reverted with custom error `0x420075ea` (`InvalidSelectedTerms()`).
  - *Root Cause:* Factory enforces strict terms matching selected economics (`feeBps == 200`, `proposalBond == poolCap / 10`, `challengeBond == poolCap / 100`, `challengePeriod == 48 hours`, `arbitrationPeriod == 96 hours`).
  - *Remediation:* Corrected `initialParameters` in `test-real-safe.mjs` to match exact required economics.
- **Defect 3 — Safe Subcall Revert (`GS013`):**
  - *Observation:* Calling `execTransaction` for premature finance activation threw `GS013`.
  - *Root Cause:* In Safe v1.4.1, when `safeTxGas == 0` and `gasPrice == 0`, if the target subcall reverts, Safe requires success and reverts with `"GS013"`.
  - *Remediation:* Wrapped expected failure scenarios in `try...catch` and verified both the revert and the unchanged target contract state.
- **Defect 4 — TypeScript NodeNext MJS Resolution (`TS7016`):**
  - *Observation:* `tsc --noEmit` failed with `Could not find a declaration file for module '../../scripts/p3/safe-lib.mjs'`.
  - *Root Cause:* Under NodeNext resolution, declaration files for `.mjs` modules must be named `.d.mts`, not `.d.ts`.
  - *Remediation:* Created `scripts/p3/safe-lib.d.mts` and `scripts/p3/test-real-safe.d.mts`.

### 1.2 `tdd`
- **Cycle 1 — Live Deployment Verification:**
  - *Red:* Created `backend/test/deployment-verification-live.test.ts` expecting fail-closed behavior on missing trust anchor.
  - *Green:* Updated `scripts/p2/verify-deployment.mjs` to mandate `hasTrustAnchor` with all four cryptographic commitments. Tests passed.
  - *Refactor:* Cleaned up error messages and dynamic selector derivations.
- **Cycle 2 — Safe 3-of-5 Execution:**
  - *Red:* Built 28 test scenarios against real Safe proxy instances; identified and caught signature order, domain mismatch, and quorum failure states.
  - *Green:* Implemented ascending signer ordering and EIP-712 hashing in `scripts/p3/safe-lib.mjs`. All 28 scenarios passed green.

### 1.3 `codebase-design`
- **Seam Architecture:**
  - Official Safe Global v1.4.1 contracts isolated completely under `contracts/p3-safe/` with independent compiler settings (`0.7.6`).
  - ORAKL core protocol contracts maintained under `contracts/src/` (`0.8.37`).
  - Legacy test fixture `Safe3Of5.sol` preserved under `contracts/test/` strictly as a simulation fixture.

---

## 2. QIE-FORGE Framework Execution

### 2.1 Module D04 — Smart Contracts
- Configured multi-compiler Foundry architecture ensuring that Solc 0.8.37 and Solc 0.7.6 execute in clean isolation.
- Verified that official Safe bytecode targets EVM Istanbul and contains zero instances of `PUSH0` or `TSTORE`/`TLOAD`.

### 2.2 Module D05 — Wallets
- Deployed real Safe v1.4.1 proxies for Governance, Compliance, and Arbitration roles.
- Enforced complete separation of powers via `ProtocolConfig._walletState()` and `_disjoint()`.

### 2.3 Module D06 — Transactions
- Implemented full EIP-712 structured data signing pipeline in `scripts/p3/safe-lib.mjs`.
- Verified monotonically increasing nonces, ascending signature packing, and domain separator isolation.

### 2.4 Module D13 — Debugging
- Debugged custom contract errors via `toFunctionSelector` analysis (`0x420075ea` -> `InvalidSelectedTerms()`, `0x07de2154` -> `InvalidMultisig()`).
- Inspected Anvil transaction traces and receipts to verify exact gas bounds.

### 2.5 Module D14 — Deployment
- Hardened `scripts/p2/verify-deployment.mjs` to fail closed if independent trust anchors are missing.
- Verified live deployment and contract linkage on isolated Anvil chain ID 31337.
