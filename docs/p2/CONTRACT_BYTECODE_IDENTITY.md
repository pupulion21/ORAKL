# ORAKL Protocol — Contract Bytecode Identity Manifest

- **Document ID**: `ORAKL-P2-BYTECODE-001`
- **Date**: 2026-11-01
- **Status**: `REPRODUCIBLE BUILD IDENTITY`

---

## 1. Bytecode Hashes and Identifiers

The cryptographic identities below are generated from pinned solc `0.8.37`, optimizer runs `50`, and `evm_version = "paris"`.

### A. SelectedMarketFactory
- **Source Path**: `contracts/src/SelectedMarketFactory.sol`
- **Solc Version**: `0.8.37+commit.f401782d`
- **EVM Target**: `paris`
- **Optimizer**: `50 runs`
- **Runtime Bytecode Size**: `19,084 bytes`
- **Deployed Codehash (Keccak-256)**:
  `0xc161294828d00ae957972ba8bc0d983680f2393fe6cdd650c12ed5cfadb4332f`
- **Initcode Size**: `20,368 bytes`
- **Immutable References**:
  - `config` (`ProtocolConfig` address slot)

### B. ProtocolConfig
- **Source Path**: `contracts/src/ProtocolConfig.sol`
- **Solc Version**: `0.8.37+commit.f401782d`
- **EVM Target**: `paris`
- **Optimizer**: `50 runs`
- **Runtime Bytecode Size**: `8,508 bytes`
- **Deployed Codehash (Keccak-256)**:
  `0xaed346cc6bdb2d85536b5d320058822be4a355b2ef417bffe07ce3bfcd25b5fe`
- **Initcode Size**: `11,420 bytes`

### C. Preserved Historical Contracts
- **MarketFactory (P0.3)**: `15,859 bytes` runtime
- **QiePredictionMarket (Legacy Testnet)**: `13,906 bytes` runtime
