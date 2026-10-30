# ORAKL repository instructions

- Product source of truth: `docs/product/ORAKL-PRD-v1.0.md` (user-supplied, version 1.0, Draft, 2026-10-30). The PRD describes the target, not proof that a feature is implemented.
- Use `docs/protocol/` for the P0 implementation policies and `docs/testing/FOUNDRY_TEST_REPORT.md` for executed evidence. Keep the PRD's section 25 open decisions explicit; provisional test/engineering settings do not approve production economics or compliance.
- `docs/archive/` is historical and non-normative. Preserve archives/evidence and third-party licenses.
- Preserve `QiePredictionMarket.sol`, its ABI/generated frontend integration and `frontend/public/deployments/qie-testnet.json` as the legacy Testnet product until migration is explicitly approved. P0 does not authorize a frontend rewrite.
- New protocol contracts initialize financially disabled. Local simulated activation in tests is not deployment approval. Do not activate or deploy Mainnet without explicit authorization, security review and applicable operational/legal approval.
- Application UI copy remains English; user explanations may be Indonesian. Describe pool share as contribution distribution, never guaranteed probability or fixed payout.
- On branch `refactor/orakl-protocol-v1`, use logical local commits. Do not push or open a PR without explicit authorization for this refactor.
