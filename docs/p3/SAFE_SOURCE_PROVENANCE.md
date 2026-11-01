# ORAKL Protocol — Official Safe Source Provenance & Verification

- **Document ID**: `ORAKL-P3-PROVENANCE-001`
- **Date**: 2026-11-01
- **Status**: `VERIFIED & PINNED`
- **Upstream Target**: Official Safe Global Core Protocol v1.4.1

---

## 1. Upstream Source Identity & Provenance

To eliminate custom test double risks (`BLK-07`) and achieve institutional security readiness, ORAKL pins official, unmodified Safe Global smart contracts for protocol multi-signature governance (Governance Safe, Compliance Safe, and Arbitration Safe).

| Attribute | Upstream Identity / Value |
| :--- | :--- |
| **Upstream Repository** | `https://github.com/safe-global/safe-contracts` (mirror: `safe-fndn/safe-smart-account`) |
| **Release Tag** | `v1.4.1` |
| **Exact Git Commit** | `aa14911666deb13cdbbe37c37253a55918525437` |
| **NPM Source Package** | `@safe-global/safe-contracts` @ `1.4.1-2` |
| **NPM Package Shasum** | `1cb195808db860402403efa1f9ee6644b6403184` |
| **NPM Deployments Package** | `@safe-global/safe-deployments` @ `1.37.66` |
| **Deployments Package Shasum**| `d0738a50c99213068e3c6bf046505e309e172364` |

---

## 2. Cryptographic Fingerprints & Artifact Verification

All contracts are verified against official canonical deployments deployed across 400+ EVM networks by the Safe Foundation:

### 2.1 Safe Singleton (`Safe.sol`)
- **Source Path**: `contracts/Safe.sol`
- **Source SHA-256**: `0xefd3301ed5c6bf522fb3a7a43be4a27341e65dff6d1fee04f8567f304a67e365`
- **Compiler Version**: Solidity `0.7.6+commit.7338295f`
- **Compiler Settings**: Optimizer enabled (`runs = 200`), EVM target: default (`berlin`/`istanbul`)
- **ABI SHA-256**: `0x69ad1fe2bf3622b0c0561206cdc40477134258f4c55965e490acc16e5a24bfd3`
- **Canonical Address (L1 / Multichain)**: `0x41675C099F32341bf84BFc5382aF534df5C7461a`
- **Runtime Bytecode Keccak-256**: `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4`
- **Runtime Bytecode Length**: 23,579 bytes (conforms to EIP-170 limit of 24,576 bytes; margin: 997 bytes)

### 2.2 Safe Proxy Factory (`SafeProxyFactory.sol`)
- **Source Path**: `contracts/proxies/SafeProxyFactory.sol`
- **Source SHA-256**: `0x0bf51e2baa3945a0e975d602d85aec63f49513e4c4a159e1c538d0a5f0808889`
- **Compiler Version**: Solidity `0.7.6+commit.7338295f`
- **Compiler Settings**: Optimizer enabled (`runs = 200`), EVM target: default
- **ABI SHA-256**: `0x96a106fb0615c1236632905a41bd4537a8ccbd77af2dddca882c12b0e2ec180b`
- **Canonical Address**: `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`
- **Runtime Bytecode Keccak-256**: `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317`
- **Runtime Bytecode Length**: 3,054 bytes

---

## 3. Upstream Security Audits & Formal Verification

Official Safe Core Protocol v1.4.1 has undergone rigorous independent audits by tier-1 security firms:

1. **Ackee Blockchain Security Audit** (April 2023):
   - Scope: Complete Safe Core v1.4.1 smart contracts.
   - Status: All reported issues addressed prior to tagged v1.4.1 release.
2. **Certora Formal Verification** (May 2023):
   - Scope: Invariants on access control, owner ordering, balance conservation, and signature replay defenses.
   - Formal rules mathematically proven over Safe Core state transitions.
3. **Runtime Verification** (2023):
   - Formal semantic verification of Safe execution invariants and module delegatecall boundaries.

> [!NOTE]
> Upstream Safe audits verify the Safe singleton and proxy factory in isolation. They do not constitute an audit of ORAKL's protocol contracts (`SelectedMarketFactory`, `ProtocolConfig`) or the ORAKL-Safe integration layer.

---

## 4. QIE Blockchain EVM & Opcode Compatibility Assessment

In P2, reproducible JSON-RPC probes against QIE Mainnet (`chainId 1990`) and QIE Testnet (`chainId 1983`) established:
- `PUSH0` (`0x5f`): Supported on QIE.
- `TSTORE`/`TLOAD` (`0x5d`/`0x5c`): **Unsupported** on QIE (returns `invalid opcode: opcode 0x5d not defined`).

### Compatibility Analysis for Safe v1.4.1:
1. **Solc 0.7.6 Pre-dates Shanghai and Cancun**:
   - Solidity `0.7.6` was released on January 14, 2021.
   - EIP-3855 (`PUSH0`) was introduced in Solidity `0.8.20` (Shanghai).
   - EIP-1153 (`TSTORE`/`TLOAD`) was introduced in Solidity `0.8.24` (Cancun).
   - Solc 0.7.6 produces EVM bytecode using `PUSH1 0x00` instead of `PUSH0`, and standard `SSTORE`/`SLOAD` for all state storage.
2. **Bytecode Scanning**:
   - Automated disassembly and scanning of `Safe.sol` runtime code confirms **zero** transient storage opcodes.
3. **EIP-170 Compliance**:
   - Runtime size of 23,579 bytes is within the 24,576 byte Spurious Dragon limit.
4. **Verdict**: Official Safe v1.4.1 is **100% compatible** with QIE EVM execution semantics and isolated local Anvil.

---

## 5. Non-Modification Policy

Under ORAKL P3 policy:
- No Safe contract is forked, patched, or modified.
- No Safe contract is backported or ported to Solidity 0.8.37.
- `Safe3Of5.sol` is preserved strictly as a historical legacy fixture and is not treated as canonical Safe.
- All real multisig governance evidence is generated exclusively by deploying and executing unmodified official Safe v1.4.1 contracts.
