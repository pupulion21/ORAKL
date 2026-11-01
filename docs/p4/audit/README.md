# ORAKL Protocol — P4 Independent Security Auditor Handoff Package

> **VERDICT**: `P4 INTERNAL AUDIT HANDOFF READY — EXTERNAL AUDIT NOT PERFORMED — PUBLIC RELEASE BLOCKED`
>
> **Repository Baseline Commit**: `c8cda059275cf2efc77e46b3133a967fd10335fb`
> **Finalized Source Commit**: `cfa52b9b20ec9576e871a00f9d691cb68bc86047`
> **Target Branch**: `feature/orakl-p4-audit-readiness`
> **Target Network**: Local Isolated Anvil Chain ID 31337 (Public QIE Testnet/Mainnet BLOCKED)
> **Compiler Profiles**:
> - **ORAKL Protocol Core**: Solidity `0.8.37`, EVM `paris`, `via_ir: false`, optimizer `runs: 50`
> - **Official Safe Upstream**: Solidity `0.7.6`, default EVM (`berlin`/`istanbul`), optimizer `runs: 200`
> **Primary Security Standard**: Genuine, Unmodified Safe Global v1.4.1 Multisig Control + Fail-Closed ProtocolConfig Enforcement

---

## 1. Executive Summary

This package provides an exhaustive, reproducible, and verifiable audit dossier for the ORAKL Protocol smart contract architecture and governance subsystems.

ORAKL is an EVM-compatible decentralized prediction market protocol designed for high-integrity settlement, featuring:
- **Canonical Multi-Role Governance**: Separation of powers across three disjoint 3-of-5 multisig Safes (`Governance`, `Compliance`, `Arbitration`) powered by unmodified official Safe Global v1.4.1 contracts.
- **Fail-Closed Financial Activation**: Timelocked 24-hour staging requirement strictly guarded by Compliance Safe approval before financial activity can begin.
- **Emergency Circuit Breaker**: Permissionless and Guardian-triggered pause mechanics with automatic role-drift detection and immediate financial interruption.
- **Isolated Dispute Resolution**: Bounded arbitration windows, immutable exposure caps, and neutral-INVALID fallback economics.

---

## 2. Auditor Orientation & Document Map

| Document | Description | Key Focus Areas |
| :--- | :--- | :--- |
| [SCOPE.md](./SCOPE.md) | In-scope contracts, out-of-scope files, SLOC, compiler settings | Protocol contracts, interfaces, libraries, Solc 0.8.37 (Paris) settings |
| [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) | Exact commands and environments to reproduce all test suites | Frozen lockfile installation (`npm ci`), Foundry builds, manifest generation |
| [THREAT_MODEL.md](./THREAT_MODEL.md) | Comprehensive threat model, trust assumptions, actor profiles | Multi-sig collusion, flash loans, front-running, timelock bypass |
| [FINDINGS_REGISTER.md](./FINDINGS_REGISTER.md) | Internal security findings register (P0–P4) with verification proofs | Remediation implemented, regression verified, pending external audit |
| [TEST_EVIDENCE.md](./TEST_EVIDENCE.md) | Empirical test results across smart contracts, backend, frontend | 244 Foundry tests, 28 Safe scenarios, 12 security mutations |
| [DEPENDENCY_PROVENANCE.md](./DEPENDENCY_PROVENANCE.md) | Pinned SHAs, upstream package details, Safe Global parity | Safe v1.4.1 runtime codehashes, OpenZeppelin contracts |
| [RELEASE_BLOCKERS.md](./RELEASE_BLOCKERS.md) | Explicit statement of why public release is strictly BLOCKED | Pending independent audit, key ceremonies, legal signoff |

---

## 3. Architecture Overview

```
                      +-----------------------------------------+
                      |       Official Safe v1.4.1 Singleton     |
                      | Canonical Address: 0x41675C099...      |
                      | Codehash: 0x1fe2df852ba3299...         |
                      +--------------------+--------------------+
                                           | (Delegatecall via SafeProxy)
       +-----------------------------------+-----------------------------------+
       |                                   |                                   |
+------v----------------+          +-------v---------------+          +--------v--------------+
|   Governance Safe     |          |    Compliance Safe    |          |   Arbitration Safe    |
|   (3-of-5 Multisig)   |          |   (3-of-5 Multisig)   |          |   (3-of-5 Multisig)   |
+-----------+-----------+          +-----------+-----------+          +-----------+-----------+
            |                                  |                                  |
            | bindFactory / setParams          | approveRelease                   | settleDispute
            | unpause / activateFinance        | (Release Tag)                    | (Market ID)
            v                                  v                                  v
+---------------------------------------------------------------------------------------------+
|                                     ProtocolConfig.sol                                      |
|  - Manages immutable role bindings and disjoint owner validation                            |
|  - Enforces 24-hour timelock delay on finance activation                                   |
|  - Role-drift monitoring via requireArbitrator()                                           |
|  - Immediate emergency pause via Guardian EOA                                              |
+----------------------------------------------+----------------------------------------------+
                                               |
                                               v
+---------------------------------------------------------------------------------------------+
|                                  SelectedMarketFactory.sol                                  |
|  - Creates and manages prediction markets with fixed pilot caps                             |
|  - Implements immutable exposure accounting (global: 300 ETH, arbitrator: 200 ETH)         |
|  - Transitions markets: OPEN -> CLOSED -> PROPOSED -> DISPUTED -> FINALIZED                 |
+---------------------------------------------------------------------------------------------+
```

---

## 4. Primary Auditor Boundaries & Operational Constraints

- **Testing Environment**: Strictly isolated local Anvil (`chainId 31337`).
- **Forbidden Actions**: No transactions to public QIE testnet or mainnet. No real cryptographic keys or live funds.
- **Audit Scope Boundary**: Upstream Safe v1.4.1 contracts are audited separately by tier-1 firms. The primary subject of this audit handoff is ORAKL core protocol contracts, timelock and permission boundaries, dispute settlement mechanics, and the Safe multi-sig integration layer.
