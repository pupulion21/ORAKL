# Exposure and spam model

Status **PROPOSED_NOT_APPROVED**. [predict](../../contracts/src/PredictionPool.sol#L14) checks each market's snapshotted cap on YES+NO, and [totalAccounted](../../contracts/src/ProtocolStorage.sol#L82) adds participant, bond and fee liabilities. There is no current shared-arbitrator or global unresolved-exposure counter. Four correlated markets at cap 10 have aggregate unresolved exposure 40, regardless of their shared arbitrator. Refundable K can be reused after terminal settlement; it does not permanently pay for indexer/storage/monitoring costs or stop gas-funded Sybils and empty markets.

## Accounting distinction and candidate hard bounds

Unresolved outcome exposure is actual YES+NO contributions whose market remains nonterminal. Participant liability includes refundable or winning funds still unclaimed after a terminal state; bond and fee liability are separate. Forced native credits are surplus, not deposited predictions. A global unresolved cap does **not** cap custody or external hedge/bribe exposure, and per-address arbitrator limits do not prove independent control.

If approved, add immutable or explicitly prospective global/per-arbitrator budgets, `totalUnresolvedExposure`, `unresolvedExposureByArbitrator`, and one exactly-once release flag per market. Snapshot arbiter identity and budget semantics at creation. This is a **design only**; current production code does not enforce it.

| Transition | Proposed outcome exposure update | Other ledger effects |
|---|---|---|
| Create, zero pool | None | K increases bond liability |
| Predict x | Atomically check both headrooms then add x to both counters | Add x to user position/participant liability |
| Close, propose, challenge | None | Bond deposits remain separate |
| Valid finalization, INVALID, cancellation, or empty-winner refund | Release Y+N exactly once at stored terminal transition | Fees allocated only for valid nonempty winner; payout/refund liabilities persist |
| Timeout reached but cancellation not yet executed | No release | Permissionless caller must execute transition; prevent permanent capacity loss operationally |
| Claim, refund, bond claim, fee withdrawal, forced transfer | No second release | Debit only the proper liability, or classify surplus |

Example in hypothetical units: market A deposits 10 and B deposits 20, so unresolved exposure is 30. A finalizes at a hypothetical 2% fee: unresolved becomes 20, participant liability 29.8, fee liability 0.2 before claims. After A's payout, B cancels: unresolved becomes 0 while its 20-unit refund liability remains. Bonds are separate throughout. The reproducible [P0.3 model](../../scripts/model-orakl-p0-3-economics.py) exercises this schedule; amounts are synthetic, not a Mainnet denomination claim.

Hard caps create capacity contention and may be consumed by strategic deposits; prices/gas and clearing latency determine operational cost. Many related arbitrator addresses evade per-arbiter-only limits. Related markets have correlated loss: sums constrain deposits but cannot bound economic payoff across external positions. Terminal unclaimed balances can accumulate independently, so any separate custody limit needs its own owner decision, precise treatment of liabilities and admission/testing policy.

Parameter discussion ranges only: fee 200 bps; P 5–20% of per-market cap; C 0.5–1 P; K 0.05–0.25 P; challenge 24–72h; arbitration 48–168h. None is a safe default. Monitor capital, opportunity cost, detection, market size, external value and measured gas must be reviewed. A tiny sole winning deposit can receive almost the entire net pool; one-sided markets and strategic INVALID can change incentives. Minimum contribution and nonrefundable creation fees require separate explicit approval, and Mainnet native decimals/gas must be verified before setting units.
