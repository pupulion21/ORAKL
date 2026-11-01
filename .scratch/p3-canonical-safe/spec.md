# ORAKL P3 Specification: Canonical Safe Integration & Independent Audit Readiness

## Problem Statement

ORAKL requires institutional-grade, multi-party decentralized governance to administer protocol parameters, release approvals, and dispute arbitration without introducing centralized trust vectors. In P2, multi-signature governance was verified against a custom test fixture (`Safe3Of5.sol`), while integration of official, unmodified Safe Global smart contracts was tracked as blocked (`BLK-07`) pending dependency verification and multi-compiler isolation. Additionally, deployment verification integration tests in P2 utilized mocked RPC responses rather than live Anvil execution loops, and the repository requires an authoritative, auditor-ready handoff package before external security evaluation.

## Solution

Integrate genuine, unmodified, version-pinned official Safe Global contracts (Safe v1.4.1) using an isolated multi-compiler boundary (`contracts/p3-safe/`) targeting Solc 0.7.6. Deploy official Safe singletons and `SafeProxyFactory` instances to establish three distinct 3-of-5 multisig roles (Governance Safe, Compliance Safe, and Arbitration Safe) on isolated Anvil chain ID 31337. Implement comprehensive integration tests verifying real Safe EIP-712 transaction hashing, signature thresholds, nonce sequencing, and `ProtocolConfig` permission enforcement. Close P2 deployment verification regression gaps with automated, live Anvil execution tests and fail-closed trust anchors. Produce a complete threat model and independent auditor handoff package under `docs/p3/`.

## User Stories

1. As a protocol security engineer, I want genuine, unmodified Safe Global contracts pinned by exact commit SHA and tarball integrity, so that the protocol introduces no custom multisig vulnerabilities.
2. As a protocol architect, I want an isolated multi-compiler build boundary for Safe (Solc 0.7.6), so that ORAKL's existing contracts retain their Solidity 0.8.37 compiler identity and approved bytecodes without drift.
3. As an auditor, I want reproducible build commands and matching bytecode codehashes (`0x1fe2df...` and `0x50c3cd...`) identical to official canonical Safe deployments, so that contract provenance is mathematically proven.
4. As an off-chain operator, I want three separate Safe proxy instances (Governance, Compliance, Arbitration) with 5 distinct owners and threshold 3, so that authority is decentralized and role sets are strictly disjoint.
5. As a governance participant, I want transaction execution to require at least 3 valid owner signatures in ascending signer order, so that fewer than 3 signatures or unordered/duplicate signatures are rejected.
6. As a compliance officer, I want the Compliance Safe to execute `approveRelease()` on `ProtocolConfig`, so that releases cannot be activated without formal multi-owner compliance approval.
7. As a governance participant, I want the Governance Safe to be strictly bound by the 24-hour timelock (`RECOVERY_DELAY`), so that finance cannot be activated prematurely.
8. As a protocol guardian, I want immediate emergency pause capability (`pause()`) that invalidates pending release approvals, so that anomalous activity halts financial execution instantly.
9. As an arbitrator, I want the Arbitration Safe to execute valid dispute determinations within the authorized window, so that contested markets settle fairly.
10. As a deployment verifier, I want `verifyDeployment()` to execute against live Anvil instances in `onchain-required` mode, so that live bytecode, dynamic selectors, and mutual linkages are verified on-chain.
11. As a system architect, I want `verifyDeployment()` to fail closed when no approved trust anchor exists for a chain ID, so that unauthorized networks cannot run with self-referential manifest assertions.
12. As an independent auditor, I want a cleanly structured handoff package under `docs/p3/audit/`, so that upstream Safe code, ORAKL core code, and local test fixtures are clearly delineated.

## Implementation Decisions

1. **Official Upstream Version Selection**: Safe v1.4.1 (`@safe-global/safe-contracts@1.4.1-2` and `@safe-global/safe-deployments@1.37.66`, Git commit `aa14911666deb13cdbbe37c37253a55918525437`). This version is extensively audited, canonically deployed across 400+ EVM networks, and compiled with Solc 0.7.6, which produces bytecode containing zero unsupported QIE opcodes (no `PUSH0`, no `TSTORE`/`TLOAD`).
2. **Build Isolation Boundary**: Establish `contracts/p3-safe/` with an independent `foundry.toml` configured for `solc_version = "0.7.6"`. This preserves ORAKL's root `contracts/foundry.toml` (Solc 0.8.37) untouched and prevents compiler contamination.
3. **Role Architecture on Anvil**:
   - Governance Safe: 5 distinct accounts, threshold 3.
   - Compliance Safe: 5 distinct accounts, threshold 3.
   - Arbitration Safe: 5 distinct accounts, threshold 3.
   - Guardian: Disposable standalone account (disjoint from all Safe owner sets).
   - All owner sets pairwise disjoint as enforced by `ProtocolConfig._disjoint()`.
4. **Execution Mechanics**: Tests invoke `Safe.execTransaction(...)` with packed `r, s, v` signatures over EIP-712 digests. Rejection of custom test doubles: `Safe3Of5.sol` is preserved strictly as a historical legacy fixture; all P3 tests execute against real Safe instances.
5. **Deployment Gate Hardening**: `verifyDeployment()` requires an independently approved trust anchor in `onchain-required` mode. Unknown chains without explicit trust anchors fail closed. Integration test runs a self-contained Anvil child process that deploys, verifies, asserts, and tears down cleanly.

## Testing Decisions

- Only external contract behavior is asserted: state changes, events, reverts with standard Safe and ORAKL errors, and nonce progression.
- Integration test suite in TypeScript (`scripts/p3/test-real-safe.mjs` and `backend/test/safe-integration.test.ts`) covers all 28 execution scenarios against live Anvil contracts.
- Deployment verification integration test (`backend/test/deployment-verification-live.test.ts`) exercises real isolated Anvil startup, deployment, and verification without mock servers.
- Prior art: existing Foundry tests (`SafeGovernance.t.sol`), Vitest suites (`deployment-verification.test.ts`), and P1 Anvil runner (`run-browser-e2e.mjs`).

## Out of Scope

- Public chain deployments (QIE Mainnet 1990 or Testnet 1983).
- Real-value cryptocurrency funding or production HSM key ceremonies.
- Modifying approved protocol economics (fee bps, pool caps, bond amounts).
- Porting Safe v1.4.1 source code to Solidity 0.8.37 (forbidden; unmodified official sources only).
- External audit sign-off (handoff preparation only).

## Further Notes

All executions are confined to local Anvil chain ID 31337.
Status remains: `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`.
Target verdict: `P3 CANONICAL SAFE LOCAL INTEGRATION VERIFIED — PUBLIC RELEASE BLOCKED`.
