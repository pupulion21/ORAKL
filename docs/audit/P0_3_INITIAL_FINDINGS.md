# P0.3 initial findings — before production modifications

Repository verified locally: `origin=https://github.com/pupulion21/ORAKL.git`. Initial working tree clean on `feature/orakl-p0-2`; both HEAD and that branch resolve to **8d850ae42ebc77acaf2323cd50f63f08e57f1b66**, matching the requested baseline. Created `security/orakl-p0-3` from that exact commit. Protected refs: main=`b555a87e82d40560e50c8ce102239b10eb3bd365`, P0=`7b8ac4e3f009c46631d88f5094e632972885aaaa`, P0.1=`d46452479b9ce08dea77dd45730276c26fa50894`, P0.2=`8d850ae42ebc77acaf2323cd50f63f08e57f1b66`. No baseline discrepancy.

The complete PRD, required P0.2 decision/range/security/freeze/recovery/verification/migration documents, five production modules, interfaces/types and **all current unit/fuzz/invariant/remediation/economics/integration/legacy Foundry tests and doubles/helpers** were read before production changes. Historical test results are evidence of P0.2 only; no P0.3 success is assumed.

## Confirmed source paths and threat model

Line references below refer to the immutable baseline; final references will be recorded separately.

| Issue | Baseline source | Existing executable reproduction | Attack/impact and initial disposition |
| --- | --- | --- | --- |
| C1 First-challenge evidence exclusion | `contracts/src/MarketResolver.sol:49-62` accepts only PROPOSED and stores one challenger; no independent evidence entry | `contracts/test/economics/P0_2Economics.t.sol:50`, `testFirstChallengerCapturesSlotButCannotBypassArbitrator_RESIDUAL` | Proposer/first challenger may share control. Later formal challenges fail, and there is no on-chain evidence intake path. Separate evidence access from economic slot ownership; do not invent Sybil identity detection or rewards. |
| C2 Premature arbitration | `MarketResolver.sol:74-85` has only upper deadline bound | `P0_2Economics.t.sol:69`, `testArbitratorMayResolveImmediatelyAfterCapturedChallenge_RESIDUAL` | Authorized arbiter may finalize immediately after capture, excluding observers before the promised challenge deadline. Add lower boundary using existing immutable challengeDeadline; no reset/extension. |
| C3 Transient role-view censorship | `ProtocolStorage.sol:48-55` financialEntry → `ProtocolConfig.sol:146-152` → `:193-195` currentRoleState; also `MarketResolver.sol:49,64` | `P0_2Economics.t.sol:269`, `testRestoredRoleViewsDoNotProveUninterruptedChallengeAvailability_RESIDUAL` | Governance/compliance/arbiter can temporarily alter getters; challenges revert. Restoring views after deadline permits unchallenged finalization absent a recorded interruption. Evaluate a narrow active/bound/chain/epoch/window/exact-bond gate without live getters for objections only. Keep creation/prediction/proposal/finalization/fee role validation. |
| C4 Admitted corrupt arbitration | `ProtocolConfig.sol:164-173,232-250`; `MarketResolver.sol:74` | `contracts/test/remediation/MultisigControls.t.sol:151`, hidden-module residual | Plausible owner getters do not prove genuine execution, singleton/modules/guards or beneficial independence. Prevent unauthorized external callers and early decisions; honest consideration/truth remains an operational trust boundary. |

All C1–C4 are initially **OPEN**, not fixed by documentation or a passing residual PoC. Separate authorization, evidence access, timing, economic incentives and truthful adjudication. C1 evidence exclusion and C2/C3 are locally actionable candidate safety corrections under the user's express P0.3 instruction; economic redistribution and appeals remain unapproved.

## Safety boundaries preserved

`ProtocolConfig.sol:108-145,186-210`: finance starts false; independent compliance approves an epoch/build/control-bound digest; a full24-hour delay and governance unpause/activate follow. Any authorized pause/deactivate/parameter change increments activityEpoch, revokes approval and quarantines old unresolved markets. `MarketResolver.sol:87-116`: ordinary and first-interruption refunds remain permissionless/bounded; existing disputed exit is arbitrationDeadline. Never resume old epochs or use an emergency outcome override.

`MarketFactory.sol:25-60` snapshots nine terms, metadata/deadlines and arbitrator fingerprint. `PredictionPool.sol:58-111`, `ProtocolStorage.sol:90-138` isolate participant/bond/fee liabilities with owner-directed pull withdrawals, CEI/nonreentrancy/rollback. Full-return bonds and fee/refund formulas must stay unchanged. Evidence must not touch these ledgers or grant settlement rights. Forced balances remain surplus. No participant/evidence iteration in settlement.

Compiler baseline: Foundry1.8.1, native solc0.8.37+f401782d, Paris, metadata hash none, v1 optimized roots runs50/non-IR; untouched legacy optimizer off/runs200. Fuzz2,048 fixed seed0x4f52414b4c503031; strict invariants128×64; intensive256×128 seed0x4f52414b4c503032. No dependency/compiler upgrade planned. Actual command executions will be preserved under `docs/testing/p0-3/` with failures, timestamps, durations, exit codes and output SHA256.

Legacy Solidity/ABI/frontend/public manifest/deployment history, old reports/archive and protected branch refs must remain unchanged. No live network transaction, signing, broadcast, finance activation, deployment, push, merge or PR is authorized.

## Executed baseline reproduction

At `f23a4c5` (only audit/recorder additions; production/test source still exactly8d850ae), `forge build --force` exited0 and the existing artifact/profile checker passed. All three named original residual PoCs exited0 under `forge test ... -vvvv`, confirming second-challenge rejection, immediate authorized arbitration, and role-restoration/uncontested finalization. These passes reproduce vulnerabilities; they are **not fixes**. Exact traces: `docs/testing/p0-3/baseline-pocs-1.txt`; command/status/hash records: `docs/testing/p0-3/commands.json`. The [minimal candidate design](../protocol/P0_3_DISPUTE_STATE_MACHINE.md) was recorded before failing regressions and production edits.
