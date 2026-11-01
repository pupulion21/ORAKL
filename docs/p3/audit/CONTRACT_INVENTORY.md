# ORAKL Protocol — Contract Inventory & Scope Partition

**Document ID:** `ORAKL-P3-CONTRACT-INVENTORY`  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Date:** 2026-11-01  

> [!IMPORTANT]
> This inventory partitions the codebase into four strictly separated categories to assist auditors in identifying target scopes, upstream third-party sources, test doubles, and off-chain infrastructure.

---

## 1. Category A — ORAKL Core Protocol (Primary Audit Scope)

Compiled with Solidity `0.8.37` (`evm_version = paris`, `optimizer_runs = 50`).

| Contract Path | Role / Description | LOC | Solc | Status |
| :--- | :--- | :---: | :---: | :---: |
| [`contracts/src/SelectedMarketFactory.sol`](file:///home/pupulion/orakl/contracts/src/SelectedMarketFactory.sol) | Production candidate factory implementing fixed-tier exposure caps and neutral INVALID settlement | 176 | 0.8.37 | Primary Scope |
| [`contracts/src/MarketFactory.sol`](file:///home/pupulion/orakl/contracts/src/MarketFactory.sol) | Core prediction market lifecycle, collateral accounting, and settlement | 258 | 0.8.37 | Primary Scope |
| [`contracts/src/ProtocolConfig.sol`](file:///home/pupulion/orakl/contracts/src/ProtocolConfig.sol) | Multi-role governance, 24h timelock, guardian pause, and multisig fingerprint checks | 286 | 0.8.37 | Primary Scope |
| [`contracts/src/libraries/ProtocolTypes.sol`](file:///home/pupulion/orakl/contracts/src/libraries/ProtocolTypes.sol) | Protocol-wide structs, enums (State, Disposition), and parameter definitions | 62 | 0.8.37 | Primary Scope |
| [`contracts/src/interfaces/IProtocolConfig.sol`](file:///home/pupulion/orakl/contracts/src/interfaces/IProtocolConfig.sol) | Interface defining config queries, pause status, and role authentication gates | 42 | 0.8.37 | Primary Scope |
| [`contracts/src/interfaces/IMultisig.sol`](file:///home/pupulion/orakl/contracts/src/interfaces/IMultisig.sol) | Interface defining standard `getOwners()` and `getThreshold()` calls | 12 | 0.8.37 | Primary Scope |

---

## 2. Category B — Official Safe Global Core Protocol (Upstream Pinned)

Compiled with Solidity `0.7.6` (`evm_version = istanbul`, `optimizer = false`). Unmodified upstream sources from `@safe-global/safe-contracts@1.4.1-2` (Commit `aa14911666deb13cdbbe37c37253a55918525437`).

| Contract Path | Role / Description | Solc | Codehash Verified |
| :--- | :--- | :---: | :---: |
| [`contracts/p3-safe/src/Safe.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/Safe.sol) | Official Safe mastercopy singleton | 0.7.6 | `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4` |
| [`contracts/p3-safe/src/proxies/SafeProxyFactory.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/proxies/SafeProxyFactory.sol) | Official proxy deployer with `createProxyWithNonce` | 0.7.6 | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |
| [`contracts/p3-safe/src/proxies/SafeProxy.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/proxies/SafeProxy.sol) | Official minimal proxy delegatecalling singleton | 0.7.6 | Dynamic per proxy |
| [`contracts/p3-safe/src/base/OwnerManager.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/base/OwnerManager.sol) | Linked list owner tracking and threshold validation | 0.7.6 | Library (Internal) |
| [`contracts/p3-safe/src/base/ModuleManager.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/base/ModuleManager.sol) | Safe module execution manager | 0.7.6 | Library (Internal) |
| [`contracts/p3-safe/src/base/GuardManager.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/base/GuardManager.sol) | Safe execution guard manager | 0.7.6 | Library (Internal) |
| [`contracts/p3-safe/src/base/FallbackManager.sol`](file:///home/pupulion/orakl/contracts/p3-safe/src/base/FallbackManager.sol) | Fallback handler routing | 0.7.6 | Library (Internal) |

---

## 3. Category C — Test Doubles & Simulation Fixtures (Non-Production)

These contracts exist solely for Foundry unit tests and simulated scenarios. They are **never deployed to production**.

| Contract Path | Role / Description |
| :--- | :--- |
| [`contracts/test/Safe3Of5.sol`](file:///home/pupulion/orakl/contracts/test/Safe3Of5.sol) | Legacy lightweight simulation mock emulating `getOwners()` and `getThreshold()`. |
| [`contracts/test/MockERC20.sol`](file:///home/pupulion/orakl/contracts/test/MockERC20.sol) | Disposable ERC-20 token for collateral testing. |
| [`contracts/src/QiePredictionMarket.sol`](file:///home/pupulion/orakl/contracts/src/QiePredictionMarket.sol) | Legacy standalone Testnet monolithic contract preserved for historical reference. |

---

## 4. Category D — Integration & Verification Infrastructure

Off-chain scripts and test suites automating deployment, verification, and governance checks.

| Path | Role / Description |
| :--- | :--- |
| [`scripts/p3/safe-lib.mjs`](file:///home/pupulion/orakl/scripts/p3/safe-lib.mjs) | Canonical Safe deployment, EIP-712 transaction signing, and execution library |
| [`scripts/p3/test-real-safe.mjs`](file:///home/pupulion/orakl/scripts/p3/test-real-safe.mjs) | 28-scenario integration test runner against live Anvil |
| [`scripts/p2/verify-deployment.mjs`](file:///home/pupulion/orakl/scripts/p2/verify-deployment.mjs) | On-chain deployment verification gate with fail-closed trust anchors |
| [`backend/test/safe-governance-live.test.ts`](file:///home/pupulion/orakl/backend/test/safe-governance-live.test.ts) | Vitest automated integration suite for Safe governance |
| [`backend/test/deployment-verification-live.test.ts`](file:///home/pupulion/orakl/backend/test/deployment-verification-live.test.ts) | Vitest automated integration suite for deployment gate |
