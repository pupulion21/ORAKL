# ORAKL
## Product Requirements Document (PRD)
**Version:** 1.0

**Status:** Draft — Engineering Specification

**Target Blockchain:** QIE Mainnet (EVM)

**Product Type:** Decentralized Prediction Market

**Architecture:** Hybrid On-Chain / Off-Chain

**Market Mechanism:** Binary Pari-Mutuel Pool

**Target Audience:** Global, subject to jurisdictional eligibility

**Document Date:** October 30, 2026

---

# 1. Executive Summary

## 1.1 Product Overview

ORAKL is a decentralized, community-driven prediction market built on QIE Blockchain that enables eligible users to create markets, take positions on real-world outcomes, and participate in transparent, blockchain-based settlement.

The platform supports multiple categories, including cryptocurrency, politics, sports, economics, technology, entertainment, and global events.

Unlike prediction markets that use Automated Market Makers (AMMs) or order books, ORAKL initially uses a **pari-mutuel pool-based mechanism**.

Participants contribute funds to either YES or NO. After the event outcome is finalized, the distributable pool is allocated proportionally among participants who selected the winning outcome.

This approach eliminates the need for dedicated liquidity providers, pricing algorithms, and order-matching infrastructure.

ORAKL uses a hybrid architecture: smart contracts manage financial state and settlement, while off-chain infrastructure handles market discovery, metadata, indexing, search, and user experience.

## 1.2 Product Vision

**To build an accessible, transparent, and community-driven platform where people can express predictions about future events through verifiable on-chain markets.**

## 1.3 Mission

- Enable eligible users to create prediction markets.
- Provide transparent accounting of all contributions and payouts.
- Minimize the need for trusted intermediaries.
- Support verifiable and dispute-resistant market resolution.
- Deliver a simple and responsive user experience.
- Establish a scalable foundation for future prediction market mechanisms.

## 1.4 Brand Identity

**Product Name:** ORAKL

**Tagline:** Predict What's Next. Own Your Conviction.

**GitHub Description:**

ORAKL is a decentralized, community-driven prediction market built on QIE Blockchain, empowering anyone to create markets, predict real-world outcomes, and earn rewards through transparent, on-chain settlement.

---

# 2. Problem Statement

## 2.1 Existing Problems

Traditional prediction and wagering platforms may suffer from:

1. Centralized custody of user funds.
2. Limited transparency into settlement calculations.
3. Restricted market creation controlled by platform operators.
4. Unclear dispute and resolution processes.
5. High technical complexity in liquidity-dependent trading systems.
6. Limited auditability of transaction history.

## 2.2 Proposed Solution

ORAKL addresses these issues through:

- Permissionless market creation for eligible participants.
- Smart contract-based custody and settlement.
- Publicly verifiable contribution pools.
- Deterministic payout calculations.
- Transparent market resolution procedures.
- Independent event indexing.
- A simplified pool-based participation model.

**Important limitation:** On-chain settlement does not automatically guarantee truthful real-world outcomes. Resolution accuracy depends on oracle design, evidence quality, dispute procedures, and governance.

---

# 3. Goals and Success Metrics

## 3.1 Product Goals

**G1 — Market Creation**

Eligible users can create valid binary prediction markets without individual administrator approval.

**G2 — Participation**

Users can select YES or NO and contribute supported collateral through their wallets.

**G3 — Transparent Settlement**

Users can independently verify pool balances, outcomes, fees, and payout calculations.

**G4 — Reliable Resolution**

Every market has a defined process for outcome proposal, disputes, finalization, and fallback resolution.

**G5 — User Experience**

Users can discover markets, monitor positions, and claim payouts through a responsive interface.

**G6 — Mainnet Readiness**

The system passes defined security, operational, legal, and deployment gates before accepting real-value funds.

## 3.2 Proposed MVP KPIs

These are engineering targets, not predictions of adoption.

| Metric | MVP Target |
|---|---|
| Successful valid market creation | 100% in controlled E2E tests |
| Payout accounting invariants | 100% passing |
| Unauthorized fund withdrawal tests | 0 successful |
| Duplicate payout claims | 0 successful |
| Indexed event accuracy | 100% after finality/reconciliation |
| Market metadata integrity | Hash verified |
| Critical/high security findings | 0 unresolved before launch |
| Supported screen sizes | Mobile and desktop |
| Indexer recovery | Automatic from persisted checkpoints |
| Market resolution fallback | Available for every market |

Performance targets such as API p95 latency and indexing delay must be established from QIE RPC benchmarks before production acceptance.

---

# 4. Product Scope

## 4.1 MVP In Scope

- Wallet connection.
- Wallet-based authentication for off-chain features.
- Market creation.
- Market metadata and categories.
- Market discovery and search.
- YES/NO pool contributions.
- Market countdown.
- Pool distribution visualization.
- Estimated payout preview.
- User portfolio.
- Transaction history.
- Optimistic outcome proposal.
- Outcome challenges.
- Arbitration and timeout handling.
- Market cancellation.
- Payout claims.
- Refund claims.
- Creation and resolution bonds.
- Protocol fee accounting.
- Administrative moderation.
- Blockchain event indexing.
- Basic analytics.
- Mainnet deployment controls.
- Monitoring and error reporting.

## 4.2 Out of Scope for MVP

- AMM trading.
- Order book.
- Selling positions before resolution.
- Leveraged predictions.
- Multi-outcome markets.
- Cross-chain deposits.
- Fiat payments.
- Native ORAKL governance token.
- NFT-based positions.
- Automated AI outcome finalization.
- Copy trading.
- Referral rewards.
- Mobile native applications.

## 4.3 Future Expansion

The architecture should allow later introduction of:

- Multi-outcome prediction markets.
- ERC-20 stablecoin collateral.
- Automated oracle integrations.
- More decentralized arbitration.
- Advanced analytics.
- Reputation systems.
- Market creator incentives.
- Additional EVM networks.
- AMM-based markets as a separate product mechanism.

---

# 5. User Roles

## 5.1 Visitor

A visitor can:

- Browse publicly visible markets.
- Search and filter markets.
- View pool distribution.
- View market resolution rules.
- View finalized outcomes.
- Inspect public transaction history.

A visitor cannot submit transactions without a wallet.

## 5.2 Participant

An eligible participant can:

- Connect a wallet.
- Contribute to YES or NO.
- View personal positions.
- Review estimated payouts.
- Claim winnings.
- Request eligible refunds.
- Propose or challenge outcomes where permitted.

## 5.3 Market Creator

An eligible creator can:

- Create a market.
- Submit immutable resolution rules.
- Provide required creation bond.
- Share market links.
- Monitor participation.
- Propose an outcome.

The creator cannot unilaterally withdraw pool funds or rewrite market rules.

## 5.4 Resolver / Arbitrator

Authorized resolution participants can:

- Review outcome proposals.
- Inspect supporting evidence.
- Participate in dispute resolution.
- Finalize disputed outcomes under predefined rules.

Arbitration permissions must be transparent and limited.

## 5.5 Platform Administrator

Administrators can:

- Moderate off-chain market visibility.
- Manage supported categories.
- Review abuse reports.
- Configure permitted protocol parameters.
- Monitor system health.
- Trigger authorized emergency controls.
- Manage operational eligibility controls.

Administrators cannot arbitrarily seize participant pool funds.

---

# 6. Market Categories

The initial category taxonomy includes:

| Category | Examples |
|---|---|
| Crypto | BTC, ETH, blockchain events |
| Politics | Elections, government decisions |
| Sports | Football, basketball, esports |
| Economics | Inflation, interest rates, GDP |
| Technology | AI releases, product launches |
| Entertainment | Movies, awards, music |
| World Events | International developments |
| Other | Additional eligible topics |

Categories are managed off-chain.

The smart contract must not require modification when new categories are introduced.

Category availability may differ by jurisdiction. Markets involving prohibited activities, violence, personal harm, or legally restricted event contracts must be excluded or restricted as required.

---

# 7. Core User Journeys

## 7.1 Wallet Connection

**Flow:**

1. User opens ORAKL.
2. User clicks Connect Wallet.
3. Wallet provider selection appears.
4. User connects a supported EVM wallet.
5. Application detects the connected chain.
6. If the chain is unsupported, the interface requests switching to QIE.
7. Wallet address and balances are displayed.
8. Optional off-chain session authentication uses a signed nonce.

**Acceptance Criteria:**

- Connecting a wallet never requests a private key.
- Wrong-network states are clearly displayed.
- Disconnecting clears the authenticated session.
- Wallet signatures use nonces, expiration, and domain binding.
- Server verifies signed authentication messages.

## 7.2 Create Market

**Required Fields:**

- Market question.
- Market description.
- Category.
- YES resolution condition.
- NO resolution condition.
- Official evidence source.
- Market closing timestamp.
- Expected resolution timestamp.
- Final resolution deadline.
- Cancellation/refund conditions.
- Creator wallet.
- Metadata content hash.

**Flow:**

1. Creator opens Create Market.
2. Creator completes required fields.
3. Frontend validates field structure.
4. Backend checks metadata, eligibility, and content rules.
5. Metadata is stored in content-addressed storage.
6. Creator signs a transaction containing the metadata commitment and creation bond.
7. Smart contract validates on-chain parameters.
8. Market ID is generated.
9. `MarketCreated` event is emitted.
10. Indexer records the event.
11. Backend associates the event with immutable metadata.
12. Market appears in discovery after synchronization and applicable moderation checks.

**Important:** Backend validation is not an on-chain permission guarantee. Permissionless contracts can be called directly, so eligibility restrictions and enforcement mechanisms must be designed according to applicable law and clearly documented.

**Acceptance Criteria:**

- Market metadata commitment cannot change after creation.
- Invalid deadlines are rejected.
- Insufficient bond is rejected.
- Duplicate transaction processing does not create duplicate database entries.
- Creator cannot alter market financial rules.
- Invalid or unavailable metadata is handled explicitly.

## 7.3 Participate in Market

**Flow:**

1. User opens an active market.
2. User selects YES or NO.
3. User enters contribution amount.
4. Interface displays current pool and indicative payout.
5. User reviews risk and confirms.
6. Wallet requests transaction signature.
7. Transaction is submitted to QIE.
8. Contract validates deadline, amount, and market state.
9. Contract records the contribution.
10. Contract emits `PredictionPlaced`.
11. Indexer updates the database.
12. Portfolio displays the confirmed contribution.

**Acceptance Criteria:**

- Contributions after deadline revert.
- Contributions below minimum revert.
- Failed transactions do not create confirmed positions.
- Users may contribute multiple times.
- A user may contribute to both sides, with balances tracked separately.
- Pool balances are derived from on-chain accounting.

## 7.4 Market Closure

Market contributions stop at the configured closing timestamp.

Closure is enforced by contract timestamp checks, not only by a backend scheduler.

A market may appear CLOSED in the frontend even if no explicit close transaction has been executed.

## 7.5 Outcome Proposal

1. The event becomes eligible for resolution.
2. An authorized proposer submits YES, NO, or INVALID according to the market rules.
3. The proposer supplies an evidence commitment.
4. A proposal bond is deposited where required.
5. The challenge window begins.
6. The proposal becomes publicly visible.

## 7.6 Outcome Challenge

1. A participant reviews the proposed result.
2. The participant submits a challenge before the deadline.
3. The challenge includes a bond and supporting evidence.
4. Market state changes to DISPUTED.
5. The case enters the arbitration process.
6. The arbitrator issues a decision under the published resolution rules.

## 7.7 Finalize Market

A market can finalize when:

- An uncontested proposal passes the challenge window; or
- A disputed proposal receives a valid arbitration decision.

Final outcomes are immutable.

A resolution failure or missed maximum deadline must lead to a defined fallback or cancellation process.

## 7.8 Claim Rewards

1. User opens Portfolio.
2. User selects a finalized market.
3. Application checks claim eligibility.
4. User clicks Claim.
5. Wallet submits the claim transaction.
6. Contract calculates the user's entitlement.
7. Contract updates claimed accounting.
8. Contract transfers the entitled collateral.
9. Event is emitted.
10. Portfolio updates after confirmation.

Users pay applicable network gas fees.

---

# 8. Pool Economics

## 8.1 Pool Mechanism

Each market maintains two contribution totals:

- `yesPool`
- `noPool`

The total contribution pool is:

`totalPool = yesPool + noPool`

No liquidity provider is required.

No outcome token is required for MVP. Participant positions are recorded directly as on-chain contribution balances.

## 8.2 Protocol Fee

Initial proposed fee: 2%.

This is a configurable design assumption, not a finalized economic parameter.

Fee calculation:

`protocolFee = floor(totalPool × feeBps / 10000)`

`distributablePool = totalPool - protocolFee`

Fee is charged only for valid, successfully resolved markets with an eligible winning side.

No protocol fee is charged for cancelled markets.

The fee rate for an individual market must be fixed when that market is created.

## 8.3 Winner Payout

For a YES outcome:

`payout = floor(userYesContribution × distributablePool / yesPool)`

For a NO outcome:

`payout = floor(userNoContribution × distributablePool / noPool)`

All calculations must use overflow-safe integer arithmetic and explicitly defined rounding.

The sum of user claims must never exceed the distributable pool.

## 8.4 Example

Market:

- YES pool: 600 QIE.
- NO pool: 400 QIE.
- Total pool: 1,000 QIE.
- Protocol fee: 2%.
- Winning outcome: YES.

Distributable pool:

`1000 - 20 = 980 QIE`

User contribution:

`100 QIE on YES`

Payout:

`100 / 600 × 980 = 163.333... QIE`

Net gain before gas:

`63.333... QIE`

Actual contract values are rounded according to the token's smallest unit.

## 8.5 Zero-Winner Condition

If the finalized outcome has no contributions:

- Market enters a refund-eligible terminal state.
- Protocol fee is zero.
- All participants can reclaim their original contributions.
- No losing-side redistribution occurs.

## 8.6 Zero-Participation Condition

If no user participates:

- No prediction payout is generated.
- The market expires or resolves according to its rules.
- Creation bond handling follows the predefined creator-bond policy.

## 8.7 Refund Rules

Refunds are permitted when:

- Market is cancelled.
- Resolution becomes impossible under published rules.
- Resolution timeout is reached without a valid final outcome.
- The finalized outcome has zero contributors.
- Another explicitly specified invalidation condition occurs.

For refund-eligible markets:

`refund = userYesContribution + userNoContribution - alreadyRefundedAmount`

Users cannot claim both a winning payout and a refund for the same contribution.

## 8.8 Rounding Dust

Rounding may leave small residual balances.

The protocol must define deterministic residual handling before launch.

Recommended approach:

- Track total payout entitlements.
- Preserve strict accounting separation.
- Allow dust sweeping only after a sufficiently long claim period and under a predefined, auditable policy.
- Do not silently redirect unclaimed user entitlements to the protocol.

## 8.9 Creation Bond

A creation bond discourages spam and low-quality markets.

Proposed initial amount: 5 QIE.

Bond rules:

- Held separately from prediction funds.
- Returned after successful completion of valid creator obligations.
- Subject to predefined penalties for provable violations.
- Cannot be arbitrarily confiscated by administrators.
- Has a defined refund path when cancellation is not the creator's fault.

## 8.10 Proposal and Challenge Bonds

Outcome proposal and challenge bonds are separate from creation bonds.

Bond distribution and slashing must be governed by explicit, immutable rules for each resolution process.

Arbitrators must not receive unrestricted access to prediction collateral.

---

# 9. Market State Machine

## 9.1 Market States

- `OPEN`
- `CLOSED`
- `PROPOSED`
- `DISPUTED`
- `FINALIZED`
- `CANCELLED`

`CLAIMED` is a per-user accounting state, not necessarily a market-wide state.

## 9.2 Valid Transitions

| From | To | Condition |
|---|---|---|
| Created | OPEN | Valid creation |
| OPEN | CLOSED | Closing timestamp reached |
| CLOSED | PROPOSED | Valid outcome proposal |
| PROPOSED | DISPUTED | Valid challenge |
| PROPOSED | FINALIZED | Challenge period elapsed |
| DISPUTED | FINALIZED | Valid arbitration |
| CLOSED | CANCELLED | Resolution failure/invalidity |
| DISPUTED | CANCELLED | Invalid or unresolvable event |
| PROPOSED | CANCELLED | Applicable invalidation rule |

Time-dependent states may be computed from timestamps rather than requiring an explicit state-changing transaction.

Finalized and cancelled states are terminal for the outcome.

## 9.3 Forbidden Transitions

- FINALIZED → OPEN.
- FINALIZED → PROPOSED.
- CANCELLED → OPEN.
- Changing the winning outcome after finalization.
- Reopening contributions after closing.

---

# 10. Smart Contract Architecture

## 10.1 Contract Modules

### MarketFactory.sol

Responsibilities:

- Create markets.
- Validate creation parameters.
- Collect creation bonds.
- Assign market IDs.
- Store market configuration commitments.
- Register markets.
- Emit creation events.

### PredictionPool.sol

Responsibilities:

- Accept contributions.
- Track YES and NO balances.
- Track participant contributions.
- Enforce contribution deadlines.
- Calculate fee and payout entitlements.
- Process claims and refunds.
- Maintain collateral accounting.

### MarketResolver.sol

Responsibilities:

- Accept outcome proposals.
- Collect proposal bonds.
- Accept challenges.
- Track challenge windows.
- Authorize arbitration.
- Finalize results.
- Cancel invalid markets.
- Handle resolution timeouts.

### ProtocolConfig.sol

Responsibilities:

- Store global configurable parameters.
- Manage authorized governance roles.
- Configure emergency controls.
- Expose fee and bond parameters for future markets.

Existing market parameters must not change retroactively.

## 10.2 Contract Interfaces

Required conceptual functions:

`createMarket(metadataHash, closeTime, resolutionTime, maxResolutionTime)`

`predict(marketId, outcome)`

`proposeResult(marketId, outcome, evidenceHash)`

`challengeResult(marketId, evidenceHash)`

`finalizeResult(marketId)`

`settleDispute(marketId, decision)`

`cancelMarket(marketId, reasonCode)`

`claim(marketId)`

`claimRefund(marketId)`

`claimBond(marketId, bondType)`

`getMarket(marketId)`

`getPosition(marketId, user)`

`getClaimable(marketId, user)`

`getPoolTotals(marketId)`

These are interface requirements, not final Solidity function signatures.

## 10.3 Required Events

- `MarketCreated`
- `PredictionPlaced`
- `MarketOutcomeProposed`
- `MarketChallenged`
- `MarketFinalized`
- `MarketCancelled`
- `RewardClaimed`
- `RefundClaimed`
- `BondDeposited`
- `BondReleased`
- `BondSlashed`
- `ProtocolFeeAccrued`
- `ProtocolFeeWithdrawn`

Events must contain sufficient indexed identifiers for reliable off-chain reconstruction.

## 10.4 Smart Contract Security Requirements

- Reentrancy protection.
- Checks-effects-interactions.
- Strict access control.
- Immutable finalized outcomes.
- Bounded fee parameters.
- Timestamp validation.
- No arbitrary admin withdrawals.
- Separate pool, fee, and bond accounting.
- Safe native QIE transfers.
- Safe integer arithmetic.
- Explicit rounding.
- Duplicate-claim prevention.
- Pull-based payouts.
- Emergency pause for new financial activity.
- Claims/refunds remain accessible when safely possible.
- No unbounded loops over participants.
- No reliance on block timestamps for randomness.
- No reliance on frontend validation for security.

## 10.5 Accounting Invariants

For every market:

- Contributions cannot be created without received collateral.
- Claimable payouts plus paid payouts cannot exceed allocated distributable funds.
- Refunds cannot exceed refundable contributions.
- Fee withdrawals cannot exceed accrued protocol fees.
- Bond payouts cannot exceed available bond balances.
- Every contribution is settled under exactly one terminal outcome.
- No participant can claim the same entitlement twice.

Global contract liabilities must never exceed controlled collateral.

---

# 11. Resolution and Oracle Design

## 11.1 Initial Model

ORAKL v1 uses optimistic resolution with a challenge window and independent arbitration.

The platform must not describe this mechanism as fully trustless.

## 11.2 Resolution Requirements

Every market must specify:

- Exact question.
- Measurement criteria.
- Relevant time zone.
- Observation cutoff.
- Authoritative evidence source.
- Outcome definition.
- Ambiguity handling.
- Cancellation conditions.
- Proposal period.
- Challenge period.
- Maximum resolution deadline.

## 11.3 Proposed Defaults

Initial design assumptions:

- Challenge window: 24 hours.
- Proposal bond: configurable.
- Challenge bond: configurable.
- Arbitration: designated multisig or approved dispute mechanism.
- Resolution timeout: defined per market.

These values require risk review before deployment.

## 11.4 Resolution Failure

If the proposer, oracle, or arbitrator becomes unavailable:

1. The system enters the timeout procedure.
2. A fallback resolver may act if authorized by the rules.
3. If no valid result is obtained by the final deadline, the market becomes refund-eligible.
4. Users reclaim contributions through the contract.

## 11.5 Market Integrity

Market metadata must be committed using a cryptographic hash.

Metadata should be stored using content-addressed storage such as IPFS, with redundant pinning or mirrored storage.

The frontend verifies retrieved metadata against the on-chain commitment.

Evidence must remain accessible for dispute review.

---

# 12. Backend Architecture

## 12.1 Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Web framework | Next.js |
| API | Next.js Route Handlers |
| ORM | Prisma |
| Database | PostgreSQL |
| Blockchain client | viem |
| Wallet integration | wagmi |
| Indexer | Dedicated Node.js worker |
| Background jobs | Redis + BullMQ, if needed |
| Storage | IPFS-compatible storage |
| Frontend hosting | Vercel |
| Worker hosting | Persistent container/server |
| Contract tooling | Foundry |

## 12.2 Backend Responsibilities

The backend handles:

- Market metadata.
- Search.
- Filtering.
- Categories.
- Wallet authentication.
- User preferences.
- Market discovery.
- Indexing projections.
- Historical analytics.
- Portfolio aggregation.
- Moderation.
- Reporting.
- Notifications.
- Operational monitoring.

The backend does not own participant private keys or directly control user contributions.

## 12.3 API Requirements

### Public APIs

`GET /api/v1/markets`

Returns paginated market listings.

`GET /api/v1/markets/:id`

Returns market metadata and indexed on-chain state.

`GET /api/v1/markets/:id/activity`

Returns contribution and settlement history.

`GET /api/v1/markets/:id/pool`

Returns YES/NO pool totals.

`GET /api/v1/categories`

Returns supported categories.

`GET /api/v1/search`

Searches market metadata.

### Portfolio APIs

`GET /api/v1/users/:address/positions`

`GET /api/v1/users/:address/activity`

`GET /api/v1/users/:address/claims`

### Authentication APIs

`POST /api/v1/auth/nonce`

`POST /api/v1/auth/verify`

`POST /api/v1/auth/logout`

### Market Metadata APIs

`POST /api/v1/markets/drafts`

`POST /api/v1/markets/metadata`

`GET /api/v1/markets/:id/metadata`

### Resolution APIs

`GET /api/v1/markets/:id/resolution`

`GET /api/v1/markets/:id/evidence`

`GET /api/v1/disputes/:id`

Transaction-signing and contract writes are handled by the connected wallet.

## 12.4 API Security

- Request schema validation.
- Rate limiting.
- Pagination limits.
- Authentication where necessary.
- Wallet signature verification.
- CSRF protection for session-based mutations.
- Input sanitization.
- Structured error responses.
- No trust in user-supplied wallet addresses for authorization.
- Secrets managed outside source control.
- Administrative action logging.

---

# 13. Database Design

## 13.1 users

Fields:

- `id`
- `wallet_address`
- `created_at`
- `last_seen_at`
- `display_name`
- `avatar_url`

Wallet address is the primary external identity.

## 13.2 markets

Fields:

- `id`
- `chain_id`
- `onchain_market_id`
- `contract_address`
- `creator_address`
- `metadata_hash`
- `metadata_uri`
- `question`
- `description`
- `category_id`
- `close_time`
- `resolution_time`
- `max_resolution_time`
- `status`
- `created_block`
- `created_at`

## 13.3 market_positions

Fields:

- `market_id`
- `wallet_address`
- `yes_contribution`
- `no_contribution`
- `claimed_amount`
- `refunded_amount`
- `updated_block`

This table is an indexed projection, not the authoritative ledger.

## 13.4 predictions

Fields:

- `id`
- `chain_id`
- `market_id`
- `wallet_address`
- `outcome`
- `amount`
- `tx_hash`
- `log_index`
- `block_number`
- `block_hash`
- `timestamp`

## 13.5 resolutions

Fields:

- `market_id`
- `proposer_address`
- `proposed_outcome`
- `evidence_hash`
- `challenge_deadline`
- `final_outcome`
- `status`
- `finalized_tx_hash`

## 13.6 disputes

Fields:

- `id`
- `market_id`
- `challenger_address`
- `evidence_hash`
- `bond_amount`
- `status`
- `decision`
- `created_at`

## 13.7 claims

Fields:

- `market_id`
- `wallet_address`
- `claim_type`
- `amount`
- `tx_hash`
- `log_index`
- `block_number`

## 13.8 categories

Fields:

- `id`
- `slug`
- `name`
- `description`
- `is_active`

## 13.9 indexer_checkpoints

Fields:

- `chain_id`
- `contract_address`
- `last_processed_block`
- `last_processed_block_hash`
- `updated_at`

## 13.10 moderation_reports

Fields:

- `id`
- `market_id`
- `reporter_address`
- `reason`
- `status`
- `created_at`

Database indexes must support market discovery, wallet portfolio queries, chronological event retrieval, and unique blockchain event identification.

---

# 14. Blockchain Indexer

## 14.1 Responsibilities

The indexer reads QIE contract events and builds queryable projections in PostgreSQL.

## 14.2 Processing Flow

1. Load the last persisted checkpoint.
2. Query QIE RPC for contract logs.
3. Decode events using contract ABIs.
4. Validate block identity.
5. Process events in deterministic order.
6. Upsert indexed records.
7. Update aggregate projections.
8. Persist the checkpoint atomically.
9. Continue polling.

## 14.3 Reliability Requirements

- Idempotent event processing.
- Unique event identity.
- Restart-safe checkpoints.
- Chain reorganization detection.
- Rollback and replay support.
- RPC retry with exponential backoff.
- Configurable batch sizes.
- Historical backfill.
- Reconciliation against on-chain state.
- Alerts on indexing lag.
- Separate pending and sufficiently confirmed states.

The required confirmation depth must be determined from QIE Mainnet behavior and RPC testing.

---

# 15. Frontend Requirements

## 15.1 Design Principles

- Modern Web3-native visual identity.
- Clean, minimal interface.
- Responsive mobile-first layout.
- Clear financial information.
- Accessible navigation.
- Visible transaction status.
- Transparent risk disclosures.
- Fast market discovery.

## 15.2 Required Pages

### Home

- Hero section.
- Trending markets.
- Popular categories.
- Recently created markets.
- Recently resolved markets.
- Total protocol activity.
- Create Market CTA.

### Explore

- Search bar.
- Category tabs.
- Active/closed/resolved filters.
- Sorting.
- Market cards.
- Pagination or infinite scrolling.

### Market Detail

- Market question.
- Description.
- YES/NO selection.
- Pool distribution.
- Contribution amount.
- Estimated payout.
- Deadline.
- Resolution source.
- Market rules.
- Contribution history.
- Current status.
- Resolution evidence.
- Claim/refund action.

### Create Market

- Guided form.
- Validation.
- Deadline selection.
- Resolution rule builder.
- Metadata preview.
- Bond disclosure.
- Wallet confirmation.

### Portfolio

- Active positions.
- Pending resolution.
- Claimable rewards.
- Refundable positions.
- Historical results.
- Transaction history.

### Profile

- Wallet address.
- Markets created.
- Participation history.
- Public activity.

### Disputes

- Challenged markets.
- Proposed outcomes.
- Evidence.
- Deadlines.
- Arbitration status.

### Admin Dashboard

- Market moderation.
- Reports.
- Indexer health.
- Resolution queues.
- Operational alerts.
- Protocol configuration visibility.

## 15.3 Transaction UX

Every transaction must support:

- Wallet confirmation pending.
- Transaction submitted.
- Confirmation pending.
- Confirmed.
- Reverted.
- Rejected by user.
- RPC error.
- Insufficient gas.
- Wrong network.

The interface must never display a contribution as finalized solely because a wallet returned a transaction hash.

---

# 16. Estimated Payout UX

Because ORAKL uses pari-mutuel pools, payout estimates change as new contributions arrive.

The interface must display:

- Current YES pool.
- Current NO pool.
- Total pool.
- Current contribution distribution.
- Estimated payout based on current pool.
- Estimated net return.
- Protocol fee.
- Disclaimer that final payout is not fixed.

Pool percentages must not be labeled as mathematically verified probabilities.

Example:

"Estimated payout based on current contributions. Final returns depend on total pool distribution at market closure."

---

# 17. Security and Privacy

## 17.1 Smart Contract Security

Required:

- Static analysis.
- Unit tests.
- Fuzz tests.
- Invariant tests.
- Access-control tests.
- Reentrancy tests.
- Edge-case payout tests.
- Resolution timeout tests.
- Malicious receiver tests.
- Independent security review before financial activation.

## 17.2 Backend Security

- Secure session management.
- Wallet authentication.
- Rate limiting.
- Database access restrictions.
- Secrets management.
- Administrative MFA.
- Audit logs.
- Input validation.
- Dependency scanning.
- Monitoring.
- Backups and recovery procedures.

## 17.3 Privacy

Public wallet addresses and on-chain transactions are inherently observable.

The platform must disclose this clearly.

Do not store sensitive personal data on-chain.

Any identity verification data required for compliance must be stored and processed using appropriate security controls and retention policies.

---

# 18. Legal and Compliance Requirements

ORAKL targets a global audience, but real-money prediction markets are regulated differently across jurisdictions.

The product must not assume that permissionless smart contracts eliminate legal obligations.

Before accepting real-value funds, requirements include:

- Jurisdiction-by-jurisdiction legal assessment.
- Determination of gambling, derivatives, or event-contract classification.
- Licensing analysis.
- Market-category restrictions.
- KYC/AML obligations where applicable.
- Sanctions screening.
- Age eligibility.
- Consumer protection requirements.
- Privacy and data processing compliance.
- Terms of Service.
- Risk disclosures.
- Dispute and complaint procedures.
- Responsible participation controls where applicable.

A jurisdictional access-control policy must be defined before launch.

Geo-blocking alone must not be treated as proof of compliance.

**Release rule:** If required legal authorization is unavailable, real-value prediction pools remain disabled. The platform may continue development and testing using non-redeemable test mechanisms.

---

# 19. Infrastructure and Deployment

## 19.1 Repository Structure

```text
orakl/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── public/
│   │
│   └── indexer/
│       ├── src/
│       └── tests/
│
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── MarketFactory.sol
│   │   │   ├── PredictionPool.sol
│   │   │   ├── MarketResolver.sol
│   │   │   └── ProtocolConfig.sol
│   │   ├── test/
│   │   ├── script/
│   │   └── foundry.toml
│   │
│   ├── database/
│   │   ├── prisma/
│   │   └── migrations/
│   │
│   ├── shared/
│   │   ├── abi/
│   │   ├── types/
│   │   └── constants/
│   │
│   └── ui/
│
├── docs/
│   ├── architecture/
│   ├── protocol/
│   ├── security/
│   └── api/
│
├── .github/
│   └── workflows/
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## 19.2 Environments

- Local development.
- Automated CI test environment.
- Staging frontend/backend.
- Mainnet deployment in paused state.
- Production environment after release approval.

Local testing must not require public mainnet funds.

## 19.3 Mainnet Deployment Requirements

- Official QIE Mainnet RPC verified.
- Chain ID verified.
- Native currency properties verified.
- Gas behavior benchmarked.
- Explorer verification procedure tested.
- Deployment addresses recorded.
- Contract bytecode verified.
- Ownership and administrative roles confirmed.
- Emergency controls tested.
- Indexer synchronization validated.
- Independent audit completed.
- Legal launch approval obtained before financial activation.

## 19.4 Key Management

- No production private keys in GitHub.
- No secrets in frontend environment variables.
- Dedicated deployer account.
- Multisig for privileged administrative functions.
- Hardware-backed or managed signing where appropriate.
- Documented key rotation and incident procedures.

---

# 20. Testing Strategy

## 20.1 Unit Tests

Cover:

- Market creation.
- Invalid metadata commitments.
- Invalid deadlines.
- Bond handling.
- Contribution accounting.
- Fee calculations.
- Winner payout.
- Multiple contributions.
- Both-side contributions.
- Claim protection.
- Refund eligibility.
- Cancellation.
- Resolution.
- Dispute handling.
- Pause behavior.

## 20.2 Fuzz Testing

Randomize:

- Contribution amounts.
- Participant count.
- YES/NO distributions.
- Claim order.
- Market deadlines.
- Fee values within bounds.
- Bond amounts.
- Resolution timing.

Verify accounting invariants across randomized inputs.

## 20.3 Integration Testing

Test complete flows:

1. Create market.
2. Participate YES.
3. Participate NO.
4. Close market.
5. Propose outcome.
6. Wait through challenge window.
7. Finalize outcome.
8. Claim payout.
9. Reconcile database state.

Repeat with challenged, cancelled, and zero-winner markets.

## 20.4 Adversarial Testing

Test:

- Reentrancy.
- Duplicate claims.
- Malicious receiver contracts.
- Unauthorized resolution.
- Creator manipulation.
- Premature finalization.
- Expired challenges.
- Invalid evidence commitments.
- Incorrect bond accounting.
- RPC failures.
- Indexer crashes.
- Blockchain reorganizations.
- Metadata unavailability.
- Timestamp boundaries.
- Unexpected native token transfers.

---

# 21. Observability and Operations

## 21.1 Monitoring

Track:

- API errors.
- RPC failures.
- Indexer lag.
- Missed events.
- Unresolved markets.
- Dispute deadlines.
- Failed transactions.
- Claim failures.
- Contract balance reconciliation.
- Administrative actions.

## 21.2 Alerts

Critical alerts:

- Contract accounting discrepancy.
- Unauthorized privileged action.
- Unexpected protocol balance movement.
- Indexer significantly behind chain.
- Resolver approaching timeout.
- Repeated claim failures.
- Persistent RPC outage.

## 21.3 Recovery

Required runbooks:

- RPC provider outage.
- Indexer restart.
- Database restoration.
- Chain reorganization.
- Metadata storage outage.
- Resolver failure.
- Compromised operational credential.
- Emergency contract pause.

---

# 22. Development Roadmap

## Phase 1 — Protocol Foundation

Deliverables:

- Final economic specification.
- Market state machine.
- Payout and refund rules.
- Resolution specification.
- Smart contract architecture.
- Threat model.

**Exit Criteria:** No unresolved ambiguity in custody, payout, or terminal market states.

## Phase 2 — Smart Contract Development

Deliverables:

- MarketFactory.
- PredictionPool.
- MarketResolver.
- ProtocolConfig.
- Events and interfaces.
- Deployment scripts.

**Exit Criteria:** All core functions compile and pass initial unit tests.

## Phase 3 — Security Testing

Deliverables:

- Comprehensive unit tests.
- Fuzz testing.
- Invariant testing.
- Static analysis.
- Integration tests.
- Remediation report.

**Exit Criteria:** No known critical or high-severity issues.

## Phase 4 — Backend Development

Deliverables:

- Database schema.
- API routes.
- Metadata storage.
- Wallet authentication.
- Indexer.
- Portfolio projections.

**Exit Criteria:** Database accurately reconstructs confirmed on-chain activity.

## Phase 5 — Frontend Development

Deliverables:

- Landing page.
- Explore markets.
- Market details.
- Create market.
- Portfolio.
- Claims.
- Disputes.
- Responsive design.

**Exit Criteria:** Core user journeys work end-to-end in controlled testing.

## Phase 6 — Mainnet Preparation

Deliverables:

- Verified mainnet configuration.
- Deployment scripts.
- Monitoring.
- Operational runbooks.
- Independent security audit.
- Compliance review.

**Exit Criteria:** Technical readiness and documented legal release decision.

## Phase 7 — Mainnet Deployment

Deliverables:

- Verified deployed contracts.
- Paused initial deployment.
- Production frontend/backend.
- Synced indexer.
- Verified contract addresses.
- Public documentation.

Financial activation remains gated by audit remediation and applicable legal authorization.

---

# 23. Definition of Done

ORAKL MVP is technically complete when:

- Users can connect supported wallets.
- Valid markets can be created.
- Metadata is verifiably bound to on-chain markets.
- YES/NO contributions are correctly accounted for.
- Contributions close at the specified deadline.
- Results can be proposed and challenged.
- Every market has a terminal settlement or refund path.
- Payouts are deterministic and correct.
- Duplicate claims are impossible.
- Creation and resolution bonds are accounted for.
- Indexer projections match on-chain state.
- Frontend supports all required journeys.
- Critical failure paths are tested.
- Monitoring and recovery procedures are documented.
- Security review findings are resolved.

**Production financial launch additionally requires the applicable legal and operational approvals.**

---

# 24. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Incorrect resolution | Evidence rules, challenge window, arbitration |
| Creator spam | Creation bonds, moderation, abuse controls |
| Smart contract exploit | Testing, audit, limited privileges |
| Funds locked indefinitely | Timeouts and refund paths |
| No winning participants | Refund policy |
| Market ambiguity | Required resolution criteria |
| Backend downtime | On-chain claim independence |
| RPC outage | Retries, provider redundancy |
| Database desynchronization | Replayable indexer, reconciliation |
| Volatile QIE collateral | Clear denomination and risk disclosure |
| Regulatory restrictions | Eligibility controls and legal review |
| Malicious metadata | Validation, content-addressing, moderation |

---

# 25. Open Design Decisions

The following items must be finalized before the implementation is considered production-ready:

1. Final creation bond amount and return conditions.
2. Minimum contribution amount.
3. Final protocol fee.
4. Proposal and challenge bond economics.
5. Exact dispute arbitration model.
6. Final challenge and timeout durations.
7. Unclaimed reward and rounding-dust policy.
8. Eligible jurisdictions and market categories.
9. Legal requirements for real-value participation.
10. QIE Mainnet network parameters and RPC reliability.
11. Metadata storage and redundancy provider.
12. Whether market creation eligibility is enforced on-chain.
13. Privileged role management and upgrade policy.
14. Whether the first production release supports native QIE only.

These are explicit design decisions, not implementation details that should be silently chosen by a coding agent.

---

# 26. Engineering Principles

ORAKL development must follow these principles:

**1. On-chain financial truth**

Financial state is determined by verified smart contract storage and events, not mutable database records.

**2. No arbitrary custody**

Creators and administrators must not have unrestricted access to participant funds.

**3. Deterministic accounting**

Payouts, fees, bonds, and refunds must follow explicit formulas.

**4. Verifiable market rules**

Critical market terms are cryptographically committed before contributions begin.

**5. Reliable exit paths**

Every market must eventually support a valid claim or refund process.

**6. Security before activation**

Mainnet deployment does not imply authorization to activate financial functionality.

**7. Modular architecture**

Contracts, indexing, backend APIs, and frontend components remain independently testable.

**8. Transparent limitations**

The interface must clearly explain uncertain payouts, collateral volatility, resolution trust assumptions, and jurisdictional restrictions.

---

# 27. Final Product Statement

ORAKL aims to become a community-driven prediction market infrastructure on QIE Blockchain, combining permissionless market creation, transparent pool-based participation, and verifiable on-chain settlement.

Its initial architecture prioritizes simplicity, deterministic accounting, and operational reliability over advanced trading mechanisms.

The MVP establishes a foundation for future expansion into more sophisticated market structures while maintaining clear separation between smart contract custody, real-world resolution, and off-chain application services.

**ORAKL — Predict What's Next. Own Your Conviction.**

---

**Document End — ORAKL PRD v1.0**
