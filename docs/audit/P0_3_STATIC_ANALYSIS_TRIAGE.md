# P0.3 static analysis and transfer review

Slither0.11.6 completed all four analyses with success=true/error=null and exit255 because findings remain. No detector report is removed or converted into a clean-pass claim. Raw JSON/stdout/stderr and exact compiler arguments are under [p0-3 evidence](../testing/p0-3/README.md).

| Scope | High | Low | Informational | Optimization |
| --- | --- | --- | --- | --- |
| Full Foundry project |4|14|4|2|
| Complete deployable MarketFactory inheritance root |1|9|1|0|
| Complete ProtocolConfig root |0|1|2|1|
| Preserved legacy root |1|4|1|0|

These overlap and must not be summed as independent vulnerabilities. Compared with P0.2, the additional timestamp Low is the deliberate fixed evidence-intake end boundary. Early/upper arbitration comparisons also remain deliberate and tested; this does not remove consensus timestamp assumptions. The two native-send High detector matches are retained.

## Native-value graph: every outgoing entry remains bounded

Production custody sources [PredictionPool.sol](../../contracts/src/PredictionPool.sol) and [ProtocolStorage.sol](../../contracts/src/ProtocolStorage.sol) are byte-for-byte unchanged from 8d850ae, as are the legacy implementation and compiler/runtime identity. P0.3 changes only admission/evidence/timing; it adds no send sink, new recipient, reward entitlement or extra funding function. All ten outgoing paths were rechecked:

| Entry / sink | Caller entitlement, authorization and liability reduction | Destination and regression proof |
| --- | --- | --- |
| Pool claim:42 / claimTo:46 → _settle:69 → _send:130 | Terminal nonrefundable winning position owned by msg.sender, positive winning contribution, not settled. Fixed floor entitlement, mark settled, increase market/global outflow, debit participantLiability before checked send. | Caller or owner-selected valid recipient. Shared nonReentrant; failed send rolls back every field. Existing hostile-receiver tests plus P0.3 cross-market evidence callback, forced-surplus and A–P campaigns. |
| Pool claimRefund:50 / claimRefundTo:54 → same sink | Terminal refundable market, caller's YES+NO principal, same exactly-once position flag. Debit only participant liability; incompatible payout/refund modes reject. | Same destination validation/rollback; no role getter in user exit. INVALID/empty-winner/timeout/emergency cases and original A–N preserved. |
| Storage claimBond:90 → _send | Terminal bond record, owner==caller, !claimed, exact deposited own principal. Mark claimed, debit bondLiability and increment totalBondsPaid. | Owner selects valid recipient; zero amount skips callback; no evidence submitter/bounty recipient inserted. All nine result cases, zero-C, rejecting recipients and conservation tests. |
| Pool withdrawProtocolFees:58 → _send | Governance caller, unchanged full live-role check, positive amount<=accrued feeLiability. Debit only feeLiability and increment totalFeesWithdrawn. | Valid governance-selected fee recipient. Cannot consume participant/bond liability or forced surplus; prior partial/failed-fee tests remain. |
| Legacy claim:265 / claimTo:272 → _claim:411 → _sendNative:463 | Internal account fixed to msg.sender; valid binary result/nonempty winner, positive contribution, !settled; fixed proportional entitlement, CEI escrow accounting. | Caller/owner-selected recipient; zero/contract destination rejected, nonReentrant and checked send. Legacy source and tests/runtime untouched. |
| Legacy refund:278 / refundTo:285 → _refund:437 → same sink | Caller's principal only under INVALID/cancelled/zero-winner; exactly-once flag and paid-out accounting. | Same owner direction/rollback. Legacy cross-market ownership and rejecting receiver tests remain in full suite. |

Six v1 plus four legacy entries are included above; wrappers are grouped only for readability. New challenge admission receives exactly one C and uses the unchanged _depositBond:117 owner/accounting path. No native transfer occurs during submission, proposal, arbitration/cancellation or settlement allocation. Uncontested/arb settlement still reclassifies only the fixed fee on a valid nonempty winner; refunds never charge it. Full trace is also retained in [P0.1 value-flow review](P0_1_VALUE_FLOW_REVIEW.md).

No reachable unauthorized send was established under the stated verified-component/role/entitlement assumptions. This is a scoped review conclusion, **not** an assertion that a generic send helper is harmless or arbitration honest. Both arbitrary-send-eth detector reports remain for independent review. Lying admitted execution/biased answers can still allocate an incorrect outcome; see [arbitration trust](../security/P0_3_ARBITRATION_TRUST.md).

## Other retained classes

The full-project scan adds two uninitialized-state High reports for marketCount/_markets in an incomplete default-profile abstract compilation unit. ProtocolStorage is abstract/nondeployable; actual Factory:45-56 creation writers are included in the optimized deployable-root scan, where those findings do not appear. Raw project/root results, source preservation and executable creation/uniqueness/accounting tests support this classification; reports are not suppressed.

Four Informational reports consist of three low-level-call groups and bounded-buffer assembly. Binding/native calls and wallet getter stipends/output maxima remain reviewed unchanged functions. Optimization reports are the deliberately catchable/gas-bounded external self-call and an incomplete-unit constant suggestion. No dependency upgrade, library link, compiler pipeline change, warning filter on production source or automatic analyzer rewrite was made. Existing return-bomb/anti-gas-starvation regressions pass.

Static analysis does not establish evidence availability, consideration, economic deterrence, beneficial independence, legal authorization or Mainnet compatibility. Passing residual module/proxy/shared-controller/biased-INVALID tests explicitly leaves those conditional risks open. [Freeze readiness](P0_3_PROTOCOL_FREEZE_READINESS.md), [verification](../testing/P0_3_VERIFICATION_REPORT.md).
