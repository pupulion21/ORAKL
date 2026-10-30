# ORAKL v1 freeze gate matrix

**Freeze: BLOCKED.** Selected implementation base `f3b35a1fb25bc08f2e5cd6c31addb6396c238181`. Local M1/neutral-INVALID/hard-cap choices are explicitly selected by the user; production release is not approved. A technical pass describes the stated local evidence and assumptions, not an independent audit or a production authorization. Candidate policies and procedures are proposals, not owner decisions. The [selected implementation verification](../testing/ORAKL_V1_ECON_IMPLEMENTATION_VERIFICATION.md) records execution and limitations.

| Gate | Status | Evidence / action needed |
| --- | --- | --- |
| F1 Security | BLOCKED — OWNER DECISION | P0.3 attack regressions and [current threat model](../security/ORAKL_V1_THREAT_MODEL_FINAL_CANDIDATE.md) leave arbitration honesty, availability and coalition stake dilution open. Owner must select a complete threat/trust policy; independent review remains F13. |
| F2 Economics | PASS — VERIFIED | Selected LOCAL M1/neutral-INVALID matrix and empty/cancellation exceptions execute in SelectedMarketFactory; all nine combinations and conservation tested. Production authorization remains F3/F16. |
| F3 Financial parameters | BLOCKED — OWNER DECISION | Fee, K/P/C, minimum, caps and durations are not approved; select explicit units, bounds and per-market snapshot policy. |
| F4 Market integrity | PASS — VERIFIED | Selected LOCAL multi-stake intake, independent evidence and original D/A controls tested; truthful evidence consideration remains F7/F15. |
| F5 Aggregate exposure | PASS — VERIFIED | Immutable local global3×/per-arbitrator2×tier limits enforce actual unresolved deposits and exactly-once release. Actual native tier and monitor budget remain F3; custody/external incentives are not bounded. |
| F6 Spam | BLOCKED — OWNER DECISION | Refundable creation bond is recyclable; approve monitoring, moderation and economic control assumptions. |
| F7 Arbitration | BLOCKED — OWNER DECISION | [Admission standard](../security/ORAKL_V1_ARBITRATOR_ADMISSION_STANDARD.md) is proposed; select verified wallets, roles and independent controls, document acceptance and perform operational checks. |
| F8 Emergency | BLOCKED — OWNER DECISION | First-interruption exits, epoch quarantine and 24-hour recovery are implemented and tested; explicitly accept operational recovery/abort policy. |
| F9 Accounting | PASS — VERIFIED | Local tests, A–P invariants, native-flow trace and retained Slither triage provide scoped evidence; independent audit remains F13. |
| F10 Compiler identity | PASS — VERIFIED | Existing artifact checker confirms pinned compiler/settings and local bytecode identity; review exact final artifact before release. |
| F11 ABI | PASS — VERIFIED | Candidate exporter/checker and interface tests validate current local ABI; it remains not frozen and has no production addresses. Recheck if source or policy changes. |
| F12 QIE compatibility | BLOCKED — NETWORK VERIFICATION | [QIE-FORGE evidence](../qie/QIE_FORGE_EXECUTION_EVIDENCE.md) records documented settings and one identity/header observation; real opcode/fork, limits, wallet, gas, explorer, history and finality remain unverified. |
| F13 Independent audit | BLOCKED — EXTERNAL AUDIT | Obtain independent audit of exact approved implementation, compiler and operational trust boundaries; remediate and retest. |
| F14 Legal/compliance | BLOCKED — LEGAL/COMPLIANCE | Obtain applicable jurisdiction, category, eligibility and real-value launch authorization. |
| F15 Operational readiness | NOT TESTED | Build and exercise evidence retention, reorg-safe indexing, monitoring, disaster recovery, incident and actual wallet procedures. Local mocks do not establish production operation. |
| F16 Owner freeze authorization | BLOCKED — OWNER DECISION | Owner must explicitly approve exact audited source/build and complete economic/operational specification after preceding gates. |

Any blocked or untested mandatory gate prevents freeze. No approval is inferred from local tests or from the documents written by the engineering team.

Selected execution details: [owner authorization and implementation scope](../decisions/ORAKL_V1_SELECTED_ECONOMICS.md), [versioned interface](../migration/ORAKL_V1_SELECTED_INTERFACE_DELTA.md). Old MarketFactory/P0.3 ABI remains a separate historical policy, not selected economics.
