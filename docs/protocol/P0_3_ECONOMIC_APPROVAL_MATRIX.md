# P0.3 exact economic approval matrix

**No punitive economic policy is approved or implemented.** Executable Solidity still returns each deposited K/P/C principal to its original owner after every terminal state. P0.3 only changes evidence access, protective challenge admission and the earliest disputed decision time. Its candidate timing/access design also needs final protocol sign-off. [Current accounting source](../../contracts/src/ProtocolStorage.sol#L90), [unchanged fee/payout source](../../contracts/src/PredictionPool.sol#L94), [counterfactual model](../../scripts/model-orakl-p0-3-economics.py).

## All nine proposed/final outcomes

The completed neutral-final-INVALID candidate below is **analysis only**. K always returns to creator; totals include only principals actually deposited. Unchallenged proposals have no C deposit and return P. A challenge is an objection, not an encoded alternate answer. Under the candidate, good-faith but incorrect parties may forfeit principal; a challenge alone never proves misconduct.

| Proposal | Arbitrator final | Current proposer / challenger | Candidate proposer / challenger | Conservation / coalition controlling both |
| --- | --- | --- | --- | --- |
| YES | YES | P / C | P+C /0 | Both sum P+C; coalition principal gain0 |
| YES | NO | P / C |0 / P+C | Same |
| YES | INVALID | P / C | P / C | Same |
| NO | YES | P / C |0 / P+C | Same |
| NO | NO | P / C | P+C /0 | Same |
| NO | INVALID | P / C | P / C | Same |
| INVALID | YES | P / C |0 / P+C | Same; the missing P0.2 candidate case is explicit |
| INVALID | NO | P / C |0 / P+C | Same |
| INVALID | INVALID | P / C | P / C | Same |

For every row, K+proposerReceipt+challengerReceipt=K+P+C. Current owners can claim only their own bond record; no reward ledger or BondSlashed event was introduced. Candidate transfer recipients would need a new audited entitlement allocation, not an administrator-selected send. Failed transfers must roll back exactly-once flags/liabilities; owner-directed pull claims remain required.

| Edge condition | Executable current policy | Candidate reviewed, still unapproved |
| --- | --- | --- |
| Valid binary, nonempty winner | Full bond returns; fee=floor(T*feeBps/10000), fixed proportional participant payouts | Apply corresponding matrix row; fee candidate200 bps, not an approved production amount |
| Binary with empty winning side | Participant full refunds; fee0; all deposited principals returned | Recommended discussion default: same binary bond row; alternative: neutral bond returns for all refundable markets. Owner must choose explicitly. |
| Entirely empty market | No prediction payout or fee; deposited bonds return after terminal | Same matrix by default for analysis; alternative full-neutral empty-market rule avoids punitive disputes with no participant exposure. Not silently selected. |
| Final INVALID, any pool distribution | Full participant/bond returns; fee0 | P/C neutral returns even if proposal was binary; no reward for obtaining INVALID |
| No proposal / unresolved expiry / arbitration timeout / emergency cancellation | Full original participant/bond principal; fee0 | Same neutral cancellation rule; no presumption that timeout proves dishonesty |
| P=0 or C=0 | Allowed by current config, still activation/pause/chain/epoch gated | Algebra conserves principal, but proposal/challenge deterrence or reward disappears. Recommend positive P/C only after exact minima/amounts are approved; do not manufacture rewards from pools/fees/surplus. |
| External payoff exceeds native exposure | No on-chain observation/bound on bribes, hedges, political/reputational value | A cap/bond ratio alone cannot secure it. Model stress example adds10,000 external units to a1,000-unit pool; not a measured forecast. |

The executable model checks **144** combinations:9 outcomes×4 zero/positive P/C cases×4 pool shapes (two-sided, each one-sided, empty), fee-free refunds, full bond conservation/cancellations and coalition internal transfers. It also retains exact P0.2 position/detection sensitivities. Simulations are not proof of monitoring, honest arbitration or economic security. Native1e18 scale is synthetic, not Mainnet decimal verification.

## Multiple bonded challengers — two concrete unimplemented alternatives

**Default now: retain one economic challenge record with permissionless evidence intake.** A new reward/slash design requires owner approval. The first bonded record remains capturable by a proposer-controlled wallet; multiple contributors do not acquire economic entitlement from an evidence event.

| Alternative | Allocation and O(1) accounting | Sybil/coalition, splitting and gas/DoS implications | Recommendation |
| --- | --- | --- | --- |
| A. Proportional bonded objection pool | During [proposal,D), add each exact/allowed C_i to totalChallengeBond and per-owner aggregate balance. A valid first contribution marks DISPUTED; later contributions do not reset timers. At terminal, allocate one immutable reward pool. If binary reversal: each owner claims C_i+floor(P*C_i/sumC); if upheld: proposer claims P+sumC; INVALID/timeout returns each original deposit. Per-owner settled flag, O(1) deposit/terminal allocation/claim, no contributor iteration. Separate bond liabilities; total claims<=P+sumC; rounding reserve never participant funds. | Splitting fixed aggregate stake among Sybils cannot improve proportional principal share beyond rounding, but a coalition can flood capital to dilute honest rewards and recapture most of its own proposal bond. No guaranteed researcher priority or independence. No small global count cap; each deposit costs gas/capital, indexer load remains. No zero denominator or early claim; positive-minimum and cap policy must be explicit. | Prefer over equal-per-wallet weighting if owner later requires multiple bonded challengers, subject to loss-budget and dilution review. **Not approved/implemented.** |
| B. Equal fixed-bond tranches | Each eligible wallet deposits fixed C once, total countN increments; receipt balance/claim flag keyed by owner. Binary reversal pays each C+floor(P/N); upheld proposer gets P+N*C; neutral cases return ownC. O(1) insertion, count-based allocation and per-owner claim. Total payouts bounded by P+N*C; reserve floor dust. No settlement scan. | A coalition buys N Sybil slots and captures N/(N+honest) of P, so “one wallet one reward” does not establish fairness. Front-running and copied evidence still possible. A small global slot cap recreates exclusion; no such cap should close free evidence intake. Fixed C creates capital cost but no beneficial-owner defense; low C enables cheap reward dilution, high C excludes honest monitors. | Reject as default production choice absent a justified anti-Sybil/eligibility policy; keeping it explicit shows why address counts are not independence. **Not approved/implemented.** |

Example for either design: P=100, honest bond10 and coalition90 (or9 coalition tranches of10 versus1 honest tranche). The honest reward is10, and the coalition recaptures90 of its own P. Larger coalition weight further suppresses an external challenger's incentive. Correct arbitrary merit-weighted evidence would introduce adjudicator trust; a Merkle allocation root has O(1) claim-state accounting but O(logN) proof work and a new allocation authority. It is not silently treated as an O(1), trustless alternative.

## Exposure and spam: current behavior and minimal hard-bound design

Current [predict](../../contracts/src/PredictionPool.sol#L14) enforces only the creation-snapshotted per-market total cap on Y+N. Permissionless creation with one shared arbitrator can exceed any operational aggregate target; the P0.2 four-market cap10/aggregate40 residual remains in the passing suite. Refundable K can recycle after empty markets expire. A minimum prediction or per-address creation rate cannot identify gas-funded Sybils. A tiny sole false winner may still receive almost all distributable funds, and INVALID can protect a losing position or avoid a one-sided fee. P0.3 does not claim these economics fixed.

If the owner requires a **hard native unresolved-exposure bound**, recommend a separately audited, fixed deployment-wide `globalUnresolvedCap` plus `perArbitratorUnresolvedCap`, with counters `totalUnresolvedExposure` and `unresolvedExposureByArbitrator`, and a per-market exactly-once exposure-release flag. Count **actual prediction deposits only**, not creation/proposal/challenge bonds or the market cap reservation. Immutability/prospective budget semantics must be approved; empty-market creation must not consume reserved pool-cap slots. A global bound also limits evasion by registering related arbiter addresses; per-arbiter addresses alone do not establish independent beneficial risk.

| Event/action | Proposed exposure update | Participant/bond/fee accounting remains separate |
| --- | --- | --- |
| Create market, no predictions |0 | K is bond liability, not unresolved prediction exposure |
| Valid predict of amountx | Check both cap headrooms; addx globally and to snapshot arbitrator | Addx to participant liability and caller position; revert entire msg.value on cap rejection |
| OPEN→CLOSED / PROPOSED / DISPUTED | No release | Native pool can still be assigned by an oracle outcome, so exposure remains |
| Valid finalization, including binary empty-winner refund | Release exactly Y+N once, mark flag | Allocate fee/distributable only for nonempty winner; claim liabilities remain until withdrawn |
| INVALID / ordinary timeout / emergency cancellation executed | Release exactly Y+N once | Full principal becomes refundable; bond handling unchanged |
| Deadline reached / quarantine recorded, but cancellation not executed | Conservatively retain exposure until explicit terminal path | Timestamp eligibility is not yet the stored terminal state. Permissionless cancellation/keepers can free capacity; do not iterate all markets. |
| Participant claim/refund | **No exposure change** | Debit only participant entitlement; terminal exposure was already released |
| Bond/fee withdrawals or forced native credits | **No exposure change** | Separate class debit or surplus; never counted as predictions |

The model's A10/B20 example shows unresolved30, then20 after A finalizes while participant liability is29.8 and fee0.2; after A claim participant liability20; after B cancellation unresolved0 while refundable liability remains20; B refund then participant liability0. Bonds remain a separate20 throughout. This proposed counter must not be confused with outstanding liabilities or double-decremented on claims. It is **not implemented**; exact caps and capacity-contention UX need owner approval. Under a future punitive policy, bond-at-risk/external incentives require separate exposure analysis.

An unresolved-outcome cap is not a total custody/TVL cap: terminal unclaimed entitlements can accumulate while new markets accept deposits. If a separate custody-risk bound is required, the owner must explicitly approve a distinct prospective limit on accounted participant/bond/fee liabilities. Forced surplus must not fabricate liabilities or entitlements. No custody cap is silently implemented or promised here.

## Exact owner decisions and follow-up code boundaries

| Decision | Recommended default / alternatives rejected or reserved | Exact work after explicit approval |
| --- | --- | --- |
| S1 P0.3 timing/evidence/challenge gate | Approve the minimal implemented candidate for final specification review; reject early admin override, restarted windows and full live getter dependence for objections | Final sign-off on these three production-file changes; rerun/audit exact candidate. Separate review delayΔ is unnecessary now. If desired later, snapshot0<=Δ<arbitrationPeriod and requireD+Δ<=now<A without extending A; new validation/ABI/tests required. |
| E1 Bond distribution | Consider completed neutral-INVALID matrix, accepting good-faith incorrect forfeiture; alternative full-return or independently specified service-cost policy | Add immutable policy/version and segregated deterministic bond reward entitlements; update claimBond/events/ABI/invariants. Never retrofit old contracts or arbitrary recipients. |
| E2 Empty-winner/empty-market semantics | Explicit binary decision rule in matrix versus neutral returns for every refundable/empty market | Encode the chosen terminal matrix; tests for all nine×pool/bond cases. Current full returns remain until approval. |
| E3 Positive P/C, K and minima | Positive P/C for economically active production, K refundable; exact amounts unset | Approved config validation/snapshots/production manifest and affordability tests. Reject zero P/C only after approved policy; current zero-bond local tests remain valid. |
| E4 Fee and basis | Candidate200 bps, review0–200; full-pool basis has one-sided fee effects. Reject silently adopting hard maximum1,000 as pricing | Select exact future terms/release inputs; payout code changes only if fee basis itself changes, then review all rounding/refund cases. |
| E5 Market and correlated caps | Explicit loss budget plus honest-monitor capital/coverage; P/Tcap5–20%, C/P0.5–1 remain discussion bands, not safe values | If hard aggregate bound selected, implement the counters/release flag/cap checks above and conservation/reentrancy/terminal-order tests. No cap/fee added now. |
| E6 Multiple bonded challenge rewards | Keep existing single C while free evidence is open; prefer A over B only if separately selected | New per-owner contribution/entitlement ledger, snapshot aggregate allocation, O(1) claims, dust policy and events. Reassess Sybil dilution; do not claim evidence submission itself earns bonds. |
| E7 Creation spam | Keep K full-return pending decision; moderation alone cannot stop direct calls | Approve a specific nonrefundable charge/concurrency/eligibility mechanism before any contract change. Reject unapproved penalties or false claims that refundable K solves spam. |
| E8 Arbitration/appeals | Independently vetted immutable v1 arbiter, full-window public intake, published consideration/recusal/nonperformance rules | Genuine wallet/control verification and operational specification. Any appeal/performance bond needs a complete separately approved pre-finality state machine before implementation. |
| E9 Evidence schema/availability | Versioned content-addressed publication and independent verification; no schema/hash algorithm silently selected | P1 publisher/indexer verification/storage work; extra on-chain schema fields only if explicitly required and audited. Event alone cannot prove consideration. |
| E10 Timers/abort/release trust | Retain existing D/A/refund deadlines and24-hour independent recovery; emergency abort disclosure | Select exact future-market durations. Any change requires snapshots/deadline regression review; no shortening into a payout or retroactive edits. |
| E11 Dust/unclaimed funds | Preserve perpetual reserves/no sweep as default candidate | If expiry/sweep selected, specify exact rights/deadlines/residual accounting and independently audit; never relabel unclaimed entitlements as protocol fees. |

Final production amounts, arbitration independence, network compatibility and applicable legal/operational authorization remain unresolved. There is no owner economic approval recorded by this task. [Freeze readiness](../audit/P0_3_PROTOCOL_FREEZE_READINESS.md) keeps these blockers explicit.
