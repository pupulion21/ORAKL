# P0.2 verification report

Date:2026-10-30 UTC. Branch:`feature/orakl-p0-2`, baseline:`d46452479b9ce08dea77dd45730276c26fa50894` (`remediation/orakl-p0-1`). Final Solidity test additions:`2b5ca567342ed6f5b89a5fc8a728d7bd28cc4403`; production Solidity/compiler settings remain identical to baseline. Earlier P0.1 production source revision was `fc5b8be`.

**Result:** safely actionable review/testing/interface work completed; **economic policy approval, final audit scope, protocol freeze and Mainnet launch remain blocked**. Current bond policy is full principal return; no punitive rule implemented. No main/base branch change, push, merge, deployment, live transaction or real-value activation occurred.

## Executed commands and results

Exact argv/cwd/environment/status/timing/output SHA256: [command records](p0-2/commands.json) and [frontend records/evidence index](p0-2/README.md). Tool versions: Foundry1.8.1 commit982849d3140c01fd3b72905759581a132df7aa98; native solc0.8.37+f401782d; Slither0.11.6; Node24.20.0; npm11.19.0. No dependency/compiler upgrade.

| Verification | Result | Exact evidence |
| --- | --- | --- |
| `forge build` | PASS after correcting new test helper stack depth; final `--force` also PASS | [build-2](p0-2/build-2.txt), [final build](p0-2/build-final-1.txt) |
| `forge test -vvv` final | **168 pass,0 fail,0 skip,18 suites**,104.118s process duration | [final suite](p0-2/forge-test-2.txt) |
| Unit fuzz | **10 functions ×2,048 cases**, seed`0x4f52414b4c503031` | Final suite/default settings in [preservation](p0-2/preservation.json) |
| Default stateful campaigns | Legacy5 + v1 A–N14 =**19 named assertions**,128 runs×64 depth per handler; fail_on_revert=true | Final suite: two grouped invariant entries,8,192 calls each,0 reverts |
| Intensive current stateful campaign | **256 runs×128 depth =32,768 calls,0 reverts**,14 current assertions, seed`0x4f52414b4c503032`,486.609s | [intensive output](p0-2/invariant-intensive-1.txt); same handler/assertion source as final suite |
| `forge coverage` | PASS,168 entries; coverage table below | [coverage](p0-2/coverage-1.txt) |
| `forge fmt --check` | PASS,exit0; only baseline legacy formatting exclusions retained | [empty successful output](p0-2/fmt-1.txt) |
| Slither project +3 complete roots | All analyzed successfully; **exit255/findings retained**, not clean scans | [triage](../audit/P0_2_STATIC_ANALYSIS_TRIAGE.md) and raw JSON/text |
| Compiler/artifact/profile checks | PASS; all 3 runtime templates/sizes equal P0.1; >=20% engineering headroom for v1 against standard EVM references | [artifact checks](p0-2/artifact-check.json), [preservation](p0-2/preservation.json) |
| Candidate interface/source check | PASS; compiler metadata source hashes, ABI SHA256, all selectors/topics/structs;68 functions,21 events across2 deployable roots | [interface check](p0-2/interface-check-1.txt), [exact package](../../contracts/abi/orakl-v1-candidate/INTERFACE.md) |
| Interface negative/decoding tests | **4 pass**: selector/call decoding, binary refundable event decoding, tampered ABI rejection, stale compiler source rejection | [Node output](p0-2/interface-tests-1.txt) |
| Exact synthetic economic model | PASS self-checks: nine completed-candidate cases, zero/nonzero bond conservation, cancellations, hand-calculated examples | [model](p0-2/economic-model.json) |
| Existing frontend Node tests/typecheck/Vite build | **39 pass**,tsc PASS,production build PASS | [frontend test](p0-2/frontend-test-1.txt), [typecheck](p0-2/frontend-typecheck-1.txt), [build](p0-2/frontend-build-1.txt) |
| Baseline preservation | **127 files +3 branch refs unchanged**; source,dependencies,compiler,frontend,legacy ABI/deployment/history/archive protected | [preservation](p0-2/preservation.json) |

Grouped invariant entries are not19 separately counted Foundry tests; the final 168 total includes one grouped v1 and one grouped legacy invariant entry. Fuzz/invariant pass counts do not establish real-world oracle correctness, meaningful identity independence or production monitoring probabilities.

## Coverage of deployable v1 source

| File | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| MarketFactory.sol |27/27|43/44|4/5|2/2|
| MarketResolver.sol |81/81|124/124|26/26|8/8|
| PredictionPool.sol |73/73|90/91|16/17|10/10|
| ProtocolConfig.sol |143/146|232/238|25/29|25/26|
| ProtocolStorage.sol |60/60|66/67|8/9|19/19|
| **v1 aggregate** |**384/387,99.22%**|**555/564,98.40%**|**79/86,91.86%**|**64/65,98.46%**|

Legacy QiePredictionMarket line coverage remains133/152 (87.50%). The raw all-files total, including legacy/helpers/tests, is 1,019/1,122 (90.82%) lines; do not confuse this with the selected v1 aggregate. Remaining branches/errors need independent review rather than artificial tests solely to raise a percentage. Coverage compilation/instrumentation is followed by a clean noninstrumented force build and artifact checks.

## New executable coverage and residual cases

P0.2 adds18 Foundry entries across `test/economics/P0_2Economics.t.sol` (16,including2 fuzz) and `P0_2GasBounds.t.sol` (2). Existing current invariant contract gains M (all snapshotted terms/deadlines/metadata/evidence) and N (quoted unsettled entitlements plus deterministic dust reconcile to global participant reserves). No production Solidity was modified.

Coverage includes all 9 proposal/arbitration combinations under full returns, every zero/positive proposal/challenge combination, first-challenger capture/unauthorized settlement rejection, immediate trusted arbitration, repeated creation recycling K, per-market versus aggregate caps, maximum uint128 cap with repeated/both-sided contributions, smallest-unit fee/dust across terminal modes, all 9 terms/evidence snapshots through emergency arbitration, expired/interrupt cancellation ordering, reverting arbiter timeout exits, and failed-transfer/cross-market reentrancy recovery.

Residual PoCs intentionally **pass while demonstrating unresolved risks**, especially a tiny false winner receiving nearly the pool, one-sided fee/refund incentives, first-slot coalition capture, immediate arbitration, hash presence without available evidence, and role drift/restoration that can censor challenges without persisting an epoch change if no observer reports it. These are not vulnerabilities reported as fixed. See [prioritized threat/economic findings](../security/P0_2_ADVERSARIAL_ECONOMICS.md).

Local maximum-owner/URI test measured create1,941,865 and predict1,398,610 gas inside its warm test transaction, with explicit3,000,000-gas call budgets; full-role drift reporting fit2,500,000-gas calls. Claims fit150,000 gas before/after 40 unrelated markets. These are local fixture observations, not actual QIE limits, real Safe signature/guard gas or Mainnet deployment compatibility.

## Static analysis disposition

Whole project:4 High/13 Low/4 Informational/2 Optimization. Complete Factory root:1 High/8 Low/1 Informational; Config:0 High/1 Low/2 Informational/1 Optimization; legacy:1 High/4 Low/1 Informational. Two extra project High initialization reports arise in an incomplete abstract compilation unit and disappear with actual Factory writers included. Both native-send High reports remain, with all ten withdrawal call paths traced and regression evidence. No blanket “harmless” or “security audit passed” claim. [Full triage and value-flow graph](../audit/P0_2_STATIC_ANALYSIS_TRIAGE.md).

## Preserved failures and limits

1. [focused attempt 1](p0-2/focused-1.txt): `testFailed...` was interpreted as obsolete Foundry `testFail*`; renamed `testRejected...`. Attempt2 passed17 entries, before the additional role-restoration case.
2. [build attempt 1](p0-2/build-1.txt): added invariant had too many local variables under the preserved non-IR compiler. Extracted `_quotes`/QuoteTotals without changing production/compiler settings; build attempt 2 and both later full suites passed.
3. Intermediate [167-test pass](p0-2/forge-test-1.txt) is retained. Final suite after adding the transient-drift residual test passed168. Static analysis exit255 is retained as findings, not misreported execution failure or clean success.

Raw outputs are byte-for-byte, SHA256-checked; logs were not whitespace-normalized. Compiler warnings include test-only forced-transfer selfdestruct fixtures and existing lint/cast/timestamp observations; they are visible in raw output. No independent auditor, real multisig signing, public network/fork execution, RPC/finality benchmark, backend/indexer E2E or compliance assessment occurred. No command uses production funds.

## Commits, migration and readiness

| Commit | Work |
| --- | --- |
| `0fb839d` | Initial economic decision/ranges/threat model and exact offline model |
| `2a097f5` | Economic/gas tests, invariants M/N, verification recorder and exact candidate ABI/interface |
| `0a2255e` | Fail-closed ABI/source drift tests and selector/event decoding |
| `2b5ca56` | Transient role drift residual test and preservation tooling; final Solidity test source |
| `18d399b` | Freeze/operational decisions, historical challenge availability and P1 implications; preservation identity strengthening |

Later evidence/report commits change no production/test behavior. `main=b555a87`, `refactor/orakl-protocol-v1=7b8ac4e`, `remediation/orakl-p0-1=d464524` remain unchanged. Existing frontend/testnet remain functioning on their original ABI; P0.2 introduces no breaking runtime ABI change because production source is unchanged. New P1 artifacts are a separate **CANDIDATE_NOT_FROZEN** package, with null production addresses/network and deployment/activation authorization false.

Owner must decide complete bond/INVALID/empty-market rules, fee and amounts, exposure/monitor funding, first-slot and minimum evidence intake/appeal, transient drift controls, creation spam, evidence schema/availability, timing/abort trust and dust before final implementation/freeze. Preliminary independent source review can start using this baseline and residual PoCs. Final economic freeze and final production audit scope are not ready; [Mainnet readiness](../deployment/QIE_MAINNET_READINESS.md) stays BLOCKED. [Freeze checklist](../audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md) and [P1 interface specification](../migration/P0_2_P1_INTERFACE.md) provide the handoff.
