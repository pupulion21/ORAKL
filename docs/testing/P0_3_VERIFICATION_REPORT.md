# P0.3 verification report

Date:2026-10-30 UTC. Branch:`security/orakl-p0-3`. Verified base:`8d850ae42ebc77acaf2323cd50f63f08e57f1b66`. Production corrections:`7f9ca5e47a70915c7dfcd19889dcf7ffd3551646`; final Solidity test source:`158694d42418cb37ea988e43212fdc40aceec46a`. Later commits add analysis/interface/evidence tooling and documents, not new financial behavior.

**Engineering candidate complete; protocol freeze BLOCKED.** Default-disabled finance, native binary pari-mutuel pools, full-return bonds, original exit deadlines and all P0.1 custody/release controls are preserved. No live deployment/signing/broadcast/financial activation, push, merge or PR occurred. Local Foundry activation/execution fixtures are simulations, not approvals.

## Before/after security evidence

1. At f23a4c5, production and original tests remained identical to8d850ae. `forge build --force` and artifact/profile checks passed; all three original P0.2 residual PoCs passed, reproducing evidence exclusion, immediate arbitration and restored-role uncontested finalization. [Exact traces](p0-3/baseline-pocs-1.txt).
2. At3518891, eight new corrections-oriented regressions were committed before production edits. **0 passed/8 failed** against P0.2 for actual expected reasons: absent intake, no early-decision revert, role mutation/getter failures and ControlChanged masking an exact-value objection check. [Failing output](p0-3/regressions-before-1.txt).
3. Production correction 7f9ca5e changes exactly MarketResolver, ProtocolConfig and IProtocolConfig. The **same eight regressions passed** after implementation. [First after-output](p0-3/security-1.txt). They remain in every full/current security run. Original premature/restored-role residuals were rewritten to assert prevention, not retained as unsafe successes.
4. [Further security tests](../../contracts/test/security) add spam/duplicates, pause/quarantine intake, exact indexing/nonpayability/callbacks, narrow-gate boundary/role/value/chain cases and genuine *execution-model* adversaries (hidden module, mutable delegated proxy, guard denial, shared controller, biased INVALID). Residual successes remain explicitly OPEN trust findings; they are not counted as fixing truthful arbitration.

## Actual commands and results

All argv/cwd, explicit seeds/overrides, UTC timestamps, duration, execution HEAD, exit status and output SHA256 are recorded in [commands.json](p0-3/commands.json) plus three frontend record files listed in the [evidence index](p0-3/README.md). Text outputs are exact combined stdout/stderr bytes, without normalization. Installed tools: Foundry1.8.1 commit982849d3140c01fd3b72905759581a132df7aa98, solc0.8.37+f401782d, Slither0.11.6, Node24.20.0, npm11.19.0. Compiler/dependencies unchanged.

| Required check | Actual result | Raw output |
| --- | --- | --- |
| `forge build --force` | PASS; baseline, corrected and final noninstrumented force builds captured | [corrected](p0-3/build-1.txt), [final](p0-3/build-final-1.txt) |
| `forge test -vvv` | **208 passed,0 failed,0 skipped;22 suites**,112.562s process time including compile | [full final suite](p0-3/forge-test-2.txt) |
| `forge test --match-path 'test/economics/*' -vvv` | **18 passed**; includes rewritten safety regressions and unchanged economic residuals | [economics](p0-3/economics-1.txt) |
| `forge test --match-path 'test/remediation/*' -vvv` | **30 passed**; guards, native flows, role admission, release/emergency remain | [remediation](p0-3/remediation-1.txt) |
| `forge test --match-path 'test/security/*' -vvv` | **39 passed**, four suites, including three new fuzz functions | [security](p0-3/security-2.txt); same tests in full208 |
| `forge test --match-path 'test/invariant/*' -vvv` | **2 grouped entries**:16 current assertions plus max-seed handler unit;128×64,8,192 calls,0 handler reverts | [standard current](p0-3/invariant-2.txt) |
| Intensive current invariant campaign | **256×128,32,768 calls,0 unexpected handler reverts**,16 current assertions; max-seed unit also passes;487.484s | [intensive](p0-3/invariant-intensive-1.txt) |
| `forge coverage` | PASS,208 entries; source coverage below | [coverage](p0-3/coverage-1.txt) |
| `forge fmt --check` | PASS,exit0; baseline legacy exclusions retained | [empty successful fmt output](p0-3/fmt-1.txt) |
| `forge build --sizes --skip test --skip script` | PASS; measured production roots below | [sizes](p0-3/sizes-1.txt) |
| Slither full project +3 separate roots | All success=true/error=null, **exit255 with findings**, no clean-audit claim | [triage](../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md), raw JSON/text |
| Existing artifact/profile checker | PASS: pinned compiler/Paris/v1 optimizer50/non-IR/metadata-none, no linked libraries, engineering size margins, exact legacy runtime | [artifact check](p0-3/artifact-check.json) |
| Existing candidate ABI exporter `--write`, then `--check` | PASS; P0.3 candidate,70 functions/22 events, exact source/ABI hashes | [export](p0-3/interface-export-1.txt), [check](p0-3/interface-check-1.txt) |
| Existing candidate interface Node tests | **4 passed**, selector/event decoding and deliberate tampered-ABI/stale-source rejection | [Node output](p0-3/interface-tests-1.txt) |
| Counterfactual economics/exposure model | PASS self-checks for144 cases, conservation, multiple-bonded alternatives and exposure/liability separation; **not approved economics/security proof** | [model](p0-3/economic-model.json) |
| Existing frontend unit/type/build | **39 passed**,TypeScript PASS,Vite production build PASS | [tests](p0-3/frontend-test-1.txt), [typecheck](p0-3/frontend-typecheck-1.txt), [build](p0-3/frontend-build-1.txt) |
| Preservation/compatibility check, latest | PASS:202 protected files,4 original refs,14 A–N assertion bodies,21 unchanged release/control functions,6 original proposal/refund/finality functions; only three intended production files differ; all old ABI entries preserved with exactly3 additions; legacy runtime exact | [final preservation](p0-3/preservation.json), [second command output](p0-3/preservation-2.txt) |

Fuzz baseline remains **13 functions×2,048 cases** per full/coverage run (26,624 unit-fuzz cases), seed`0x4f52414b4c503031`. Full suite includes original legacy 5 assertions and current A–P16 =**21 named invariant assertions**, grouped by Foundry; do not add21 to the 208 test total. Standard profiles remain128 runs/depth64/fail_on_revert=true. Intensive overrides use seed`0x4f52414b4c503032`,256/depth128. Handler calls include legitimate early-return actions; nonvacuous seeding plus unit matrices prove the new paths are exercised, not 32,768 distinct complete trades.

A–N bodies are mechanically compared with 8d850ae and remain unchanged apart from whitespace. The handler now models delayed arbitration without moving original timers, independent evidence, unauthorized/early decisions and transient role faults/restoration with an independent ghost ledger. O checks intake/event/financial isolation and persistence of funded objections; P checks original lower/upper arbitration bounds. Faulted roles restore atomically before old A–N checks; separate deployed mutable-wallet tests cover persistent malformed/reverting/gas-burning/threshold/owner conditions. This is not genuine Safe signing or proof of historical control continuity.

## Coverage and sizes

| v1 source | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| MarketFactory |27/27|43/44|4/5|2/2|
| MarketResolver |88/88|138/138|29/29|9/9|
| PredictionPool |73/73|90/91|16/17|10/10|
| ProtocolConfig |147/150|234/240|25/29|27/28|
| ProtocolStorage |60/60|66/67|8/9|19/19|
| **v1 total** |**395/398,99.25%**|**571/580,98.45%**|**82/89,92.13%**|**67/68,98.53%**|

Legacy line coverage remains133/152 (87.50%). The raw coverage output includes tests/helpers/legacy separately; these selected v1 percentages are not a claim about the whole tree or an independent audit. All remaining branches/errors require review rather than artificial tests just to raise a percentage. Instrumented coverage is followed by restored noninstrumented force build and artifact verification.

| Artifact | Runtime bytes | Initcode incl. constructor args | Runtime template keccak256 |
| --- | --- | --- | --- |
| MarketFactory |15,860|16,179|`0xb7961b0a0e4099bd9ac75fc821940a1858386572df142e4b7da28e18ad79f4ca`|
| ProtocolConfig |8,508|11,804|`0xaed346cc6bdb2d85536b5d320058822be4a355b2ef417bffe07ce3bfcd25b5fe`|
| Legacy QiePredictionMarket |13,906|13,945|`0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b`|

v1 runtime/initcode guards remain<=19,660/39,321, providing>=20% margin against standard EVM24,576/49,152 references. Factory runtime grows448 and Config48 bytes from P0.2; no optimizer/library change. Template hashes for v1 include unpatched immutables and are not deployed-instance verification. QIE-specific limits/forks/native properties/genuine-wallet/cold gas/explorer support remain unverified. Local tests exercise fixed60,000-gas evidence submissions after 512 spam entries and500,000-gas settlement, plus400,000-gas challenges during getter faults; these are local budgets, not Mainnet performance certification.

## Static analysis findings retained

Project:4 High/14 Low/4 Informational/2 Optimization. Complete Factory:1 High/9 Low/1 Informational; Config:0 High/1 Low/2 Informational/1 Optimization; legacy:1 High/4 Low/1 Informational. Two project High initialization matches belong to the incomplete abstract compilation unit; complete Factory root includes actual writers and does not report them. Both native-send Highs remain with all ten outgoing paths traced. New evidence timing adds one deliberate timestamp Low. No suppression of production findings, automatic rewrite or claim that a helper is harmless. [Full call-path triage](../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md).

## Actual failures and intermediate evidence

- Baseline residual PoCs passed as attack reproductions, not fixes; the eight new before-fix regressions deliberately failed. Both outputs are preserved exactly.
- First combined-suite attempt failed compiler Stack too deep in the **test handler**, after adding max-seed arithmetic to the transient-fault action. Split fault/restore helpers and bounded the actor seed at158694d, keeping compiler/non-IR profiles unchanged. [Actual compiler failure](p0-3/forge-test-1.txt). Final full/coverage/standard/intensive runs pass. This is a corrected test-harness issue, not a claimed production vulnerability fix.
- Earlier security8/39 and intermediate invariant output remain. No failed text output was overwritten, filtered or normalized. Derived preservation.json was regenerated on a second run to add ABI/timer/control consistency checks; both exact stdout attempts remain, while that derived JSON represents the latest check. Raw Slither JSON is never overwritten by the recorder.

Compiler/lint warnings, including test-only selfdestruct/proxy fixtures and existing timestamp/cast/future-keyword warnings, remain visible. No public fork/RPC/genuine multisig/audit/compliance E2E or real-value operation was performed. Passing tests do not prove real-world truthful resolution, beneficial independence or honest evidence consideration.

## Commit inventory and handoff

| Commit | Work |
| --- | --- |
| f23a4c5 | Baseline audit/identity/settings and exact local recorder |
|3518891|Minimal design and eight failing-before regressions, no production edits yet|
|7f9ca5e|Three-file production correction: event intake, narrow challenge admission, D<=arbitration<A|
|7a8b21d|Adversarial execution mocks, security tests, rewritten original residuals, timing fixtures and O/P handler expansion|
|158694d|Final Solidity test source: bounded max-seed arithmetic and helper stack correction|
|991d7c1|Counterfactual economics and preservation tooling|
|09c6ab8|Final security/economic/state/interface documentation, exported ABI and stronger compatibility checks|

All four protected refs remain unchanged; work is on the dedicated branch only. Old financial/release policies, compiler/dependencies, legacy contract/ABI/frontend/manifest/deployment history and prior evidence/archive are preserved. The [candidate ABI](../migration/P0_3_INTERFACE_CHANGES.md) is regenerated but explicitly not frozen. [Security disposition and remaining blockers](../audit/P0_3_PROTOCOL_FREEZE_READINESS.md) distinguish corrected paths from owner economics, trusted arbitration, independent audit, operational services, QIE Mainnet compatibility and applicable legal release requirements. No deployment or activation approval is inferred.
