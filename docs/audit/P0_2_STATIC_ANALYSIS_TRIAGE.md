# P0.2 static analysis and payment graph review

All four Slither0.11.6 analyses completed with `success=true`, `error=null`, and exit255 because findings exist. They are **not clean passes**. Raw detector JSON and exact command output are preserved under [p0-2](../testing/p0-2/README.md); compiler identity, source and runtime templates remain unchanged from P0.1.

| Analysis | High | Low | Informational | Optimization |
| --- | --- | --- | --- | --- |
| Foundry project, tests/lib/scripts filtered | 4 | 13 | 4 | 2 |
| Complete MarketFactory inheritance root, pinned optimized solc | 1 | 8 | 1 | 0 |
| Complete ProtocolConfig root, pinned optimized solc | 0 | 1 | 2 | 1 |
| Preserved legacy QiePredictionMarket root, optimizer off | 1 | 4 | 1 | 0 |

These are overlapping views, not counts to sum into independent vulnerabilities. Full command arguments/statuses/digests are in [commands.json](../testing/p0-2/commands.json). Test-only adversarial contracts are excluded from detector output filtering, not removed from the compilation or Foundry tests.

## High reports: retain and trace

| Report / file | Reachable payment authorization and liability change | Executable evidence / disposition |
| --- | --- | --- |
| `arbitrary-send-eth`, `contracts/src/ProtocolStorage.sol:130` | Only three caller families reach `_send`: (1) `PredictionPool.sol:42,46,50,54` → `_settle:69`, checks terminal/refund mode, caller's unsettled positive position, valid recipient; computes fixed native entitlement; sets settled/debits participant liability/increments correct market/global outflow before checked call. (2) `ProtocolStorage.sol:90` checks terminal, caller owns deposited bond and not already claimed, valid recipient; marks claimed/debits only bond liability. (3) `PredictionPool.sol:58` verifies governance caller/live declared controls, positive amount<=accrued fee liability, recipient; debits only fee liability. All share facade nonReentrant; transfer failure rolls back all effects. | Existing hostile-receiver and fee/bond regressions; new cross-market reentrancy/rollback, cap, smallest-unit/mixed-market, all 9 outcomes and independent quoted-entitlement invariant N. **Retain High detector match.** No unconstrained native transfer path established under stated authority/entitlement assumptions; this is not a claim of universal safety or correct oracle outcomes. |
| `arbitrary-send-eth`, `contracts/src/QiePredictionMarket.sol:463` | Four preserved wrappers `claim:265`, `claimTo:272`, `refund:278`, `refundTo:285` enter guarded `_claim:411`/`_refund:437`; account is always msg.sender. Owner's recorded contribution, terminal resolution/refund conditions and exactly-once flag bound payment; CEI debits escrow accounting. Destination is caller or an owner-selected valid alternate recipient; no admin send/rescue or other-account entitlement override. | Legacy unit/fuzz/invariant tests remain in final 168. Existing cross-market legacy regression remains preserved. Full original line-by-line graph: [P0.1 value-flow review](P0_1_VALUE_FLOW_REVIEW.md). **Retain High detector match.** Legacy trusted manual resolution remains a distinct preserved trust model, not migrated v1. |
| `uninitialized-state`, `marketCount` / `_markets` in abstract ProtocolStorage compilation unit | Multi-profile project scan includes a default-profile abstract unit without the restricted optimized Factory creation implementation. ProtocolStorage is abstract/nondeployable; actual `MarketFactory.sol:45` increments marketCount and writes all creation fields. Complete facade scan includes those writers and does not report these two initialization findings. | Permissionless creation/unique-ID/bond/pool regressions; source-preservation and runtime template identity checks. Compare raw project vs complete root results. Treat these two as incomplete-unit analyzer artifacts with explicit evidence, not hidden reports. |

The v1 and legacy send graph has ten public withdrawal entry points in total: six v1 paths (four position wrappers, bond, fee) and four legacy wrappers. No additional native transfer helper was introduced. Rechecking caller control, entitlement, liability class and destination for each path matters; simply observing CEI in `_send` would not establish authorization. Forced native balances cannot create entitlements or be swept. Floor dust and unclaimed funds remain participant reserves.

## Remaining detector classes

Thirteen Low reports concern deliberate timestamp comparisons used for exclusive close/proposal/challenge/arbitration and inclusive finalization/cancellation/review boundaries. Timestamp variability and QIE consensus properties still require review; no randomness depends on timestamps. Unit/fuzz/invariant tests exercise boundary equality, ordinary/emergency cancellation ordering and immutable interruption exits.

Four Informational reports comprise three low-level-call reports and one assembly report. They cover checked native sends, one-time facade static binding, bounded multisig reads and the bounded memory-safe output-buffer assembly. Wallet reads cap call gas/output size before decode. P0.1 return-bomb regressions remain passing. New local gas tests exercise three 32-owner role sets and maximum 256-byte URI, plus constant-budget claims after 40 unrelated markets. These are local warm-call budgets, not Mainnet compatibility evidence.

Optimization reports include the deliberate external self-call used to make role-check failure catchable and gas-bounded, plus an incomplete-unit constant suggestion in the whole-project scan. No automatic rewrite, dependency update, pragma change or detector suppression was applied. Full descriptions, source mappings and confidence are retained in JSON; [prior triage](P0_1_STATIC_ANALYSIS_TRIAGE.md) supplies unchanged rationale.

## Risks static analysis does not resolve

This scan does not establish truthful evidence, honest arbitration, monitoring availability, Sybil independence, fair first-slot allocation or approved economics. [Adversarial review E-C/E-J](../security/P0_2_ADVERSARIAL_ECONOMICS.md) adds executable residual examples of immediate arbitration and unreported transient role drift/restoration censoring challenges. These remain open conditional safety findings. Lying wallet views/hidden modules, aborted-market incentives and full-return bond griefing remain release blockers. No finding is declared fixed merely because the detector does not report it.

Independent review of the final policy and exact implementation is still required. All production financial activity remains unauthorized; no deployment/live transaction occurred.
