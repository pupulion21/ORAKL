# ORAKL Protocol — Audit Scope Specification

> **Repository Baseline Commit**: `c8cda059275cf2efc77e46b3133a967fd10335fb`
> **Finalized Source Commit**: `cfa52b9b20ec9576e871a00f9d691cb68bc86047`
> **Target Branch**: `feature/orakl-p4-audit-readiness`
> **Toolchain Compiler Profiles**:
> - **ORAKL Protocol Core**: Solidity `0.8.37`, EVM `paris`, `via_ir: false`, optimizer `runs: 50`
> - **Official Safe Upstream**: Solidity `0.7.6`, default EVM (`berlin`/`istanbul`), optimizer `runs: 200`

---

## 1. In-Scope Smart Contracts

The following smart contracts comprise the ORAKL v1 protocol core and are submitted for formal independent audit:

| Contract File | SLOC | Primary Function / Purpose | Critical Security Invariants |
| :--- | :--- | :--- | :--- |
| `contracts/src/ProtocolConfig.sol` | 286 | System registry, role boundaries, timelocks, emergency controls | Role separation, 24h timelock enforcement, permissionless drift detection |
| `contracts/src/SelectedMarketFactory.sol` | 176 | Root market creation, pilot pool caps, immutable exposure accounting | Global and per-arbitrator exposure caps, terminal release |
| `contracts/src/MarketResolver.sol` | 144 | State transitions, challenge handling, dispute settlement | Arbitrator role verification, challenge deadline ordering, neutral-INVALID |
| `contracts/src/PredictionPool.sol` | 110 | User prediction deposits, contribution tracking, payout claims | Non-reentrancy, mathematical payout conservation |
| `contracts/src/ProtocolStorage.sol` | 147 | Abstract base state storage, market records, bond registries | State consistency, reentrancy guards |
| `contracts/src/MarketFactory.sol` | 63 | Preserved P0.3 market factory baseline | Backward compatibility, interface stability |
| `contracts/src/libraries/ProtocolTypes.sol` | 82 | Canonical structs, enums, outcome definitions, bond types | Type safety, outcome domain validity |
| `contracts/src/interfaces/IMultisig.sol` | 8 | Standard Safe-compatible multisig interface | External call safety |
| `contracts/src/interfaces/IProtocolConfig.sol` | 16 | External interface for ProtocolConfig | Strict interface boundary |

**Total In-Scope SLOC**: 1,032 lines of Solidity.

---

## 2. Out-of-Scope Files

The following contracts and files are explicitly **OUT OF SCOPE** for this audit engagement:

1. **`contracts/src/QiePredictionMarket.sol` (477 SLOC)**:
   - Historical Testnet legacy contract preserved strictly for backwards compatibility with the existing QIE testnet deployment.
   - Does not interact with `ProtocolConfig` or `SelectedMarketFactory`.
2. **`contracts/p3-safe/src/*`**:
   - Genuine, unmodified Safe Global v1.4.1 upstream contracts (`Safe.sol`, `SafeProxyFactory.sol`, `OwnerManager.sol`, etc.).
   - Audited independently by Safe Global / Ackee Blockchain / Certora / Runtime Verification. Pinned commit and bytecode hashes documented in [DEPENDENCY_PROVENANCE.md](./DEPENDENCY_PROVENANCE.md).
3. **`contracts/test/*`**:
   - Foundry test suites, unit tests, mock contracts, and invariant harnesses.
4. **`frontend/*` & `backend/*`**:
   - Off-chain UI and indexing infrastructure. Relevant only as consumers of contract ABI events.

---

## 3. Compiler & Build Configuration

All contract compilation settings are pinned in `contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
test = "test"
out = "out"
libs = ["lib"]
remappings = ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"]
solc_version = "0.8.37"
evm_version = "paris"
optimizer = false
bytecode_hash = "none"

additional_compiler_profiles = [{ name = "orakl", optimizer = true, optimizer_runs = 50, via_ir = false }]
compilation_restrictions = [
    { paths = "src/SelectedMarketFactory.sol", optimizer_runs = 50 },
    { paths = "src/MarketFactory.sol", optimizer_runs = 50 },
    { paths = "src/ProtocolConfig.sol", optimizer_runs = 50 },
]

[profile.default.fuzz]
runs = 2048
seed = "0x4f52414b4c503031"

[profile.default.invariant]
runs = 128
depth = 64
fail_on_revert = true
```

### EVM Target Compatibility Note
- EVM version is pinned to `paris` to guarantee total compatibility across both Ethereum Anvil simulation and QIE EVM targets, avoiding Shanghai (`PUSH0`) or Cancun (`TSTORE`/`MCOPY`) opcode incompatibilities on intermediate EVM nodes.
