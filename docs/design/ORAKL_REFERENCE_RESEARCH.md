# ORAKL Protocol — Reference Research & Comparative UX Architecture

> **DOCUMENT ID**: `ORAKL-REF-RES-001`
> **DATE**: 2026-11-02
> **TARGET**: ORAKL Protocol Selected Frontend (`/local.html`)
> **ROLE**: Principal Product Designer, Senior Frontend Engineer, Web3 UX Specialist
> **STATUS**: `RESEARCH COMPLETED — RATIFIED SPECIFICATION`

---

## 1. Executive Overview

Before implementing the ORAKL v1 frontend rebuild, direct research was conducted across four primary industry references:
1. **Polymarket** ([polymarket.com](https://polymarket.com/)) — Prediction market discovery, optimistic proposal/challenge resolution lifecycle, rule clarity.
2. **Kleros Dispute Resolver** ([resolve.kleros.io](https://resolve.kleros.io/)) — Institutional dispute case registry, cryptographic evidence audit trails (ERC-1497 / RFC 8785), structured deliberation.
3. **Safe Global** ([app.safe.global](https://app.safe.global/)) — Multi-signature transaction lifecycle, threshold counters, signer ownership evaluation, timelock warnings, fail-closed state disclosures.
4. **Linear** ([linear.app](https://linear.app/)) — Dense tabular layouts, 4px/8px modular rhythm, monospace figures, discrete state badges, side-sheet/drawer information architecture, zero decorative slop.

---

## 2. In-Depth Reference Product Analyses

### 2.1 Polymarket

1. **Primary Product URL & Documentation Studied**:
   - Product: [https://polymarket.com/](https://polymarket.com/)
   - Resolution Documentation: [https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved](https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved)
   - Oracle Infrastructure: UMA Optimistic Oracle (OO) v2/v3, resolution liveness period (2 hours), proposal bond ($750 USDC) and challenge bond.

2. **Market Discovery Patterns**:
   - High-density cards with horizontal categorization tags (Politics, Crypto, Pop Culture, Business).
   - Prominent probability bar showing binary outcome distribution (`YES %` vs `NO %`).
   - 24-hour volume and total pool liquidity displayed with tabular numbers.
   - Status indicators distinguish active trading from markets in resolution ("Resolving", "Disputed").

3. **Detail View Information Hierarchy**:
   - Level 1: Market Question in crisp, high-contrast headline.
   - Level 2: Outcome odds breakdown pills and aggregate pool volume.
   - Level 3: Rules & Resolution Source block immediately below the header (mandatory reading before trading).
   - Level 4: Action panel (Trade/Staking) on the right column; Activity, Holders, and Resolution details on the left.

4. **Resolution/Status/Timelock Presentation**:
   - Dedicated optimistic resolution banner when a proposed outcome is submitted.
   - Countdown timer displaying exact hours and minutes remaining in the challenge liveness window.
   - Clear disclosure of the proposer identity and staked bond amount.

5. **Evidence and Rule Display**:
   - Explicit "Resolution Source" link (e.g. Associated Press, Bureau of Labor Statistics).
   - Clear textual rules defining boundary conditions (inclusive vs exclusive dates, timezone specifications, emergency fallback).

6. **What Works Well (Keep)**:
   - **Rules-First Placement**: Rules are prominently positioned rather than buried in an expandable drawer.
   - **Optimistic State Banner**: Prominent countdown and outcome assertion gives immediate notice of pending settlement.
   - **Compact Information Density**: Financial metrics are presented cleanly without wasteful white space.

7. **What Is Poor or Confusing (Avoid)**:
   - **Orderbook Continuous Price Illusion**: Binary tokens trade like shares on an AMM/CLOB, which confuses users into treating dynamic market prices as guaranteed fixed payouts or mathematical probabilities.
   - **Speculative Noise**: Uncurated comment sections and emoji reactions introduce social hype that undermines institutional trust.
   - **Hidden Escalation Paths**: How UMA disputes are escalated to tokenholder voting is often unclear to regular users until a dispute occurs.

8. **Specific Adaptations for ORAKL**:
   - **Pari-Mutuel Contribution Clarity**: Replaced token price charts with a transparent Pool Contribution Distribution card explaining that payouts are proportional shares of opposing pools minus protocol fees, never guaranteed odds.
   - **5-Stage Resolution Stepper**: Integrated an explicit visual lifecycle stepper (`OPEN` → `CLOSED` → `PROPOSED` → `DISPUTED` → `FINALIZED`) with exact block timestamps and countdown indicators.
   - **Bond Requirement Callouts**: Explicitly displayed 10 ETH proposal bond, 1 ETH challenge bond, and 1 ETH creation bond requirements with refund terms.

---

### 2.2 Kleros Dispute Resolver

1. **Primary Product URL & Documentation Studied**:
   - Product: [https://resolve.kleros.io/](https://resolve.kleros.io/)
   - Documentation: [https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/integration-tools/dispute-resolver](https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/integration-tools/dispute-resolver)
   - Standard: ERC-1497 Evidence Standard, IArbitrator / IArbitrable interfaces.

2. **Market/Dispute Discovery Patterns**:
   - Tabular dispute queue ("Cases") with column headers: Case #, Subcourt, Category, Disputed Amount, Status, and Voting Deadline.
   - Filter chips for `Open`, `Need Evidence`, `In Voting`, `Appeals`, and `Resolved`.
   - Clear indication of case urgency with color-coded deadline badges.

3. **Detail View Information Hierarchy**:
   - Level 1: Dispute Case Header with Case ID, creation timestamp, and current court tier.
   - Level 2: Original Agreement / Primary Question and contract address.
   - Level 3: Chronological Evidence Stream containing submissions from all parties.
   - Level 4: Deliberation and Ruling Panel showing juror vote distributions, justifications, and appeal periods.

4. **Resolution/Status/Timelock Presentation**:
   - Multi-phase timeline: Evidence Submission Phase → Juror Voting Phase → Appeal Window → Execution.
   - Clear countdown timers for each phase deadline.

5. **Evidence and Rule Display**:
   - Each piece of evidence is itemized with submitter address, submission timestamp, title, description, and cryptographic URI/hash.
   - Direct link to IPFS raw evidence files with hash verification.

6. **What Works Well (Keep)**:
   - **Dedicated Dispute Queue**: Provides institutional participants a unified workbench for tracking contested matters.
   - **Cryptographic Evidence Registry**: Evidence items are immutable and independently auditable via content hash commitments.
   - **Transparent Deliberation Record**: Ruling justifications are recorded permanently on-chain or via linked IPFS storage.

7. **What Is Poor or Confusing (Avoid)**:
   - **Subjective Juror Token Staking (Schelling Point)**: PNK stakers vote based on expected majority rather than objective fact; minority jurors get slashed.
   - **Endless Appeal Cycles**: Recursive appeal rounds with doubling stakes can drag dispute resolution out for months.
   - **Complex Staking Math**: Distracts users from the underlying factual question.

8. **Specific Adaptations for ORAKL**:
   - **Dedicated Arbitration Workspace (`#/arbitration`)**: Built a standalone Dispute Queue table in ORAKL showing Disputed Markets, Market IDs, Pool Capital, Challenger Count, and Arbitration Deadlines.
   - **RFC 8785 Canonical Evidence Inspector**: Embedded an in-app JSON inspector modal that verifies canonical RFC 8785 sorting and calculates `keccak256` content hashes.
   - **Bounded Single-Round Arbitration Window**: Hard-coded 48-hour arbitration window enforced by `MarketResolver.sol` ensuring definitive terminal settlement without infinite appeal spirals.

---

### 2.3 Safe Global

1. **Primary Product URL & Documentation Studied**:
   - Product: [https://app.safe.global/](https://app.safe.global/)
   - Documentation: [https://docs.safe.global/](https://docs.safe.global/)
   - Contracts: GnosisSafe / Safe v1.3.0 / v1.4.1 singleton and proxy contracts, EIP-712 multisig execution.

2. **Market/Dispute/Transaction Discovery Patterns**:
   - Transaction Queue split into `Queue` (pending signatures) and `History` (executed transactions).
   - Each transaction entry shows nonce, transaction type, recipient, threshold counter (e.g. `1 of 3`), and status.
   - Prominent badge indicating if the connected wallet has signed or needs to sign.

3. **Detail View Information Hierarchy**:
   - Level 1: Transaction summary (action title, target contract, value transfer).
   - Level 2: Signer status list displaying each owner address, name label, and signature state (Confirmed vs Awaiting).
   - Level 3: Advanced data accordion showing raw hex calldata, nonce, safeTxHash, and gas parameters.
   - Level 4: Action bar with `Sign`, `Reject`, or `Execute` buttons.

4. **Resolution/Status/Timelock Presentation**:
   - Explicit progress bar for quorum: `n / m confirmed`.
   - Clear warning badges when execution is blocked by missing signatures or nonce mismatches.
   - Timelock indicators for modules with delayed execution.

5. **Evidence and Rule Display**:
   - Raw parameter decoding showing decoded contract method calls and arguments.
   - Verification badges confirming contract addresses match known registries.

6. **What Works Well (Keep)**:
   - **Multi-Signer Progress Checklist**: Unambiguous visual audit of which owners have signed and how many are required.
   - **Staging vs Execution Separation**: Explicit distinction between signing an authorization and broadcasting the final state change.
   - **Fail-Closed Safety**: Prohibits execution and explains the exact missing prerequisite in clear language.

7. **What Is Poor or Confusing (Avoid)**:
   - **Unclear Role Boundaries**: In enterprise setups with multiple Safes, users can easily sign from the wrong wallet without clear domain separation.
   - **Nonce Collision Frustration**: Concurrent transactions can conflict without actionable guidance for non-technical users.

8. **Specific Adaptations for ORAKL**:
   - **Honest Multisig Role Disclosure**: In the local testbed (`/local.html`), the UI transparently discloses whether the protocol arbitrator is governed by a real Safe Global multisig or simulated by `LocalRoleMock` (Threshold 2-of-2), listing authorized owner addresses.
   - **Authorized Signer Role Gating**: The Arbitration Settlement panel checks the connected wallet against `isArbitratorOwner()`, disabling the settlement submission button with an explanatory message if the wallet is not an authorized arbitrator signer.
   - **Immutable Parameter Inspection**: Pre-flight review cards verify that dispute settlement targets the exact market address, adheres to the 200 ETH per-arbitrator exposure budget, and references the dispute evidence hash.

---

### 2.4 Linear

1. **Primary Product URL & Documentation Studied**:
   - Product: [https://linear.app/](https://linear.app/)
   - Documentation: [https://linear.app/docs](https://linear.app/docs)
   - Methodology: High-density, keyboard-driven productivity interface, restrained dark design system.

2. **Discovery & Navigation Patterns**:
   - Sidebar workspace navigation with compact icon-and-label tabs.
   - Dense list views with tabular numbers, subtle vertical column separators, and zero wasted margin.
   - Instant filtering and sorting without page reloads.

3. **Detail View Information Hierarchy**:
   - Level 1: Breadcrumbs showing project path and issue identifier.
   - Level 2: Crisp issue title and markdown description.
   - Level 3: Right-hand sidebar with metadata properties (Status, Priority, Assignee, Labels, Due Date).
   - Level 4: Chronological activity stream with inline status transitions and audit events.

4. **Status & Timelock Presentation**:
   - Discrete, rounded status badges with subdued background tones and crisp accent text (e.g. `Done`, `In Progress`, `Canceled`).
   - Relative and exact timestamps on hover with tabular alignment.

5. **Evidence and Rule Display**:
   - Code blocks and cryptographic IDs displayed in high-contrast monospace fonts (`JetBrains Mono`, `SF Mono`).
   - Subdued 1px neutral borders (`rgba(255, 255, 255, 0.08)`) separating structural panels.

6. **What Works Well (Keep)**:
   - **Modular 4px/8px Spatial Discipline**: Predictable vertical rhythm creates high visual calm and professional feel.
   - **Restrained Color Palette**: Accents are reserved exclusively for status semantics, never background decor.
   - **Tabular Figures**: Ensures financial amounts and timestamps align perfectly in tables and cards.
   - **Dense Data Layouts**: Maximizes visible information without visual clutter or cognitive strain.

7. **What Is Poor or Confusing (Avoid)**:
   - **Over-Reliance on Keyboard Shortcuts**: Web3 users require explicit, visible affordances and confirmations for irreversible financial transactions.
   - **Lack of High-Impact Warning Modals**: Low-friction actions in project management are dangerous in smart contract execution where mistakes lose capital.

8. **Specific Adaptations for ORAKL**:
   - **Institutional Dark Theme**: Deep slate/charcoal backgrounds (`#080c14`, `#0e1524`, `#131c2e`) with crisp 1px borders (`#1e293b`) and zero neon purple glow or blurry glassmorphism.
   - **Tabular Market Directory**: High-density table view with sortable columns (ID, Question, Pool Capital, Status, Deadline) alongside responsive card views.
   - **Explicit Confirmation Modals**: High-stakes operations (Create Market, Propose, Challenge, Settle) require dedicated pre-flight review cards with parameter validation.

---

## 3. Reference Product to ORAKL Component Mapping Matrix

| Benchmark Product | Feature / Pattern | ORAKL UI Component | Protocol Alignment in ORAKL | Anti-Pattern Eliminated |
| :--- | :--- | :--- | :--- | :--- |
| **Polymarket** | Rules-First Hierarchy | `Resolution Rules Callout` | Directly binds question to objective resolution criteria and source URI | Eliminates buried rules and ambiguous settlement terms |
| **Polymarket** | Optimistic Proposal Banner | `5-Stage Resolution Stepper` | Reflects 48h challenge window, 10 ETH proposal bond, and proposer identity | Eliminates unnotified settlement transitions |
| **Polymarket** | Probability Share Display | `Pool Contribution Distribution Card` | Pari-mutuel proportional distribution with explicit "Non-Guaranteed" disclaimer | Eliminates misleading continuous token price illusions |
| **Kleros** | Cases Dispute Table | `Arbitration Workspace (#/arbitration)` | Displays all markets in `DISPUTED` state with capital at risk and challenge counts | Eliminates hunting through market lists for contested outcomes |
| **Kleros** | Chronological Evidence Log | `Evidence Dossier & Inspector` | RFC 8785 canonical JSON hash verification and IPFS CID auditing | Eliminates unverifiable or mutable dispute claims |
| **Kleros** | Dispute Timelines | `Resolution Timeline Card` | Visualizes proposal deadline, challenge window, and 48h terminal arbitration window | Eliminates infinite appeal cycles and delayed finality |
| **Safe Global** | Multi-Signer Status List | `Honest Multisig Role Card` | Displays threshold (2-of-2 in testbed, 3-of-5 in Safe), owner addresses, and role eligibility | Eliminates misleading mock claims of production Safe consensus |
| **Safe Global** | Pre-Flight Parameter Review | `Publication & Settlement Review Cards` | Displays exact calldata target, bond commitment, metadata hash, and network ID (31337) | Eliminates blind signing and accidental parameter drift |
| **Linear** | 4px/8px Geometric Layout | `ORAKL Design System Tokens` | Modular spacing (`--spacing-1` through `--spacing-8`), tabular monospace figures | Eliminates random AI-slop padding and misaligned figures |
| **Linear** | Discrete Status Pills | `State Badge Component` | Semantic state coloring (`OPEN` blue, `PROPOSED` amber, `DISPUTED` purple, `FINALIZED` green) | Eliminates garish full-card neon backgrounds |

---

## 4. Verification & Audit Conformance

This research directly informed the implementation of:
1. `frontend/src/styles.css`: Complete tokenized styling adhering to Linear's density and Safe's high-contrast readability.
2. `frontend/src/local/main.ts`: Modular two-column layout, resolution stepper, evidence dossier, and dedicated arbitration workspace.
3. `frontend/src/local/navigation.ts`: Pure routing, status tone mapping, pool share calculation, and honest role checking.
4. `frontend/test/resolution-arbitration-ux.test.ts`: Automated test suite verifying lifecycle tones, route switching, and role checks.
