# P0.2 protocol freeze checklist

Decision: **FREEZE NOT COMPLETE.** A preserved, testable baseline is available for preliminary independent review. A final production audit scope cannot be declared economically complete while the following decisions are unapproved. No deploy/activation/push/merge is authorized.

## Approval record

Owner economic approvals received in P0.2: **none**. Mentioning a candidate is not approval. [Economic decision](../protocol/P0_2_ECONOMIC_DECISION.md), [parameter recommendations](../protocol/P0_2_PARAMETER_RECOMMENDATIONS.md) and [adversarial review](../security/P0_2_ADVERSARIAL_ECONOMICS.md) supply concrete options and limits. The immutable current implementation returns all bond principals. No punitive policy, economic defaults, role addresses or Mainnet configuration were silently selected.

| Gate / decision | Current condition | Exact remaining action / accountable party |
| --- | --- | --- |
| F1 Bond distribution | **BLOCKED — OWNER** | Select full return, correctness-contingent Option A, completed neutral-INVALID B, or separate service-cost C. Approve all9 proposal/decision combinations, INVALID→binary, empty winner/market, cancellation and timeout cases. |
| F2 Bond amounts/positive minima | **BLOCKED — OWNER/RISK** | Approve K/P/C, zero-value policy, native scale and their affordability/exposure rationale. Current code allows zero; tests do not approve it. |
| F3 Fee basis/rate | **BLOCKED — OWNER** | Approve exact bps, full-pool fee basis, one-sided fee effect and fee-free refund rules. Candidate200 bps remains proposed. |
| F4 Exposure/correlated markets | **BLOCKED — OWNER/RISK** | Select enforced per-market cap and aggregate shared-arbitrator loss budget. Decide operational-only limit vs new on-chain aggregate enforcement; current cap is per market only. |
| F5 First challenge/evidence intake | **BLOCKED — OWNER/ARBITRATION** | Decide captured-slot handling, access for independent observers and immediate arbitration vs minimum intake/appeal period. Current arbiter can finalize immediately after a challenge. A timing change requires code/regressions and bounded refund rules. |
| F6 Arbitration trust | **BLOCKED — OWNER/SECURITY/OPERATIONS** | Approve independent multisig model, real signer/control independence, misconduct/nonperformance policy and any pre-finality appeal. No self-adjudicated punitive arbiter bond. |
| F7 Durations and emergency abort | **BLOCKED — OWNER/OPERATIONS** | Approve proposal/challenge/arbitration/max periods, P0.1 short-pause abort semantics and release review minimum. No emergency restart/shortened challenge payout. |
| F8 Creation spam/eligibility | **BLOCKED — OWNER/LEGAL** | Accept refundable K's weak spam cost or approve specific fee/concurrency/eligibility design compatible with direct permissionless calls. Frontend moderation is insufficient on-chain enforcement. |
| F9 Metadata/evidence | **BLOCKED — OWNER/PRODUCT/ARBITRATION** | Approve exact schema, hash algorithm, byte serialization/canonicalization, authoritative criteria, INVALID/ambiguity definitions, storage/pinning/retention and evidence-submission deadlines. Current hash presence is not availability/truth proof. |
| F10 Minimum contribution | **BLOCKED — OWNER/RISK** | Approve exact smallest-unit amount using verified QIE denomination and measured gas/accessibility; do not infer security from a minimum-size position. |
| F11 Dust/unclaimed entitlements | **BLOCKED — OWNER** | Accept perpetual reservation/no sweep in v1 or fully specify audited claim expiry/residual policy. Unclaimed user funds cannot be called dust. |
| F12 Economic implementation/version | **BLOCKED — ENGINEERING AFTER APPROVAL** | Implement only approved deltas, segregated deterministic bond reward entitlements if selected, immutable terms/version, conservation, transfer rollback and new event/ABI coverage. New contract version cannot retrofit old markets. |
| F13 Roles/release/upgrades | **BLOCKED — OPERATIONS/SECURITY** | Independently verify genuine deployed wallet code/singleton/modules/guards/fallback, signer independence and incident procedures. Resolve unreported transient role drift/restoration that can censor a challenge without a persisted epoch change; choose verified wallet change controls/independent reporting or a protocol redesign. Accept immutable nonproxy v1/replacement strategy and separate governance/compliance/guardian powers. Technical approval digest is not proof of audit or legality. |
| F14 QIE Mainnet facts | **BLOCKED — ENGINEERING/NETWORK** | Resolve symbol/decimals, forks/code/initcode limits, gas/envelopes, finality/history/log behavior, explorer verification and genuine wallet compatibility with authoritative evidence. Existing dated RPC reads do not certify these. |
| F15 Legal/market eligibility | **BLOCKED — OWNER/QUALIFIED REVIEW** | Applicable legal authorization, eligible jurisdictions/categories, participant eligibility and operational controls; no real-value launch until release requirements are satisfied. |
| F16 Final independent audit | **BLOCKED — EXTERNAL REVIEW AFTER F1–F13 SCOPE DECISIONS** | Audit exact final source/compiler/dependencies/parameters/trust model, remediate findings, rerun reproducible verification and pin reviewed commit/artifacts. Current first-party passing tests are not an independent audit. |
| F17 P1 interface and migration | **CANDIDATE ONLY** | Review [exact ABI package](../migration/P0_2_P1_INTERFACE.md); update it after approved economic changes. Explicit frontend migration approval remains absent. Legacy frontend/Testnet remain untouched. |
| F18 Operational platform | **NOT COMPLETED BY P0.2** | Implement/test PRD metadata, backend authentication, indexing/reorg replay, monitoring/recovery and actual production E2E; agree the interface only after economic scope is stable. |

Native-QIE binary pari-mutuel, no AMM/orderbook/LP/position token, permissionless protocol creation, no admin participant custody, financially disabled initialization and legacy preservation are fixed constraints of this task. They are not open economic choices. Currency properties, exact eligibility enforcement and release authorization are unresolved details, not permission to change those constraints.

## Current specification that can be reviewed now

One deployable MarketFactory facade composes creation, pool, resolver and shared liability modules; separate ProtocolConfig is noncustodial. Immutable contract code and creation-snapshotted9-field parameters fix economics/arbiter/deadlines for a market. Native deposits alone create contribution/bond liabilities; forced balances are surplus. Fee allocation on valid nonempty-winner settlement is `floor((Y+N)*feeBps/10000)`; each winning wallet gets `floor(contribution*distributable/winningPool)`. INVALID/empty winner/expiry/emergency use full contribution refunds with no fee. Current full-return bonds remain owner-only, terminal and exactly once.

States: OPEN→timestamp CLOSED→PROPOSED→FINALIZED, with DISPUTED before authorized arbitration; INVALID/expiry/interruption produce CANCELLED, while binary zero-winner is FINALIZED plus refundable. No finality reversal/reopening. No value-bearing entry before activation, even zero-value bond calls. Independent compliance review plus24-hour delay and governance authorization are required; interventions revoke review and quarantine old unresolved markets. Terminal withdrawal paths remain permissionless with respect to platform availability and do not call wallet control getters. See [emergency recovery](../security/EMERGENCY_RECOVERY.md).

No production source/compiler/dependency change was justified by a new demonstrated bug in P0.2. Preserved code can receive preliminary independent review, particularly payment graph, role checks/assembly, emergency trust and immediate arbitration. **Do not describe that review as final economic sign-off or freeze.** If owner adopts completed B, entitlement and event changes are still work to implement and audit.

## Reproducibility and freeze procedure after decisions

1. Record owner choices against F1–F11, including explicit rejected alternatives and trusted arbitration/abort assumptions; attach independently verified role/network/legal evidence when available.
2. Implement only approved deltas on a separate reviewed commit; retain old deployment/history. Add failing-before regressions for genuine fixes and explicit tests for every new economic terminal case, including coalition/slot behavior.
3. Pin source, compiler/profile/OZ dependency and full settings. Run all Foundry suites/fuzz/invariants, static analysis/triage, gas/artifact identity and frontend compatibility checks; preserve failures and raw command output.
4. Regenerate exact ABI/event/schema manifest and specification from that final artifact; obtain external audit, remediation review and owner freeze approval on the exact commit/digests.
5. Deployment authorization and financial activation are later, separate decisions. Initial deployment must stay inactive. This task performs neither.

Executed P0.2 results and preserved failures are in the [verification report](../testing/P0_2_VERIFICATION_REPORT.md). The [Mainnet readiness record](../deployment/QIE_MAINNET_READINESS.md) remains BLOCKED.
