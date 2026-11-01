# ORAKL Predict — Visual Review & Frontend Audit (P4-DES)

**Review Date:** 2026-11-02
**Target Branch:** `feature/orakl-frontend-product-redesign`
**Network Fixture:** Isolated Anvil Chain (`chain_id: 31337`)
**Design System Reference:** [`docs/design/ORAKL_DESIGN_SYSTEM.md`](file:///home/pupulion/orakl/docs/design/ORAKL_DESIGN_SYSTEM.md)
**Research Benchmark:** [`docs/design/ORAKL_REFERENCE_RESEARCH.md`](file:///home/pupulion/orakl/docs/design/ORAKL_REFERENCE_RESEARCH.md)
**Test Suite:** 117 tests passed (0 failed, 15 suites, 1.05s execution time)

---

## 1. Executive Summary

This comprehensive visual review audits the overhaul of the ORAKL prediction market frontend (`/local.html`). Built from primary research on Polymarket, Kleros Dispute Resolver, Safe Global, and Linear, the redesign eliminates generic AI templates and delivers an institutional, high-density, fail-closed prediction experience.

All 14 mandatory viewpoints were captured using Playwright with Google Chrome for Testing at 2x Retina resolution across Desktop (1440 × 900), Laptop (1280 × 800), Tablet (768 × 1024), and Mobile (390 × 844) viewports.

---

## 2. Review of 14 Mandatory Viewpoints

### Viewpoint 01: Market Discovery Desktop (1440 × 900)
- **Artifact:** `docs/design/screenshots/01-market-discovery.png`
- **Audit Findings:**
  - **Sidebar Navigation:** Clean brand mark, workspace tag (`LOCAL`), primary navigation items (`Markets`, `Disputes`, `Create market`, `Portfolio`, `Evidence lab`, `Protocol status`).
  - **Summary Metrics Bar:** 4 metrics rendered in tabular figures (`Protocol fee 2.00%`, `Pool cap 100 ETH`, `Challenge window 48h`, `Arbitration window 96h`).
  - **Search & Filter Controls:** Real-time search query input, category dropdown, status filter, and sort controls aligned on a single horizontal row.
  - **Market Grid:** Markets rendered with distinct status pills (`OPEN`, `CLOSED`, `PROPOSED`, `DISPUTED`, `FINALIZED`, `CANCELLED`). Pari-mutuel contribution bars render proportional mint emerald (`YES`) vs coral rose (`NO`) fill without misleading odds claims.

### Viewpoint 02: Market Detail Desktop (1440 × 900) — Market #4 (Disputed)
- **Artifact:** `docs/design/screenshots/02-market-detail.png`
- **Audit Findings:**
  - **Two-Column Split Layout:** Left main column (~62%) houses substantive market facts, rules, and dispute history; sticky right column (~38%) houses participant position and contextual action controls.
  - **Rules & Settlement Criteria:** Highlighted `.rules-callout` specifies verified resolution sources, affirmative occurrence rules, and neutral-INVALID refund conditions.
  - **Pool Contribution Distribution:** Mint emerald (`YES`) and coral rose (`NO`) bars with large tabular figures and the mandatory compliance disclaimer: *"Pool shares represent proportional contribution distributions across pari-mutuel outcome pools. Shares are never guaranteed probabilities or fixed payouts."*

### Viewpoint 03: Create Market Empty State (1440 × 900)
- **Artifact:** `docs/design/screenshots/03-create-market-empty.png`
- **Audit Findings:**
  - **6-Section Institutional Wizard:**
    - Section 01: Market Question & Classification (15-char min, mandatory `?`, category selection, description).
    - Section 02: Objective Resolution Rules & Criteria (Primary source URL, fallback source, YES criteria, NO criteria, INVALID criteria with neutral refund explanation).
    - Section 03: Parameter-Validated Timeline (Close time, resolution start, max resolution deadline with live 192h floor calculator).
    - Section 04: Protocol Resolution Mechanism (4-step sequence, protocol arbitrator address, **zero custom resolver input allowed**).
    - Section 05: Pre-Flight Publication Review (live summary grid, compiled criteria preview, immutability confirmation checkbox).
    - Section 06: Metadata Commitment & Node Publication Pipeline (RFC 8785 canonical JSON generation and submission).
  - **Template Action:** Top-level button *"Load Gold Benchmark Preset"* enables instant population of LBMA Gold Price PM benchmark.

### Viewpoint 04: Create Market With Validated Input (1440 × 900)
- **Artifact:** `docs/design/screenshots/04-create-market-validated.png`
- **Audit Findings:**
  - **Filled Form:** Populated with the LBMA Gold Price PM benchmark proposition.
  - **Live Dynamic Timeline Floor:** Green badge indicates `FLOOR SATISFIED (+192h)`.
  - **Compiled Criteria:** Pre-flight review card displays compiled text blocks for YES, NO, and INVALID refund rules.
  - **Verified Commitment:** Clicking *"Validate & Preview Commitment"* displays the RFC 8785 Keccak-256 commitment hash without broadcasting a premature on-chain transaction.

### Viewpoint 05: Publication Review Card Element
- **Artifact:** `docs/design/screenshots/05-publication-review.png`
- **Audit Findings:**
  - **Key-Value Audit Grid:** Question, category (`finance`), primary source URL, chain close timestamp, resolution start, max resolution deadline, creation bond (1.000 ETH), local chain ID (31337), factory contract address, and connected wallet address.
  - **Immutability Acknowledgment:** Checkbox requiring explicit acknowledgment that rules and timelines are permanent and cannot be modified after creation.

### Viewpoint 06: Resolution Timeline (Market #2 — Proposed State)
- **Artifact:** `docs/design/screenshots/06-resolution-timeline.png`
- **Audit Findings:**
  - **5-Stage Stepper Progression:**
    1. *Creation & Funding* (Completed, creator address, 1 ETH creation bond).
    2. *Outcome Proposal* (Active, proposed outcome pill, proposer address, 10 ETH bond, evidence commitment link).
    3. *Challenge Period* (Active countdown timer, 1 ETH challenge bond requirement).
    4. *Arbitration Deliberation* (Pending, Arbitrator Safe authority).
    5. *Terminal Settlement* (Pending, payout claimability).
  - **State Semantics:** Checkmarks (`✔`) for completed stages, accented numbers for active stages, and muted styling for pending stages.

### Viewpoint 07: Evidence Details & RFC 8785 Inspector Modal (Market #4)
- **Artifact:** `docs/design/screenshots/07-evidence-details.png`
- **Audit Findings:**
  - **Modal Dialog:** Fixed overlay backdrop with focus trap and `Escape` key dismissal.
  - **Verification Badges:** Cryptographic validation flags Keccak-256 commitment hash match against canonical JSON and raw content bytes.
  - **Authenticity Disclaimer:** Prominent alert reminding observers that cryptographic hash matching verifies artifact integrity, while factual veracity remains subject to arbitrator evaluation.
  - **Canonical Manifest Viewer:** Raw RFC 8785 JSON formatted in crisp monospace typography.

### Viewpoint 08: Dispute Queue (Arbitration Workspace #/arbitration)
- **Artifact:** `docs/design/screenshots/08-dispute-queue.png`
- **Audit Findings:**
  - **Header & Metric Grid:**
    - `Active Disputes`: Count of contested cases currently in dispute.
    - `Pending Challenge Window`: Count of markets awaiting objections.
    - `Disputed Pool Volume`: Summed ETH volume locked in disputes.
    - `Safe Authority`: Displays `3-of-5 Safe` with subtitle `Local Mock (Threshold 2)`.
  - **Filter Tabs:** Tabbed navigation (`All Cases`, `Active Disputes`, `Challenge Window`, `Finalized / Settled`).
  - **Dense Table:** Case ID, Market Title, Category, Status Badge, Total Stake, and direct `Review Case →` action button.

### Viewpoint 09: Arbitration Case Review Detail (1440 × 900) — Case #4
- **Artifact:** `docs/design/screenshots/09-arbitration-case-detail.png`
- **Audit Findings:**
  - **Comparative Claims Analysis:** Side-by-side comparative cards showing the Proposer's result and bond vs the Challenger's objection and counter-stake.
  - **Multisig Decision Console:**
    - **Honest Local Mock Disclosure:** Explicit banner detailing that the local testbed uses `LocalRoleMock` (Threshold 2) rather than concealing the mock as a production Safe.
    - **Authorized Signer Detection:** Connected wallet evaluated against arbitrator owners list (`✔ Authorized Arbitrator Signer` vs `Observer / Read-Only`).
    - **Ruling Actions:** `Decide YES`, `Decide NO`, and `Decide INVALID (Refund)` buttons enabled strictly for authorized owners during an active dispute.

### Viewpoint 10: Wallet Disconnected State (Portfolio View)
- **Artifact:** `docs/design/screenshots/10-wallet-disconnected.png`
- **Audit Findings:**
  - **Fail-Closed Clarity:** When no wallet is connected, trading inputs and ruling buttons are disabled with informative helper text (*"Connect wallet to participate in this market"*).
  - **Read-Only Preservation:** All contract data, resolution rules, evidence dossiers, and timeline stages remain completely accessible for inspection.

### Viewpoint 11: Error State — RPC Unavailable Banner
- **Artifact:** `docs/design/screenshots/11-error-state-rpc-unavailable.png`
- **Audit Findings:**
  - **Fail-Closed Blocking Notice:** When local Anvil RPC is unreachable or wrong-chain, `verifyLocalDeployment` returns `FAILED` and renders a full-page blocking notice with error details and retry controls.
  - **Zero Unverified Execution:** No contract reads or writes are attempted against an offline or unverified RPC.

### Viewpoint 12: Error State — Metadata Publisher Unavailable Notice
- **Artifact:** `docs/design/screenshots/12-error-state-metadata-unavailable.png`
- **Audit Findings:**
  - **Graceful Failure Handling:** In Evidence Lab or Create Market, if the local Fastify API node (port 4310) is offline, the client renders an explicit error card (*"Publishing Failed: fetch failed"*).
  - **Deterministic Fallback:** Create Market falls back to verified deterministic commitments (`ipfs://orakl-local-artifact/<hash>`) while disclosing node connectivity status.

### Viewpoint 13: Mobile Viewport — Discovery & Navigation (390 × 844)
- **Artifact:** `docs/design/screenshots/13-mobile-navigation.png`
- **Audit Findings:**
  - **Reflow Integrity:** Two-column grid reflows into a single vertical stack. Sticky sidebar collapses into a fixed bottom navigation bar (`Markets`, `Disputes`, `Create`, `Portfolio`, `Evidence`, `Status`).
  - **Touch Targets:** All primary buttons and chips maintain minimum 44px touch targets.
  - **Horizontal Containment:** Zero horizontal overflow; cards adapt cleanly to 390px width.

### Viewpoint 14: Mobile Viewport — Create Form Validation (390 × 844)
- **Artifact:** `docs/design/screenshots/14-mobile-create-form.png`
- **Audit Findings:**
  - **Field Validation Callout:** Red alert card itemizes specific validation errors when mandatory fields are omitted.
  - **Touch Usability:** Form inputs, datetime pickers, and submit buttons remain fully accessible on small screens with no awkward horizontal pinch-zooming required.

---

## 3. Five-Point Visual Critique Pass

1. **Information Density:**
   - *Critique:* Initial layouts risked feeling either sparse or overcrowded.
   - *Resolution:* Adopted Linear's 4px/8px modular rhythm (`var(--space-1)` to `var(--space-8)`), compact tabular numbers (`tabular-nums`), and structured split panels. Financial figures, timestamps, and addresses align with mathematical precision.

2. **Visual Hierarchy:**
   - *Critique:* Users must immediately distinguish the core proposition, resolution criteria, and current state.
   - *Resolution:* High-contrast 24px headings anchor the page; prominent colored pills designate binary outcomes; sticky sidebar isolates user position; and the 5-stage stepper visually communicates progress toward final settlement.

3. **Contrast & Legibility (WCAG 2.1 AA Compliance):**
   - *Critique:* Dark themes often suffer from poor text contrast or neon eye fatigue.
   - *Resolution:* Foundation uses solid dark slate (`#080c14`, `#0e1524`, `#131c2e`) with `#f8fafc` primary text (contrast ratio > 14:1) and `#94a3b8` secondary text (contrast ratio > 7:1). Semantic accents strictly meet or exceed the 4.5:1 AA threshold.

4. **Interactive Affordances:**
   - *Critique:* Irreversible smart contract actions require unmistakable visual states.
   - *Resolution:* Primary buttons feature solid saturated backgrounds (`#3b82f6` or outcome colors) with distinct active, hover, and 2px focus rings (`outline: 2px solid var(--accent); outline-offset: 2px`). Disabled buttons provide explicit tooltips explaining prerequisites.

5. **State Honesty & Protocol Integrity:**
   - *Critique:* Web3 UIs frequently exaggerate probability accuracy or simulate multisig consensus dishonestly.
   - *Resolution:*
     - Pool shares are strictly labeled as proportional pari-mutuel contribution shares, never guaranteed probabilities.
     - Neutral-INVALID fallback guarantees 100% deposit refunds with 0% protocol fee.
     - Local testbed transparently discloses `LocalRoleMock` (Threshold 2) rather than masquerading as a production 3-of-5 Safe multisig.
     - Create Market completely eliminates creator-selected resolver wallets, guaranteeing protocol-governed arbitration.

---

## 4. Twelve-Question Product Review Checklist

| # | Product Review Question | Evaluation & Evidence | Result |
| :-: | :--- | :--- | :-: |
| **1** | Would a sophisticated trader or institutional analyst take this seriously? | Dense data tables, monospace figures, RFC 8785 evidence inspector, and zero hype graphics establish institutional credibility. | **YES** |
| **2** | Does the resolution section immediately answer "who decides, by what rules, and what's the evidence"? | Resolution callout cites primary source URL, criteria rules, 5-stage timeline, and links directly to verified cryptographic evidence hashes. | **YES** |
| **3** | Are the rules visible without clicking into an accordion or sub-tab? | Resolution rules are elevated to the top of the detail view in a dedicated `.rules-callout` card. | **YES** |
| **4** | Is the dispute status unmistakably clear? | Prominent purple `DISPUTED` badge, comparative claim cards, and countdown to arbitration deadline make dispute status immediately apparent. | **YES** |
| **5** | Does the pool distribution card make it obvious this is not an orderbook? | Clear proportional fill bars with large ETH figures accompanied by the non-guaranteed pool share compliance notice. | **YES** |
| **6** | Does the "Create Market" flow feel like defining a rigorous financial contract? | 6-section wizard requires binary framing, objective resolution criteria, verified sources, parameter-validated timelines, and pre-flight review. | **YES** |
| **7** | Is the timeline validated and its constraints clearly explained? | Real-time floor calculator enforces `maxResolutionTime >= resolutionTime + 192h` (48h challenge + 96h arbitration + 48h buffer) with dynamic visual feedback. | **YES** |
| **8** | Is the arbitrator role clearly distinguished from a regular user? | Arbitration console checks `isArbitratorOwner()`, displaying `✔ Authorized Arbitrator Signer` vs `Observer / Read-Only` with honest `LocalRoleMock` disclosure. | **YES** |
| **9** | Does the dispute queue feel like an institutional resolution workbench? | `/arbitration` view provides a sortable, filterable dispute register with aggregate capital metrics, case statuses, and review links. | **YES** |
| **10** | Is the mobile experience a thoughtful adaptation, not a broken desktop layout? | Responsive breakpoints (1280px, 1024px, 768px, 480px, 390px) collapse sidebars into bottom nav, stack columns, and maintain 44px touch targets. | **YES** |
| **11** | Are loading, error, and empty states treated with the same design care? | Fail-closed RPC blocking banners, empty state cards with actionable guidance, and clean node offline notices receive first-class styling. | **YES** |
| **12** | Does any part of the interface look like a generic AI template? | Zero floating glowing blobs, zero neon purple glassmorphism, zero fake orderbooks; strictly tokenized dark slate surfaces and purposeful typography. | **NO (CLEAN)** |

---

## 5. Verification Conformance & Artifact Summary

- **Automated Test Suite:** `npm --prefix frontend test` passes 117 tests across 15 suites in 1.05s.
- **TypeScript Static Verification:** `npm --prefix frontend run typecheck` produces 0 errors.
- **Production Asset Build:** `npm --prefix frontend run build` builds clean client bundle in 2.20s.
- **Visual Artifacts:** 14 high-resolution PNG screenshots stored in `docs/design/screenshots/`.
