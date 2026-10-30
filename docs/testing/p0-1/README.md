# P0.1 evidence index

Current source: `fc5b8be`. [Executed verification report](../P0_1_VERIFICATION_REPORT.md) owns current claims.

- `commands.json`: exact final argv, timestamps and exit codes; `forge-test.txt`, `invariant-seed-2.txt`, `coverage.txt`, `build*.txt`, `fmt.txt`, `gas-local.txt` are final outputs.
- `slither*.json`/text and `slither-summary.json`: final project and separate deployable-root analyses; exits 255 mean findings remain, not a clean pass.
- `artifact-check.json`, `foundry-config.json`, `preservation.json`: offline build identity/size/profile checks, sanitized test/compiler settings, immutable legacy/base-branch preservation.
- `size-baseline.json` / `size-remediation.json`: raw standard-json compiler measurements with source hashes; external library experiment exists only in memory and is unlinked/unadopted.
- `baseline-regressions.txt`: four deliberately failing tests against original P0. `return-bomb-before.txt` / `return-bomb-after.txt`: failing-before/passing-after last hardening regression.
- `pre-return-bound-*`: intermediate completed campaigns/scans before the last hardening change. `focused-tests.txt` preserves the initial 29-entry focused pass. These are historical, not final source claims.
- `frontend-*.txt`: preserved frontend regression commands; no v1 UI integration is claimed.

Text log formatting normalization, if applied, removes trailing whitespace/redundant blank EOF only; raw/normalized hashes are recorded in `log-formatting.json`. JSON detector output is retained unchanged. Synthetic mocks/Foundry pranks are local test evidence; there are no live transactions or real multisig-signature proofs.
