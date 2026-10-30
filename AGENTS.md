# ORAKL repository instructions

- Product source of truth: `docs/product/ORAKL-PRD-v1.0.md` (user-supplied, version 1.0, Draft, 2026-10-30). The PRD describes the target, not proof that a feature is implemented.
- Use `docs/protocol/` for the P0 implementation policies and `docs/testing/FOUNDRY_TEST_REPORT.md` for executed evidence. Keep the PRD's section 25 open decisions explicit; provisional test/engineering settings do not approve production economics or compliance.
- Historical P0.2 review: `docs/testing/P0_2_VERIFICATION_REPORT.md` and `docs/audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md`. P0.2 keeps full bond returns; candidate slashing/parameter ranges are unapproved.
- Latest P0.3 review: `docs/testing/P0_3_VERIFICATION_REPORT.md`, `docs/audit/P0_3_PROTOCOL_FREEZE_READINESS.md`, and `docs/migration/P0_3_INTERFACE_CHANGES.md`. Independent evidence stays open through the original window, arbitration waits until challengeDeadline, and protective challenges use the narrow active/bound/chain/epoch gate. All economic redistribution remains unapproved; the separate candidate ABI is P0.3 and not frozen or a deployment manifest. Preserve A-N assertions, legacy identity and historical evidence.
- `docs/archive/` is historical and non-normative. Preserve archives/evidence and third-party licenses.
- Preserve `QiePredictionMarket.sol`, its ABI/generated frontend integration and `frontend/public/deployments/qie-testnet.json` as the legacy Testnet product until migration is explicitly approved. P0 does not authorize a frontend rewrite.
- New protocol contracts initialize financially disabled. Local simulated activation in tests is not deployment approval. Do not activate or deploy Mainnet without explicit authorization, security review and applicable operational/legal approval.
- Application UI copy remains English; user explanations may be Indonesian. Describe pool share as contribution distribution, never guaranteed probability or fixed payout.
- On branch `refactor/orakl-protocol-v1`, use logical local commits. Do not push or open a PR without explicit authorization for this refactor.
