# ORAKL

**Predict What's Next. Own Your Conviction.**

ORAKL targets a native-QIE binary pari-mutuel prediction market with optimistic resolution on QIE Mainnet. The authoritative product reference is the [user-supplied PRD v1.0](docs/product/ORAKL-PRD-v1.0.md), dated October 30, 2026, status **Draft — Engineering Specification**. Its open decisions remain open until explicitly approved.

## Implementation status

Two implementations coexist:

- **Legacy Testnet prototype:** the functioning English Vite/TypeScript/viem frontend and `contracts/src/QiePredictionMarket.sol`, using manual trusted resolution. Its [public manifest](frontend/public/deployments/qie-testnet.json) and [actual deployment history](results/deployment/README.md) are preserved. Contract: `0x43A666a9a305232E6a10fae8507d67EF64F02C98`, chain 1983.
- **ORAKL P0.2 review baseline:** modular Solidity retains all P0.1 security controls and full-return bonds, with additional economic/adversarial Foundry tests and a candidate P1 ABI. Financial entry points initialize disabled; the frontend is not migrated to the new ABI. No Mainnet deployment or activation was performed. These changes do not complete the PRD's backend, indexer, metadata service or eligibility requirements.

[Initial repository audit](docs/audit/INITIAL_REPOSITORY_AUDIT.md) · [Architecture](docs/protocol/ARCHITECTURE.md) · [State machine](docs/protocol/STATE_MACHINE.md) · [Accounting](docs/protocol/ACCOUNTING_INVARIANTS.md) · [Bonds](docs/protocol/BOND_ECONOMICS.md) · [Resolution](docs/protocol/RESOLUTION.md) · [Threat model](docs/security/THREAT_MODEL.md) · [Frontend migration](docs/migration/FRONTEND_ABI_MIGRATION.md) · [Mainnet readiness](docs/deployment/QIE_MAINNET_READINESS.md) · [Current executed tests](docs/testing/P0_2_VERIFICATION_REPORT.md).

Earlier specifications and UI delivery reports are [archived](docs/archive/README.md). They are not current product requirements. Third-party licenses and live deployment history remain in place.

## Run the existing frontend

Use Node.js 24 and npm:

```sh
npm ci
npm --prefix frontend ci
npm run dev
```

Open http://localhost:5176/. Build output is `frontend/dist`. This UI continues to use the verified legacy QIE Testnet contract. Consumer connection information is at `#/network`; maintenance tools are at `#/developer`. Those tools do not deploy or activate ORAKL v1.

```sh
npm run typecheck
npm test
npm run build
```

## Check contracts locally

Use the existing pinned Foundry/Solidity dependencies in `contracts/foundry.toml`:

```sh
cd contracts
forge build
forge test -vvv
forge test --match-path 'test/invariant/*' -vvv
forge coverage
forge fmt --check
```

Legacy tests remain part of the full suite. Formatting ignores only untouched legacy files to preserve their artifact/source identity. The new deployment rehearsal is local-chain-only and constructs unbound, unapproved, inactive contracts; it has no broadcast or activation call.

Passing local checks is not an independent security audit or authorization for a real-value launch. Mainnet configuration and remaining release gates are tracked in the readiness document.

P0.1 adds [reviewed emergency recovery](docs/security/EMERGENCY_RECOVERY.md), [security findings](docs/audit/P0_1_SECURITY_REVIEW.md), a [bond policy awaiting approval](docs/protocol/BOND_POLICY_PROPOSAL.md) and [migration impact](docs/migration/P0_1_MIGRATION_IMPACT.md). The v1 compiler roots select an optimized additional profile; legacy compiler identity is preserved. Production economics, role verification and financial launch remain blocked.

P0.2 supplies the [economic decision](docs/protocol/P0_2_ECONOMIC_DECISION.md), [parameter recommendations](docs/protocol/P0_2_PARAMETER_RECOMMENDATIONS.md), [adversarial scenarios](docs/security/P0_2_ADVERSARIAL_ECONOMICS.md), [freeze checklist](docs/audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md) and [exact candidate P1 interface](docs/migration/P0_2_P1_INTERFACE.md). Candidate slashing is **not approved or implemented**; protocol freeze is incomplete. Raw verification output, including earlier failed checks, is preserved under `docs/testing/p0-2/` and reproducible using `scripts/verify-orakl-p0-2.py`.
