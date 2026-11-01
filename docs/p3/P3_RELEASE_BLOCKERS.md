# ORAKL Protocol — P3 Public Release Blockers & Operational Gate

**Document ID:** `ORAKL-P3-RELEASE-BLOCKERS`  
**Current Protocol Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Date:** 2026-11-01  

> [!CAUTION]
> **PUBLIC RELEASE PROHIBITED:**  
> The completion of ORAKL P3 proves that canonical Safe Global v1.4.1 contracts can be successfully integrated, deployed, and executed in an isolated local Anvil environment. It does NOT approve or authorize public testnet deployment, public mainnet deployment, broadcast of public-chain transactions, or the management of real financial value.

---

## 1. Absolute Release Blockers

The following criteria constitute mandatory release blockers. Public deployment and financial activation remain strictly blocked until all blockers are formally closed:

| Blocker ID | Domain | Requirement | Current Status | Remediation Required |
| :---: | :--- | :--- | :---: | :--- |
| **BLK-01** | **External Audit** | Independent security audit by a reputable third-party firm. | **OPEN / BLOCKED** | Formally engage an independent security auditing firm using `docs/p3/audit/`. |
| **BLK-02** | **Key Ceremony** | Multi-party key generation ceremony for Governance, Compliance, and Arbitration Safes. | **OPEN / BLOCKED** | Execute air-gapped key generation with hardware signing modules (HSM) across 15 distinct entities. |
| **BLK-03** | **Economic Approval**| Formal governance approval of production economics, fee parameters, and pool caps. | **OPEN / BLOCKED** | Provisional test settings (200 bps fee, 50 ETH cap) are local engineering baselines only. |
| **BLK-04** | **Legal & Regulatory**| Legal compliance review of prediction market operations in target jurisdictions. | **OPEN / BLOCKED** | Obtain formal legal opinions regarding jurisdictional regulatory requirements. |
| **BLK-05** | **RPC Infrastructure**| Certified high-availability RPC endpoints with DDoS and rate-limit SLAs. | **OPEN / BLOCKED** | Validate redundant public RPC infrastructure and failover configurations. |
| **BLK-06** | **Production Manifest**| Signed, independent deployment manifest anchored on public mainnet. | **OPEN / BLOCKED** | Generate and cryptographically sign production deployment manifests. |

---

## 2. Permitted Operations

The following engineering activities are authorized:
- Execution of Foundry test suites on local simulation environments.
- Execution of backend Vitest integration suites against local Anvil instances.
- Execution of frontend unit and end-to-end tests against local development servers.
- Reproduction of multi-compiler builds in isolated local workspaces.
- Handoff of documentation and reproduction packages to external auditors.

---

## 3. Prohibited Operations

The following activities remain strictly prohibited:
- Deploying any contract to QIE Testnet or QIE Mainnet.
- Broadcasting any transaction to a public blockchain network.
- Creating production Safe wallets with real funds.
- Enabling financial activity (`activateFinance()`) on any public network.
- Accepting or custodying real user deposits or tokens.
