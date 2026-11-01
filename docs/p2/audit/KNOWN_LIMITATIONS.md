# ORAKL Protocol — Known Limitations & Architectural Boundaries

- **Document ID**: `ORAKL-P2-LIMITS-001`
- **Date**: 2026-11-01
- **Status**: `AUDIT TRANSPARENCY DISCLOSURE`

---

## 1. Smart Contract & Blockchain Limitations

### 1.1 Shanghai Hardfork Ceiling & Cancun Incompatibility
- **Limitation**: The QIE blockchain EVM currently supports Shanghai opcodes (`PUSH0` verified) but does NOT support Cancun transient storage opcodes (`TSTORE` `0x5d` and `TLOAD` `0x5c` revert with `invalid opcode`).
- **Design Consequence**: ORAKL contracts are strictly compiled targeting `paris` in `contracts/foundry.toml`. They do not use transient storage. Any future compiler upgrade must not enable Cancun without prior hardfork deployment on QIE.

### 1.2 Lack of Hosted Safe Transaction Service on QIE
- **Limitation**: Safe Global does not operate a hosted Safe Transaction Service (REST API) or Safe Web App (`app.safe.global`) on QIE Mainnet (1990) or Testnet (1983).
- **Design Consequence**: Multi-signature operations must be coordinated off-chain via signed EIP-712 messages and executed via CLI / custom relayer scripts or directly on-chain using `approveHash()`.

### 1.3 Sequential Single-Proposal Lifecycle per Market
- **Limitation**: Each market supports one active resolution proposal at a time. If challenged, it transitions directly to `DISPUTED` state for arbitration.
- **Design Consequence**: There is no recursive or branching proposal tree. This deliberately simplifies market state machines and prevents unbounded gas exhaustion attacks.

### 1.4 Local Multi-Sig Test Double (Safe3Of5.sol) & Blocked Official Safe Integration
- **Limitation**: Official Safe Global contracts (`@safe-global/safe-contracts`) are NOT integrated into local dependencies. Official contract integration is **BLOCKED** due to external dependency pinning constraints and Solc compiler versioning (pinned to 0.8.37). Local tests execute against a custom test fixture (`Safe3Of5.sol`).
- **Design Consequence**: Passing local governance tests verifies `ProtocolConfig` role mechanics with a 3-of-5 threshold test double, but does NOT constitute verification of official Safe Global smart contracts or real Safe deployment.

---

## 2. Off-Chain Service Limitations

### 2.1 Indexer Polling Latency
- **Limitation**: The backend PostgreSQL indexer operates via RPC block polling (default interval: 500 ms) rather than native WebSockets or direct node IPC.
- **Design Consequence**: Real-time UI updates exhibit a bounded latency of ~500 ms to 1 second following transaction inclusion in a mined block.

### 2.2 Local Evidence Storage Directory
- **Limitation**: In the local simulation environment, evidence manifests and content are persisted to local filesystem directories and database tables rather than IPFS or Arweave.
- **Design Consequence**: For decentralized production release, content storage must bridge to decentralized storage networks (e.g. Greenfield / IPFS) with content-hash anchoring.
