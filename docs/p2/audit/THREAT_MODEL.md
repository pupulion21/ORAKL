# ORAKL Protocol — Threat Model & Security Analysis

- **Document ID**: `ORAKL-P2-THREAT-001`
- **Methodology**: STRIDE / DREAD & Formal Economic Attack Surface Analysis
- **Date**: 2026-11-01

---

## 1. Threat Modeling Overview

The ORAKL protocol manages escrowed native assets and economic incentives across decentralized prediction markets. The protocol's threat model evaluates potential attacks by adversaries ranging from opportunistic users to well-funded economic cartels, colluding arbitrators, compromised infrastructure nodes, and rogue signers.

---

## 2. Attack Vectors & Mitigations

### 2.1 Sybil & Malicious Challenger Attacks
- **Threat**: An adversary attempts to extract an unfair share of the proposal bond by submitting multiple challenges from Sybil addresses or timing challenges to front-run other honest participants.
- **Protocol Mitigation**:
  - Every challenge requires posting an unbacked `challengeBond` (e.g. 1.0 ETH).
  - The ladder cap restricts the maximum number of registered challengers (`maxChallengers = 3`).
  - Challenger bond distribution is calculated via remainder-free integer division:
    ```solidity
    share = totalProposerBond / challengerCount;
    // Remainder wei is deterministically granted to the first registered challenger
    ```
  - If the market is settled in favor of the proposer, **100% of all challenger bonds are slashed and burned or redistributed to the honest proposer**.

### 2.2 Proposer Bribery & False Outcome Proposals
- **Threat**: A rogue proposer submits an incorrect or fraudulent outcome proposal hoping nobody notices, attempting to steal the counter-pool.
- **Protocol Mitigation**:
  - The proposer must post a significant `proposalBond` (10.0 ETH, 10x the challenge bond).
  - A mandatory 48-hour challenge window is enforced (`challengePeriod = 48 hours`).
  - Any single market participant can trigger a dispute by posting 1.0 ETH, risking the proposer's 10.0 ETH bond.

### 2.3 Arbitrator Collusion & Corruption
- **Threat**: An arbitrator colludes with a market participant to falsely settle a disputed market in exchange for an off-chain bribe.
- **Protocol Mitigation**:
  - **Exposure Budget Cap**: Each arbitrator is bound by an immutable `perArbitratorUnresolvedCap` (default: 200 ETH). The factory strictly refuses new market assignments once an arbitrator's unresolved liability exceeds this cap.
  - **Time-Bounded Arbitration**: Arbitrators must settle within `arbitrationPeriod` (96 hours). If an arbitrator fails to act, any permissionless caller can trigger `cancelExpiredMarket`, which forces an **INVALID** settlement, returning 100% of principal to users.
  - **Multi-Sig Council**: Arbitrators are recommended to be deployed as 3-of-5 multisig councils, requiring 3 independent signers to agree on dispute resolution call data.

### 2.4 Governance Key Theft & Rogue Administrative Action
- **Threat**: An attacker steals an administrative private key and attempts to drain escrow, change parameters, or unpause a vulnerable market.
- **Protocol Mitigation**:
  - **Role Separation**: Privileges are strictly partitioned across Governance Safe (3-of-5), Compliance Safe (3-of-5), and Guardian.
  - **No Single Key Authority**: No single key can execute an administrative change.
  - **Mandatory 24-Hour Timelock**: Every parameter update or financial activation requires Compliance to call `approveRelease(digest)`. The protocol contract enforces `block.timestamp >= activationAfter` (24 hours minimum) before Governance can activate.
  - **Circuit Breaker Independence**: The Guardian can ONLY freeze/pause (`pause()`); it cannot unpause, withdraw funds, or alter parameters.

### 2.5 Blockchain Reorgs & Consensus Divergence
- **Threat**: A deep block reorg on QIE EVM alters the sequence of contributions or reverts a settlement transaction while the off-chain indexer continues serving stale data.
- **Protocol Mitigation**:
  - **Contract Level**: Contract state transitions are purely driven by mined EVM transactions and internal block timestamps; contracts are immune to off-chain desynchronization.
  - **Indexer Level**: The PostgreSQL indexer detects block hash mismatches (reorg detection) and automatically rolls back unconfirmed blocks, replaying canonical blocks from the reorg fork point without duplicate rows.

### 2.6 Signature Replay & Malleability
- **Threat**: An adversary intercepts an off-chain publication signature (EIP-712 or EIP-191) and replays it across a different chain, market, or timestamp.
- **Protocol Mitigation**:
  - **EIP-712 Domain Separation**: Rigorously binds `chainId`, `verifyingContract`, `action`, `nonce`, and `deadline`.
  - **Atomic Nonce Consumption**: The backend ingests publications within an atomic PostgreSQL transaction. Reused nonces fail immediately with `409 REUSED_NONCE`.
  - **Trusted Factory Validation**: 10-layer server-side validation ensures client-supplied factory addresses are strictly rejected if they mismatch the verified server deployment.

### 2.7 RPC Man-in-the-Middle (MITM) & Poisoning
- **Threat**: A corrupted public RPC node serves fake state or altered transaction receipts.
- **Protocol Mitigation**:
  - Backend deployment validation checks contract runtime bytecode Keccak-256 codehash against the authoritative deployment manifest.
  - Read-only RPC diagnostics employ multiple fallback endpoints (`rpc1mainnet`, `rpc2mainnet`, etc.).
