# ORAKL Protocol

ORAKL is a decentralized prediction market protocol featuring optimistic proposals, multi-challenger bonded dispute arbitration, and reorg-safe event projection.

## Language

### Markets & Positions

**Contribution Share**:
A participant's proportional ownership of an outcome pool based on deposited collateral.
_Avoid_: Guaranteed payout, pool probability, betting odds, stake

**Exposure Cap**:
The protocol-enforced maximum aggregate uncollateralized liability permitted across non-terminal markets globally or per arbitrator.
_Avoid_: Market limit, pool ceiling, liquidity cap

### Dispute & Resolution

**Bonded Challenge**:
A formal stake tranche deposited by an independent challenger during the challenge window that transitions a proposed outcome into disputed status.
_Avoid_: Unbonded objection, dispute vote, report, flag

**Challenger Stake**:
An individual bonded contribution tranche deposited by a challenger during the challenge window, tracked with an immutable prefix offset.
_Avoid_: Challenger balance, dispute share, objection deposit

**Informational Evidence**:
An unbonded proof commitment published on-chain via cryptographic hash without altering market phase or dispute liability.
_Avoid_: Formal dispute, bonded claim, challenge evidence

**Arbitrator**:
A designated entity or multi-sig authorized to settle a disputed market proposal before the arbitration deadline.
_Avoid_: Admin, judge, market owner, validator

**Neutral Resolution**:
A terminal market state (such as INVALID or cancellation) where no prediction outcome wins, triggering participant refunds without fee deduction and returning bonds neutrally.
_Avoid_: Void, tie, split decision, cancellation fee

**Refundable Bond Liability**:
Funds held in escrow as creator or dispute bonds that remain payable to their depositors under neutral resolution, maintained strictly disjoint from protocol revenue.
_Avoid_: Protocol revenue, slashed bond, escrow profit, retained deposit

### Indexing & Ledger

**Reorg Depth**:
The maximum configurable span of past blocks across which the indexer detects block hash divergence and executes atomic projection rollback.
_Avoid_: Finality window, block confirmation count, confirmation threshold

**Synchronization Metadata**:
Block height and block hash properties attached to API read payloads indicating the exact ledger state at which the response was projected.
_Avoid_: Cache header, timestamp, server version

**Local Simulation**:
An isolated development environment running on Chain ID 31337 with synthetic parameter fixtures and zero production financial authority.
_Avoid_: Testnet staging, production sandbox, live deployment
