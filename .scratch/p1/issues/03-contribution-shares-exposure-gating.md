# 03: Contribution Shares and Exposure Budget Gating Tracer Bullet

**What to build:** An end-to-end slice enabling participants to contribute collateral to YES or NO outcome pools in open markets. Contributions are verified against the market pilot pool cap and the arbitrator's immutable exposure budget ($2 \cdot T_{\text{cap}}$ per arbitrator, $3 \cdot T_{\text{cap}}$ globally). The indexer projects user positions and aggregate exposure, the API serves real-time exposure limits and portfolio data, and the frontend presents user ownership strictly as proportional "Contribution Shares".

**Blocked by:** 02 (Market Creation and Initial Liquidity Tracer Bullet).

**Status:** ready-for-agent

- [ ] Participant wallet can deposit ETH collateral into YES or NO pools via `predict(marketId, side)`.
- [ ] Contract enforces `minContribution` (0.01 ETH) and reverts with `ExposureExceeded` if global or arbitrator exposure caps are breached.
- [ ] Indexer processes `PredictionPlaced` event, updates market pool totals, and records `MarketPosition` and `Prediction` rows using exact BigInt decimal strings.
- [ ] Fastify API `GET /api/v1/exposure` and `GET /api/v1/portfolio/:address` return verified exposure numbers and participant positions.
- [ ] Frontend displays the participant's pool share explicitly labeled as "Contribution Share", without guaranteed odds or betting jargon (GLOSSARY.md).
