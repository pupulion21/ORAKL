# ORAKL P2 — QIE Compatibility, Safe Governance & Security Readiness Specification

Status: ready-for-agent
Author: Lead Protocol Engineer & Security Architect (Antigravity)
Date: 2026-11-01
Working Branch: feature/orakl-p2-security-readiness
Baseline HEAD: 8e75c60 (feature/orakl-p1-end-to-end)

---

## 1. Problem Statement

ORAKL has successfully verified its P1 release candidate on an isolated local simulation environment (Chain ID 31337), establishing mathematical solvency across binary reversal and neutral-INVALID settlement, PostgreSQL indexer bounded reorg rollback, trusted-factory validation, atomic publication nonce persistence, and Playwright browser financial flows.

However, ORAKL cannot be deployed or safely released on a public EVM network (such as QIE Testnet or QIE Mainnet) due to critical external dependencies and unverified production readiness factors:
1. **Unverified QIE EVM Compatibility**: The exact EVM opcode profile (e.g., PUSH0 support, Cancun vs Shanghai vs Paris), transaction type support (legacy Type 0 vs EIP-1559 Type 2), gas price dynamics, and block header fields on QIE networks are not formally benchmarked against ORAKL's compiled bytecode and runtime assumptions.
2. **Reliance on Mock Governance**: The local deployment relies on simplified `LocalRoleMock` contracts for governance, compliance, and arbitration rather than production-grade multi-signature contracts (such as canonical Safe 3-of-5 contracts).
3. **Absence of Independent Security Audit Package**: External auditors require a frozen contract inventory, formal specification of all financial conservation invariants, an exhaustive threat model, and explicit trust boundaries before commencing a security review.
4. **Deployment Identity Hardening**: Server-side trusted factory validation must be extended to support immutable codehash verification, cached validated deployment contexts with freshness checking, and strict isolation between local simulation and public network environments.

---

## 2. Solution

Execute ORAKL P2 as an exhaustive, multi-dimensional security readiness, compatibility benchmarking, and governance hardening package without sending public-chain transactions or deploying real-value finance:
1. **P2-01: QIE Network Compatibility Research (Read-Only)**: Audit primary documentation at `docs.qie.digital`, execute bounded read-only RPC probes across QIE Testnet (Chain ID 1983) and QIE Mainnet (Chain ID 1990), document gas pricing, block timing, transaction receipt schemas, and compile an EVM compatibility matrix and RPC risk register.
2. **P2-02: Selected Contract EVM Compatibility**: Validate ORAKL's compiled bytecode, constructor arguments, runtime size (<24KB EIP-170), revert selectors, and immutable patching against QIE's verified EVM profile, recording exact bytecode identities and deployment constraints.
3. **P2-03: Safe Multisig Governance Architecture & Local 3-of-5 Fixture**: Design independent 3-of-5 Safe governance for Governance, Compliance, and Arbitration; research Safe deployment availability on QIE; and build a real local Anvil 3-of-5 multisig integration fixture proving threshold enforcement, signature ordering, replay protection, and the mandatory 24-hour release delay.
4. **P2-04: Trusted Deployment Hardening**: Extend `resolveTrustedDeployment()` with layered verification (configuration origin, chain identity, factory address, ProtocolConfig binding, runtime codehash, ABI identity, and database consistency) with fail-closed semantics.
5. **P2-05: Independent Audit Preparation**: Package complete auditor-ready documentation under `docs/p2/audit/` including contract inventory, financial invariants, exhaustive threat model, trust assumptions, known limitations, and blocker matrix.
6. **P2-06: Verification & Security Operations Review**: Execute all regression suites (Foundry, Vitest, Node, Playwright E2E, manifest verification, Safe tests) and generate `P2_VERIFICATION_REPORT.md` concluding with the authoritative verdict `P2 LOCAL READINESS VERIFIED — PUBLIC RELEASE BLOCKED`.

---

## 3. User Stories

1. As a protocol security engineer, I want read-only RPC compatibility probes against QIE networks, so that I can determine exact chain parameters without sending public transactions or incurring gas costs.
2. As a protocol security engineer, I want to verify whether QIE nodes support `eth_feeHistory` and EIP-1559 Type 2 transactions, so that the indexer and client can avoid submitting unsupported transaction formats.
3. As a protocol security engineer, I want to benchmark QIE block time and timestamp consistency, so that market expiration and dispute window timers do not suffer unexpected drift.
4. As a smart contract engineer, I want to verify if QIE EVM supports the `PUSH0` opcode, so that Solidity compiler settings (`evm_version`) can be configured safely to avoid deployment reverts.
5. As a protocol architect, I want to measure the runtime bytecode size of `SelectedMarketFactory` and `ProtocolConfig`, so that I can confirm they remain within the 24,576-byte EIP-170 limit across all target EVM versions.
6. As a protocol architect, I want to verify the exact Keccak-256 codehash of compiled contract artifacts, so that deployments can be authenticated deterministically.
7. As a governance designer, I want a 3-of-5 multi-signature architecture for the Governance role, so that privileged protocol changes cannot be executed by any single compromised signer.
8. As a governance designer, I want a 3-of-5 multi-signature architecture for the Compliance role, so that market releases cannot be unilaterally approved without independent multi-party consensus.
9. As a dispute operations specialist, I want a formal risk and trade-off analysis of arbitration authority mechanisms, so that we can evaluate dedicated 3-of-5 Safe multisig versus decentralized escalation paths.
10. As a smart contract tester, I want a local Anvil 3-of-5 Safe integration test fixture, so that I can verify that 2 signatures fail while 3 valid signatures execute privileged calls.
11. As a smart contract tester, I want the local Safe fixture to test invalid signature order, wrong signers, and replayed nonces, so that execution reverts fail closed under all adversarial conditions.
12. As a backend engineer, I want `resolveTrustedDeployment` to verify runtime bytecode codehash and ProtocolConfig binding, so that tampered or surrogate contracts are rejected before processing requests.
13. As a backend engineer, I want trusted deployment validation to cache authenticated contexts with freshness checking, so that the API avoids redundant network or disk overhead on every request.
14. As an external smart contract auditor, I want an exhaustive contract inventory with compiler settings and commit SHAs, so that the audit target is completely unambiguous.
15. As an external smart contract auditor, I want a formal specification of financial conservation invariants (solvency, fee isolation, bond isolation, and telescopic share distribution), so that formal verification tools can be applied.
16. As an external smart contract auditor, I want an exhaustive threat model analyzing Sybil challengers, arbitrator collusion, and chain reorgs, so that penetration testing can focus on edge cases.
17. As a protocol maintainer, I want an auditor handoff runbook detailing how to spin up local verification environments in under 5 minutes, so that auditors can reproduce all test evidence seamlessly.
18. As a compliance officer, I want a comprehensive release blocker matrix documenting required external approvals, so that public deployment is strictly blocked until all gates are satisfied.

---

## 4. Implementation Decisions

1. **Safety Boundary**: Chain ID 31337 on local Anvil remains the ONLY authorized execution environment for financial transactions. Public QIE interaction is strictly read-only (`eth_chainId`, `eth_blockNumber`, `eth_call`, `eth_getLogs`).
2. **Local Safe Integration Seam**: Implement a local Safe 3-of-5 integration test using canonical Safe semantics (GnosisSafe v1.3.0/v1.4.1 architecture) deployed to local Anvil, testing multi-signature threshold execution without modifying `SelectedMarketFactory` or `ProtocolConfig` contract source code.
3. **Layered Deployment Identity Model**: Backend validation checks origin, chain ID, factory address, config address, factory-to-config binding, and bytecode codehash. Caches valid deployments in memory with a configurable freshness TTL.
4. **Audit Documentation Package Structure**: Centralized under `docs/p2/audit/` with standardized Markdown formats adhering to industry auditing standards (OpenZeppelin, Trail of Bits, ConsenSys Diligence templates).
5. **Issue Tracker Conventions**: Maintained in `.scratch/p2-security-readiness/issues/` numbered `01` through `06` with status and blocking edge tracking.

---

## 5. Seams & Verification Plan

- **Seam 1: Network & RPC Probe**: Node.js read-only script using standard fetch / JSON-RPC calling public QIE endpoints, recording structured results to `docs/p2/RPC_VERIFICATION_RESULTS.json`.
- **Seam 2: Contract Bytecode Analysis**: Foundry compiler inspection (`forge inspect <contract> bytecode` / `deployedBytecode` / `methods`) across target EVM profiles.
- **Seam 3: Safe Multisig Governance**: Local Anvil test suite (`contracts/test/governance/SafeGovernance.t.sol` or Node script) executing real 3-of-5 signature collection, packing, and execution against `ProtocolConfig`.
- **Seam 4: Backend Trusted Deployment Hardening**: Vitest integration tests in `backend/test/trusted-deployment.test.ts` verifying codehash matching, config binding, and cache invalidation.
- **Seam 5: Audit Documentation & Invariants**: Full compilation of `docs/p2/audit/` verified against Foundry invariant suite (`OraklInvariantTest`).
- **Seam 6: Comprehensive Regression**: Full execution of Foundry (235+ tests), Vitest (123+ tests), Node (91+ tests), Playwright E2E (36 txs), and evidence manifest verification.
