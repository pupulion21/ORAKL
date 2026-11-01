# ORAKL Protocol — External Dependency & Provenance Verification

> **STATUS**: `INTERNAL EVIDENCE VERIFIED — EXTERNAL AUDIT NOT PERFORMED — PUBLIC RELEASE BLOCKED`

---

## 1. Upstream Official Safe Global v1.4.1 Provenance

The ORAKL Protocol relies exclusively on genuine, unmodified smart contracts from Safe Global for all multisig governance, compliance authorization, and dispute arbitration.

### Package & Upstream Source Identifiers
- **NPM Package**: `@safe-global/safe-contracts` @ `1.4.1-2`
- **Upstream Tag**: `v1.4.1`
- **Git Commit (gitHead)**: `aa14911666deb13cdbbe37c37253a55918525437`
- **Upstream Repository**: `https://github.com/safe-global/safe-contracts` (mirror: `safe-fndn/safe-smart-account`)
- **Upstream Compiler Profile**: Solidity `0.7.6+commit.7338295f`, optimizer enabled (`runs = 200`), default EVM target (`berlin`/`istanbul`)

### Verified Artifacts, Canonical Addresses & Observed Runtime Codehashes

| Component | Source Path / Artifact | Canonical Deployment Address | Observed Runtime Codehash (`keccak256`) | Runtime Size |
| :--- | :--- | :--- | :--- | :--- |
| **`Safe.sol` (Singleton)** | `contracts/p3-safe/canonical/Safe.json` | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4` | 23,579 bytes |
| **`SafeProxyFactory.sol`** | `contracts/p3-safe/canonical/SafeProxyFactory.json` | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` | 3,054 bytes |
| **`SafeProxy.sol`** | `contracts/p3-safe/canonical/SafeProxy.json` | *Deployed per instance by factory* | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` | 393 bytes |

> [!IMPORTANT]
> Canonical deployment addresses on Ethereum L1 (`0x4167...` and `0x4e1D...`) are multichain deployment addresses and MUST NOT be confused with runtime bytecode hashes (`keccak256(runtimeBytecode)`). Runtime verification compares actual deployed on-chain bytecode against the pinned codehashes above.

### On-Chain Integrity Verification Protocol
Every deployment and test in `scripts/p3/test-real-safe.mjs` and `scripts/p4/test-security-mutations.mjs` verifies the deployed runtime bytecode hash against these canonical codehashes:
- Singleton bytecode hash equality: `keccak256(singletonCode) === CANONICAL_SAFE_CODEHASH`
- Factory bytecode hash equality: `keccak256(factoryCode) === CANONICAL_FACTORY_CODEHASH`
- Proxy mastercopy pointer (storage slot `0x00...00`): points strictly to the verified singleton address before any proxy function is called.
- Module list: `getModulesPaginated` returns empty array.
- Guard slot (`0x4a204f620c8c...`): `0x00...00` (zero guards).
- Fallback handler slot (`0x6c9a6c4a3928...`): `0x00...00` or expected handler.

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

## 3. Third-Party Audits & Scope Boundary Notice

- **Upstream Safe Core v1.4.1**: Underwent independent security audits by Ackee Blockchain Security (April 2023), Certora Formal Verification (May 2023), and Runtime Verification (2023).
- **Scope Boundary**: Upstream Safe audits verify the official Safe singleton and proxy factory in isolation. They **DO NOT** constitute an audit of ORAKL protocol contracts (`ProtocolConfig`, `SelectedMarketFactory`, `MarketResolver`, `PredictionPool`, `ProtocolStorage`) or the ORAKL-Safe integration layer.
- **ORAKL Protocol Audit Status**: An independent third-party smart contract security audit of ORAKL has **NOT** yet been performed. All public release remains strictly **BLOCKED**.

---

## 4. Third-Party License Compliance

- **Safe Global Contracts**: Licensed under `LGPL-3.0-only`. Source code remains unmodified and isolated under `contracts/p3-safe/`.
- **OpenZeppelin Contracts**: Licensed under `MIT`.
- **ORAKL Protocol Core**: Proprietary / User-designated protocol license. Dynamically links to Safe via EVM `DELEGATECALL` conforming to LGPL-3.0 boundary requirements.
