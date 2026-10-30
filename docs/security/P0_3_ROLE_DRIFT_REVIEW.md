# P0.3 role drift and objection admission

Implemented candidate: [ProtocolConfig.sol](../../contracts/src/ProtocolConfig.sol) requireFinancialActivity:146, requireChallengeActivity:152, _requireActiveFacade:156, reportRoleDrift:184, _interrupt:206; [MarketResolver.sol](../../contracts/src/MarketResolver.sol) challengeResult:61, finalizeResult:77, cancelInterruptedMarket:120. Final protocol approval is still required. No economic redistribution or release authorization is inferred.

## Original attack and corrected path

Baseline financialEntry → ProtocolStorage._requireFinancialActivity → config.requireFinancialActivity → _requireUnchangedRoles → currentRoleState queried governance, compliance and arbitrator owner/threshold views. A changed owner, reduced threshold, malformed/reverting/gas-consuming getter or code drift blocked challenge. No state can survive a reverted check. Restoring the fingerprint after challengeDeadline allowed a false unchallenged proposal to finalize if no observer persisted a report. Original PoC is preserved at baseline8d850ae and in the P0.3 baseline trace.

Only `challengeResult` now calls the narrow active-facade predicate. The exact original active/unpaused/nonzero-bound-facade/deployment-chain checks were factored into _requireActiveFacade and reused by both admission methods. Challenge then independently checks market existence/current creation epoch, PROPOSED, now<challengeDeadline, caller not proposer/arbiter, nonzero evidence and exact snapshotted C. It records one challenger/bond with unchanged liability accounting. No owner/threshold/code getter is on that path.

The accepted objection persists DISPUTED even when views later restore; `finalizeResult` cannot treat it as unchallenged. This removes the demonstrated role-view veto for correctly funded, included objections without requiring a drift reporter to be online. It does **not** prove continuous historical signer control or make a bad arbitrator truthful.

## Gate separation

| Activity | Gate / role-view behavior | Reason and residual |
| --- | --- | --- |
| Create, predict, propose | Existing financialEntry: active/unpaused/bound/chain **plus full live declared-role check**; current-market epoch where relevant | New financial risk fails closed on drift or malformed views. No broad role-validation removal. |
| Formal challenge | Same explicit activation/pause/binding/chain, current epoch, original window/exact C, **no live wallet getter** | A protective objection to an existing proposal must not depend on a role's mutable getter honesty/availability. Still one bonded slot; no slashing/reward. |
| Additional evidence | Nonpayable, PROPOSED/DISPUTED, nonzero hash, before D; no config/role query | Available through explicit emergency/quarantine; no native funding or result authority. Evidence alone does not create a formal dispute. |
| Uncontested finalization | Original active/unpaused/chain/epoch and **full live declared-role check**, now>=D and now<max | No drifted current view can directly finalize while it fails checks; accepted disputes cannot use this path even after restoration. |
| Disputed arbitration | Original snapshot arbiter caller/fingerprint, valid disjoint declared role views, **D<=now<A** | Available during pause under unchanged snapshot authority. Arbiter drift blocks decision; timeout refund is bounded. Valid gov/compliance rotation does not replace the snapshot arbiter. |
| Participant/refund/bond claims | Existing terminal caller-owned entitlement, CEI, shared guard and valid recipient; **no role getter** | Faulted role getters cannot deny a valid terminal withdrawal. Claims do not reactivate markets. |
| Fee withdrawals | Governance caller plus existing full live control checks and accrued-fee bound | No participant/bond liability debit or bypass added. |

Config admission methods are public **read-only predicates**, not authority to write on behalf of a facade. Passing the correct facade address in an external view call changes no state. A second unbound facade still fails; wrong chain/default-disabled finance still rejects, including zero-value challenges.

## Explicit interruptions remain authoritative

Pause/deactivate/setParameters/reportRoleDrift interrupt the epoch, disable finance, revoke review and quarantine old unresolved markets. Challenges reject while explicitly paused/deactivated; reapproval cannot revive old epochs. This is intentionally different from temporary *unreported getter drift*. A short pause may abort unresolved markets, but cannot censor a challenge then resume an unchallenged winning payout. Original first-interruption grace/refunds remain; an existing dispute keeps A and cannot be arbitrated before D. Nonpayable evidence remains open through D; terminal claims/refunds/bond returns remain independent.

This preserves default-disabled finance, separate compliance/governance,24-hour review, anti-gas-starvation drift reporting and all existing control validation on other paths. No admin outcome override, replay of a release, retrospective economics or finality reversal is introduced. A bad-value/late/rejected transaction is not a valid objection; users still need the exact bond, sufficient gas and chain inclusion before D. We do not invent a free halt whenever any caller supplies invalid calldata/value.

## Attack trace after correction

1. A proposal opens with immutable D/A and C.
2. A role mutates owners/threshold or breaks/burns/malforms its getter. New-risk calls still reject.
3. A permitted observer's exact-C challenge succeeds without those queries. Bond liability increases exactly C; no transfer occurs.
4. The role restores original views after D. Direct finalize still rejects DISPUTED.
5. The snapshot arbitrator may adjudicate only during [D,A); if its authority is unavailable/invalid or inactive, anyone can cancel at A and principals remain refundable.

Regressions for governance/compliance/arbitrator mutations and all five getter faults failed before and pass after 7f9ca5e. [Admission tests](../../contracts/test/security/P0_3Admission.t.sol) additionally cover threshold reduction, retained full checks on other paths, binding/chain, inactive/zero-bond gates, six explicit interventions, old epochs/repeated interruptions, caller/value validation and restoration fuzzing. [Original residual tests](../../contracts/test/economics/P0_2Economics.t.sol) were rewritten to assert the corrected behavior, not renamed into claimed fixes without an attack-prevention check.

## Remaining trust and monitoring

This gate does not establish historical continuity, beneficial independence, genuine multisig execution, data availability or honest arbitration. Monitoring is **not required to make the covered active-state valid objection succeed**. Independent observers/monitors are still necessary to discover false proposals, submit timely funded objections, detect role compromise, persist explicit emergency reports and operate indexing/recovery. Actual emergency roles retain abort/denial power; network censorship and underfunded/absent observers remain risks.

Verified wallet implementation/modules/guards/singleton/change controls remain required for release/arbitration integrity. They are no longer a prerequisite for bypassing a broken getter on the objection path. An always-available admin settlement bypass would be more dangerous and is rejected. Final protocol sign-off must explicitly accept this narrow gate's protective-bond admission during unreported control faults, while retaining full financial checks elsewhere.

Stateful transient-fault actions temporarily replace compatible test-mock code/owner/threshold views and restore them atomically before unchanged A–N assertions run. Persistent, deployed mutable-wallet faults are separately tested in the security regressions. The campaign does not claim to prove genuine Safe signing or uninterrupted real-world monitoring. [Final evidence](../testing/P0_3_VERIFICATION_REPORT.md).
