# P0.1 verification report

Date: 2026-10-30. Baseline: `7b8ac4e`; final production source: `fc5b8be`. Branch: `remediation/orakl-p0-1`. Full source audit and decision boundaries: [security review](../audit/P0_1_SECURITY_REVIEW.md). No live deployment, transaction, signing or real-value activation; approvals/funding/caller identity are simulated locally with Foundry. Wallet mocks are not genuine signature-verifying multisigs.

## Executed commands and results

[Exact argv, timestamps and exit codes](p0-1/commands.json), [sanitized resolved config](p0-1/foundry-config.json). Toolchain remains Foundry 1.8.1 (`982849d3140c01fd3b72905759581a132df7aa98`), solc `0.8.37+commit.f401782d`, Paris; OpenZeppelin 5.4.0 subset unchanged. v1 compilation uses optimizer on/runs 50/viaIR false; legacy remains optimizer off/runs 200.

| Command / scope | Result | Evidence |
| --- | --- | --- |
| `forge build` and final `forge build --force` | Exit 0. | [build](p0-1/build.txt), [restored final build](p0-1/build-final.txt) |
| `forge test -vvv` | **150 passed, 0 failed, 0 skipped**, 16 suites. | [Full output](p0-1/forge-test.txt) |
| `forge test --match-path 'test/invariant/*' --fuzz-seed 0x4f52414b4c503032 -vvv` | Exit 0; all 12 current invariant assertions passed, 8,192 handler calls, zero unexpected reverts. | [Second seed](p0-1/invariant-seed-2.txt) |
| `forge coverage` | Exit 0; 150 passed; standard command succeeded, no fallback IR command needed. | [Coverage](p0-1/coverage.txt) |
| `forge fmt --check` | Exit 0; all new code formatted. Six original legacy files remain intentionally excluded to preserve their source/artifact identity. | [Formatter](p0-1/fmt.txt) |
| `forge test --match-path 'test/remediation/*' --gas-report` | Exit 0; 30 focused remediation entries passed. Fixture gas measurements are local, not QIE benchmarks. | [Gas report](p0-1/gas-local.txt) |
| `slither . …` plus three explicit deployable-root scans | Analysis completed, findings retained, exits 255. Detailed triage includes both native-send High matches and two abstract-unit High project matches. | [Triage](../audit/P0_1_STATIC_ANALYSIS_TRIAGE.md), [summary](p0-1/slither-summary.json) |
| `node scripts/check-orakl-artifacts.mjs …` | PASS: selected profiles, standard engineering size margins, no external library links, legacy runtime identity. | [Artifact results](p0-1/artifact-check.json) |
| Root `npm run typecheck`, `npm test`, `npm run build` | All exit 0; **39 frontend tests** passed; source unchanged. | [Typecheck](p0-1/frontend-typecheck.txt), [tests](p0-1/frontend-test.txt), [build](p0-1/frontend-build.txt) |

The 150 Foundry entries include 60 original legacy unit/fuzz functions, 53 P0 unit functions (updated where the safety behavior intentionally changed), four P0 fuzz functions, one integration test, two grouped invariant entries and 30 remediation entries. **17 named invariant assertions** run in the full suite: five legacy and twelve current. Foundry groups each contract's invariant assertions into one reported entry; do not count them twice.

## Expanded reproducible campaigns

Primary seed `0x4f52414b4c503031` is pinned in foundry.toml. **Eight fuzz functions × 2,048 cases**, increased from the prior 256 runs. Both invariant handlers run **128 sequences × depth 64 = 8,192 actions per handler**, increased from 64×32. `fail_on_revert=true` now fails unexpected handler reverts. A second explicitly recorded seed `0x4f52414b4c503032` repeats the current invariant handler with the same intensity. There is no live chain fork dependency. Wall time/gas summaries can vary by host/tool scheduling; reproduce the toolchain, source, arguments, config and seed rather than expecting byte-identical timings.

The current handler uses eight actors (including a rejecting native receiver), up to 24 markets, independent contribution/bond/fee histories, independent epoch/first-interruption ghost state, emergency cancellation, early cancellation attempts, quarantined-write attempts, unauthorized resume attempts, repeated pauses/config changes, zero/variable bonds, forced balance, random outcomes and caller/claim ordering. Seeded populated terminal cases prevent empty-state-only assertions. New K verifies release/epoch authorization; L verifies immutable first-interruption refund timing. Other adversarial cases use real callback receivers/module forwarders in unit tests; `vm.prank` models role and actor identity, not real multisig cryptographic security.

The intentional residual test `testHiddenModulesGuardsAndImplementationCanEvadeViewFingerprint_RESIDUAL` **passes by demonstrating an admitted lying wallet can still act through a hidden module**. It is evidence of a production role-admission blocker, not proof that the risk is fixed.

## Failing-before / passing-after evidence

- Four regressions in `P0_1Regression.t.sol` failed against unmodified P0: [baseline](p0-1/baseline-regressions.txt). They now pass in the final full run: guardian override requires fresh independent review; interrupted proposal refund is bounded; mutated observable governance/arbitrator control fails closed. Reproduce baseline using source `7b8ac4e` plus the regression file from `e1b9b9f`, retaining baseline helpers.
- The oversized wallet return regression failed before bounded copying on P0.1 source `7347819`: [before](p0-1/return-bomb-before.txt). It passes at `fc5b8be`: [after](p0-1/return-bomb-after.txt), with full-suite and gas-starvation fuzz coverage. This is a controlled-failure/gas-grief hardening finding, not a demonstrated theft exploit.
- `pre-return-bound-*` files preserve intermediate analysis/campaigns before that last hardening change; `focused-tests.txt` is the initial 29-entry focused run. They are historical evidence and do not supersede the final commands above.

## Source coverage

Five executable current v1 source modules aggregate to **384/387 lines (99.22%)**, **554/564 statements (98.23%)**, **78/86 branches (90.70%)**, **64/65 functions (98.46%)**. Interfaces/types have no executable body. This excludes legacy, script fixtures, test helpers and handlers.

| Current v1 file | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| MarketFactory.sol | 100.00% (27/27) | 97.73% (43/44) | 80.00% (4/5) | 100.00% (2/2) |
| MarketResolver.sol | 100.00% (81/81) | 99.19% (123/124) | 96.15% (25/26) | 100.00% (8/8) |
| PredictionPool.sol | 100.00% (73/73) | 98.90% (90/91) | 94.12% (16/17) | 100.00% (10/10) |
| ProtocolConfig.sol | 97.95% (143/146) | 97.48% (232/238) | 86.21% (25/29) | 96.15% (25/26) |
| ProtocolStorage.sol | 100.00% (60/60) | 98.51% (66/67) | 88.89% (8/9) | 100.00% (19/19) |

Overall tool totals **90.82% lines / 90.73% statements / 79.74% branches / 88.21% functions** include legacy and helper/double/handler code. Legacy source remains 87.50% line coverage. Coverage emits its standard optimizer/IR instrumentation warning; final artifacts are rebuilt afterward and independently checked for the selected production profiles. Coverage is not evidence of actual QIE code/gas/fork compatibility or formal correctness.

## Preservation and release limits

[Preservation evidence](p0-1/preservation.json) confirms the legacy source, original tests/helpers/doubles, vendored dependencies/licenses, ABI/generated frontend, frontend package/source/assets, old ABI generator, root dependencies and original deployment record are unchanged from P0. The rebuilt legacy runtime still matches `0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b`. Main and base refactor branch refs are unchanged. [Compiler size report](../protocol/CONTRACT_SIZE_REPORT.md): facade runtime 15,412 bytes; config 8,460, with >20% margin against standard EVM references. Actual QIE limits and deployment/gas behavior remain unverified.

Policy approval is still required for slashing/rewards and their amounts, zero-bond/exposure handling, emergency-abort trust and genuine multisig execution/control admission. Independent audit, Mainnet compatibility, legal authorization and operational services remain outstanding. No production readiness or approval is implied by successful tests.
