# ORAKL v1 freeze-candidate verification

This is local engineering evidence, not approval of economics, trusted arbitration, an independent audit, a protocol freeze or Mainnet financial operation. Baseline and executed production source: `9e256c1451d666889f9f248edee3e2e2d61f6d48` on `release/orakl-v1-freeze-candidate`. No production Solidity or existing Foundry tests changed during the recorded baseline runs.

Exact argv, working directory, UTC start, elapsed time, source HEAD, explicit overrides, exit code and output SHA-256 are in [commands.json](orakl-v1-candidate/commands.json), [extra commands](orakl-v1-candidate/extra-commands.json) and [network preflight command](orakl-v1-candidate/network-live-command.json). Uncommitted documentation and new offline model scripts were present; the Solidity source, existing tests, and Foundry settings were unchanged from baseline. [Runner](orakl-v1-candidate/runner.py) imports the existing P0.3 recorder with a new evidence directory; raw output is retained without editing. See [tool versions](orakl-v1-candidate/tool-versions.json) and [QIE-FORGE provenance](../qie/QIE_FORGE_EXECUTION_EVIDENCE.md).

| Check | Actual result | Raw output |
| --- | --- | --- |
| `forge build --force` | PASS | [build](orakl-v1-candidate/build-1.txt) |
| `forge test -vvv` | **208 passed, 0 failed, 0 skipped**, 22 suites | [full suite](orakl-v1-candidate/forge-test-1.txt) |
| `forge test --match-path 'test/security/*' -vvv` | 39 passed | [security](orakl-v1-candidate/security-1.txt) |
| `forge test --match-path 'test/economics/*' -vvv` | 18 passed | [economics](orakl-v1-candidate/economics-1.txt) |
| `forge test --match-path 'test/remediation/*' -vvv` | 30 passed | [remediation](orakl-v1-candidate/remediation-1.txt) |
| `forge test --match-path 'test/invariant/*' -vvv` | 2 grouped entries pass; 16 current assertions, 128 runs × depth 64, plus boundary unit | [invariants](orakl-v1-candidate/invariant-1.txt) |
| Intensive invariant | **PASS**: 256 runs × depth 128 = 32,768 handler calls, zero unexpected reverts; 16 A–P assertions plus the boundary unit; 520.772 s process time | [output](orakl-v1-candidate/invariant-intensive-1.txt) |
| `forge coverage` | PASS; v1 source totals 395/398 lines (99.25%), 82/89 branches (92.13%), 571/580 statements, 67/68 functions | [coverage](orakl-v1-candidate/coverage-1.txt) |
| `forge fmt --check`; `forge build --sizes --skip test --skip script` | PASS | [format](orakl-v1-candidate/fmt-1.txt), [sizes](orakl-v1-candidate/sizes-1.txt) |
| Local security-suite gas report | PASS, 39 tests; diagnostic local gas only | [report](orakl-v1-candidate/gas-security-1.txt), [command](orakl-v1-candidate/gas-command.json) |
| Post-coverage `forge build --force`; artifact identity | PASS | [build](orakl-v1-candidate/build-final-1.txt), [artifact](orakl-v1-candidate/artifact-check.json) |
| Candidate ABI `--check` and Node interface tests | PASS, 4 tests; candidate remains unfrozen | [check](orakl-v1-candidate/interface-check-1.txt), [tests](orakl-v1-candidate/interface-tests-1.txt) |
| Frontend `npm test`, `npm run typecheck`, `npm run build` | PASS; 39 frontend tests | [tests](orakl-v1-candidate/frontend-test-1.txt), [typecheck](orakl-v1-candidate/frontend-typecheck-1.txt), [build](orakl-v1-candidate/frontend-build-1.txt) |
| Evidence vectors and counterfactual economic model | PASS, narrow test scope; no economic authorization or real-world accuracy proof | [vectors](orakl-v1-candidate/evidence-vectors-1.txt), [model](orakl-v1-candidate/economic-model-v1-1.txt) |
| Independent release preservation check | PASS: 312 protected files vs baseline and working tree, five protected refs, unchanged Solidity/tests/config/frontend, legacy runtime hash | [check](orakl-v1-candidate/preservation-v1-1.txt), [command](orakl-v1-candidate/preservation-command.json), [hashes](orakl-v1-candidate/preservation-hashes.json) |

Fuzz baseline: 13 functions × 2,048 runs, seed `0x4f52414b4c503031`. The full suite includes 16 current A–P and 5 legacy named invariant assertions, grouped by Foundry; these are not additional test entries. Standard invariants use `fail_on_revert=true`. Intensive seed `0x4f52414b4c503032`, `FOUNDRY_INVARIANT_RUNS=256`, `FOUNDRY_INVARIANT_DEPTH=128`. Handler calls include legitimate early-return actions, so the reported call count is not a count of complete trades. Existing accounting and security assertions are not weakened by an unmodified test source.

## Static analysis and artifact sizes

Slither 0.11.6 completed all four analyses with JSON `success=true` but **exit 255 because findings exist**. Full project: 4 High, 14 Low, 4 Informational, 2 Optimization. Factory root: 1 High, 9 Low, 1 Informational. Config root: 0 High, 1 Low, 2 Informational, 1 Optimization. Legacy root: 1 High, 4 Low, 1 Informational. Overlapping scopes must not be summed as unique vulnerabilities. [Full raw output](orakl-v1-candidate/slither-1.txt), [Factory](orakl-v1-candidate/slither-factory-1.txt), [Config](orakl-v1-candidate/slither-config-1.txt), [legacy](orakl-v1-candidate/slither-legacy-1.txt); JSON is alongside each log. The existing [transfer path and detector triage](../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md) traces ten outgoing entries and retains the two native-send High findings for independent review. Analyzer success is not an audit or a clean security finding.

Factory runtime/initcode including constructor arguments: **15,860 / 16,179 bytes**; Config **8,508 / 11,804 bytes**; preserved legacy runtime 13,906 bytes, keccak `0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b`. The artifact checker verifies standard EVM reference limits with the existing engineering margin, compiler profiles and hashes. QIE-specific limits and opcode support remain unverified. New v1 runtime hashes are unpatched templates and do not prove the identity of any deployed immutable-patched instance.

## Scope and limitations

Recorded vector check covers two bounded ASCII fixtures and does not establish complete JSON Canonicalization Scheme conformance. The model is counterfactual, uses hypothetical integer units, and makes no proof that detection incentives, arbitrator behavior or unbounded external payoffs are safe. Live Mainnet preflight merely observed the chain ID and block header; no write, signer, native denomination, gas, fork behavior, wallet compatibility, event history or finality was certified. The P0.3 residual attack demonstrations remain open where stated in the [freeze readiness report](../audit/P0_3_PROTOCOL_FREEZE_READINESS.md).

At execution the vector-check source SHA-256 was `bae339ff8e4e943f3e70d0a48754fce994c169ee9c6a05a6df1c1c823da2eb64`; the economic model source SHA-256 was `005f84797d764878199ca43cdc40a648fedd0fba14d8a70fde615b868e0c9f15`. These files were newly authored and uncommitted at that time; the recorded baseline HEAD alone does not identify them.
