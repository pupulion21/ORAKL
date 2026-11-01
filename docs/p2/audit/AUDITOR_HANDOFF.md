# ORAKL Protocol — Auditor 5-Minute Local Handoff Runbook

- **Document ID**: `ORAKL-P2-HANDOFF-001`
- **Target Audience**: External Security Audit Teams & Independent Verifiers
- **Date**: 2026-11-01

---

## 1. Prerequisites

Ensure your local development environment has the following installed:
- **Node.js**: v20.12.0 or higher
- **npm**: v10.0.0 or higher
- **Foundry / Forge**: 0.3.0 or higher (`forge --version`)
- **PostgreSQL**: v14 or higher (or running Docker container)

---

## 2. 5-Minute Quickstart

### Step 1: Install Dependencies
From the repository root:
```bash
# Install backend dependencies
npm --prefix backend install

# Install frontend dependencies
npm --prefix frontend install
```

### Step 2: Run Foundry Smart Contract Regression (244 Tests)
```bash
cd contracts
forge test
```
**Expected Output**:
```
Ran 2 test suites: 244 tests passed, 0 failed, 0 skipped
Suite result: ok. 244 passed; 0 failed; 0 skipped
```

### Step 3: Run Backend Vitest Regression Suite (133 Tests)
From the repository root:
```bash
npm --prefix backend test
```
**Expected Output**:
```
Test Files  9 passed (9)
Tests       133 passed (133)
Duration    ~17s
```

### Step 4: Run Backend TypeScript Typecheck
```bash
npm --prefix backend run build
```
**Expected Output**: Clean exit with code 0.

### Step 5: Run Frontend Tests & Typecheck
```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```
**Expected Output**: All unit tests pass, typecheck clean, Vite build successful.

---

## 3. Bytecode Hash Verification

To verify that compiled contracts match the authoritative bytecode identities:
```bash
cd contracts
forge build --force
```
Inspect codehash and runtime bytes:
- `SelectedMarketFactory`: 19,084 bytes runtime code; Keccak-256 hash `0xc161294828d00ae957972ba8bc0d983680f2393fe6cdd650c12ed5cfadb4332f`.
- `ProtocolConfig`: 8,508 bytes runtime code; Keccak-256 hash `0xaed346cc6bdb2d85536b5d320058822be4a355b2ef417bffe07ce3bfcd25b5fe`.

---

## 4. Playwright Browser Financial E2E Harness (Optional Local Run)

To run the full end-to-end browser financial simulation (requires running local Anvil node):
```bash
# 1. Start local isolated Anvil chain
anvil --port 8546 --chain-id 31337

# 2. Deploy local contracts
node scripts/p1/deploy-local-selected.mjs

# 3. Execute browser E2E test
node scripts/p1/run-browser-e2e.mjs
```
**Expected Result**:
32 browser UI transactions + 4 fixture admin transactions executed and verified across all 4 financial scenarios (YES win, NO win, INVALID settlement, Disputed challenger win).
