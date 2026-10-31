# ORAKL P1 Fastify API Reference

The **ORAKL P1 Fastify REST API** runs on `http://127.0.0.1:4310` and provides read-only projections of the local Anvil chain alongside validated off-chain discovery stores.

> [!NOTE]
> The API never custodies funds, never signs financial transactions, and never exposes private keys. All financial writes occur strictly client-side via wallet interaction with the verified contracts.

---

## 1. Response & Error Envelopes

### 1.1 Success Envelope
All successful read endpoints wrap data in a top-level simulation envelope:
```json
{
  "simulationOnly": true,
  "data": { ... }
}
```

### 1.2 Synchronization Metadata ([ADR-0007](file:///home/pupulion/orakl/docs/adr/0007-api-freshness-and-reorg-metadata.md))
Endpoints that query market projections attach blockchain synchronization headers:
```json
{
  "simulationOnly": true,
  "sync": {
    "lastProcessedBlock": 619,
    "lastProcessedBlockHash": "0xf0524d1a3bbdae5f29f0e8f813a3f5a9e7fbbffba9b14b8a2e1d6748434d2847",
    "chainId": 31337,
    "status": "HEALTHY"
  },
  "data": { ... }
}
```

### 1.3 Centralized Error Envelope ([ADR-0012](file:///home/pupulion/orakl/docs/adr/0012-centralized-fastify-error-handling.md))
All error responses adhere to a standardized JSON schema. Internal database URLs, credentials, and SQL stack traces are strictly scrubbed:
```json
{
  "error": {
    "code": "MARKET_NOT_FOUND",
    "message": "Market 999 not found"
  },
  "statusCode": 404,
  "requestId": "req-wxfls6xl"
}
```

---

## 2. Complete Endpoint Inventory (18 Endpoints)

### 2.1 System & Indexer Status

#### `GET /api/v1/health`
Returns service status, database connectivity, and environment mode.
```bash
curl -s http://127.0.0.1:4310/api/v1/health
```
```json
{
  "simulationOnly": true,
  "data": {
    "service": "orakl-p1-backend",
    "mode": "local-selected",
    "simulationOnly": true,
    "chainId": 31337,
    "database": "up"
  }
}
```

#### `GET /api/v1/network`
Returns network metadata and safety boundaries for the local chain.

#### `GET /api/v1/deployment`
Returns the active deployment addresses and runtime verification hashes from `local-selected.json`.

#### `GET /api/v1/indexer/status`
Returns indexer sync status, tip block height, last sync timestamp, and reorg count.

---

### 2.2 Markets & Activity

#### `GET /api/v1/markets`
List all markets with pagination, search query, category filtering, and sync metadata.
- Query Parameters:
  - `page` (default: 1)
  - `limit` (default: 20, max: 100)
  - `status` (`OPEN`, `CLOSED`, `RESOLVED`, `CANCELLED`)
  - `category` (e.g. `tech`, `macro`, `crypto`)
  - `q` (case-insensitive text search)

#### `GET /api/v1/markets/:id`
Retrieve detailed view of a single market by numeric ID, including YES/NO pools, dispute status, and creator bonds.
- Returns 78-digit exact decimal strings for all financial balances.

#### `GET /api/v1/markets/:id/activity`
Returns the complete chronological event timeline for the market (creation, predictions, proposals, challenges, arbitration, claims).

#### `GET /api/v1/markets/:id/challenges`
Returns the ordered dispute tranche ladder for the market.
```json
{
  "simulationOnly": true,
  "data": {
    "marketId": "0",
    "totalDisputeStake": "3000000000000000000",
    "tranches": [
      {
        "challenger": "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
        "stake": "1000000000000000000",
        "prefixBefore": "0",
        "entitlement": "4333333333333333333"
      },
      {
        "challenger": "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
        "stake": "2000000000000000000",
        "prefixBefore": "1000000000000000000",
        "entitlement": "8666666666666666666"
      }
    ]
  }
}
```

#### `GET /api/v1/markets/:id/evidence`
Lists all off-chain and on-chain evidence submissions linked to this market.

#### `GET /api/v1/markets/:id/settlement`
Returns final settlement accounting: winning disposition, fee retained (or 0 if neutral), distributable rewards, and refundability.

#### `GET /api/v1/markets/:id/metadata`
Returns off-chain metadata associated with the market question and resolution rules.

---

### 2.3 Evidence & Artifacts

#### `GET /api/v1/evidence/:commitment`
Fetches a published RFC 8785 evidence artifact by its Keccak-256 commitment.

#### `POST /api/v1/evidence`
Publishes an off-chain RFC 8785 evidence artifact ([ADR-0003](file:///home/pupulion/orakl/docs/adr/0003-rfc8785-canonical-evidence-profile.md)).
- Validates canonical JSON schema and ensures hash integrity.
- Request Body:
```json
{
  "schema": "orakl-evidence-v1",
  "chainId": "31337",
  "contract": "0x998abeb3e57409262ae5b751f60747921b33613e",
  "marketId": "0",
  "kind": "ARBITRATOR_DECISION",
  "title": "Dispute Arbitration Ruling",
  "summary": "Official arbitrator ruling overturning proposed outcome.",
  "submittedBy": "0xf5059a5d33d5853360d16c683c16e67980206f36",
  "submittedAt": "1790400000",
  "contentHash": "0x5d7876945f596b76adeb631dbcebbf1a8a96ade9616ef7b7dc1781d254e32173"
}
```

#### `GET /api/v1/metadata/:commitment`
Fetches published market metadata artifact.

#### `POST /api/v1/markets/metadata`
Publishes market question metadata prior to on-chain creation.

---

### 2.4 User Portfolios & Exposure

#### `GET /api/v1/portfolio/:address`
Returns active positions, claimable rewards, deposited bonds, and historical activity for a given wallet address.

#### `GET /api/v1/transactions/:hash`
Inspects on-chain transaction status, block confirmations, and indexer event projection.

#### `GET /api/v1/exposure`
Returns global, pilot, and per-arbitrator exposure metrics compared against immutable contract budgets.
