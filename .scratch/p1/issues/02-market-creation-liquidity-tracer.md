# 02: Market Creation and Initial Liquidity Tracer Bullet

**What to build:** An end-to-end slice allowing a market creator to connect an EVM wallet on Chain ID 31337, configure question terms, and deposit the refundable creator bond $K = 1\text{ ETH}$ with zero creation fee ($F = 0$). The indexer catches the on-chain event, stores the canonical event log, projects the market and creator bond liability into PostgreSQL, and serves the market through the Fastify API with block synchronization metadata to the frontend.

**Blocked by:** 01 (Database Migration and Schema Precision Baseline).

**Status:** ready-for-agent

- [ ] Connected wallet can sign and submit `createMarket` to `SelectedMarketFactory` on local Anvil (Chain ID 31337).
- [ ] Contract enforces pilot pool cap ($T_{\text{cap}} = 100\text{ ETH}$), creation bond ($K = 1\text{ ETH}$), and zero protocol creation fee ($F = 0$) (ADR-0010).
- [ ] Indexer ingests `MarketCreated` and `BondDeposited` events into `IndexedBlock`, `IndexedEvent`, `Market`, and `Bond` tables in a single transaction.
- [ ] Fastify API endpoint `GET /api/v1/markets` returns the projected market with embedded block synchronization metadata (`lastProcessedBlock`, `lastProcessedBlockHash`, `chainId`) (ADR-0007).
- [ ] Frontend UI dynamically renders the newly created market in the active market list.
