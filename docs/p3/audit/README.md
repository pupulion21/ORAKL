# ORAKL Protocol — Independent Auditor Handoff Package

**Audit Package ID:** `ORAKL-P3-AUDITOR-HANDOFF`  
**Target Git Branch:** `feature/orakl-p3-canonical-safe`  
**P2 Baseline Commit:** `8bc1c0a1385dee3bc50142ab979bb109c2ee9ff0`  
**Date:** 2026-11-01  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  

> [!IMPORTANT]
> **AUDITOR SCOPE STATEMENT:**  
> This package is prepared for independent security auditors evaluating the ORAKL prediction market protocol and its multi-party governance integration. All financial activation remains administratively and cryptographically disabled. Local verification evidence does not constitute an audit signoff or production deployment authorization.

---

## 1. Directory Contents

The auditor handoff package consists of four authoritative modules:

| Document | Purpose |
| :--- | :--- |
| [CONTRACT_INVENTORY.md](file:///home/pupulion/orakl/docs/p3/audit/CONTRACT_INVENTORY.md) | Exhaustive inventory partitioning ORAKL core contracts, official Safe sources, and test fixtures. |
| [REPRODUCIBILITY_GUIDE.md](file:///home/pupulion/orakl/docs/p3/audit/REPRODUCIBILITY_GUIDE.md) | Step-by-step instructions to reproduce builds, verify bytecodes, and execute test suites. |
| [SECURITY_INVARIANTS.md](file:///home/pupulion/orakl/docs/p3/audit/SECURITY_INVARIANTS.md) | Formal specification of protocol financial, governance, and arbitration invariants. |
| [SAFE_GOVERNANCE_THREAT_MODEL.md](../SAFE_GOVERNANCE_THREAT_MODEL.md) | Exhaustive 21-vector threat analysis spanning multi-party governance and protocol integration. |

---

## 2. Core Cryptographic Commitments

### 2.1 ORAKL Core Protocol Contracts (Solc 0.8.37, EVM Paris)
- **`SelectedMarketFactory.sol`**:
  - ABI SHA-256: `0x6c2afa5a7277da5962e6e9364aa6bd66fd289ada21fcc229d336023ffe3c7fdc`
  - Runtime Codehash: `0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a`
- **`ProtocolConfig.sol`**:
  - ABI SHA-256: `0xc9cfb7dbff2c16fe6f1b8aa5b0be64e355f164e052f7af3aaf4fa04a6e176b8d`
  - Runtime Codehash: `0x418d1b9ebdf9fcdf2ce444d4bd898042aad86651aebb21d3f56b98c8c9950b5e`

### 2.2 Canonical Safe Core Protocol v1.4.1 (Solc 0.7.6, EVM Istanbul)
- **`Safe.sol` (Singleton)**:
  - Canonical Runtime Codehash: `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4`
  - Upstream Commit: `aa14911666deb13cdbbe37c37253a55918525437`
- **`SafeProxyFactory.sol`**:
  - Canonical Runtime Codehash: `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317`
  - Upstream Commit: `aa14911666deb13cdbbe37c37253a55918525437`

---

## 3. Scope Boundaries & Explicit Non-Claims

1. **No Real Funds or Mainnet Deployment**: All contracts are tested solely on local Anvil chains (`chainId: 31337`).
2. **Safe3Of5.sol Is a Test Double**: The file `contracts/test/Safe3Of5.sol` is preserved strictly as a lightweight legacy mock for existing unit tests; it is never deployed to production.
3. **Economics Non-Approval**: Selected economics (200 bps fee, 50 ETH pilot cap, neutral INVALID settlement) are local engineering baselines and remain non-approved for production.
