# ORAKL Protocol — Audit Reproducibility Guide

> **VERDICT**: `P4 INTERNAL AUDIT HANDOFF READY — EXTERNAL AUDIT NOT PERFORMED — PUBLIC RELEASE BLOCKED`
>
> **Repository Baseline Commit**: `c8cda059275cf2efc77e46b3133a967fd10335fb`
> **Target Branch**: `feature/orakl-p4-audit-readiness`

This document describes the exact steps, environment prerequisites, and deterministic execution commands required to independently reproduce all verification suites for ORAKL from a clean clone.

---

## 1. System Requirements & Toolchain Pins

| Tool | Required Version | Verification Command | Notes |
| :--- | :--- | :--- | :--- |
| **Operating System** | Linux (Ubuntu 22.04 / 24.04 or Debian) | `uname -a` | Tested on Linux x86_64 |
| **Node.js** | `>= v20.18.0` (Recommended: `v24.20.0` or `v20.x`) | `node --version` | ESM modules mandatory |
| **Foundry / Forge** | `1.8.1` (`982849d3`) | `forge --version` | Solc `0.8.37` Paris (ORAKL) & Solc `0.7.6` (Safe) |
| **Anvil** | Integrated with Foundry | `anvil --version` | Local simulated RPC (`chainId 31337`) |
| **PostgreSQL** | `>= 14.0` | `psql --version` | For backend indexer replay tests |

---

## 2. Clean Clone Setup & Build Sequence

To guarantee deterministic dependency resolution without lockfile drift, always use `npm ci`:

```bash
# 1. Clone repository and checkout audit branch
git clone https://github.com/pupulion21/ORAKL.git
cd ORAKL
git checkout feature/orakl-p4-audit-readiness

# 2. Install frozen dependencies for backend and frontend
npm ci --prefix backend
npm ci --prefix frontend

# 3. Build smart contracts with pinned Foundry compiler profiles
forge build --root contracts

# 4. Generate local deployment simulation manifests (required before indexer, API, or manifest verifiers run)
node scripts/p1/deploy-local-selected.mjs
```

> [!NOTE]
> `scripts/p1/deploy-local-selected.mjs` spins up an isolated ephemeral Anvil instance on port 8546, deploys `SelectedMarketFactory` and `ProtocolConfig`, validates linkage, and generates `backend/deployments/local-selected.json` and `frontend/public/deployments/local-selected.json`. This file is excluded from Git to prevent dynamic local state leakage into version control.

---

## 3. Test Suites & Verification Execution

### Suite 1: Smart Contract Foundry Test Suite (244 Tests)
Executes all invariant suites, fuzz tests, access control tests, and economic conservation tests.

```bash
forge test --root contracts
```
*Expected Result*: 244 tests passed, 0 failed, 0 skipped.

---

### Suite 2: Canonical Safe v1.4.1 Governance Suite (28 Scenarios)
Deploys official Safe Global singletons and proxy factories on isolated local Anvil, testing 28 distinct governance, compliance, and arbitration scenarios with strict error selectors, monotonic nonces, and receipts.

```bash
node scripts/p3/test-real-safe.mjs
```
*Expected Result*: All 28 scenarios report `PASS`, ending with:
`=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===`

---

### Suite 3: Security Mutation & Regression Suite (12 Mutations)
Runs controlled negative injections against contract bytecodes, mastercopy slots, signers, thresholds, EIP-712 domains, nonces, dispute authority, timelocks, compliance gates, manifest identity, and network failure.

```bash
node scripts/p4/test-security-mutations.mjs
```
*Expected Result*: All 12 mutations report `DETECTED`, ending with:
`=== ALL 12 SECURITY MUTATIONS DETECTED (GENUINE FAULT GATES) ===`

---

### Suite 4: Deployment & Artifact Verification Gate
Validates compiled artifacts against canonical trust anchors, nonces, and safety boundary assertions.

```bash
# Artifact-only mode (validates local trust anchors, nonces, ABIs without requiring live network)
node scripts/p2/verify-deployment.mjs --mode artifact-only
```
*Expected Result*: `Artifact Verification: PASS`, reports `ONCHAIN_UNVERIFIED` (as expected in artifact-only mode).

---

### Suite 5: Evidence Manifest Integrity Verification
Verifies cryptographic SHA-256 hashes of all 13 protocol evidence artifacts.

```bash
node scripts/p1/verify-evidence-manifest.mjs
```
*Expected Result*: `Manifest status: PASS`, 13 artifacts verified.

---

### Suite 6: Backend Vitest & TypeScript Suite (167 Tests)
Executes full backend integration suite including Prisma indexer, API concurrency, and live mutation vitest runners.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
```
*Expected Result*: `typecheck` exit code 0; 14 test files passed, 167 tests passed.

---

### Suite 7: Frontend Test, Typecheck, and Production Build
Verifies user interface contracts, read controllers, and production bundle generation.

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```
*Expected Result*: 91 tests passed, typecheck exit code 0, Vite production build completes successfully.
