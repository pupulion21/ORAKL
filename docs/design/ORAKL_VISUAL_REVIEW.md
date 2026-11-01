# ORAKL Predict — Visual Review & Frontend Audit (P4-DES)

**Review Date:** 2026-11-01  
**Target Branch:** `feature/orakl-frontend-product-redesign`  
**Network Fixture:** Isolated Anvil Chain (`chain_id: 31337`)  
**Design System Reference:** [`docs/design/ORAKL_DESIGN_SYSTEM.md`](file:///home/pupulion/orakl/docs/design/ORAKL_DESIGN_SYSTEM.md)  
**Research Benchmark:** [`docs/design/ORAKL_DESIGN_REFERENCE_RESEARCH.md`](file:///home/pupulion/orakl/docs/design/ORAKL_DESIGN_REFERENCE_RESEARCH.md)

---

## 1. Executive Summary

This visual audit evaluates the overhaul of the ORAKL prediction market frontend (`/local.html`). Built in accordance with established principles from Polymarket, Kleros Dispute Resolver, Safe Global, and Linear, the redesign replaces the previous flat interface with a dense, authoritative, institutional prediction experience.

All 10 required viewpoints were rendered against live on-chain protocol contracts on Anvil chain 31337 and captured using Playwright Chromium at 2x device pixel ratio.

---

## 2. Review of 10 Mandatory Viewpoints

### Viewpoint 1: Market Discovery Desktop (1440 × 900)
- **Artifact:** `docs/design/screenshots/01-market-discovery-desktop.png`
- **Observations:**
  - **Information Hierarchy:** Sidebar brand mark, workspace tag (`LOCAL`), primary navigation items (`Markets`, `Disputes`, `Create market`, `Portfolio`, `Evidence lab`, `Protocol status`).
  - **Summary Metrics Bar:** 4 metrics rendered in tabular figures (`Protocol fee 2.00%`, `Pool cap 100 ETH`, `Challenge window 48h`, `Arbitration window 96h`).
  - **Search & Filters:** Real-time search input, category dropdown, status filter, and order controls aligned on a single row.
  - **Market Grid:** Markets rendered with distinct status pills (`OPEN`, `CLOSED`, `PROPOSED`, `DISPUTED`, `FINALIZED`, `CANCELLED`). Pari-mutuel contribution bars render proportional mint emerald (`YES`) vs coral rose (`NO`) fill without misleading odds claims.

### Viewpoint 2: Market Detail Desktop (1440 × 900)
- **Artifact:** `docs/design/screenshots/02-market-detail-desktop.png`
- **Observations:**
  - **Two-Column Split Layout:** Left main column (width ratio ~62%) houses substantive market facts; sticky right column (~38%) houses participant position and contextual actions.
  - **Rules & Settlement Criteria:** Highlighted `.rules-callout` specifies verified IPFS observation source, affirmative occurrence rules, and neutral-INVALID refund conditions.
  - **Pool Contribution Distribution:** Mint emerald (`YES`) and coral rose (`NO`) bars with large tabular figures and the mandatory compliance disclaimer: *"Pool shares represent proportional contribution distributions across pari-mutuel outcome pools. Shares are never guaranteed probabilities or fixed payouts."*

### Viewpoint 3: Resolution Lifecycle Stepper
- **Artifact:** `docs/design/screenshots/03-resolution-timeline.png`
- **Observations:**
  - **5-Stage Stepper:**
    1. *Market Creation & Funding* (Completed, creator address, 1 ETH creation bond).
    2. *Outcome Proposal* (Completed/Active, outcome pill, proposer address, 10 ETH bond, evidence commitment link).
    3. *Challenge Period* (Active/Completed, countdown timer, counter-bond 1 ETH, challenger address).
    4. *Arbitration Deliberation* (Active/Conditional, Arbitrator Safe authority, decision evidence hash).
    5. *Final Settlement & Claims* (Terminal state, winning outcome, claimable distribution).
  - **State Clarity:** Step markers use distinctive checkmarks (`✔`) for completed stages, accented numbers for active stages, and muted borders for pending stages.

### Viewpoint 4: Evidence Dossier & RFC 8785 Commitment Inspector Modal
- **Artifact:** `docs/design/screenshots/04-evidence-dossier-modal.png`
- **Observations:**
  - **Modal Structure:** Fixed overlay backdrop with focus trap and `Escape` key dismissal.
  - **Verification Badges:** Cryptographic validation flags Keccak-256 commitment hash match against canonical JSON and raw content bytes.
  - **Authenticity Disclaimer:** Prominent alert reminding observers that cryptographic hash matching verifies artifact integrity, while factual veracity remains subject to arbitrator evaluation.
  - **Canonical Manifest Viewer:** Collapsible raw RFC 8785 JSON viewer in monospace typography.

### Viewpoint 5: Arbitration Workspace Dispute Queue (1440 × 900)
- **Artifact:** `docs/design/screenshots/05-dispute-queue.png`
- **Observations:**
  - **Header & Metric Grid:**
    - `Active Disputes`: Highlighted count of contested cases currently in dispute.
    - `Pending Challenge Window`: Count of markets awaiting objections.
    - `Disputed Pool Volume`: Summed ETH volume locked in disputes.
    - `Safe Authority`: Clearly displays `3-of-5 Safe` with subtitle `Local Mock (Threshold 2)`.
  - **Filter Tabs:** Tabbed navigation (`All Cases`, `Active Disputes`, `Challenge Window`, `Finalized / Settled`).
  - **Dense Table:** Case ID, Market Title, Category, Status Badge, Total Stake, and direct `Review Case →` action button.

### Viewpoint 6: Arbitration Case Review Detail (1440 × 900)
- **Artifact:** `docs/design/screenshots/06-arbitration-case-detail.png`
- **Observations:**
  - **Contested Claims Comparison:** Side-by-side comparative cards showing the Proposer's result and bond vs the Challenger's objection and counter-stake.
  - **Multisig Decision Console:**
    - **Honest Local Mock Disclosure:** Explicit banner detailing that the local testbed uses `LocalRoleMock` (Threshold 2) rather than concealing the mock as a production Safe.
    - **Authorized Signer Detection:** Connected wallet evaluated against arbitrator owners list (`✔ Authorized Arbitrator Signer` vs `Observer / Read-Only`).
    - **Ruling Actions:** `Decide YES`, `Decide NO`, and `Decide INVALID (Refund)` buttons enabled strictly for authorized owners during an active dispute.

### Viewpoint 7: Mobile Market View (390 × 844)
- **Artifact:** `docs/design/screenshots/07-mobile-market-view.png`
- **Observations:**
  - **Reflow Integrity:** Two-column grid reflows into a single vertical stack. Sticky sidebar collapses into a fixed bottom navigation bar (`Markets`, `Disputes`, `Create`, `Portfolio`, `Evidence`, `Status`).
  - **Touch Targets:** All primary buttons maintain minimum 44px touch targets.
  - **Horizontal Containment:** No horizontal viewport overflow; tables and code blocks utilize bounded horizontal scrolling.

### Viewpoint 8: Mobile Arbitration Workspace (390 × 844)
- **Artifact:** `docs/design/screenshots/08-mobile-arbitration-view.png`
- **Observations:**
  - **Metric Grid Adaptation:** 4-card metric grid cleanly collapses into 2x2 or 1-column layout.
  - **Table Responsiveness:** Dispute queue table scrolls horizontally inside a dedicated `.dispute-table-wrap` container without breaking the outer viewport.
  - **Bottom Navigation:** `Disputes` tab shows active indicator.

### Viewpoint 9: Empty State View
- **Artifact:** `docs/design/screenshots/09-empty-state.png`
- **Observations:**
  - **Zero-Data State:** Centered card with restrained icon, descriptive header (*"No markets match your criteria"*), clear guidance on clearing filters, and direct action button.
  - **Dispute Empty State:** Separate empty state for dispute queue when no cases match a specific filter tab.

### Viewpoint 10: Disconnected / Observer State
- **Artifact:** `docs/design/screenshots/10-disconnected-or-error-state.png`
- **Observations:**
  - **Fail-Closed Clarity:** When no wallet is connected, trading inputs and ruling buttons are disabled with informative helper text (*"Connect wallet to participate in this market"*).
  - **Read-Only Preservation:** All contract data, resolution rules, evidence dossiers, and timeline stages remain completely accessible for inspection.

---

## 3. Design System & Anti-Slop Audit

| Criterion | Implementation Standard | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Color Restraint** | Dark slate foundation (`#080c14`, `#0e1524`, `#131c2e`). No rainbow gradients. | **PASS** | Semantic accents strictly reserved for outcomes (`#10b981` mint emerald, `#ef4444` coral rose, `#a855f7` neutral purple). |
| **Typography Scale** | Inter/SF Pro with monospace tabular figures (`font-variant-numeric: tabular-nums`). | **PASS** | Clear 6-level typographic hierarchy; market titles, IDs, hashes, and ETH quantities render in crisp monospace. |
| **Spacing System** | Strict 4px/8px modular rhythm (4, 8, 12, 16, 24, 32, 48px). | **PASS** | CSS variable tokens `--space-1` through `--space-8` enforced across all layouts and cards. |
| **Safe Multisig Transparency** | Never disguise `LocalRoleMock` as production Safe 3-of-5. | **PASS** | Visible notice explicitly notes `LocalRoleMock` at `0x9fe4...` with Threshold 2 of 2 in local simulation. |
| **Pari-Mutuel Copy** | Pool shares described as contribution distributions, never fixed probabilities. | **PASS** | Mandatory compliance notice on market detail and card views. |
| **Accessibility (WCAG 2.1 AA)** | 4.5:1 contrast, 2px visible focus ring, ARIA roles, skip-to-content links. | **PASS** | `:focus-visible` ring with `var(--accent-brand)`, ARIA tabs, modal dialog roles, keyboard `Escape` dismiss. |

---

## 4. Automated Verification Results

- **Unit & Integration Suite (`frontend/test/`):** 110 passed (0 failed, 14 suites, 1.12s execution time).
- **TypeScript Static Verification:** `tsc --noEmit` passed with 0 errors.
- **Production Bundle:** `vite build` generated optimized production assets in 2.19s without warnings.
