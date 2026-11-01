# ORAKL Protocol — External Dependency & Provenance Verification

---

## 1. Upstream Official Safe Global v1.4.1 Provenance

The ORAKL Protocol relies exclusively on genuine, unmodified smart contracts from Safe Global for all multisig governance, compliance authorization, and dispute arbitration.

| Component | Upstream Source | Canonical Release Tag | Pinned Runtime Codehash (`keccak256`) |
| :--- | :--- | :--- | :--- |
| **`Safe.sol` (Singleton)** | `github.com/safe-global/safe-contracts` | `v1.4.1` | `0x41622798e1694f41dd3eb7c554589d81d200ce8834455de31f1dc1938fe76d29` |
| **`SafeProxyFactory.sol`** | `github.com/safe-global/safe-contracts` | `v1.4.1` | `0xeeab77c152ab5f14e7a2dfb421a15ee0ee9a4f41b31525a74abddf09fa92ee88` |
| **`SafeProxy.sol`** | `github.com/safe-global/safe-contracts` | `v1.4.1` | `0x19bb81005fbc5f22eb01ec2fb7692fb474d209d8463ad2a393cc54f28682a826` |

### Integrity Verification Protocol
Every deployment and test in `scripts/p3/test-real-safe.mjs` and `scripts/p4/test-security-mutations.mjs` strictly computes `keccak256(deployedBytecode)` on-chain and enforces exact equality against these canonical codehashes before admitting any contract into protocol governance.

### Storage Slot Conformance
For every deployed Safe proxy instance:
1. **Slot 0 (`0x00...00`)**: Must point strictly to the verified Safe v1.4.1 singleton address.
2. **Modules Slot**: `getModulesPaginated` must return an empty array (no external execution modules).
3. **Guard Slot (`0x4a204f620c8c...`)**: Must contain `0x00...00` (no arbitrary transaction guards).
4. **Fallback Handler Slot (`0x6c9a6c4a3928...`)**: Must match expected address or zero address.

---

## 2. OpenZeppelin Contracts

| Dependency | Repository | License | Purpose in ORAKL |
| :--- | :--- | :--- | :--- |
| `@openzeppelin/contracts` | `OpenZeppelin/openzeppelin-contracts` | MIT | Math utilities, reentrancy guards, safe casts |

Remappings are pinned in `contracts/foundry.toml`:
```toml
remappings = ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"]
```

---

## 3. Third-Party License Compliance

- **Safe Global Contracts**: Licensed under `LGPL-3.0-only`. The source code remains unmodified and isolated in `contracts/p3-safe/`.
- **OpenZeppelin Contracts**: Licensed under `MIT`.
- **ORAKL Protocol Core**: Proprietary / User-designated protocol license. Compatible with LGPL-3.0 dynamic linking via EVM `DELEGATECALL`.
