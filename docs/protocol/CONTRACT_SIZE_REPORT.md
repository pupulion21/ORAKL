# P0.1 compiler and contract size report

P0.2 preserves production Solidity/compiler settings byte-for-byte. The [P0.2 artifact identity check](../testing/p0-2/artifact-check.json) and [verification report](../testing/P0_2_VERIFICATION_REPORT.md) revalidate these sizes; no new optimizer choice or modularization is introduced.

Code: `fc5b8be`. Offline compilation only; no deployment or activation.

The [EIP-170](https://eips.ethereum.org/EIPS/eip-170) runtime reference is 24,576 bytes; [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860) provides a 49,152-byte initcode reference. These are standard EVM engineering checks, **not evidence of the QIE Mainnet fork configuration or enforced limits**. QIE-specific verification remains blocked. The compiler still generates Paris-compatible bytecode.

## Reproducible measurements

Run `python3 scripts/benchmark-orakl-solc.py --label P0.1-fc5b8be --output docs/testing/p0-1/size-remediation.json` from the root. It uses installed pinned solc, standard-json, optimizer choices below, metadata hash none and source digests; it does not touch production source or Foundry artifacts. [Baseline input/results](../testing/p0-1/size-baseline.json), [final input/results](../testing/p0-1/size-remediation.json). Creation-code values in this table **exclude ABI constructor arguments**.

| Pipeline | P0 Factory runtime | P0.1 Factory runtime | P0.1 Config runtime | Factory initcode base |
| --- | --- | --- | --- | --- |
| off | 24,302 | 26,887 | 15,267 | 27,373 |
| runs-1 | 13,567 | 15,357 | 8,427 | 15,637 |
| runs-50 | 13,625 | 15,412 | 8,460 | 15,692 |
| runs-200 | 13,746 | 15,551 | 8,476 | 15,831 |
| runs-1000 | 14,284 | 16,255 | 8,927 | 16,535 |
| ir-200 | 11,176 | 12,855 | 7,324 | 13,103 |

## Selected compilation boundary

Optimizer on, **runs 50**, **viaIR false**, same solc `0.8.37+commit.f401782d`, Paris and bytecodeHash none. Foundry uses additional compiler profile `orakl` and file restrictions on Factory/Config roots; importing tests inherit those requirements. Default legacy remains optimizer off/runs 200. Actual artifact metadata is verified by `node scripts/check-orakl-artifacts.mjs docs/testing/p0-1/artifact-check.json`. No dependency upgrade, opcode-target change or external library link was adopted. [Foundry compiler profile documentation](https://getfoundry.sh/config/reference/solidity-compiler).

Runs 1 is slightly smaller; runs 200/1000 increase the Factory size. Runs 50 retains substantial margin using the existing non-IR pipeline. IR-200 is smaller but changes the compilation pipeline and would require separate review/equivalence validation; it was not selected. This is a measured size/code-generation decision, not a claim that gas costs are globally optimal.

| Selected artifact | Runtime | Runtime headroom | Constructor args | Initcode incl. args |
| --- | --- | --- | --- | --- |
| MarketFactory | 15,412 | 9,164 (37.29%) | 32 | 15,724 |
| ProtocolConfig | 8,460 | 16,116 (65.58%) | 384 | 11,756 |
| QiePredictionMarket | 13,906 | 10,670 (43.42%) | 0 | 13,945 |

v1 guards require runtime <=19,660 and initcode with static constructor arguments <=39,321, giving at least 20% headroom against the reference limits. Regression: `ProtocolConfigTest.testRuntimeWithinEIP170`. The offline checker also rejects wrong compiler/optimizer/IR/EVM settings, unexpected linked libraries and changed legacy runtime. New runtime hashes are **templates with immutable patches**; deployed addresses/chain fields must be independently verified after any separately approved deployment.

## Modularization comparison

The in-memory external pure-math-library candidate compiles successfully: Factory runtime **15,406** bytes, only **6 bytes** less than the selected 15,412; a separate **426-byte** library and two link references are added. It also adds linked-library `delegatecall`, deployment/code-verification dependencies and external-call overhead. This compilation-only candidate was not deployed, semantically tested or adopted. The production facade retains inlined pinned OZ Math and one custody ledger.

Separate pool/bond/resolver custody deployments would add cross-contract value forwarding and accounting/wiring failure surfaces; no such migration is justified by the measured margin. A read-only lens or a different custody split was not benchmarked or claimed implemented. Source modules remain independently organized while sharing one balance.

## Gas and remaining verification

[Local Foundry gas report](../testing/p0-1/gas-local.txt) covers control reads, emergency actions and transfers under test fixtures; warm/cold access and pranked wallets differ from production. It does not establish QIE Mainnet execution prices or wallet compatibility. Native decimals/symbol, actual chain limits/forks, cold genuine-wallet getter gas, reporter estimates, full creation/payout/dispute execution and explorer verification remain release blockers. The local-only construction rehearsal is a script fixture, not a production deployable financial component; it contains no broadcast/activation and is excluded from production size claims.
