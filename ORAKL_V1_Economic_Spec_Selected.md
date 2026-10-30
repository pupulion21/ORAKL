# ORAKL v1 — Selected Economic Design Specification

**Design decision:** ORAKL-ECON-SELECTED-2026-10-30\
**Decision authority:** User delegated selection of the three architecture choices; this is authorization to produce and locally test a *candidate implementation*, not approval to deploy, activate finance, or use real funds.

**Repository:** `pupulion21/ORAKL`\
**Verified base:** `release/orakl-v1-freeze-candidate` at `f3b35a1fb25bc08f2e5cd6c31addb6396c238181`\
**Status:** SELECTED FOR LOCAL IMPLEMENTATION AND AUDIT — NOT FROZEN / NOT MAINNET AUTHORIZED.

## 1. Three definitive design selections

1. **M1 — Multi-challenger proportional bonded pool.** Multiple independent addresses may deposit challenge stake during the original challenge window. The first valid deposit changes the market from PROPOSED to DISPUTED. Later deposits do not move deadlines. Anyone may publish unbonded evidence with the existing `submitEvidence`; it does not grant bond entitlement or initiate a dispute.
2. **Neutral-INVALID bond economics.** On a disputed binary final decision, proposal/challenge principal is allocated based on whether the final binary outcome agrees with the proposal. On final INVALID, all deposited proposal and challenger principals return to their original owners. Cancellation, timeout and interruption are neutral. K is always refundable at terminal state.
3. **Hard on-chain unresolved-exposure limits.** Enforce a global limit and a per-snapshot-arbitrator limit on actual nonterminal YES+NO contributions. Neither limit is only a frontend convention. Total custody liabilities remain a separate accounting class.

**Important:** M1 removes exclusive bonded evidence access but does not prove unique human challengers, prevent a coalition flooding stake, force arbitrator honesty, or make bonds sufficient to defend against external manipulation incentives.

## 2. Economic parameters and scope

| Parameter | Selected local candidate rule | Boundary |
|---|---|---|
| Settlement fee | `feeBps=200` (2% of total pool only when binary winner has at least one funded position) | On refunds, INVALID and empty winning side: zero |
| Proposal bond P | `ceil(10% * Tcap)` | Positive; creation-snapshotted |
| Creation refundable bond K | `ceil(1% * Tcap)` | Returned to creator on any terminal reason |
| Minimum per-challenger stake Cmin | `ceil(1% * Tcap)` | Positive; one bonded tranche per address per market; multiple different addresses permitted; address uniqueness is not Sybil resistance |
| Nonrefundable creation admission fee F | **Candidate only:** `ceil(0.1% * Tcap)` | Upfront charge that may be lost even if emergency-terminated; financial fairness/risk must be signed off separately before implementation. Do NOT implement F without explicit additional approval. |
| Minimum contribution | `ceil(0.01% * Tcap)` for pilot stress tests | Must test accessibility against real gas; not a security guarantee |
| Challenge period | 48 hours | Exact D immutable; unbonded evidence remains accessible before D |
| Arbitration period | 96 hours, beginning at D | Authorized arbiter may settle only on `[D,A)` |
| Minimum proposal opportunity | 48 hours before latest proposal cutoff | Validate creation/max-time window before admitting market |
| Global unresolved exposure | `3 * Tcap` as a **single fixed-cap pilot** | Deployment-wide bound; different Tcap tiers require a more explicit fixed budget design |
| Per-arbitrator unresolved exposure | `2 * Tcap` as a **single fixed-cap pilot** | Key by snapshotted arbitrator address; cannot prove distinct human ownership |
| Unclaimed liabilities / dust | Indefinitely reserved, no arbitrary sweep | Only explicitly determinable user entitlements may be withdrawn |

**Numerical fixture for local or testnet simulation only:** `Tcap = 100 synthetic native units`, `P=10`, `K=1`, `Cmin=1`, `F=0.1` (F not authorized for code), minimum contribution `0.01`, total unresolved cap `300`, arbitrator cap `200`.

Use integer base units and checked `mulDiv`/ceil; these are NOT certified native-QIE mainnet amounts, deployment defaults, or purchasing-power security guarantees.

Official docs identify Mainnet chain ID 1990 and Testnet 1983, but on-chain fork, gas, mainnet native decimals and Safe behavior must still be verified. Any production monetary value requires risk/liquidity/monitor-budget and network sign-off.

**Why 10% P is not proof of security:** If nobody challenges or a biased arbiter cooperates, no finite on-chain bond ratio guarantees truthful outcomes; external hedges or bribes can exceed Tcap.

## 3. Deterministic entitlement rules

Define `S = sum(C_i)` for all bonded challengers on a market, where `C_i >= Cmin`, each admitted before D. Total `S` must be represented with overflow-safe integer accounting.

At a terminal state, evaluate all decisions from the saved proposal/final outcome and *real deposited amounts*, never from an operator-picked recipient.

| Proposal | Final arbitration | Proposer | Each challenger `i` |
|---|---|---|---|
| YES | YES | `P+S` | `0` |
| YES | NO | `0` | `C_i + reward_i` |
| YES | INVALID | `P` | `C_i` |
| NO | YES | `0` | `C_i + reward_i` |
| NO | NO | `P+S` | `0` |
| NO | INVALID | `P` | `C_i` |
| INVALID | YES | `0` | `C_i + reward_i` |
| INVALID | NO | `0` | `C_i + reward_i` |
| INVALID | INVALID | `P` | `C_i` |

`reward_i` divides **only P** among the challengers on a successful binary reversal; nobody receives participant collateral as a bond reward.

When no challenge exists (`S=0`), no challenger allocation exists and P returns to proposer at uncontested terminal resolution.

K always returns to creator once terminal.

On no proposal, missed proposal/settlement deadline, arbitration timeout, emergency interruption/cancellation, and other unresolved terminal cancellations, P and all C_i return to original depositors when present, with participant refunds and no settlement fee.

### Exact rounding without a claimant sweep

For one stake tranche per address, store `prefixBefore_i`, the cumulative S before the accepted tranche.

At finalization, with immutable final S greater than zero:

`reward_i = floor(P * (prefixBefore_i + C_i) / S) - floor(P * prefixBefore_i / S)`

Use overflow-safe `Math.mulDiv`, checked totals, immutable tranche records, and a separate claim ledger.

This *telescopes to exactly P* across all accepted stakes, independently of claim order and without iterating at settlement.

Stress-test rounding effects of stake ordering and Sybil splitting; amounts can differ by an atomic unit due to deterministic ordering.

Do not claim this provides Sybil-proof incentives.

If this algorithm cannot be implemented safely within gas/code-size budgets, stop and report the concrete issue rather than silently substitute an unfair split.

### Refundable/empty special cases — selected

- **Final INVALID:** neutral bonds and full participant refunds, fee 0.
- **Binary final with zero funded winning side:** full participant refunds, fee 0, and **neutral return of P and all C_i**; no slashing when nobody receives a binary reward.
- **Completely empty market:** terminal K/P/C principals are neutral; no participant payout/fee.
- **Binary final with a nonempty winning side:** standard fee and binary bond matrix apply, including if just one address funded the winner.
- **Unchallenged proposal:** original P back; nobody receives imagined challenger rewards; participant settlement follows existing valid/INVALID/empty-side accounting.
- **Cancellation, timeout or emergency:** neutral return of original bonds and participant principal. No arbitrary treasury slash and no finality reopening.

These special cases are chosen to avoid punishing a challenge when all participant deposits are refunded; they may weaken deterrence for strategically chosen empty-side outcomes and require adversarial testing.

## 4. Multi-challenger state machine and admission

- First valid `challengeResult` or explicitly versioned replacement `bondedChallenge` changes PROPOSED → DISPUTED, stores challenger stake and evidence, and emits a deterministic event.
- Additional stakes accepted while DISPUTED and `now < D`. Do not reset/extend D or A.
- Maintain O(1) per-call admission and per-user claim paths; no settlement iteration over challengers.
- Do not impose a small total participant-slot cap or first-N reward priority. One bonded tranche per address is a simple accounting rule, **not identity security**. A full stake-cap can recreate first-slot censorship; any aggregate bond cap needs a specific denial-of-service defense and approval.
- Challenges must use the P0.3 **protective activity gate** (finance active, unpaused, correct factory/chain/current epoch) without live role-getter veto; no accepted deposits after explicit interruption. `submitEvidence` remains nonpayable/open under its existing P0.3 semantics even during interruption.
- Challenger must not be proposer or snapshot arbitrator under the existing address restriction, though this cannot prevent beneficial-control collusion.
- No accepted bond may be withdrawn before terminal settlement, even if more challengers deposit.
- A market cannot transition twice to terminal. Claims must be recipient-redirectable and reentrancy protected with full rollback on rejected transfers.

## 5. Enforced unresolved-exposure counters

Use deployment-fixed `globalUnresolvedCap` and `perArbitratorUnresolvedCap` for the approved pilot tier, both positive and in native base units.

Count actual accepted YES+NO predictions for OPEN/CLOSED/PROPOSED/DISPUTED markets, never unused market cap, bonds, fee accruals, or forced-value surplus.

- On predict `x`: atomically verify global and snapshot-arbitrator headroom, then increase both counters by x exactly once with the corresponding participant liability/position credit.
- On terminal finalization (binary or INVALID), ordinary expiry cancellation, or emergency cancellation: decrease both counters by the market's total accepted predictions, exactly once with a market terminal-release guard.
- On proposal/challenge/evidence: no exposure update.
- On claims, refunds, bond claims, fee withdrawals: no exposure update; these change distinct liabilities.
- At timestamp expiry before a transaction calls terminal cancellation: retain the unresolved exposure until a successful terminal transaction. Provide keeper/indexer instrumentation and explain capacity contention.
- Enforce cap in Solidity, not only API or frontend. Keep existing per-market cap and snapshot arbitrator identity unchanged.
- Global cap complements per-arbitrator cap; neither limits external hedges/bribes or total accumulated terminal unclaimed custody.

## 6. Spam, evidence and arbitrator trust

- Keep refundable K in the first implementation. An optional nonrefundable admission fee **F is not authorized yet** because it can punish legitimate creators after a governance emergency abort, and it should be tied to measured monitoring/indexer costs. Stress-test creation spam and report a concrete F proposal separately; do not silently levy it.
- Independent evidence events remain publicly available through the original window; **they do not stop uncontested finalization absent an accepted bonded challenge**.
- Require a dedicated, verified 3-of-5 arbitration Safe design proposal, with independently verified signer/control separation from governance and compliance. Do not invent signer addresses or falsely claim a Safe is verified. Its actual deployed modules/guards/fallback/singleton/upgrade paths must be independently checked.
- Do not present the model as trustless. Biased arbitration, malicious INVALID, failed monitoring, network censorship, gas/transaction exclusion, and self-funded challenger coalitions remain risks.
- Use the documented P0.3 `D <= now < A` settlement boundary, 24-hour release approval delay, epoch quarantine, and permissionless timeout/emergency refunds.

## 7. Engineering acceptance and audit gates

1. Before/after regressions for every changed economic transition; exact 9-case matrix × empty/both/one-sided pools × cancellations and timing, zero/positive stake boundaries, bad recipients and repeated withdrawals.
2. Assert `sum(all claimable bond entitlements) == K+P+S` for each terminal case and no claimable bond amount transfers from participant or fee ledgers.
3. Assert global and per-arbitrator exposure equals independently tracked nonterminal accepted YES+NO deposits under randomly interleaved terminal transitions.
4. Preserve P0.3 early-arbitration, protective challenge-admission, independent evidence, emergency/refund, compiler/legacy identity regressions and all invariants A–P.
5. Verify runtime/initcode size headroom; if total storage/code risk is unacceptable, show a smaller auditable solution rather than weakening the economic specification.
6. Use **QIE-FORGE** through `/home/pupulion/.agents/skills/qie/SKILL.md` (verified in the *Codex report*, not independently by ChatGPT) and read its real module instructions. Preserve skill execution evidence.
7. Run Foundry, fuzzing, intensive invariants, Slither, bytecode/ABI checker, legacy frontend regressions and local no-value deployment rehearsals. Preserve raw logs and failure output.
8. Never infer mainnet readiness from RPC chain ID 1990, or from standard EVM assumptions. Verify network-specific gas/fork/wallet/explorer/finality with independent evidence.
9. Production source/ABI changed by implementation must be externally audited and frozen at exact compiler+source+artifact hashes. **No mainnet deployment, signing, financial activation or real-value launch is authorized.**

## 8. Remaining explicitly external approvals

The *three architecture choices* and policy matrix in this file are selected for **local engineering**.

Before production freeze, the owner and independent reviewers must approve:

- Actual native denomination and numerical market Tcap.
- Monitoring resources/capital and exposure loss budget.
- Optional creation fee/spam policy.
- 3-of-5 signer addresses and independence.
- Evidence canonicalization, retention and arbitration consideration.
- Network compatibility.
- Independent audit.
- Legal/market eligibility.
- Final deployment-release authorization.

Do not mislabel these operational requirements as implemented code.
