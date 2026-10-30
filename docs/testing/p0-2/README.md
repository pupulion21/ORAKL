# P0.2 exact verification evidence

See [verification report](../P0_2_VERIFICATION_REPORT.md), [machine-readable summary](summary.json), [economic model](economic-model.json), [freeze checklist](../../audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md), and [static analysis triage](../../audit/P0_2_STATIC_ANALYSIS_TRIAGE.md).

Text outputs are the **exact combined stdout/stderr bytes**, including empty output and tool whitespace; no log normalization/filtering was performed. `.gitattributes` disables whitespace lint for this evidence path so raw data is preserved. Commands record cwd, argv, explicit safe environment overrides, UTC execution time, duration, exit code, execution HEAD, output path and SHA256. HEAD may precede reviewed working-tree changes; final contract/test source is pinned by commits and the preservation/interface manifests. No complete environment, RPC/API credentials, private keys or keystore contents are captured.

- [commands.json](commands.json): sequential Foundry/model/Slither/artifact/interface/preservation history, including two early failures and an intermediate 167-test pass.
- [frontend-test-commands.json](frontend-test-commands.json), [frontend-typecheck-commands.json](frontend-typecheck-commands.json), [frontend-build-commands.json](frontend-build-commands.json): independent frontend checks, run concurrently using separate record files to avoid shared-file writes.
- [forge-test-2.txt](forge-test-2.txt): final 168 Foundry entries. `forge-test-1.txt` is the earlier 167 pass before the additional transient-drift residual test.
- [invariant-intensive-1.txt](invariant-intensive-1.txt): unchanged current handler/assertion code, second seed,256×128,32,768 calls,0 reverts;14 named invariants.
- [coverage-1.txt](coverage-1.txt), [build-final-1.txt](build-final-1.txt), [fmt-1.txt](fmt-1.txt): coverage and final restored noninstrumented compilation/format check. Empty fmt output with exit0 is expected.
- `slither*.json` and `slither*-1.txt`: four completed analyses, retained findings/exit255. No findings were removed to imply a clean result.
- [artifact-check.json](artifact-check.json): compiler/profile/template size and legacy runtime identity. [preservation.json](preservation.json):127 protected file hashes, three protected refs, tool versions/default test settings and equality with P0.1 runtime templates/sizes.
- [interface-tests-1.txt](interface-tests-1.txt): four Node tests, including deliberately tampered ABI/stale-source rejection and exact selector/event decoding.
- [focused-1.txt](focused-1.txt): new test's `testFailed...` name matched the removed Foundry testFail convention. Renamed to `testRejected...`; focused attempt 2 passed17 tests.
- [build-1.txt](build-1.txt): new invariant helper initially exceeded the non-IR compiler stack. Extracted a bounded quote helper; build attempt 2 succeeded with unchanged compiler settings. These were test-harness failures, not fixed production vulnerabilities.

## Reproduce offline

From repository root with the existing installed pinned tools/dependencies:

```sh
python3 scripts/verify-orakl-p0-2.py build
python3 scripts/verify-orakl-p0-2.py forge-test
python3 scripts/verify-orakl-p0-2.py invariant-intensive
python3 scripts/verify-orakl-p0-2.py coverage
python3 scripts/verify-orakl-p0-2.py fmt
python3 scripts/verify-orakl-p0-2.py slither
python3 scripts/verify-orakl-p0-2.py slither-factory
python3 scripts/verify-orakl-p0-2.py slither-config
python3 scripts/verify-orakl-p0-2.py slither-legacy
python3 scripts/verify-orakl-p0-2.py build-final
python3 scripts/verify-orakl-p0-2.py artifact-check
python3 scripts/verify-orakl-p0-2.py interface-check
python3 scripts/verify-orakl-p0-2.py interface-tests
python3 scripts/verify-orakl-p0-2.py economic-model
python3 scripts/verify-orakl-p0-2.py preservation
python3 scripts/verify-orakl-p0-2.py frontend-test
python3 scripts/verify-orakl-p0-2.py frontend-typecheck
python3 scripts/verify-orakl-p0-2.py frontend-build
```

Run artifact-producing Foundry/Slither steps sequentially; Slither invokes clean/build. Restore a noninstrumented force build after coverage/Slither before checking artifacts. Existing raw detector JSON is never overwritten: for a rerun, explicitly retain/rename the old JSON or use a clean checkout/evidence directory, then keep both attempt records. Repeated text attempts get new numbered filenames. Do not run independent steps against the same record file; use `--record-file <unique-json-basename>` if running frontend checks concurrently. No command signs, broadcasts, accesses live RPC or activates a deployed protocol.

The preservation step expects artifact-check.json and baseline P0.1 evidence, and verifies the dedicated branch/protected refs and unchanged source. It reads an explicit compiler/test configuration allowlist only. ABI regeneration is a deliberate separate `node scripts/export-orakl-candidate-interface.mjs --write`; the check step refuses silent drift. The candidate package is not frozen or a deployment manifest.
