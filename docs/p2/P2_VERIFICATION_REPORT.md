# ORAKL Protocol — P2 Comprehensive Verification & Security Report

- **Document ID**: `ORAKL-P2-VERIF-FINAL-001`
- **Date**: 2026-11-01
- **Branch**: `feature/orakl-p2-security-readiness`
- **Authorized Verdict**: `P2 POSITIVE DEPLOYMENT VERIFICATION PASSED — PUBLIC RELEASE BLOCKED`

---

## 1. Executive Summary & Release Gate Verdict

All technical implementation, architecture, research, and verification objectives of **ORAKL P2 (QIE Compatibility, Safe Governance & Security Readiness)** have been executed and verified across isolated local test fixtures (Foundry Forge, Anvil Chain ID 31337, Fastify API, PostgreSQL, and Vite).

> [!CAUTION]
> **FINAL RELEASE GATE VERDICT: P2 POSITIVE DEPLOYMENT VERIFICATION PASSED — PUBLIC RELEASE BLOCKED**  
> While all local tests, independent trust anchor validations, live Anvil deployment gates, and static checks have passed with zero failures, public deployment to QIE Testnet (1983) or Mainnet (1990) and real-value financial custody remain **STRICTLY BLOCKED** pending formal third-party smart contract security audit sign-off, production Safe multisig HSM key ceremonies, and legal classification opinions. No claim of 100% QIE production compatibility or external audit approval is made.

---

## 2. Comprehensive Test Battery Execution Evidence

### 2.1 Foundry Smart Contract Regression Suite
- **Command**: `cd contracts && forge test`
- **Compiler**: Solidity `0.8.37` (EVM target: `paris`, optimizer `runs = 50`)
- **Total Test Suites**: 28
- **Total Tests Executed**: 244
- **Passed**: 244
- **Failed**: 0
- **Skipped**: 0
- **Execution Time**: ~98s
- **Breakdown**:
  - `SafeGovernanceTest`: 9/9 tests passed (verifying 3-of-5 threshold enforcement, address sorting, nonce replay defense, 24-hour timelock, and pause interrupt against custom test fixture `Safe3Of5.sol`. Official Safe Global contract integration is **BLOCKED**).
  - `OraklInvariantTest`: 16/16 formal invariants verified across 8,192 calls and 128 runs with 0 reverts (solvency conservation, no double claims, payout bounds, fee isolation, bond isolation, etc.).
  - `SelectedInvariantTest`: Continuous state invariant fuzzing passed in 41.44s.
  - `AccountingFuzzTest`: Fuzz tests passed with 2,048 runs each across payout rounding, ladder split, and variable participants.
  - Unit & Integration Suites: 219 tests covering all market lifecycle states, edge cases, and arithmetic limits.

### 2.2 Backend Vitest Test Suite
- **Command**: `npm --prefix backend test`
- **Test Files**: 11 passed (11)
- **Total Tests Executed**: 160
- **Passed**: 160
- **Failed**: 0
- **Duration**: ~18s
- **Breakdown**:
  - `deployment-trust.test.ts`: 20/20 tests passed (10-layer deployment validation pipeline, independent trust anchor enforcement, codehash verification, cached deployment with freshness TTL and invalidation, fail-closed database outage handling, forged manifest rejection, and strict isolation of `TRUSTED_FACTORY`).
  - `deployment-verification.test.ts`: 9/9 tests passed (testing `scripts/p2/verify-deployment.mjs` modes: `artifact-only` reporting `ONCHAIN_UNVERIFIED` and `onchain-required` positive path on live contracts matching trust anchor, dynamically derived selectors `0xf5efbb4f` and `0xc45a0155`, and mutual linkage; plus negative regressions failing closed on offline RPC, wrong chain ID, empty bytecode, codehash mismatch, linkage mismatch, unapproved ABI, and forged manifest codehash rejected by independent trust anchor).
  - `opcode-probes.test.ts`: 8/8 tests passed (testing `scripts/p2/probe-qie-evm.mjs` distinct classifications: transport error, malformed response, unsupported method, execution revert, invalid opcode, and avoiding full Shanghai hardfork claims).
  - `publication-auth.test.ts`: 16/16 tests passed (EIP-712 / EIP-191 replay protection, atomic nonce consumption).
  - `indexer.test.ts`: 15/15 tests passed (PostgreSQL event ingestion, canonical reorg fork rollback & replay).
  - `api.test.ts`: 35/35 tests passed (Fastify API endpoints, query filters, pagination).
  - `api-error.test.ts`: 17/17 tests passed (error envelope standardization, internal error masking).
  - `api-sync.test.ts`: 11/11 tests passed (indexer sync status, block lag detection).
  - `evidence.test.ts`: 10/10 tests passed (evidence manifest verification, canonical hashing).
  - `evidence-partition.test.ts`: 14/14 tests passed (market-partitioned evidence storage).
  - `reorg.test.ts`: 5/5 tests passed (reorg detection and block replacement).

### 2.3 Backend TypeScript Typecheck
- **Command**: `npm --prefix backend run build` (`tsc --noEmit`)
- **Result**: **PASS** (0 errors, exit code 0).

### 2.4 Frontend Node Test Suite
- **Command**: `npm --prefix frontend test`
- **Total Test Suites**: 6
- **Total Tests Executed**: 91
- **Passed**: 91
- **Failed**: 0
- **Duration**: 776 ms
- **Breakdown**:
  - Financial controls & side selection (YES/NO encoding, BigInt wei parsing).
  - Multi-bond claims (CREATION, PROPOSAL, CHALLENGE distinct calldata).
  - Selected API client (portfolio queries, search filters, error unwrapping).
  - RFC 8785 canonicalization & Keccak-256 evidence hashing.
  - Multi-challenger tranches & evidence modal.
  - Wallet lifecycle & chain isolation (wrong chain rejection, session invalidation).

### 2.5 Frontend TypeScript Typecheck & Production Build
- **Command**: `npm --prefix frontend run typecheck && npm --prefix frontend run build`
- **Result**: **PASS** (0 errors, Vite production build completed in 2.10s).

### 2.6 Evidence Artifact Manifest Verification
- **Command**: `node scripts/p1/verify-evidence-manifest.mjs`
- **Result**: **PASS** (all 13 artifacts match `docs/p1/evidence/MANIFEST.json` and `CHECKSUMS.txt` with identical SHA-256 hashes).

---

## 3. QIE Blockchain EVM & Infrastructure Findings

1. **Opcode Profile & Hardfork Classification**:
   - `PUSH0` (`0x5f`): **SUPPORTED** on QIE Mainnet (1990) and QIE Testnet (1983). Verified via live reproducible `eth_call` probe using bytecode `0x60425f5360015ff3`, returning `0x42`. Raw request/response logged in [`RPC_VERIFICATION_RESULTS.json`](file:///home/pupulion/orakl/docs/p2/RPC_VERIFICATION_RESULTS.json).
   - `TSTORE`/`TLOAD` (`0x5d`/`0x5c`): **UNSUPPORTED** on QIE Mainnet and Testnet. Verified via live reproducible `eth_call` probe using bytecode `0x604260005d60005c60005360016000f3`, returning error `invalid opcode: opcode 0x5d not defined`.
   - **Hardfork Scope Boundary**: Opcode probes alone do not establish full Shanghai hardfork compliance (initcode metering, warm coinbase, withdrawals remain unverified at the RPC level). Full Shanghai hardfork compliance is recorded as **UNVERIFIED**.
   - ORAKL contracts compiled targeting `paris` are **100% compatible** and avoid transient storage opcodes regardless of upstream EVM ceiling.
2. **Bytecode Size Limits (EIP-170)**:
   - `SelectedMarketFactory`: 19,084 B runtime code (margin: 5,492 B < 24,576 B cap).
   - `ProtocolConfig`: 8,508 B runtime code (margin: 16,068 B < 24,576 B cap).
3. **RPC Infrastructure & Error Separation**:
   - Transport errors, malformed responses, and method errors are strictly distinguished from opcode incompatibility in [`scripts/p2/probe-qie-evm.mjs`](file:///home/pupulion/orakl/scripts/p2/probe-qie-evm.mjs).
   - `https://rpc1testnet.qie.digital/`: Port 443 refused connection (classified as `TRANSPORT_ERROR`).
   - `https://rpc2testnet.qie.digital/`: Active and responsive (Block ~9.5M, gasPrice 7 wei).
   - `https://rpc1mainnet.qie.digital/` & `rpc2mainnet.qie.digital`: Active and responsive (Block ~11.6M, gasPrice ~1.125 Gwei).
4. **On-Chain & Local Artifact Verification**:
   - Executed [`scripts/p2/verify-deployment.mjs`](file:///home/pupulion/orakl/scripts/p2/verify-deployment.mjs) with explicit operational modes:
     - `artifact-only`: validates local Foundry artifacts, independent trust anchors, and outputs `ONCHAIN_UNVERIFIED`.
     - `onchain-required`: requires live RPC connectivity, verifies chain ID, nonempty bytecode, runtime codehashes against independent trust anchor (`CANONICAL_TRUST_ANCHORS[31337]`), derives function selectors dynamically from compiled ABIs (`protocolConfig()` -> `0xf5efbb4f`, `factory()` -> `0xc45a0155`), and verifies mutual linkage calls. Fails closed with non-zero exit code if offline or invalid.
   - **Live Isolated Anvil Positive Verification**:
     - Started clean isolated Anvil instance (Chain ID 31337, port 8546) using disposable test accounts.
     - Deployed approved `ProtocolConfig` (`0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9`) and `SelectedMarketFactory` (`0xdc64a140aa3e981100a9beca4e685f962f0cf6c9`) preserving all existing economics and source code via `scripts/p1/deploy-local-selected.mjs`.
     - Ran `node scripts/p2/verify-deployment.mjs --mode onchain-required --manifest backend/deployments/local-selected.json --rpc http://127.0.0.1:8546`.
     - Verified: `success=true`, `onchainStatus=VERIFIED`, 19/19 checks passed, exit code `0`.
   - **Demonstrated Failure Modes (Negative Regressions)**:
     - Offline RPC (`http://127.0.0.1:1`): exits code `1` (`rpc-connectivity` fail).
     - Wrong chain ID (`1983` vs `31337`): exits code `1` (`chain-id-match` fail).
     - Altered bytecode / codehash: exits code `1` (`onchain-factory-codehash` fail).
     - Incorrect linkage: exits code `1` (`manifest-immutable-linkage` fail).
5. **Multi-Sig Governance Scope**:
   - `Safe3Of5.sol` is a custom test double simulating 3-of-5 threshold mechanics with actual EIP-712 domain `EIP712Domain(uint256 chainId,address verifyingContract)` and custom errors (`InvalidSignatures()`, `Unauthorized()`, `DuplicateOrUnorderedOwner()`, `InvalidThreshold()`, `SetupFailed()`, `ExecutionFailed(bytes)`).
   - Official Safe Global contract integration into local test suite is **BLOCKED** due to external dependency pinning constraints. Real Safe integration is **NOT** claimed.
