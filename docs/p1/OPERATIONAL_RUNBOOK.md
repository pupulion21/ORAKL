# ORAKL P1 Operational Runbook

This runbook provides step-by-step procedures for managing, troubleshooting, and maintaining the **ORAKL P1** local simulation environment.

---

## 1. Routine Operational Commands

### 1.1 Starting Services in Order
```bash
# 1. Start PostgreSQL
docker compose -f backend/docker-compose.yml up -d

# 2. Start Anvil Blockchain (Background Task)
anvil --chain-id 31337 --port 8546 --host 127.0.0.1 --accounts 20 --balance 10000 --gas-limit 60000000 --code-size-limit 100000 --auto-impersonate &

# 3. Deploy Database Migrations
cd backend && npx prisma migrate deploy && cd ..

# 4. Deploy Protocol Contracts
node scripts/p1/deploy-local-selected.mjs

# 5. Start Fastify REST API
npm --prefix backend run api &

# 6. Start Block Indexer
npm --prefix backend run indexer &

# 7. Start Frontend Development Server
npm --prefix frontend run dev &
```

### 1.2 Inspecting Service Health
```bash
# Check API Health & DB connectivity
curl -s http://127.0.0.1:4310/api/v1/health | jq .

# Check Indexer Sync Block Height
curl -s http://127.0.0.1:4310/api/v1/indexer/status | jq .

# Check Live Chain Tip Block
node -e "
import {makeClients} from './scripts/p1/lib.mjs';
const {publicClient} = makeClients();
publicClient.getBlockNumber().then(b => console.log('Anvil Tip:', b));
"
```

### 1.3 Database Direct Inspection
```bash
# Connect to PostgreSQL container
docker exec -it orakl-p1-db psql -U orakl -d orakl_p1

# Useful Diagnostic Queries:
-- Check current indexer checkpoint:
SELECT * FROM "IndexerCheckpoint";

-- Check total markets and final outcomes:
SELECT "marketId", "finalOutcome", "refundable", "yesPool", "noPool" FROM "Market";

-- Check multi-challenger tranches:
SELECT "marketId", "challenger", "stake", "entitlement", "claimed" FROM "ChallengerTranche";
```

---

## 2. Troubleshooting & Incident Recovery

### Incident 1: "Fork divergence exceeds maximum rollback depth (4096 blocks)"
- **Symptom**: Indexer stops ingesting and throws fork divergence error.
- **Root Cause**: Anvil was restarted with a new genesis while PostgreSQL retains historical blocks from an older chain.
- **Resolution**:
  ```bash
  # Truncate indexer blocks and re-deploy local contracts
  docker exec -i orakl-p1-db psql -U orakl -d orakl_p1 -c 'TRUNCATE TABLE "Block", "Event", "Market", "Prediction", "ChallengerTranche", "Dispute", "EvidenceRecord", "ProtocolFeeAccrual", "IndexerCheckpoint" CASCADE;'
  node scripts/p1/deploy-local-selected.mjs
  ```

### Incident 2: "approved release digest mismatch" during `verify-local-deployment.mjs`
- **Symptom**: `verify-local-deployment.mjs` fails at check `release-digest`.
- **Root Cause**: An E2E test or scenario executed an emergency pause or activation, advancing `activityEpoch` and changing the on-chain approved release digest.
- **Resolution**:
  ```bash
  # Re-run local deployment to restore canonical Epoch 0 state
  node scripts/p1/deploy-local-selected.mjs
  node scripts/p1/verify-local-deployment.mjs
  ```

### Incident 3: "PrismaClientInitializationError: Can't reach database server"
- **Symptom**: API or indexer fails on database queries.
- **Root Cause**: Docker daemon restarted or `orakl-p1-db` container exited.
- **Resolution**:
  ```bash
  docker start orakl-p1-db
  docker exec orakl-p1-db pg_isready -U orakl -d orakl_p1
  ```

### Incident 4: Port Conflicts (4310, 5176, 8546)
- **Symptom**: `EADDRINUSE: address already in use`.
- **Resolution**:
  ```bash
  # Find and terminate zombie processes
  lsof -ti :4310 | xargs -r kill -9
  lsof -ti :5176 | xargs -r kill -9
  lsof -ti :8546 | xargs -r kill -9
  ```

---

## 3. Full Clean Slate Reset

To wipe all local state and re-initialize a clean environment from zero:

```bash
# 1. Stop all node processes
pkill -f "run.ts" || true
pkill -f "server.ts" || true
pkill -f "vite" || true
pkill -f "anvil" || true

# 2. Reset database container and volumes
docker compose -f backend/docker-compose.yml down -v
docker compose -f backend/docker-compose.yml up -d

# 3. Start fresh Anvil
anvil --chain-id 31337 --port 8546 --host 127.0.0.1 --accounts 20 --balance 10000 --gas-limit 60000000 --code-size-limit 100000 --auto-impersonate &
sleep 2

# 4. Migrate database
cd backend && npx prisma migrate deploy && cd ..

# 5. Deploy contracts
node scripts/p1/deploy-local-selected.mjs

# 6. Verify deployment
node scripts/p1/verify-local-deployment.mjs

# 7. Run E2E Verification
node scripts/p1/run-e2e-scenarios.mjs --scenarios A,B,C,D
```
