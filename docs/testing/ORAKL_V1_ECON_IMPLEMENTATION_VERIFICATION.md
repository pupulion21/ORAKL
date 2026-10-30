# Selected economics implementation verification

Status: **LOCAL IMPLEMENTATION COMPLETE**; **PROTOCOL FREEZE BLOCKED**. Base `release/orakl-v1-freeze-candidate` is exactly f3b35a1fb25bc08f2e5cd6c31addb6396c238181. The already-existing feature branch began at18b31ae (only the saved specification); no production divergence existed. Original root prompt/spec bytes are preserved. Production implementation commit99acc8f; final Solidity test sourceafebfe6. Later changes concern evidence/models/interface tests/docs only. No deployment, signing, broadcast, public transaction, production native amount or financial activation is authorized or performed. Foundry deployment/activation fixtures are local simulations only.

## Test-first evidence

The exact208-test P0.3 suite ran before source changes: [baseline](selected-economics/baseline-1.txt), exit0. Three tests committed at5692bf6 ran against the old root and failed (second bonded admission, reversal bond entitlement and exposure getter): [before](selected-economics/before-1.txt). They now run against SelectedMarketFactory and pass. Fixture amounts differ because selected ratios differ from old generic config; the entitlement expectation is P+C in both cases. A separate [isolated baseline PoC](../../scripts/reproduce-selected-exposure-before.py) exports exactf3b35a1 source from git without branch mutation and deliberately fails for actual third-market aggregate admission, uphold P+S allocation and inadequate proposal opportunity. [Actual failures](selected-economics/exposure-before-3.txt) are preserved and are not reported as implementation failures or fixes by documentation alone. Selected safety/matrix regressions exercise their corrected paths.

## Recorded commands and outcomes

All argv, working directory, explicit environment/seed, UTC start, duration, execution HEAD, exit and output SHA256 are in [commands.json](selected-economics/commands.json), [provenance commands](selected-economics/provenance-commands.json) and [extra commands](selected-economics/extra-commands.json). Reproduce using `python3 scripts/verify-orakl-selected.py STEP`, or the tracked [sequential campaign](../../scripts/run-selected-verification.py). Raw text/Slither JSON is retained without editing or suppressions. `--record-file` isolates independent ledgers; output filenames must also be unique. One attempt to reuse an existing output filename was refused before running a command; an explicit new step name retained both interface test outputs.

| Check | Result / raw evidence |
| --- | --- |
| force build | PASS [build](selected-economics/build-1.txt), restored noninstrumented [final build](selected-economics/build-final-1.txt) |
| full Foundry | **235 passed,0 failed,0 skipped;27 suites**, includes original208 and26 selected tests plus one grouped selected invariant entry; [output](selected-economics/forge-test-1.txt) |
| focused selected | **26 passed**, including nine results×four pool shapes,128 challengers, huge stake product, transfer rollback, getter faults, deadlines, exposure and explicit residual risks; [output](selected-economics/selected-3.txt) |
| focused security/economics/remediation | **39/18/30 passed**; original tests not rewritten; respective logs in evidence directory |
| standard current invariants | PASS,128×64 per handler, strict unexpected reverts; original16 A–P plus selected4, plus max-seed unit; [output](selected-economics/invariant-2.txt) |
| intensive invariants | PASS256×128 per handler,32,768 calls each (65,536 combined),0 unexpected reverts;3 grouped entries,487.921s; [output](selected-economics/invariant-intensive-1.txt) |
| coverage | PASS235 entries; selected root96/99 lines,19/26 branches; [output](selected-economics/coverage-1.txt) |
| local selected gas benchmark | PASS26 tests; [gas report](selected-economics/gas-selected-1.txt), local EVM diagnostic only, not Mainnet fee certification |
| format and sizes | PASS; [fmt](selected-economics/fmt-1.txt), [sizes](selected-economics/sizes-2.txt) |
| artifacts/profile/dependency/runtime | PASS; [artifact report](selected-economics/artifact-check.json), [preservation](selected-economics/preservation.json) |
| versioned ABI/source integrity | PASS exporter--write/--check;6 Node codec/tamper/stale-source/tuple/activation tests pass [latest](selected-economics/interface-tests-v2-1.txt) |
| legacy frontend | 39 tests PASS, typecheck PASS, build PASS; frontend source/manifest unchanged |
| independent integer rounding model | PASS32,760 cases; exact reward conservation, contiguous splitting identity and order effects; [model output](selected-economics/rounding-model-1.txt). This is not proof of economic Sybil resistance. |
| QIE-FORGE manifests and versions | PASS installed suite0.6.0-ecosystem.2; [skill integrity](selected-economics/skill-integrity-1.txt), [tool versions](selected-economics/tool-identity-1.txt). No live compatibility is inferred. |

Full-suite fuzz baseline remains2,048 cases/function, fixed seed0x4f52414b4c503031:13 original functions plus1 selected function =14×2,048. Full suite includes5 legacy +16 P0.3 +4 selected named invariant assertions =25, grouped by Foundry; never add25 to235 entries. Intensive uses seed0x4f52414b4c503032 and256/depth128 for each handler under test/invariant, not the separate legacy invariant file. Handler calls include early-return actions and bounded scenarios (selected8 actors/12 markets/2 arbiters); unit tests cover128 stakeholders separately. Mocks/pranks do not prove genuine Safe authorization or historical beneficial-control independence.

## Coverage, compiler and size

Combined six current protocol sources:496/505 lines (98.22%),716/733 statements (97.68%),101/115 branches (87.83%),77/81 functions (95.06%). Selected root alone96.97% lines/73.08% branches; coverage is a measurement, not independent audit or a claim every possible attack is modeled. Shared no-op hooks remain uncovered in some base profiles. Original P0.3 test source/assertions are byte-for-byte retained; selected policy has a separate ghost ledger because the old never-slashed-principal assertion correctly describes only the preserved old root.

Pinned solc0.8.37+f401782d,Paris,metadata bytecodeHash none,non-IR and optimizer50 remain. The only Foundry config change adds the selected root to the existing optimized profile; no dependency/compiler upgrade. Runtime/initcode including constructor arguments: **Selected19,084/20,400; preserved P0.3 root15,859/16,178; Config8,508/11,804; legacy13,906/13,945 bytes**. Selected fits the existing19,660/39,321 engineering ceilings, with5,492 bytes runtime margin to the standard EVM limit. These are not certified QIE limits. Runtime hashes are artifact templates with unpatched immutables, not deployed-instance verification. Legacy runtime keccak remains0x0d478010629faa5104f39d3e3ede0343f47ac2996affb676c7a6be6e499b256b.

## Static analysis retained and native-value triage

All five Slither analyses completed with success=true and exit255 because findings remain. Full project4 High/15 Low/4 Informational/2 Optimization; selected root1 High/10 Low/1 Informational; P0.3 root1 High/9 Low/1 Informational; Config0 High/1 Low/2 Informational/1 Optimization; legacy1 High/4 Low/1 Informational. Counts overlap across scopes. The extra Low is selected challenge timestamp admission, deliberately using exclusive D. Original timestamp assumptions remain.

The selected High is ProtocolStorage._send's generic native call. Participant claim/refund wrappers still use caller-owned positions, exactly-once marking, participant-only debit and checked send; fees retain governance/current-role checks and fee-only debit. Selected claimBond is the overridden reachable bond selector: terminal plus actual creator/proposer/tranche owner, immutable entitlement, once flag, valid owner-selected recipient, bond-only debit and outflow, shared nonReentrant and checked send. Failed callback rolls everything back; zero claims skip callback. Terminal hook allocates only disposition, never sends funds. New challenge intake receives exact msg.value into the bond ledger; prediction receives into participant/exposure accounting. No new external send sink or privilege seizure exists. The [selected review](../security/ORAKL_V1_MULTI_CHALLENGER_REVIEW.md) traces this path and keeps arbitrary-send-eth for independent audit. Legacy/P0.3 send paths remain in the [existing full triage](../audit/P0_3_STATIC_ANALYSIS_TRIAGE.md).

Full-project uninitialized-state matches remain incomplete abstract-unit reports; complete deployable roots include creation writers. Low-level-call/assembly and catchable bounded role checks remain retained. No detector is silently suppressed and no generic send is labeled harmless. Correct arbitration/truth, genuine signer independence, network gas/finality and evidence consideration are unresolved trust/operational assumptions.

## Handoff and release status

Selected ABI contains45 facade functions/17 events plus unchanged Config35/8. It is versioned separately, has null addresses and false deployment/financial authorization. Old P0.3 ABI is a preserved historical source snapshot, not a claim its old source digest matches newly added virtual hooks; consumers use the [selected migration delta](../migration/ORAKL_V1_SELECTED_INTERFACE_DELTA.md). Original legacy frontend ABI remains exact.

Owner authorization covers the local selected mechanics. Production denomination/Tcap/monitoring budget, genuine independently admitted3-of-5 Safe, evidence/indexer services, network compatibility, external audit, legal eligibility and release approval remain blocked. Fee F is not implemented. See [freeze matrix](../audit/ORAKL_V1_FREEZE_GATE_MATRIX.md), [selected decision](../decisions/ORAKL_V1_SELECTED_ECONOMICS.md) and [exposure invariants](../economics/ORAKL_V1_EXPOSURE_INVARIANTS.md). Passing residual biased-INVALID/thin-winner/coalition demonstrations leave those risks OPEN.

Final preservation verifies326 legacy/historical/test files, six prior refs and original A–P unchanged, plus exact dependency source hashes from the historical candidate manifest. No new production writes are required to reproduce this evidence. All raw output hashes are verified against their ledgers; a final evidence index lists each exit and duration.

Implementation commits:18b31ae saved governing specification;5692bf6 failing-before tests/design/recorder;99acc8f production selected root/hooks;afebfe6 selected ghost/adversary/tooling;863710e local decision/security/exposure boundaries; eefa23c selected ABI/rounding/codec evidence;6dd59ad generated Markdown normalization only. Final report/evidence commit contains this document.

Exposure before-PoC attempt3 explicitly sets the old per-market cap to the same100 synthetic units as the selected fixture, then admits100+100+1 under one arbitrator on the isolated baseline. Earlier generic-cap exploratory attempts remain retained. The selected after-test rejects that third admission using the same per-market tier; no production source or Solidity suite changed during this evidence refinement.
