# ORAKL v1 threat model — final candidate, not frozen

Scope: native QIE EVM facade at baseline `9e256c1451d666889f9f248edee3e2e2d61f6d48`; chain-specific compatibility is not established. Financial activation is disabled by default; local test activation is not a release decision. The contract is non-upgradeable custody, but external role wallet implementations may themselves be upgradeable. No outside review has certified this analysis. See the [auditor handoff](../audit/ORAKL_V1_AUDITOR_HANDOFF.md) and [P0.3 executable security evidence](../testing/P0_3_VERIFICATION_REPORT.md).

## Assets and boundaries

Prediction principal, creation/proposal/challenge bonds and accrued fees share the factory's native balance but have distinct liabilities; forced native transfers are surplus, not contributions. The user controls their claim/redirect and pays gas. Metadata, evidence hosting, chain inclusion, time and real-world truth are outside contract control. Config is immutable in the facade but is a separate contract: a verified matched pair is required.

## Native value paths

| Entry and authorization | State and liability | Destination / limits |
| --- | --- | --- |
| [createMarket](../../contracts/src/MarketFactory.sol#L25): active, unpaused, bound, correct chain, live role checks, exact K | immutable terms, creator, deadlines and epoch; K bond liability increases | Incoming only; creator/arbitrator exclusion; no withdrawal right over pool. |
| [predict](../../contracts/src/PredictionPool.sol#L14): same financial checks, current epoch, OPEN, min and cap | participant position and side pool increase, participant liability increases by exact value | Incoming only. |
| [proposeResult](../../contracts/src/MarketResolver.sol#L35): financial checks, current epoch, CLOSED, resolution window, non-arbitrator, evidence, exact P | snapshot proposal, D/A and P owner; bond liability increases | Incoming only; no unilateral finality. |
| [challengeResult](../../contracts/src/MarketResolver.sol#L61): narrow active/bound/chain gate, current epoch, PROPOSED, before D, non-proposer/non-arbitrator, nonzero evidence and exact C | DISPUTED, owner C; bond liability increases | Incoming only. No live role getter prerequisite. Single bonded slot remains. |
| [finalizeResult / settleDispute](../../contracts/src/MarketResolver.sol#L77): uncontested epoch/role checks after D; disputed snapshot arbitrator and valid role views at D≤now<A | fixed outcome, refundable flag or fee reclassification participant→fee liability; no bond recipient change | No transfer. Evidence event alone does not dispute. |
| [cancelExpiredMarket / cancelInterruptedMarket](../../contracts/src/MarketResolver.sol#L100): anyone at applicable original expiry or first-interruption exit | terminal INVALID/refundable; participant and bond liabilities retained | No transfer. A disrupted disputed market retains arbitration deadline. |
| [claim/claimTo, claimRefund/claimRefundTo](../../contracts/src/PredictionPool.sol#L42): terminal eligible position owned by caller, once | settled set and participant liability reduced before checked call | Caller or caller-designated valid recipient; failed call reverts all state. |
| [claimBond](../../contracts/src/ProtocolStorage.sol#L90): terminal, caller is bond owner, not claimed | bond marked and bond liability debited before checked call | Owner-selected valid recipient, exact principal, no punitive distribution. |
| [withdrawProtocolFees](../../contracts/src/PredictionPool.sol#L58): governance and current full role checks | fee liability debited before checked call | Governance selects valid recipient; limited to accrued fee, cannot debit principal/bonds. |

All transfers go through guarded checked native calls; zero-value sends skip the callback. P0.3 [native-send detector trace](../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md) retains the findings rather than asserting generic calls harmless. Rounding leaves conservative participant liability; no dust sweep is available. Block timestamp and inclusion must be sufficiently reliable for windows; this is not verified QIE timing or finality.

## Threats and dispositions

| Adversary / failure | Existing containment | Remaining boundary |
| --- | --- | --- |
| Proposer and first challenger collude | anyone may emit fixed-size evidence before D; arbitrator cannot decide before D | economic challenger slot remains exclusive and arbiter may ignore evidence; [capture review](P0_3_CHALLENGE_INTEGRITY.md). |
| Role getter temporarily lies, burns gas, or changes | funded valid objection uses narrow gate, survives restoration | no proof of historical control, observer funding or inclusion; explicit emergency interruption still blocks financial challenge and permits bounded refund. |
| Malicious arbiter/module/proxy/shared control | only snapshotted address, role views, full window, bounded inactivity refund | trusted arbitrator can choose false YES/NO/INVALID after D; codehash/getters cannot establish beneficial independence or honest evidence consideration. [Adversarial mocks](../../contracts/test/security/P0_3Arbitration.t.sol). |
| Governance/compliance compromise | release approval and delayed activation are distinct; fee withdrawal limited to fee liability | colluding or dishonest admitted roles can enable financial activity, interrupt markets, change future terms or fee destination; release approval is not audit/legal proof. |
| Guardian compromise | can interrupt, no outcome or custody bypass | repeated interruptions cause denial/refunds; monitoring and incident operations necessary. |
| Malicious recipient | checks-effects-interactions, shared reentrancy guard, rollback, owner-directed alternate recipient | a wallet unable to initiate its own redirect may remain unable to claim. |
| Availability failure / malformed evidence / spam | no settlement loop or small evidence slot cap; source hash commitment | logs do not enforce retrieval, verification or truth; RPC/reorg, media safety, indexer costs and pinning are external. |
| Many correlated markets / external incentives | per-market pool cap and isolated terminal accounting | no aggregate unresolved exposure cap; off-chain bribes/hedges can exceed any on-chain cap. |
| Chain reorganization or censorship | deadline checks and event records in canonical chain | finality, timestamp, log availability and funded timely inclusion are network/operations assumptions, not established by unit tests. |

Evidence contributors have no settlement authority and no economic entitlement. No admin can reverse a terminal outcome; no v1 appeal/slash is implemented. Recommendations for economics, service levels and admission are proposed only, with no owner acceptance inferred.
