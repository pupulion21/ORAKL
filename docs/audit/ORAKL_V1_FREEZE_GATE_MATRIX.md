# ORAKL v1 freeze gate matrix

**Freeze: BLOCKED.** Source baseline `9e256c1451d666889f9f248edee3e2e2d61f6d48`. A technical pass describes the stated local evidence and assumptions, not an independent audit or a production authorization. Candidate policies and procedures are proposals, not owner decisions. The [verification report](../testing/ORAKL_V1_FREEZE_CANDIDATE_VERIFICATION.md) records execution and limitations.

| Gate | Status | Evidence / action needed |
| --- | --- | --- |
| F1 Security | BLOCKED — OWNER DECISION | P0.3 attack regressions and [current threat model](../security/ORAKL_V1_THREAT_MODEL_FINAL_CANDIDATE.md) leave arbitration honesty, availability and first-slot capture open. Owner must select a complete threat/trust policy; independent review remains F13. |
| F2 Economics | BLOCKED — OWNER DECISION | Full principal return executes; [nine-row transfer candidate](../decisions/ORAKL_V1_ECONOMIC_POLICY_CANDIDATE.md) is unapproved. Record every terminal entitlement and implement/test approved changes. |
| F3 Financial parameters | BLOCKED — OWNER DECISION | Fee, K/P/C, minimum, caps and durations are not approved; select explicit units, bounds and per-market snapshot policy. |
| F4 Market integrity | BLOCKED — OWNER DECISION | P0.3 evidence, narrow objection and D/A checks exist; choose challenger economics, evidence review procedure and timing. |
| F5 Aggregate exposure | BLOCKED — OWNER DECISION | Only per-market cap exists; choose enforceable aggregate budget or explicitly accept exposure and define separate custody policy. |
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
