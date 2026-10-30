# ORAKL repository instructions

- Product source of truth: `docs/product/ORAKL-PRD-v1.0.md` (user-supplied, version 1.0, Draft, 2026-10-30). The PRD describes the target, not proof that a feature is implemented.
- Use `docs/protocol/` for the P0 implementation policies and `docs/testing/FOUNDRY_TEST_REPORT.md` for executed evidence. Keep the PRD's section 25 open decisions explicit; provisional test/engineering settings do not approve production economics or compliance.
- Latest review: `docs/testing/P0_2_VERIFICATION_REPORT.md` and `docs/audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md`. P0.2 keeps full bond returns; candidate slashing/parameter ranges are unapproved. The separate `contracts/abi/orakl-v1-candidate/` export is not a frozen interface or deployment manifest.
- `docs/archive/` is historical and non-normative. Preserve archives/evidence and third-party licenses.
- Preserve `QiePredictionMarket.sol`, its ABI/generated frontend integration and `frontend/public/deployments/qie-testnet.json` as the legacy Testnet product until migration is explicitly approved. P0 does not authorize a frontend rewrite.
- New protocol contracts initialize financially disabled. Local simulated activation in tests is not deployment approval. Do not activate or deploy Mainnet without explicit authorization, security review and applicable operational/legal approval.
- Application UI copy remains English; user explanations may be Indonesian. Describe pool share as contribution distribution, never guaranteed probability or fixed payout.
- On branch `refactor/orakl-protocol-v1`, use logical local commits. Do not push or open a PR without explicit authorization for this refactor.
