# ORAKL Protocol — Trust Assumptions & Security Boundaries

- **Document ID**: `ORAKL-P2-TRUST-001`
- **Date**: 2026-11-01
- **Status**: `AUDIT TRUST BOUNDARY SPECIFICATION`

---

## 1. Governance & Role Trust Assumptions

| Role | Entity / Structure | Trust Assumption | Failure Mode & Damage Radius |
| :--- | :--- | :--- | :--- |
| **Governance Safe** | 3-of-5 Gnosis Safe Multisig | At least 3 of 5 signers are honest, non-colluding, and retain control of their hardware private keys. | If 3+ signers collude: can modify protocol parameters and bind factory; strictly cannot bypass 24h timelock or approve releases without Compliance. |
| **Compliance Safe** | 3-of-5 Gnosis Safe Multisig | At least 3 of 5 signers are independent legal/compliance officers and do not collude with Governance. | If 3+ signers collude: can approve release digests; cannot activate finance or change parameters without Governance. |
| **Arbitration Authority** | 3-of-5 Multisig or dispute council | Settles contested market outcomes honestly and objectively based on verifiable real-world facts within 96 hours. | If corrupted: damage is bounded by `perArbitratorUnresolvedCap` (default: 200 ETH). Cannot access escrow of non-disputed markets. If offline: markets expire to INVALID (100% refund). |
| **Guardian Account** | Automated SRE key with multisig backup | Key is held securely in HSM; monitoring scripts only trigger upon genuine operational anomalies. | If compromised: attacker can call `pause()` or `deactivateFinance()`, causing temporary denial of service. Attacker **CANNOT** steal funds, approve releases, or unpause. |

---

## 2. Infrastructure & Blockchain Consensus Assumptions

1. **EVM Execution Fidelity**:
   - The underlying blockchain execution environment correctly implements EVM opcodes up to the Shanghai hardfork (including `PUSH0` support, excluding Cancun transient storage).
   - Smart contract arithmetic and storage semantics conform to standard Ethereum Virtual Machine specifications.
2. **Reorg Depth Bound**:
   - Deep reorganizations exceeding 50 blocks are considered catastrophic consensus failures requiring manual validator intervention.
   - The PostgreSQL indexer handles transient forks up to 50 blocks with automated rollback and replay.
3. **RPC Availability & Failover**:
   - At least one valid RPC endpoint remains reachable. If an endpoint fails (e.g. `rpc1testnet` connection refusal), the client/indexer automatically shifts to secondary endpoints (`rpc2testnet`).
4. **Off-Chain Time Synchronization**:
   - Block timestamps are assumed to advance monotonically within a standard drift window (typically $\le 15$ seconds). Contract logic avoids second-level granularity dependencies.

---

## 3. Cryptographic Primitives

- **secp256k1 & ECDSA**: Standard cryptographic security of ECDSA signatures with valid $v, r, s$ values.
- **Keccak-256**: Pre-image resistance and collision resistance of standard Ethereum Keccak-256 hash function.
- **EIP-712**: Structured data hashing prevents cross-contract and cross-chain transaction replays.
