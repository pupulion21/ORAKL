# ORAKL Protocol — Smart Contract Inventory & Bytecode Identity

- **Document ID**: `ORAKL-P2-INVENTORY-001`
- **Compiler Version**: `0.8.37+commit.f401782d`
- **EVM Version**: `paris`
- **Optimizer**: Enabled, `runs = 50`
- **Date**: 2026-11-01

---

## 1. Production Contract Scope

The core ORAKL protocol contracts subject to security audit are located in `contracts/src/`:

| Contract Name | Source File | Lines of Code | Runtime Size (Bytes) | Size Margin (< 24,576 B) | Unlinked Runtime Keccak-256 Codehash | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`SelectedMarketFactory`** | `contracts/src/SelectedMarketFactory.sol` | 890 | 19,084 B | 5,492 B (77.6% of cap) | `0xc161294828d00ae957972ba8bc0d983680f2393fe6cdd650c12ed5cfadb4332f` | Market creation, escrow custody, prediction contributions, proposal/challenge lifecycle, settlement, reward/refund disbursements |
| **`ProtocolConfig`** | `contracts/src/ProtocolConfig.sol` | 385 | 8,508 B | 16,068 B (34.6% of cap) | `0xaed346cc6bdb2d85536b5d320058822be4a355b2ef417bffe07ce3bfcd25b5fe` | Role-based governance, 24-hour timelock enforcement, emergency pause circuit breaker, protocol parameter management |
| **`ProtocolTypes`** | `contracts/src/ProtocolTypes.sol` | 145 | Interface/Library | N/A | N/A | Canonical type definitions, enums (`MarketState`, `Outcome`), parameter and market structs |
| **`ISelectedMarketFactory`** | `contracts/src/ISelectedMarketFactory.sol` | 110 | Interface | N/A | N/A | External interface for factory operations and market queries |
| **`IProtocolConfig`** | `contracts/src/IProtocolConfig.sol` | 65 | Interface | N/A | N/A | External interface for configuration and governance inspection |

---

## 2. Governance Fixture & Auxiliary Contracts

The following governance and testing contracts are used to verify multi-signature governance integration:

| Contract Name | Source File | Compiler Target | Role in Verification | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`Safe3Of5`** | `contracts/test/governance/Safe3Of5.sol` | Solidity `0.8.37` (Paris) | Canonical Safe EIP-712 multisig contract with threshold 3-of-5 | Implements threshold validation, ascending signature ordering, and nonce replay defense matching Safe v1.3.0/v1.4.1 mechanics |
| **`SafeGovernanceTest`** | `contracts/test/governance/SafeGovernance.t.sol` | Solidity `0.8.37` (Paris) | 9 integration tests verifying Safe threshold enforcement and timelock delays | Simulates 5 independent disposable signers interacting with `ProtocolConfig` |

---

## 3. External Dependencies & Zero External Library Policy

1. **Zero External OpenZeppelin Imports**:
   - The core protocol contracts do NOT import external npm OpenZeppelin packages at runtime.
   - All cryptographic primitives (e.g. `ecrecover`, `keccak256`) and arithmetic checks are implemented natively in Solidity 0.8.37 with built-in overflow/underflow protection.
2. **Deterministic Immutables**:
   - `SelectedMarketFactory` binds its `ProtocolConfig` reference as an immutable storage slot set at deployment time.
   - No proxy delegatecall patterns are utilized in the core market logic; contracts are directly deployed singletons.
