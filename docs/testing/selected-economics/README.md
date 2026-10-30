# Selected economics execution evidence

Exact stdout/stderr bytes and analyzer JSON are retained. Regenerate outputs only through allowlisted scripts; the recorder refuses overwrite. Expected before-policy failures and Slither findings are not clean successes. No signing, broadcast or deployment command exists here.

| Step / attempt | Exit | Seconds | Output |
| --- | --- | --- | --- |
| baseline / 1 | 0 | 108.723 | [baseline-1.txt](baseline-1.txt) |
| before / 1 | 1 | 1.132 | [before-1.txt](before-1.txt) |
| selected / 1 | 0 | 2.575 | [selected-1.txt](selected-1.txt) |
| selected / 2 | 0 | 2.854 | [selected-2.txt](selected-2.txt) |
| invariant / 1 | 0 | 105.902 | [invariant-1.txt](invariant-1.txt) |
| selected / 3 | 0 | 1.906 | [selected-3.txt](selected-3.txt) |
| build / 1 | 0 | 11.254 | [build-1.txt](build-1.txt) |
| sizes / 1 | 0 | 0.171 | [sizes-1.txt](sizes-1.txt) |
| artifact-check / 1 | 0 | 0.331 | [artifact-check-1.txt](artifact-check-1.txt) |
| forge-test / 1 | 0 | 109.494 | [forge-test-1.txt](forge-test-1.txt) |
| security / 1 | 0 | 2.472 | [security-1.txt](security-1.txt) |
| economics / 1 | 0 | 2.149 | [economics-1.txt](economics-1.txt) |
| remediation / 1 | 0 | 0.811 | [remediation-1.txt](remediation-1.txt) |
| invariant / 2 | 0 | 102.965 | [invariant-2.txt](invariant-2.txt) |
| coverage / 1 | 0 | 155.493 | [coverage-1.txt](coverage-1.txt) |
| fmt / 1 | 0 | 0.039 | [fmt-1.txt](fmt-1.txt) |
| sizes / 2 | 0 | 0.188 | [sizes-2.txt](sizes-2.txt) |
| slither / 1 | 255 | 6.754 | [slither-1.txt](slither-1.txt) |
| slither-selected / 1 | 255 | 3.206 | [slither-selected-1.txt](slither-selected-1.txt) |
| slither-factory / 1 | 255 | 2.216 | [slither-factory-1.txt](slither-factory-1.txt) |
| slither-config / 1 | 255 | 0.833 | [slither-config-1.txt](slither-config-1.txt) |
| slither-legacy / 1 | 255 | 1.493 | [slither-legacy-1.txt](slither-legacy-1.txt) |
| build-final / 1 | 0 | 11.25 | [build-final-1.txt](build-final-1.txt) |
| artifact-check / 2 | 0 | 0.393 | [artifact-check-2.txt](artifact-check-2.txt) |
| interface-export / 1 | 0 | 0.337 | [interface-export-1.txt](interface-export-1.txt) |
| interface-check / 1 | 0 | 0.36 | [interface-check-1.txt](interface-check-1.txt) |
| interface-tests / 1 | 0 | 1.459 | [interface-tests-1.txt](interface-tests-1.txt) |
| frontend-test / 1 | 0 | 0.93 | [frontend-test-1.txt](frontend-test-1.txt) |
| frontend-typecheck / 1 | 0 | 5.557 | [frontend-typecheck-1.txt](frontend-typecheck-1.txt) |
| frontend-build / 1 | 0 | 2.791 | [frontend-build-1.txt](frontend-build-1.txt) |
| invariant-intensive / 1 | 0 | 487.921 | [invariant-intensive-1.txt](invariant-intensive-1.txt) |
| gas-selected / 1 | 0 | 1.339 | [gas-selected-1.txt](gas-selected-1.txt) |
| skill-integrity / 1 | 0 | 0.061 | [skill-integrity-1.txt](skill-integrity-1.txt) |
| preservation / 1 | 0 | 1.355 | [preservation-1.txt](preservation-1.txt) |
| exposure-before / 1 | 1 | 1.361 | [exposure-before-1.txt](exposure-before-1.txt) |
| exposure-before / 2 | 1 | 1.395 | [exposure-before-2.txt](exposure-before-2.txt) |
| tool-identity / 1 | 0 | 1.236 | [tool-identity-1.txt](tool-identity-1.txt) |
| preservation / 2 | 0 | 1.243 | [preservation-2.txt](preservation-2.txt) |
| preservation / 3 | 0 | 1.281 | [preservation-3.txt](preservation-3.txt) |
| interface-tests-v2 / 1 | 0 | 1.617 | [interface-tests-v2-1.txt](interface-tests-v2-1.txt) |
| rounding-model / 1 | 0 | 0.257 | [rounding-model-1.txt](rounding-model-1.txt) |
| selected-export-final / 1 | 0 | 0.355 | [selected-export-final-1.txt](selected-export-final-1.txt) |
| selected-interface-final / 1 | 0 | 0.391 | [selected-interface-final-1.txt](selected-interface-final-1.txt) |
| interface-tests-v2 / 2 | 0 | 1.672 | [interface-tests-v2-2.txt](interface-tests-v2-2.txt) |

All 44 registered output SHA256 values were recomputed and matched. Commands include actual execution HEAD; production source is99acc8f and final Solidity testsafebfe6, with later docs/tooling changes. `preservation.json` and `artifact-check.json` are latest derived reports; prior exact command stdout remains. Earlier snapshots are preserved under their original evidence paths.
