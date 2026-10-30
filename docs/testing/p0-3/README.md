# P0.3 raw execution evidence

[Verification report](../P0_3_VERIFICATION_REPORT.md), [security disposition](../../audit/P0_3_PROTOCOL_FREEZE_READINESS.md), [static analysis triage](../../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md), [machine summary](summary.json).

All numbered `.txt` outputs are exact combined stdout/stderr bytes as captured by the existing recorder; empty output, compiler warnings and trailing whitespace remain. `.gitattributes` disables whitespace lint only for these raw logs. No output filtering/normalization or manually fabricated success record was performed. [commands.json](commands.json) contains argv, cwd, explicit overrides, UTC start, duration, execution HEAD, exit status, output path and SHA256. Independent frontend checks used separate record files to avoid a shared-file write race.

## Before/after and current outputs

- [baseline-pocs-1.txt](baseline-pocs-1.txt): all three original residuals actually reproduce at unchanged production source; full traces, not security fixes. [baseline build](baseline-build-1.txt), [baseline artifacts](baseline-artifact-check.json).
- [regressions-before-1.txt](regressions-before-1.txt): eight new tests actually fail against P0.2 at 3518891. [security-1.txt](security-1.txt): same eight pass after production correction 7f9ca5e. [security-2.txt](security-2.txt): expanded 39 security tests pass, also included in final full suite.
- [forge-test-1.txt](forge-test-1.txt): actual test-handler stack-depth compiler failure. Bounded seeds/split helpers at158694d fix the harness without changing compiler settings. [forge-test-2.txt](forge-test-2.txt): final 208 pass.
- [economics-1.txt](economics-1.txt), [remediation-1.txt](remediation-1.txt): separate required18/30-test suites. [invariant-2.txt](invariant-2.txt): final standard handler/unit source. `invariant-1.txt` is an earlier successful campaign before final max-seed helper hardening.
- [invariant-intensive-1.txt](invariant-intensive-1.txt): final 16 current assertions,256×128,32,768 calls,0 unexpected handler reverts; fixed second seed. Includes the max-seed handler unit.
- [coverage-1.txt](coverage-1.txt), [fmt-1.txt](fmt-1.txt), [sizes-1.txt](sizes-1.txt), [build-final-1.txt](build-final-1.txt): required coverage/format/production sizes and restored noninstrumented artifacts. Empty fmt output is expected with exit0.
- `slither*.json` and `slither*-1.txt`: full project and three deployable roots. All analyses succeeded with exit255/findings retained. Raw detector JSON is never overwritten by a rerun.
- [artifact-check.json](artifact-check.json): compiler/profile/runtime/initcode/legacy identity. [interface export](interface-export-1.txt), [check](interface-check-1.txt), [negative/decoding tests](interface-tests-1.txt): exact candidate ABI, no legacy integration writes.
- [preservation.json](preservation.json): latest derived report,202 protected files,4 refs, unchanged A–N/release/timer policies, exact old ABI subset/new additions and legacy runtime. Both [first](preservation-1.txt) and [second](preservation-2.txt) raw stdout are retained; the second regenerated the derived JSON with additional checks rather than retaining a separate first JSON snapshot.
- [economic-model.json](economic-model.json): **unapproved counterfactual**,144 combinations plus multi-challenger/exposure analysis; no punitive Solidity activation or security proof.
- [frontend test](frontend-test-1.txt), [typecheck](frontend-typecheck-1.txt), [build](frontend-build-1.txt) with corresponding `frontend-*-commands.json`:39 passes/tsc/build, original frontend sources unchanged.

## Reproduce locally

Use the pinned installed tools/dependencies. From root, `python3 scripts/verify-orakl-p0-3.py <step>` runs an explicit allowlisted command; see commands.json for exact argv and the wrapper for available steps. Required final order used after passing full suite:

```text
build
economics
remediation
invariant
invariant-intensive
coverage
fmt
sizes
slither
slither-factory
slither-config
slither-legacy
build-final
artifact-check
interface-export
interface-check
interface-tests
economic-model
preservation
```

`forge-test` runs the full suite; `security` runs the separated security directory. Fuzz default2,048 and strict invariant128×64 settings remain pinned; intensive step explicitly sets256/depth128/seed0x4f52414b4c503032. Run artifact-producing Foundry/Slither commands sequentially: Slither cleans/builds. Final force build restores noninstrumented artifacts before identity/export checks. Existing detector JSON is intentionally not overwritten; explicitly retain/rename it or use a clean checkout before repeating a scan. Repeated text attempts get new numbered files. Frontend steps can run concurrently only with distinct `--record-file <basename>.json` arguments.

For original vulnerabilities and failing-before regressions, use the exact 8d850ae/3518891 source in an isolated checkout rather than pretending current fixed code still supports old residual behavior. All relevant commits remain in history and protected baseline branch refs. No step signs, broadcasts, uses real funds, runs a live deployment or calls a public RPC. Keep approved deployment/activation ceremonies separate.
