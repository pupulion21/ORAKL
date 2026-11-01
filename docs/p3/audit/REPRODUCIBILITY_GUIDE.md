# ORAKL Protocol — Auditor Reproducibility Guide

**Document ID:** `ORAKL-P3-REPRODUCIBILITY-GUIDE`  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Date:** 2026-11-01  

> [!TIP]
> This guide provides deterministic, copy-paste terminal instructions for an independent auditor to verify source code provenance, reproduce compiled bytecodes, run full test suites, and execute on-chain governance scenarios.

---

## 1. Prerequisites & Tooling Verification

Ensure the following pinned tools are available:
- **Node.js:** `>= 20.0.0`
- **Foundry / Forge:** `>= 0.2.0` (with Solc `0.8.37` and Solc `0.7.6` support)
- **Git:** `>= 2.30.0`

Verify Forge and Node:
```bash
node --version
forge --version
```

---

## 2. Step 1: Upstream Safe v1.4.1 Provenance Verification

Verify that the local Safe contracts match upstream canonical releases:
```bash
# Check git commit in official safe contracts package
node -e "
const pkg = JSON.parse(require('fs').readFileSync('node_modules/@safe-global/safe-contracts/package.json'));
console.log('Safe Contracts Version:', pkg.version);
"

# Verify Canonical Runtime Codehashes
node -e "
import('./scripts/p3/safe-lib.mjs').then(({ CANONICAL_SAFE_CODEHASH, CANONICAL_FACTORY_CODEHASH }) => {
  console.log('Safe Singleton Codehash:', CANONICAL_SAFE_CODEHASH);
  console.log('SafeProxyFactory Codehash:', CANONICAL_FACTORY_CODEHASH);
});
"
```

---

## 3. Step 2: Multi-Compiler Deterministic Builds

### 3.1 Build ORAKL Core Protocol (Solc 0.8.37)
```bash
cd /home/pupulion/orakl/contracts
forge clean
forge build
```
Expected output: Compiles all protocol contracts with 0 errors.

### 3.2 Build Canonical Safe Contracts (Solc 0.7.6)
```bash
cd /home/pupulion/orakl/contracts/p3-safe
forge clean
forge build
```
Expected output: Compiles 36 official Safe contracts with Solc 0.7.6 with 0 errors.

---

## 4. Step 3: Run Full Foundry Protocol Unit Tests

Run the full Foundry regression suite covering core prediction markets, protocol config, and legacy fixtures:
```bash
cd /home/pupulion/orakl/contracts
forge test -vv
```
Expected output: 28 test suites, 244 tests passed, 0 failures.

---

## 5. Step 4: Run Live Safe 3-of-5 Governance Scenarios on Anvil

Execute all 28 canonical Safe governance, compliance, and arbitration scenarios:
```bash
cd /home/pupulion/orakl
node scripts/p3/test-real-safe.mjs
```
Expected output:
```text
=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===
```

---

## 6. Step 5: Run Full Backend Integration & Vitest Battery

Execute all backend indexer, API, authentication, and live on-chain governance tests:
```bash
cd /home/pupulion/orakl
npm --prefix backend test
```
Expected output: 13 test files passed, 166+ tests passed, 0 failures.

---

## 7. Step 6: Verify Deployment Verification Gate

Execute deployment verification in both modes:
```bash
# 1. Artifact-Only Mode
node scripts/p2/verify-deployment.mjs --mode artifact-only
# Expected: STATUS: ONCHAIN_UNVERIFIED (Exit code 0)

# 2. Automated Live Anvil Deployment Test
npx --prefix backend vitest run test/deployment-verification-live.test.ts
# Expected: 5 passed (Exit code 0)
```
