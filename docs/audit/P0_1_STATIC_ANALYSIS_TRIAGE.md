# P0.1 Slither findings and triage

Code: `fc5b8be`; Slither 0.11.6, solc 0.8.37. All analyses completed (`analysisSuccess=true`) and exited 255 because detector findings remain. No detector was blanket-suppressed. Tests/scripts/vendor paths were excluded from production reports. [Exact argv/timestamps/exit codes](../testing/p0-1/commands.json), [machine-readable summary](../testing/p0-1/slither-summary.json).

| Scope | High | Low | Informational | Optimization |
| --- | --- | --- | --- | --- |
| Foundry whole-project multi-profile scan | 4 | 13 | 4 | 2 |
| Actual MarketFactory inheritance root, optimizer on/runs 50/Paris | 1 | 8 | 1 | 0 |
| Actual ProtocolConfig root, optimizer on/runs 50/Paris | 0 | 1 | 2 | 1 |
| Legacy QiePredictionMarket root, optimizer off/Paris | 1 | 4 | 1 | 0 |

Raw JSON/text: [project](../testing/p0-1/slither.json), [Factory](../testing/p0-1/slither-factory.json), [Config](../testing/p0-1/slither-config.json), [legacy](../testing/p0-1/slither-legacy.json). Root scans use `--compile-force-framework solc` and the exact compiler args/remapping in commands.json, so the deployable inheritance graph is analyzed without the extra incomplete default-profile compilation unit.

## High: arbitrary-send-eth (both send helpers)

`ProtocolStorage._send:130` and `QiePredictionMarket._sendNative:463` retain the High detector labels in both project and deployable-root scans. Every public caller, caller-owned entitlement, amount formula, pre-send liability debit and recipient check is traced in [P0_1_VALUE_FLOW_REVIEW.md](P0_1_VALUE_FLOW_REVIEW.md). That inventory covers all six v1 and four legacy withdrawal entries. The helper is internal/private with no external selector, CEI precedes the checked call and withdrawal entries share storage-based reentrancy protection. New owner/redirect/reject/fee-isolation and legacy cross-market regressions plus stateful conservation assertions support the review.

Disposition: no unrestricted participant/bond withdrawal path found through the current call graph under its stated role assumptions; **not a claim that a High label is inherently harmless or an external audit has cleared it**. Wrong outcome adjudication and malicious admitted wallet execution remain separate release blockers.

## High: uninitialized-state in an incomplete abstract compilation unit

The project scan additionally reports `ProtocolStorage.marketCount:25` and `_markets:35` as never initialized, plus a related Optimization suggestion to make marketCount constant. These do not appear in the full Factory root scan. The default optimizer-off compilation unit contains the abstract storage base without its restricted optimizer-on Factory root. Both `ProtocolStorage.json` and `ProtocolStorage.orakl.json` contain zero creation bytecode: the abstract base is not deployable.

Actual write path is `MarketFactory.createMarket:45-56`: `id = marketCount++`, `_markets[id]` storage reference, immutable metadata/deadlines/terms and control snapshots. Before creation, `_market(id)` rejects every id because marketCount is zero. After valid creation, the requested id is populated atomically; failed role reads/deposits revert the complete creation. Unique-ID/commitment creation tests and independent invariant pool/position histories execute these writes.

Disposition: incomplete-compilation-unit matches for this project, supported by exact write-path analysis and the separate full-inheritance scan. Do not make a mutable counter constant or seed dummy markets to silence an analyzer. The raw High reports remain available.

## Low: wallet return bomb — hardened with a failing-before/passing-after test

Initial P0.1 analysis reported `_walletState` allocating/copying returndata before validating its length despite a call-gas cap. It did not demonstrate fund theft; it could exhaust a tight caller budget instead of producing the intended controlled rejection. The new `testOversizedReturnRejectedWithinBoundedCallerBudget` failed on that implementation and passes after `_boundedWalletRead` uses fixed-size output buffers and validates `returndatasize` before decoding. Owners are capped at 1,088 bytes and threshold at 32; staticcall output copies at most the preallocated maximum. `mstore(data,size)` is used only after `size <= maxReturn`. Input and output accesses remain within allocated memory.

The return-bomb detector no longer reports this path in final scans. [Before](../testing/p0-1/return-bomb-before.txt), [after](../testing/p0-1/return-bomb-after.txt). Additional malformed/oversized/reverting/gas-burning getter tests, 32-owner budget tests and gas-starvation fuzzing remain in the full suite. Gas stipends and review of genuine wallet code still need QIE operational validation.

## Other findings

The 13 root-scan Low reports are timestamp checks for deliberate market/review deadlines, not randomness. Boundary tests cover exact challenge/arbitration/review/cancellation endpoints; validators still have network timestamp discretion. Four Informational reports cover checked native sends, the value-free factory binding probe and bounded wallet staticcall. Config's Optimization `var-read-using-this` is intentional: the external self-staticcall provides a bounded, catchable complete role-validation frame for permissionless drift reporting. Inlining it would lose that failure boundary. The reporter enforces sufficient caller gas before executing the full budget, and regression/fuzz tests reject manufactured drift through gas starvation.

Not all warnings are vulnerabilities, and absence of a detector match is not proof of safety. The economic, wallet-authenticity, emergency-abort trust and Mainnet compatibility blockers in the main review remain open.
