# ORAKL P1 Local Setup & Developer Guide

This document provides complete, reproducible instructions for running the isolated **ORAKL P1** local simulation environment on Linux / macOS.

> [!IMPORTANT]
> The P1 environment runs strictly under **Chain ID 31337 (Anvil)**. It does NOT interact with public blockchains, testnets, or mainnets. All financial activations are local test fixtures and carry zero production authorization ([ADR-0004](file:///home/pupulion/orakl/docs/adr/0004-local-simulation-boundary-enforcement.md)).

---

## 1. System Prerequisites

Ensure the following tools are installed:
- **Node.js**: `v22.0.0` or later (tested on Node `v24.20.0`)
- **Foundry**: `forge` and `anvil` (`0.2.0` or later)
- **Docker & Docker Compose**: `Docker 26+` / `Docker Compose v2+`
- **PostgreSQL Client (optional)**: `psql` for local inspection

---

## 2. Directory Layout & Architecture

```
orakl/
├── contracts/               # Foundry Solidity contracts (SelectedMarketFactory, ProtocolConfig)
├── backend/                 # Fastify API, Prisma ORM, and Reorg-Safe Indexer
│   ├── prisma/              # Schema definitions and SQL migrations (NUMERIC 78,0)
│   ├── src/api/             # Fastify REST endpoints (:4310)
│   └── src/indexer/         # Continuous block ingestion and reorg rollback engine
├── frontend/                # Vite SPA with typed API client and evidence lab (:5176)
├── scripts/p1/              # Orchestration, deployment, verification, and E2E runners
└── docs/p1/                 # Architectural specs, API reference, runbooks, and evidence
```

---

## 3. Step-by-Step Environment Setup

### Step 1: Clone and Install Dependencies
```bash
# In repository root
npm install
npm --prefix backend install
npm --prefix frontend install
```

### Step 2: Start Local PostgreSQL Database
The database runs via Docker in host network mode on `127.0.0.1:5432`:
```bash
docker compose -f backend/docker-compose.yml up -d
```
Verify container status:
```bash
docker ps --filter "name=orakl-p1-db"
```

### Step 3: Start Anvil Local Blockchain
Launch Anvil with 20 funded accounts and standard local test limits:
```bash
anvil --chain-id 31337 \
  --port 8546 \
  --host 127.0.0.1 \
  --accounts 20 \
  --balance 10000 \
  --gas-limit 60000000 \
  --code-size-limit 100000 \
  --auto-impersonate
```

### Step 4: Deploy PostgreSQL Database Migrations
Apply all 7 schema migrations ensuring exact `NUMERIC(78, 0)` precision ([ADR-0001](file:///home/pupulion/orakl/docs/adr/0001-postgresql-numeric-uint256.md), [ADR-0005](file:///home/pupulion/orakl/docs/adr/0005-prisma-migrate-deploy-execution.md)):
```bash
cd backend && npx prisma migrate deploy && cd ..
```

### Step 5: Deploy Protocol Smart Contracts
Deploy `ProtocolConfig`, `SelectedMarketFactory`, and local role mocks, then activate local finance:
```bash
node scripts/p1/deploy-local-selected.mjs
```
*Expected Output*:
```
[p1-local] deploy ProtocolConfig 0x95401dc811bb5740090279ba06cfa8fcf6113778 @ block 539
[p1-local] deploy SelectedMarketFactory 0x998abeb3e57409262ae5b751f60747921b33613e @ block 540
[p1-local] activateFinance by 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
[p1-local] manifest frontend/public/deployments/local-selected.json
[p1-local] manifest backend/deployments/local-selected.json
```

> [!NOTE]
> **Runtime Manifest Generation & Gitignore**:
> `backend/deployments/local-selected.json` and `frontend/public/deployments/local-selected.json` are dynamic simulation fixtures generated during this step and are excluded from Git tracking via `.gitignore`. Fresh clones do not require pre-existing manifests; this deployment step creates both directories and files deterministically.
>
> **Strict Startup & Deployment Ordering**:
> 1. Anvil (Step 3) and PostgreSQL (Steps 2 & 4) must be running before deploying contracts.
> 2. Contract deployment (Step 5) must execute before starting backend API / indexer (Step 7) or frontend (Step 8). The indexer, API, and frontend fail-closed if `local-selected.json` is missing.
> 3. Stale runtime manifests from terminated Anvil instances must never be trusted without on-chain verification. When restarting Anvil, always re-run Step 5 (`deploy-local-selected.mjs`) and Step 6 (`verify-local-deployment.mjs`).

### Step 6: Verify Deployment Independence
Run the 15 independent deployment verification checks:
```bash
node scripts/p1/verify-local-deployment.mjs
```
*Expected Output*: `15 passed; allPassed: true`.

### Step 7: Launch Backend Services
Start the Fastify API (port 4310) and the block indexer:
```bash
# Terminal 1: Fastify REST API
npm --prefix backend run api

# Terminal 2: Reorg-safe block indexer
npm --prefix backend run indexer
```

### Step 8: Launch Frontend Development Server
Start the Vite development server on port 5176:
```bash
npm --prefix frontend run dev
```
Open [http://localhost:5176/local.html](http://localhost:5176/local.html) in your browser.

---

## 4. Running the Complete Verification Test Suite

Run all verification test suites in sequence:

```bash
# 1. Smart Contract Unit, Fuzz, and Invariant Suite (235 tests)
cd contracts && forge test -vvv && cd ..

# 2. Backend Vitest Integration Suite (93 tests)
npm --prefix backend test

# 3. Backend TypeScript Typecheck (0 errors)
npm --prefix backend run typecheck

# 4. Frontend Unit & Integration Suite (82 tests)
npm --prefix frontend test

# 5. Frontend TypeScript Typecheck (0 errors)
npm --prefix frontend run typecheck

# 6. Automated E2E Scenarios Runner (56 on-chain transactions across Scenarios A-D)
node scripts/p1/run-e2e-scenarios.mjs --scenarios A,B,C,D

# 7. Playwright Headless Browser Smoke Test
node scripts/p1/browser-smoke-test.mjs
```
