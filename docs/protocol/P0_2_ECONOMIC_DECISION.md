# P0.2 economic decision record

Status: **RECOMMENDATION ONLY — OWNER APPROVAL MISSING; PROTOCOL FREEZE BLOCKED**.
Baseline: `remediation/orakl-p0-1` at `d46452479b9ce08dea77dd45730276c26fa50894`.
Working branch: `feature/orakl-p0-2`. No production economic policy is approved by this record.

## Evidence and present executable policy

The [PRD](../product/ORAKL-PRD-v1.0.md), especially §§8, 11, 18, 25, remains the product target. The [P0.1 alternatives](BOND_POLICY_PROPOSAL.md), [current bond accounting](BOND_ECONOMICS.md), [emergency mechanism](../security/EMERGENCY_RECOVERY.md), and [security review](../audit/P0_1_SECURITY_REVIEW.md) are the starting evidence.

`contracts/src/ProtocolStorage.sol:90` returns each deposited bond to its original owner after every terminal result. `MarketResolver.sol:23` admits YES, NO and INVALID proposals; `:49` accepts only the first challenge, whose calldata contains evidence but no counter-outcome. `PredictionPool.sol:94` charges the creation-snapshotted fee only when there is a nonempty winning pool. `ProtocolConfig.sol:212` permits zero bond amounts and a fee up to 1,000 bps; these code bounds are not approved production settings. Nothing in this task authorizes forfeiture, new fee income, production parameters or activation.

## Candidate disposition

Let K, P, C denote creation, proposal, challenge principals. Recommend the owner's candidate **neutral-INVALID policy (completed Option B)** for consideration as a simple first version, provided the owner explicitly accepts its limitations and separately approves exposure/monitoring/arbitration controls. This is less punitive for ambiguous questions than Option A; it is not a sufficient oracle-security design on its own. Retain full returns in Solidity until approval and a separately tested entitlement implementation.

| Terminal reason | K entitlement | P/C entitlement under recommended candidate | Executable policy today |
| --- | --- | --- | --- |
| Unchallenged YES or NO, winning pool nonempty | Creator K | Proposer P; no C deposit | Same; valid market fee applies |
| Unchallenged INVALID | Creator K | Proposer P | Same; participant refunds, fee zero |
| Disputed final YES/NO equals proposal | Creator K | Proposer P+C; challenger zero | Owners each recover their own principal |
| Disputed final YES/NO differs from YES/NO proposal | Creator K | Challenger P+C; proposer zero | Owners each recover their own principal |
| **Proposed INVALID, disputed final YES or NO** | Creator K | **Recommend challenger P+C; explicitly missing from the supplied candidate** | Owners each recover their own principal |
| Disputed final INVALID, including an INVALID proposal | Creator K | Return P and C to original owners | Same |
| Valid binary decision, winning pool empty | Creator K | Recommend corresponding binary decision rule above | Full bond returns; participant refunds; fee zero |
| Empty market | Creator K | Recommend corresponding outcome/timeout rule; whether empty markets may slash is an explicit decision | Full returns; no prediction payout or fee |
| No proposal, missed finalization, arbitration timeout, emergency cancellation | Creator K | Return each deposited principal to its owner | Same |

The completed rule rewards a successful objection to a nonbinary proposal as well as a binary reversal. An alternative is neutral returns for **any case involving INVALID**, which also returns P/C when INVALID becomes YES/NO. That is less punitive but creates a free incorrect-INVALID proposal strategy. The owner must select exactly one rule, including empty-winning-side/empty-market treatment; neither is inferred from the candidate text.

The challenger currently asserts only that the proposal is wrong, not a signed/committed alternative answer. A reward for a changed binary decision would pay even if the challenger's evidence argued for INVALID. Recommend retaining the objection semantics, publicly documented, rather than pretending the challenger correctly predicted a particular replacement. Requiring a counter-outcome changes the ABI, evidence semantics and adjudication rules and needs approval.

No challenge alone proves misconduct. Under the candidate, an honest but unsuccessful challenger loses C, and an honest but incorrect proposer loses P. The arbitrator judges market criteria, not intent. Bond rewards must stay in a separate pull-entitlement ledger, never use prediction funds, fees or forced surplus, and preserve aggregate bond liabilities and failure rollback. No arbitrary recipient, admin slash or post-finality revision is permissible. Creation K remains refundable; no creator penalty is specified or implemented.

## Incentives and exposure

Use **coalitions**, not wallet addresses. For a coalition with contributions aY and aN, pool totals Y and N, and distributable D, its outcome receipts before bond flows are:

`R(YES)=floor(aY*D/Y)` when Y>0; `R(NO)=floor(aN*D/N)` when N>0; refunds give `aY+aN`. Aggregate floors per wallet in the actual ledger; a coalition approximation can exceed the sum of wallet entitlements by rounding units. Gain from changing the truthful decision t to attack decision u is `G=R(u)-R(t)` for the same funded position; deposits are sunk in this comparison. Across many markets, sum gains for all positions sharing the arbitrator. Externally hedged positions and reputational/bribery payoffs are unobservable and can exceed native pool exposure.

For an isolated dishonest proposer, assuming truthful independent arbitration, no colluding first challenger, no hedges and external detection probability d, a deliberately simplified incremental payoff is `(1-d)*G - d*P - costs`. Thus `P >= ((1-d)/d)*G` is a conditional deterrence test, not proof of security. With `G≈0.98*Tcap`, 5–20% P/Tcap requires d roughly 95.1–83.1% even before correlated failures; at d=0 no finite bond works. These d values are stress inputs, not measured QIE monitoring performance. Current full returns remove the `d*P` penalty altogether.

For a challenger who owns no pool position and assigns probability q to a favorable binary reversal, candidate net bond return is `q*P - (1-q)*C - costs` if INVALID/timeout have zero probability. Neutral INVALID adds a zero-principal-return branch and still incurs gas/lock cost. For C/P=0.5–1, binary-only break-even q is 1/3–1/2 before costs. A participant can also gain by changing a large losing position into a refund; include that gain when evaluating nuisance disputes and bribery. Higher bonds burden honest monitors and cannot fix a corrupt arbiter.

**First-slot capture is unresolved.** Two colluding wallets can propose and immediately challenge; only one on-chain challenge is accepted. The coalition recovers P+C whichever of its wallets receives the candidate reward, so aggregate forfeiture is zero. It can force arbitration and obstruct a later honest on-chain challenge. This does not bypass the arbitrator's authorization or automatically force a false result, but it invalidates deterrence claims based solely on P. Public challenge commitments can also be copied/front-run; a first-slot reward is not guaranteed to reach the original researcher. Independent adjudication must consider evidence from people other than the registered challenger, with a specified submission channel and deadline. Restricting one address is not Sybil protection. A multi-challenge/appeal design or nonrefundable service cost is a separate product and protocol decision.

**Arbitration/INVALID/abort conflicts remain.** A biased arbitrator can reward its ally, choose INVALID to refund a losing position, or time out to achieve refunds. A guardian can abort unresolved markets. Bonds do not price these behaviors under neutral cancellation. Current role fingerprints prove only present declared controls: unreported drift can block challenges, then restoration after challengeDeadline can permit uncontested finalization. A failed/reverted check cannot persist an interruption. Independent monitoring must report drift while observable; guaranteed historical availability would require verified wallet change controls or an approved redesign. Do not slash arbitrators based on their own judgment or seize prediction collateral. An independent appeal or independently adjudicated performance bond requires new trust, finality and timeout decisions. Current final decisions are irreversible; unavailable/drifted arbitration has a bounded refund exit.

**Thin/asymmetric pools amplify incentives.** A tiny sole winning position can receive nearly the whole pool. Conversely, when the correct side is the only funded side, valid settlement returns 98% at a 2% fee whereas INVALID returns 100%; refund-seeking has an economic incentive even without an opposing winner. Do not label pool proportions as probabilities or describe fee-bearing own-capital return as profit. Minimum contributions, fees, and cap/bond ratios must be reviewed together.

**Creation spam is not solved by K alone.** With N concurrent markets, capital lock is N*K and gas is paid, but all K returns. Capital can recycle after terminal settlement; no permanent fee or aggregate/concurrent creator cap exists. Frontend moderation cannot prevent direct contract calls. A nonrefundable creation cost, per-identity admission, or protocol-level concurrency limit requires explicit permission and a separate implementation decision.

## Approval inventory

| ID | Concrete owner choice still required | Recommendation / alternative |
| --- | --- | --- |
| E1 | Full-return vs Option A vs completed neutral-INVALID B vs service-cost C | Consider completed B only with disclosed trusted arbitration/capture risks; full-return stays implemented |
| E2 | INVALID→binary, binary with empty winner, empty market, and objection vs alternate-answer semantics | Complete every table row; recommend objection semantics and binary decision consistency |
| E3 | Final fee, K/P/C, positive minimums, native-unit denomination | See [parameter ranges](P0_2_PARAMETER_RECOMMENDATIONS.md); no approved amounts |
| E4 | Per-market cap, correlated aggregate exposure and enforcement, monitoring budget | Small enforced per-market cap; aggregate exposure cannot be claimed enforced today |
| E5 | First-slot evidence, arbiter independence, appeals, misconduct/nonperformance | Approve external evidence access/SLA; decide whether more protocol changes are needed |
| E6 | Creation spam cost/limits and permissionless eligibility interaction | K full return does not solve durable spam; no silent nonrefundable charge |
| E7 | Challenge/proposal/arbitration/max time windows and short-pause abort trust | Conservative review ranges; preserve immutable timers and P0.1 recovery until approval |
| E8 | Dust/unclaimed entitlements and economics versioning | Preserve reserved liabilities without sweeping or expiry unless separately specified |
| E9 | Canonical metadata/evidence schema, publication, retention and invalidity rules | Hash commits bytes, not truth/availability; define transport/canonicalization before P1 |
| E10 | Role deployment/admission, release process, Mainnet facts and legal eligibility | Operational approval plus external review; technical activation gate is not certification |

No owner decision has been recorded. A review-ready baseline and candidate ABI can be produced now; final economic implementation, final audit scope and protocol freeze remain blocked. [Adversarial scenarios](../security/P0_2_ADVERSARIAL_ECONOMICS.md) and [freeze checklist](../audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md) track the consequences.

## Exact choices for transient role drift and immediate adjudication

| Choice still requiring approval | Effect / trade-off |
| --- | --- |
| Retain current views with funded independent reporters | No contract ABI change; observers must detect and persist an interruption while drift is visible. Cannot guarantee availability if every observer misses the drift. Accept that dependency explicitly; a reverted challenge itself cannot record a halt. |
| Admit only independently verified wallets with enforced change procedures/guards that interrupt config before any control change | Can tie a genuine wallet's supported change routes to quarantine, but requires complete implementation/module/guard/fallback verification, direct and indirect change-path review, and protection against bypass/removal. Getter hashes alone are insufficient; this is not implemented by the generic IMultisig interface. |
| Redesign challenge/settlement admission or add historical attestations/intake/appeal | Requires a reviewed specification of who may submit native bonds during control faults, what attestations are trusted, what deadlines reset, and how every market exits. Could alter the ABI and financial gate. Do not claim a generic current-view hash can prove past availability. |
| Require minimum evidence intake before dispute settlement | Preserves access for nonregistered observers only if publication is actually available; adds capital lock and must reserve adequate arbitration/timeout space. A delay alone does not prove arbiter honesty or stop first-slot capture. Current immediate decisions remain permitted pending a decision. |

No choice above is silently selected. These affect the final audit specification as well as economic exposure; passing stateful invariants does not establish historical oracle availability.
