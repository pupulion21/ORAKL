# Foundry test and security-tool report — ORAKL P0

Historical P0 snapshot at 7b8ac4e. Current remediation verification is in [P0.1 verification report](P0_1_VERIFICATION_REPORT.md); the results below are preserved, not current P0.1 claims.

Date: 2026-10-30. Branch: `refactor/orakl-protocol-v1`. Baseline: `b555a87`. Code under final verification: `8697cee` (subsequent closeout edits are documentation/evidence only). No live signing, transaction, deployment or activation was used. Tests simulate funding, multisig callers, activation, chain identity and forced transfers in the local Foundry VM; mocks are not real multisig implementations.

## Executed results

[Timestamped command/exit records](evidence/verification-commands.json). Commands ran sequentially from `contracts/` so Slither's clean/build could not race other artifact producers. Captured text outputs have trailing whitespace/redundant blank EOF removed; [raw/normalized hashes](evidence/log-formatting.json) record this formatting-only normalization. Detector JSON is unchanged.

| Command | Exit | Result / captured output |
| --- | --- | --- |
| `forge build` | 0 | Compiled; lint warnings remain documented below. [Output](evidence/forge-build.txt). |
| `forge test -vvv` | 0 | **120 passed, 0 failed, 0 skipped**, 11 suites. [Output](evidence/forge-test.txt). |
| `forge test --match-path 'test/invariant/*' -vvv` | 0 | All **10 P0 invariants A–J** passed, 64 runs × depth 32 = 2,048 handler actions, zero handler reverts. [Output](evidence/forge-invariant.txt). |
| `forge coverage` | 0 | 120 passed; coverage table below. [Output](evidence/forge-coverage.txt). |
| `forge fmt --check` | 0 | All new source/tests/scripts conform. Six untouched legacy source/test/helper files are explicitly ignored in foundry.toml to preserve history/artifact identity. [Output](evidence/forge-fmt.txt). |
| `forge build --sizes --skip test --skip script` | 0 | Facade/config fit standard EIP-170 runtime size. [Output](evidence/forge-sizes.txt). |
| `slither . --filter-paths 'test/\|lib/\|script/' --json …` | 255 | Analysis completed with findings, **not a clean pass**: 16 detector reports, triaged below. [Text](evidence/slither.txt), [JSON](evidence/slither.json). The actual filter argument uses unescaped `|` within shell quotes; see the command record. |

Toolchain: Foundry 1.8.1 (`982849d3140c01fd3b72905759581a132df7aa98`), Solidity `0.8.37+commit.f401782d`, EVM Paris, optimizer off, bytecodeHash none, vendored OpenZeppelin 5.4.0 unchanged. Slither 0.11.6. No dependency upgrade or new Solidity package was needed. Foundry fuzz runs=256; invariant runs=64, depth=32, fail_on_revert=false, default random seed. Reproduction uses the pinned toolchain/settings; individual random sequences can differ without a fixed seed.

The 120 reported entries comprise 60 legacy unit/fuzz functions, 53 new unit functions, four new fuzz functions, one multi-market integration test and two grouped invariant entries. Foundry groups each contract's invariant assertions into one reported test: **15 named invariant assertions** run in the full suite (five preserved legacy, ten new). Do not interpret 120 as 120 unit tests plus another 15 tests. Each of the six total fuzz functions ran 256 cases (four new, two legacy). The legacy handler also executed 64×32 actions in the full suite; raw tables are in forge-test.txt.

## Scope exercised

- Permissionless creation, immutable metadata/times/terms, sequential IDs, exact creation deposits, positive minimum/cap, invalid deadlines/URI/commitments and read-only unknown-market failures.
- Pre-activation and paused/deactivated rejection of every payable selector, including zero-value paths; wrong binding/chain/runtime release digest, independent compliance/governance authority, unauthorized emergency calls, parameter bounds and multisig shape/owner-set checks.
- YES/NO, repeated contributions, both sides by one wallet, uint128 total-cap boundary, zero/small amounts, variable participant counts 1–12, varied claim order and 0–1000-bps fee settings.
- Valid/premature/late proposals, evidence/bond validation, self-challenge/arbitrator exclusion, exact challenge/arbitration/finalization boundaries, unauthorized decisions, YES/NO/INVALID arbitration, zero-winner and empty pools, unproposed/unfinalized/disputed timeout fallback.
- Interrupted challenge windows cannot later finalize uncontested. Existing terminal claims and disputed arbitration remain usable during pause/deactivation; parameter changes cannot alter existing market economics or arbitrators.
- Proportional net-of-fee payouts, losing/no-position rejection, duplicate claim/refund/bond rejection, full refunds, zero-rounded entitlements and reserved dust.
- Every bond category returned without slashing after all terminal paths; fee/bond/participant isolation, unauthorized withdrawal/slashing selector rejection, checked native-transfer rollback and recipient redirection.
- Cross-function claim/refund/bond/fee reentrancy and actual selfdestruct forced balance. Independent ghost ledgers check solvency, conservation, positions, outcomes, payout/refund bounds and all liability categories. Seeded handler flows ensure the assertions also cover populated terminal markets before random actions.
- Local deployment rehearsal initializes unbound/unapproved/inactive and refuses a nonlocal chain ID in a local VM simulation. No production broadcast helper is enabled.

No database/indexer reconciliation or v1 frontend E2E is claimed: those services are outside P0 and not implemented.

## Coverage

Source-only P0 aggregate (five executable src modules): **303/305 lines = 99.34%**, **441/445 statements = 99.10%**, **67/71 branches = 94.37%**, **51/52 functions = 98.08%**. This aggregation excludes legacy contracts, mocks, handlers and script. Source interfaces/types have no independently executable body in this table.

| File | Lines | Statements | Branches | Functions |
| --- | --- | --- | --- | --- |
| src/MarketFactory.sol | 100.00% (25/25) | 97.62% (41/42) | 80.00% (4/5) | 100.00% (2/2) |
| src/MarketResolver.sol | 100.00% (62/62) | 98.92% (92/93) | 95.45% (21/22) | 100.00% (6/6) |
| src/PredictionPool.sol | 100.00% (71/71) | 98.88% (88/89) | 94.12% (16/17) | 100.00% (10/10) |
| src/ProtocolConfig.sol | 97.75% (87/89) | 99.36% (156/157) | 94.74% (18/19) | 93.75% (15/16) |
| src/ProtocolStorage.sol | 100.00% (58/58) | 100.00% (64/64) | 100.00% (8/8) | 100.00% (18/18) |
| script/DeployInactive.s.sol | 100.00% (4/4) | 100.00% (4/4) | 100.00% (1/1) | 100.00% (1/1) |
| Preserved legacy QiePredictionMarket.sol | 87.50% (133/152) | 84.97% (164/193) | 86.67% (39/45) | 89.29% (25/28) |

The tool's overall total, **89.63% lines / 89.96% statements / 80.63% branches / 86.59% functions**, also includes test helpers/doubles/handlers and is not the production-source aggregate. Remaining coverage gaps and larger state spaces remain review targets; line coverage and bounded randomized invariants are not formal correctness proofs.

## Static analysis and review disposition

Slither completed 102 detectors over 13 contracts and returned 16 reports: **2 High arbitrary-send-eth**, **11 Low timestamp**, **3 Informational low-level-calls**. High reports identify the new and legacy native transfer helpers. They are reviewed expected pull-payment paths: owner-controlled entitlements or governance's capped accrued-fee withdrawal, validated recipients, ledger effects before send, shared reentrancy guard, rollback on failure. No unrestricted public transfer helper exists. The report preserves both High labels; classification as intended behavior is this engineering review's conclusion and must be independently checked.

Timestamp reports correspond to explicit market deadlines, not randomness; residual validator time discretion is documented. Low-level calls are checked sends and a binding staticcall. Three initial missing-zero-check reports were removed by explicit pre-assignment constructor validation. [Initial tool findings](evidence/slither-initial.json) remain available. An earlier parallel build/Slither attempt failed to read build-info; sequential execution resolved it without upgrading tooling. No analyzer installation or dependency mutation was performed.

Foundry's build lint output includes timestamp/typecast/low-level-transfer and test/helper style notices. They were reviewed against bounded uint128 deposits, max-resolution-checked uint64 deadlines, CEI/nonReentrant and purposeful owner-directed transfers. Existing vendor/legacy code was not cosmetically rewritten or blanket-suppressed. No claim of zero automated warnings, independent audit completion or production readiness is made.

## Legacy and frontend regression evidence

The baseline [61-entry run](evidence/baseline-foundry.txt) passed before source changes. [Preservation checks](evidence/legacy-preservation.json) confirm legacy source, original tests/helpers/doubles, vendored dependencies, ABI/artifacts, generated frontend integration, scripts and original deployment JSON remain unchanged from b555a87. Only foundry.toml's formatter ignore list was appended; build settings are unchanged.

[Runtime identity](evidence/legacy-runtime-identity.json): rebuilt legacy runtime keccak256 exactly equals the bundled public Testnet manifest: `0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b`. This is a local artifact comparison, not a new live deployment verification.

Executed from repository root: `npm run typecheck`, `npm test` (**39/39**), `npm run build` all exited 0. [Typecheck](evidence/frontend-typecheck.txt), [tests](evidence/frontend-test.txt), [build](evidence/frontend-build.txt). No UI source was changed, and these results do not validate an unimplemented v1 adapter. The [final heuristic secret scan](evidence/final-secrets-scan.json) found no pattern matches or tracked secret paths; this is not an exhaustive secret audit.

## Remaining work before a financial release

Independent audit/remediation, final bond/slashing/incentive policy, production economic settings, verified role deployments/control, Mainnet native-unit/configuration/compatibility and gas/explorer checks, legal authorization/eligibility, residual-funds policy and operational services remain outstanding. The facade is 24,302 runtime bytes (274 below EIP-170); config is 11,717. This margin is narrow and new features require a build-size/security review. Mainnet readiness is [BLOCKED](../deployment/QIE_MAINNET_READINESS.md).

## Local commits

| Commit | Change |
| --- | --- |
| `76e1a0e` | Mandatory initial audit before protocol changes. |
| `50ee391` | Financial gate, modular facade/config and isolated ledgers. |
| `0d6e507` | Initial unit coverage for gates, creation, pools and resolution. |
| `d73ab7b` | Interrupted-proposal protection, native payout sharing, size guard and formatting of new code. |
| `78d0025` | Adversarial, multisig/configuration, local deployment, fuzz, invariant and integration tests. |
| `8697cee` | Adopt full PRD and archive superseded specifications/evidence. |

Documentation/evidence closeout commits follow this table; inspect `git log` for their SHAs. Nothing was pushed and no pull request was opened for this branch.
