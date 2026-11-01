# ORAKL Protocol — P2 Comprehensive Blocker Matrix

- **Document ID**: `ORAKL-P2-BLOCKER-MATRIX-001`
- **Date**: 2026-11-01
- **Authorized Verdict**: `P2 LOCAL READINESS VERIFIED — PUBLIC RELEASE BLOCKED`

---

## 1. Blocker Status Overview

| Category | Total Items | Verified Local | Blocking Public Release |
| :--- | :--- | :--- | :--- |
| **Smart Contract Security & EVM Compatibility** | 4 | 4 Passed (Local) | 1 (External Audit Sign-off) |
| **Governance Architecture & Keys** | 3 | 3 Passed (Local) | 1 (Production HSM Ceremony) |
| **Regulatory & Operational Compliance** | 2 | 2 Drafted | 2 (Counsel Opinion & Parameters) |
| **QIE Blockchain Infrastructure & SRE** | 3 | 2 Verified | 1 (Public RPC Redundancy) |
| **Backend & Deployment Trust** | 3 | 3 Passed (Local) | 0 (Technical Implementation Complete) |

---

## 2. Detailed Blocker Analysis & Path to Resolution

### Blocker 1: External Independent Security Audit (Tier-1 Firm)
- **Status**: **BLOCKING**
- **Impact**: Contracts cannot custody public user funds or be deployed to QIE Mainnet without external validation.
- **Remediation**:
  1. Hand off the audit package in `docs/p2/audit/` to external audit partner.
  2. Complete formal review cycle, address any findings, and verify fixes.
  3. Publish audit report hash on-chain in `ProtocolConfig.approveRelease(digest)`.

### Blocker 2: Hardware Multisig Key Ceremony (Safe 3-of-5)
- **Status**: **BLOCKING**
- **Impact**: Local tests utilize simulated disposable keys; production requires genuine physical custody across 5 independent signers.
- **Remediation**:
  1. Procure hardware security modules (Ledger / Trezor) for 5 distinct institutional signers.
  2. Perform ceremony on QIE Mainnet establishing Governance Safe (3-of-5) and Compliance Safe (3-of-5).
  3. Test offline EIP-712 signing CLI across all 5 participants.

### Blocker 3: Legal & Regulatory Classification Opinion
- **Status**: **BLOCKING**
- **Impact**: Operating prediction markets in various jurisdictions requires formal legal analysis regarding binary options and tokenized contracts.
- **Remediation**:
  1. Obtain formal legal memorandum from specialized counsel in primary target operating regions.
  2. Implement geo-fencing / compliance gating at frontend/backend layers as required by counsel.

### Blocker 4: Production Parameter Calibration
- **Status**: **BLOCKING**
- **Impact**: Current parameters (`feeBps: 200`, `creationBond: 1 ETH`, `proposalBond: 10 ETH`, `challengeBond: 1 ETH`) are provisional test figures.
- **Remediation**:
  1. Economic simulation of bond ratios against expected market liquidity and griefing attack costs.
  2. Formal sign-off on production parameter struct by Governance and Compliance councils.

### Blocker 5: Public QIE Testnet RPC Health & Redundancy
- **Status**: **BLOCKING (Infrastructure)**
- **Impact**: `rpc1testnet.qie.digital` is currently unreachable (port 443 refused), requiring reliance on single endpoint `rpc2testnet`.
- **Remediation**:
  1. Coordinate with QIE node operators to restore `rpc1testnet`.
  2. Configure multi-region load-balanced RPC proxies with automated health checks in backend service.
