# Bond policy proposal — explicit approval required

Status: **PROPOSED, NOT APPROVED, NOT IMPLEMENTED**. P0.1 still returns every deposited creation/proposal/challenge principal to its owner in every terminal state. No slashing selector, dispute bounty, arbitrator payment, insurance levy or new production amount is introduced.

P0.2 evaluates the owner's neutral-INVALID candidate in the [economic decision record](P0_2_ECONOMIC_DECISION.md), with [parameter ranges](P0_2_PARAMETER_RECOMMENDATIONS.md). It completes missing INVALID→binary/empty-pool semantics for consideration and adds first-slot/immediate-arbitration analysis. The recommendation below is the historical P0.1 alternative, not approval; no option is implemented as punitive policy.

## What full return achieves and what it cannot achieve

Full return prevents arbitrary confiscation when intent, ambiguity or arbitrator availability cannot be proved. It cleanly separates bonds from participant liabilities and gives every depositor a timeout exit. Its anti-abuse cost is only gas and temporary opportunity cost. A wrong proposer can hope nobody monitors; a nuisance challenger can force trusted arbitration and delay users without forfeiting principal. Zero-value bonds remove even the capital lock. More TVL can make a fixed bond economically irrelevant. A creation bond that always returns is not a durable spam fee. These are **economic launch blockers**, not resolved by reentrancy guards or higher test counts.

## Option A — symmetric correctness-contingent forfeiture (candidate recommendation)

Approve the following exact rule set as a whole before implementation; approve actual amounts separately. Let K = creation bond, P = proposal bond, C = challenge bond. Require P > 0 and C > 0 for an economically active production market. Fix amounts and rules at creation. K returns after all terminal outcomes; punitive creator penalties require a separately provable violation specification and are excluded here.

| Terminal case | Creation owner | Proposal owner | Challenge owner |
| --- | --- | --- | --- |
| Uncontested valid YES/NO/INVALID proposal | K | P | No challenge deposit |
| Disputed final decision equals proposed outcome | K | P + C | 0 |
| Disputed final decision differs from proposed outcome | K | 0 | P + C |
| No proposal / no finalization / arbitration timeout / emergency cancellation | K | P if deposited | C if deposited |
| Valid YES/NO result with zero winning participants | Same bond rule as corresponding result | Same | Same; participant principal refunded with fee zero |

The arbitrator's allowed decisions are YES, NO and INVALID. **INVALID is a real decision under Option A**: a correctly proposed INVALID defeats a challenge; changing YES/NO to INVALID rewards the challenger; changing INVALID to YES/NO rewards the challenger. Outcome mismatch, not proof of malicious intent, determines forfeiture. A correct but challenged proposal receives C; a legitimate successful challenger receives P. An unsuccessful challenge forfeits C even if made in good faith. A challenge alone never triggers a slash. Timeout/operational failure is not proof either side lied, so no forfeiture occurs.

All amounts remain in a segregated bond entitlement ledger. Rewards are pull claims to the entitled bond owner, with exactly-once flags and CEI. K/P/C never become pool collateral or protocol fees. No administrator chooses a recipient or amount. Total bond claims <= K+P+C. No new external reward subsidy exists: a Sybil self-challenge cannot generate net principal profit, although it can grief arbitration or create fake activity. Address exclusion is not identity/Sybil protection. First-challenge-only design also creates a race for legitimate challengers and lets a related wallet occupy the challenge slot; independent arbitration/evidence access must account for that risk.

Expected net challenge return before gas is `q * P - (1-q) * C`, where q is the challenger's assessed probability that arbitration changes the proposed outcome. Break-even is `q > C/(P+C)`. Larger C deters nuisance challenges but also prices out honest monitors; larger P improves challenge incentives but excludes legitimate proposers. If a dishonest proposer gains V from an undetected result and is challenged with probability d, a crude upper-bound deterrence condition is `(1-d)*V <= d*P + costs`, assuming independent truthful arbitration and no hedged/Sybil positions. Those assumptions are not observable on-chain, and d near zero makes any fixed bond inadequate. No bond amount guarantees truth.

Choosing P/C relative to permitted pool exposure, honest-monitor capital and arbitration cost is a **business/risk decision**. Options are fixed amounts with low pool caps, precommitted exposure tiers with cap enforcement, or a separately reviewed dynamic-bond design. No silent linkage or production cap/amount change is implemented here.

## Option B — neutral INVALID treatment

Use Option A for disputed YES/NO outcomes only, but return P/C to their owners whenever final decision is INVALID. This reduces penalties caused by ambiguous/failed event criteria. It also lets bad actors seek INVALID to evade loss, weakens challenger rewards, and gives a colluding arbitrator a cost-free escape. A market-specific definition of invalidity must be immutable. This option is less punitive but less abuse-resistant than A. It cannot be mixed with Option A's INVALID cases after market creation.

## Option C — retain full returns with an explicit dispute service cost

Keep all principals refundable and impose a separately approved, bounded nonrefundable arbitration request fee or rate-limited eligibility process. This funds arbitration and raises spam cost without deciding who acted maliciously. It burdens legitimate challenges, introduces fee-recipient/service trust and may restrict permissionless access. It does not penalize undetected wrong proposals. Fee amount, recipient, nonperformance refund and cancellation handling need explicit approval; none is implemented.

## Zero-value bonds

Current code permits zero as an explicit provisional setting and still gates zero-value calls behind activation. Option A cannot promise abuse resistance with P=0 or C=0; activation review must reject that configuration or explicitly choose Option C's nonfinancial/eligibility mechanism. At P=C=0 there is no slashable/rewardable capital. Never manufacture rewards from participant funds, forced surplus, unclaimed user entitlements or future deposits. Tests retain zero-bond accounting/timeout coverage; that does not approve zero bonds for production.

## Arbitrator misconduct, outages and uncertainty

A contract cannot determine real-world truth from the arbitrator's decision itself. A dishonest decision can reward the wrong party under A; simply asking the same arbitrator to prove misconduct is circular. An unavailable arbiter triggers timeout/full returns, which a colluding party could deliberately seek. P0.1's observable-control pinning rejects detected wallet drift, but cannot establish honesty or detect lying views/hidden modules.

Possible separately approved defenses: a pre-finalization independent appeal layer with a bounded deadline; an independently adjudicated arbitrator performance bond; verified institutional service with public evidence/SLA and emergency retirement for future markets. Each changes cost, trust, timing and finality. No post-finality outcome rewrite, seizure of participant funds, retroactive penalty, or unapproved fourth bond category is proposed as an implementation shortcut. Multisig signer/code/config verification and incident response are required even with economic penalties.

## Exact approvals still blocked

1. Select A, B or C; explicitly select INVALID semantics and whether good-faith incorrect calls bear forfeiture.
2. Approve P/C amounts, positive minimums, pool-exposure limits and whether K remains refundable or a separate spam cost is needed.
3. Approve independent arbitration/appeal model, monitoring obligations, evidence availability and arbitrator nonperformance response.
4. Approve implementation/audit plan for per-owner bond reward entitlements and conservation tests; never retrofit existing markets.

Until those decisions are explicitly approved, the executable policy remains full return and financial production activation remains blocked. This document is a concrete policy choice for review, not permission to launch or deploy.
