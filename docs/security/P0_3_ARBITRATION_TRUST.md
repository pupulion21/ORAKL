# P0.3 arbitration trust boundary

ORAKL v1 still uses a designated trusted arbitrator, not a cryptographically trustless real-world oracle. [MarketResolver.settleDispute](../../contracts/src/MarketResolver.sol#L87) requires the snapshotted arbitrator address, [ProtocolConfig.requireArbitrator](../../contracts/src/ProtocolConfig.sol#L173) checks its declared fingerprint and valid/disjoint declared owner views, and P0.3 enforces the full original challenge window. Those checks do not establish real-world truth or genuine multisig execution.

## What the implementation prevents

An unrelated proposer, first challenger, evidence contributor, governance/compliance/guardian or direct outsider cannot settle by calling the resolver. No role may arbitrate before D or at/after A. Snapshot arbiter changes/malformed controls reject decision; declared cross-role owner overlap rejects; terminal outcomes cannot be changed. There is no admin settlement override or direct participant/bond custody. Inactivity/broken execution has a permissionless refund fallback at the original A. These paths have [executable security tests](../../contracts/test/security/P0_3Arbitration.t.sol) and unchanged accounting/recovery regressions.

## What remains possible after a wallet is admitted

| Threat | Executable local mock / result | Disposition |
| --- | --- | --- |
| Hidden Safe-like module/controller bypass | MutableMultisig.executeFromHiddenModule; unchanged declared owners/threshold/code can conceal execution authority. Direct outsider and pre-D execution reject, but admitted wallet can decide after D. | **OPEN conditional High**; timer is fixed, honest wallet admission/execution is not proved by getters. |
| Unsafe guard / unavailable execution | GuardedArbitratorMock blocks its controller's actual call. Direct fallback caller remains unauthorized; cancellation/refunds at A work. | Availability mitigated by bounded refunds; guard safety remains operational. |
| Mutable singleton/proxy implementation | MutableProxyWalletMock delegates to restricted execution, then upgrades to permissionless execution without changing outer code or getters. P0.3 blocks pre-D decisions; post-D false decision remains possible through the admitted proxy. | **OPEN conditional High**; outer codehash is not implementation identity. |
| Shared beneficial control | Three SharedControllerWalletMock instances report disjoint owner sets/threshold2 but one hidden observer can actually execute governance, compliance and arbitration calls. | **OPEN conditional High**; distinct addresses and owner getters do not prove independent people/control. |
| Biased INVALID decision | An arbitrator with a losing400-unit NO position can choose INVALID and recover400 rather than lose after truthful YES; fee stays zero. | **OPEN economic/trust High**; contract cannot infer intent or truth from that same decision. |
| Proposer/first-challenger/arbiter coalition | Fixed event intake stays available and early finality is blocked, but the authorized arbiter may still ignore independent evidence and decide falsely after D. | Evidence/time mitigated; truthful consideration and future bounty capture remain unresolved. |
| Arbitrator inactivity / persistent getter drift | No valid decision before A; anyone cancels, users pull full principal and own bonds. | Bounded liveness exit preserved; honest-result availability not guaranteed. |

These mocks are deliberately adversarial execution models, **not genuine Safe implementations** or proof that Safe deployments are broken. The proxy test actually changes delegated execution; guard/module tests exercise actual target calls. Passing a residual demonstration means the risk remains, not that it is fixed. Safe's [official concepts](https://docs.safe.global/advanced/smart-account-concepts) document separate module execution routes that can bypass owner signature checks; [guards](https://docs.safe.global/advanced/smart-account-guards) are another critical execution dependency.

## Required operational admission

Independently verify exact wallet runtime/proxy/singleton and storage layout against reviewed artifacts; owner/threshold correctness and real cross-role signer/beneficial-control independence; every module, guard, fallback handler, upgrade/admin path and execution authority; hardware/managed key controls and change/incident procedures. Monitor changes and publish verifiable decision evidence. A genuine wallet change-control mechanism is useful for release/arbitration integrity but cannot be inferred from IMultisig getters. Unknown implementations/configurations must block production admission.

The full-window event channel requires reliable indexers, independently accessible publication and arbitrators committed to a published evidence process. The contract cannot force them to read logs. Mainnet code/fork/gas/transaction-envelope support, genuine-wallet gas and deployment compatibility remain unverified. A local pranked/execution mock test is not a live signing rehearsal.

Contract-level refund eligibility is distinct from wallet liveness: a claimant must still control an account able to submit its own claim/redirect transaction and pay gas. An unsafe guard on that claimant's own wallet can block its execution. Timeout prevents the arbiter from locking everyone else's market exit; it cannot restore lost keys or provide an unauthorized admin rescue of that wallet's funds.

## Owner decisions and rejected shortcuts

Default recommendation: retain immutable v1 finality and bounded refund exits while independently vetting arbitrators and defining evidence consideration/recusal/nonperformance procedures. This is a proposed operational trust model, not production approval. If independent appeal/performance-bond adjudication is desired, first specify authority, allowed outcomes, review timing, bond ownership, failure/refund path and exact terminal state machine; implement only after owner approval and audit.

Rejected: let governance seize funds/rewrite final outcomes; assume threshold>=2 proves independence; slash an arbitrator based on its own declaration of misconduct; silently create new arbiter rewards or fees; reopen finality as an emergency shortcut. P0.3 implements none of those. [Approval matrix](../protocol/P0_3_ECONOMIC_APPROVAL_MATRIX.md), [freeze readiness](../audit/P0_3_PROTOCOL_FREEZE_READINESS.md).
