# ORAKL Protocol — Audit Reproducibility Guide

This document describes the exact steps, environment prerequisites, and deterministic execution commands required to independently reproduce all verification suites for ORAKL.

---

## 1. System Requirements & Toolchain Pins

| Tool | Required Version | Verification Command | Notes |
| :--- | :--- | :--- | :--- |
| **Operating System** | Linux (Ubuntu 22.04 / 24.04 or Debian) | `uname -a` | Tested on Linux x86_64 |
| **Node.js** | `>= v20.18.0` (Pinned: `v24.20.0`) | `node --version` | ESM modules mandatory |
| **Foundry / Forge** | `1.8.1` (`982849d3`) | `forge --version` | Pinned compiler profile |
| **Anvil** | Integrated with Foundry | `anvil --version` | Local simulated RPC |
| **PostgreSQL** | `>= 14.0` | `psql --version` | For backend indexer replay tests |

---

## 2. Repository Setup

```bash
git clone https://github.com/pupulion21/ORAKL.git
cd ORAKL
git checkout feature/orakl-p4-audit-readiness

# Install backend dependencies
npm --prefix backend install

# Install frontend dependencies
npm --prefix frontend install
```

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
Deploys official Safe Global singletons and proxies on isolated local Anvil, testing 28 distinct governance, compliance, and arbitration scenarios.

```bash
node scripts/p3/test-real-safe.mjs
```
*Expected Result*: All 28 scenarios report `PASS`, ending with:
`=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===`

---

### Suite 3: Security Mutation & Regression Suite (12 Mutations)
Runs controlled negative injections against contract bytecodes, mastercopy slots, signatures, nonces, timelocks, and RPC gates.

```bash
node scripts/p4/test-security-mutations.mjs
```
*Expected Result*: All 12 mutations report `DETECTED`, ending with:
`=== ALL 12 SECURITY MUTATIONS DETECTED (100% REGRESSION DEFENSE) ===`

---

### Suite 4: Deployment & Artifact Verification Gate
Validates local compiled artifacts against canonical trust anchors and safety boundary assertions.

```bash
# Artifact-only mode (validates local trust anchors, nonces, ABIs without requiring live network)
node scripts/p2/verify-deployment.mjs --mode artifact-only
```
*Expected Result*: `Artifact Verification: PASS`, reports `ONCHAIN_UNVERIFIED` (as required).

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
*Expected Result*: `typecheck` exit 0; 14 test files passed, 167 tests passed.

---

### Suite 7: Frontend Test, Typecheck, and Production Build
Verifies user interface contracts, read controllers, and production bundle generation.

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```
*Expected Result*: 91 tests passed, typecheck exit 0, Vite build completes successfully.
