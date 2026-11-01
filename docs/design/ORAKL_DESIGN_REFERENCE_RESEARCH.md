# ORAKL Protocol — Product Design Reference Research & UX Architecture Analysis

> **DOCUMENT ID**: `ORAKL-DES-REF-001`  
> **DATE**: 2026-11-01  
> **TARGET**: ORAKL Protocol Selected Frontend (`/local.html`)  
> **AUTHOR**: Principal Product Designer, Senior Frontend Engineer & Web3 UX Architect  
> **STATUS**: `RESEARCH COMPLETED — ARCHITECTURAL SPECIFICATION`  

---

## 1. Executive Research Summary

To transform ORAKL from a developer verification fixture into a distinctive, institutional-grade prediction market interface, we conducted structured research across four benchmark products:

1. **Polymarket** ([polymarket.com](https://polymarket.com/)) — World benchmark for prediction market discovery, rule specification, and optimistic oracle escalation.
2. **Kleros Dispute Resolver** ([resolve.kleros.io](https://resolve.kleros.io/)) — Pioneer in decentralized arbitration, cryptographic evidence management (ERC-1497), and dispute timelines.
3. **Safe Global** ([app.safe.global](https://app.safe.global/)) — Standard for multisig transaction staging, threshold tracking, signature collection, and fail-closed execution.
4. **Linear** ([linear.app](https://linear.app/)) — Benchmark for high-density information architecture, subdued dark surfaces, keyboard focus, and purposeful micro-interactions.

### Synthesis Matrix

| Product Reference | Core UX Pattern Adopted | Critical Protocol Difference in ORAKL | Anti-Pattern Rejected |
| :--- | :--- | :--- | :--- |
| **Polymarket** | Rules-first market detail, countdown challenge window, probability pill hierarchy | ORAKL is proportional pari-mutuel contribution pools (not continuous CLOB/AMM shares) | Floating token speculation widgets, gamified hype feeds |
| **Kleros Resolver** | Tabular dispute queue, structured evidence timeline, RFC 8785 commitment inspection | ORAKL disputes are resolved by a 3-of-5 Arbitration Safe (not random Schelling point jurors) | Endless appeal rounds, subjective token staking |
| **Safe Global** | Explicit `N-of-M` signature progression, clear staging vs execution separation | Local simulation uses `LocalRoleMock` when Safe library is unattached; must be labeled honestly | Hidden multi-sig execution, fake confirmation progress |
| **Linear** | 4px/8px geometric spacing, understated borders, dense data tables, monospace figures | ORAKL carries on-chain financial risk requiring explicit confirmation dialogs | Oversized hero banners, low-contrast text, decorative cards |

---

## 2. In-Depth Reference Product Analyses

### 2.1 Polymarket

- **Website**: [https://polymarket.com/](https://polymarket.com/)
- **Documentation**: [https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved](https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved)
- **Primary Mechanism**: UMA Optimistic Oracle (OO) with 2-hour challenge period, $750 proposal/challenge bond, and escalation to UMA tokenholder voting.

#### 1. What Works Well
- **Unambiguous Rules Statement**: The market question is accompanied by an authoritative "Resolution Source" and "Rules" block visible before placing any trade.
- **Optimistic State Banner**: When a market enters the proposal phase, a dedicated banner highlights the proposed outcome (e.g. "Proposed: YES"), the proposer address, and an active countdown timer for the dispute window.
- **Information Density**: Compact card layouts present pool volume, closing date, current odds, and category tags without visual bloat.

#### 2. What Would Improve ORAKL
- **Dedicated Resolution Lifecycle Section**: ORAKL's market detail page previously buried resolution actions in generic form cards. Elevating resolution into an integrated lifecycle timeline (Open → Proposed → Challenged/Disputed → Finalized) gives users immediate situational awareness.
- **Clear Bond Economics Explainer**: Clearly explaining bond amounts (e.g., Creation Bond: 1 ETH, Proposal Bond: 10 ETH, Challenge Bond: 1 ETH) and refund/forfeiture conditions before transactions are submitted.

#### 3. What Should NOT Be Copied
- **Continuous Orderbook / Token Price Charts**: Polymarket uses binary ERC-20 outcome shares traded via a Central Limit Order Book (CLOB). ORAKL is an on-chain pari-mutuel contribution pool. Showing candle charts or fake pricing would misrepresent ORAKL's math.
- **Social Commentary & Speculative Hype Feeds**: Clutters institutional clarity and distracts from factual settlement evidence.

#### 4. Relevant Interaction Patterns
- Structured outcome tabs (`YES`, `NO`, `INVALID`).
- Prominent resolution source badge linking to official data sources.
- Two-stage confirmation for actions staking capital or bonds.

#### 5. Patterns That Conflict With ORAKL's Protocol
- **Tokenholder Schelling Consensus**: Polymarket escalates disputed markets to thousands of UMA token stakers. ORAKL escalates disputes exclusively to an authorized 3-of-5 Arbitration Safe multisig bounded by a 48-hour arbitration window and immutable exposure budgets (300 ETH global, 200 ETH per-arbitrator).
- **Punitive Slashing**: Polymarket penalizes minority voters. ORAKL enforces neutral-INVALID fallback economics where canceled, expired, or invalid markets return 100% of deposits with zero protocol fee deduction.

---

### 2.2 Kleros Dispute Resolver

- **Application**: [https://resolve.kleros.io/](https://resolve.kleros.io/)
- **Documentation**: [https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/integration-tools/dispute-resolver](https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/integration-tools/dispute-resolver)
- **Primary Mechanism**: Decentralized court with staked PNK jurors, commit-reveal voting, and multi-round appeals.

#### 1. What Works Well
- **Dispute Queue Table**: A comprehensive, filterable case register displaying Case ID, Market Title, Disputed Value, Evidence Deadline, and Case Status in a scannable grid.
- **Chronological Evidence Registry**: Each piece of evidence is itemized with submitter address, submission timestamp, title, description, and cryptographic URI/hash.
- **Transparent Deliberation Log**: Clear record of what arguments were submitted by each party and what ruling choices were evaluated.

#### 2. What Would Improve ORAKL
- **Dedicated Arbitration Workspace**: Creating an `/arbitration` view in ORAKL with a real Dispute Queue table, allowing arbitrators and observers to track disputed markets without digging through individual market pages.
- **Cryptographic Evidence Inspector**: Surfacing RFC 8785 canonical hash commitments directly alongside evidence text, allowing any participant to verify that on-chain evidence has not been tampered with.

#### 3. What Should NOT Be Copied
- **Juror Staking / Token Slashing UI**: ORAKL does not have jurors or PNK tokens; dispute authority is strictly held by the Arbitration Safe.
- **Recursive Multi-Round Appeal Escalation**: Kleros allows repeated appeals with doubling jury sizes. ORAKL enforce a single terminal 48-hour arbitration window to ensure finality.

#### 4. Relevant Interaction Patterns
- Dense, tabular case overview with sortable columns.
- Dedicated evidence drawer or modal showing raw JSON, cryptographic hash, and verification status.
- State badges distinguishing `EVIDENCE_OPEN`, `AWAITING_RULING`, and `RULED`.

#### 5. Patterns That Conflict With ORAKL's Protocol
- **Secret Commit-Reveal Ballots**: Kleros jurors submit hidden hashes. ORAKL's Arbitration Safe signers sign EIP-712 structured data that is publicly verifiable and executed directly via `MarketResolver.settleDispute()`.

---

### 2.3 Safe Global

- **Website**: [https://app.safe.global/](https://app.safe.global/)
- **Primary Mechanism**: Multi-owner smart contract wallet with customizable thresholds (e.g., 3-of-5), nonce serialization, and EIP-712 transaction execution.

#### 1. What Works Well
- **Multi-Signer Progress Visualization**: Displays exact threshold status (e.g. `2 of 5 signatures collected`) with a visual checklist of approved vs pending signer addresses.
- **Clear Staging vs Execution Separation**: Clear distinction between proposing a multisig transaction, adding a signature, and broadcasting the final execution transaction.
- **Fail-Closed Warning States**: Explicit warnings when the connected account is not an authorized owner or when the safe nonce has drifted.

#### 2. What Would Improve ORAKL
- **Honest Multisig Status Indicator**: When arbitration actions are viewed, the UI must clearly display whether the action requires multi-owner authorization, what the threshold is, and whether the connected wallet holds an authorized role key.
- **Local Simulation Transparency**: In `/local.html`, clearly distinguishing when an action executes via `LocalRoleMock` versus real Safe Global multi-sig contracts.

#### 3. What Should NOT Be Copied
- **Full Enterprise Treasury Dashboard**: Safe's interface is designed for balance management, batch transactions, and DeFi apps. ORAKL only requires multisig controls for specific protocol interventions (unpause, release approval, dispute settlement).

#### 4. Relevant Interaction Patterns
- Owner address badges with copyable short hashes.
- Stepped execution modals (Review → Sign → Execute).
- Disabled buttons with explanatory tooltips when quorum is incomplete.

#### 5. Patterns That Conflict With ORAKL's Protocol
- In production, ORAKL's 3-of-5 Safes are disjoint (no single key may belong to both Governance, Compliance, and Arbitration). The frontend must communicate role boundaries and never allow accidental cross-role execution.

---

### 2.4 Linear

- **Website**: [https://linear.app/](https://linear.app/)
- **Primary Mechanism**: Keyboard-first, high-density issue tracking with understated dark mode, precise typography, and instant feedback.

#### 1. What Works Well
- **Rhythmic Spacing & Grid Discipline**: Consistent 4px/8px geometric scale. No arbitrary margins or overlapping cards.
- **Typography Hierarchy**: Crisp, tabular numerals (`font-variant-numeric: tabular-nums`), understated headers, high-contrast readable text without blinding white-on-black glare.
- **Subtle Surface Elevation**: Deep slate/charcoal backgrounds (`#0c111b`, `#121b29`, `#172132`) with 1px borders (`#263246`) instead of blurry drop shadows or garish neon gradients.
- **Status Indicators**: Pill badges with muted background tones and saturated accent text (e.g., green on dark emerald, red on dark rose).

#### 2. What Would Improve ORAKL
- **Dense, Scannable Market Rows**: Replacing generic oversized cards with high-density market rows that provide market title, pool volume, yes/no distribution, closing timestamp, and state tag at a glance.
- **Keyboard Shortcuts & Accessible Focus**: Clear, visible focus outlines (`outline: 2px solid var(--accent); outline-offset: 2px`) on all interactive controls.
- **Command/Filter Bar**: Fast filtering by category, resolution status, and text search without layout shifts.

#### 3. What Should NOT Be Copied
- Issue tracking semantics (assignees, cycles, story points) that do not belong in a financial market.

#### 4. Relevant Interaction Patterns
- Tabbed workspace switcher (`Markets`, `Arbitration`, `Portfolio`, `Create`).
- Split-pane or side-by-side market detail layout (Chart/Pool breakdown on the left, Resolution/Action panel on the right).
- Refined micro-interactions: crisp border hover transitions (150ms ease-out) without bouncy animations.

---

## 3. Product Information Architecture

Based on these research findings, ORAKL's information architecture is restructured into two dedicated user journeys:

```
                                  ORAKL PREDICT
                                         |
     +-----------------------------------+-----------------------------------+
     |                                                                       |
[REGULAR USER EXPERIENCE]                                          [ARBITRATION WORKSPACE]
     |                                                                       |
     +-- Explore Markets (Dense Table & Cards)                               +-- Dispute Queue (Active Disputed Markets)
     +-- Market Detail                                                       +-- Dispute Case View (Rule & Evidence Audit)
     |     +-- Question & Official Resolution Rules                          +-- Multi-Challenger Tranche Analysis
     |     +-- Pool Distribution & Participation                             +-- Authorized Safe Settlement Affordance
     |     +-- Resolution Timeline (Open -> Prop -> Disp -> Fin)             +-- Settlement History & Neutral Ledgers
     |     +-- Evidence Dossier (RFC 8785 Hashes)
     |     +-- Bond Reclamation & Settlement Payout
     +-- Portfolio (Active Stakes, Claims & Bond Redirection)
     +-- Create Market (Pilot Caps & Metadata Specification)
     +-- Evidence Lab (Interactive RFC 8785 Canonicalizer)
     +-- Protocol Status (Trust Anchors & Real-Time Sync)
```

---

## 4. Anti-AI-Slop Design Constraints Enforced

In strict compliance with project guidelines, the following visual rules are codified:
1. **No Gradients as Backgrounds**: Zero purple/magenta glowing blobs or radial gradient backdrops. Surfaces are clean, solid dark slate (`#0a0f18`, `#101725`, `#162032`).
2. **No Glassmorphism**: Zero blurry frosted glass overlays with high opacity white borders. Structural separation is achieved via clean 1px borders (`#1e293b`).
3. **Restrained Accent Colors**: Accents are strictly functional:
   - Neutral/Brand: Electric Cobalt (`#3b82f6` / `#60a5fa`)
   - Outcome YES: Mint Emerald (`#10b981` / `#34d399`)
   - Outcome NO: Coral Rose (`#ef4444` / `#f87171`)
   - Status Warning/Pending: Warm Amber (`#f59e0b` / `#fbbf24`)
4. **Editorial Typography**: Systematic use of `IBM Plex Sans` for UI copy and `JetBrains Mono` / `SF Mono` for addresses, hashes, and financial amounts.
5. **Honest State Communication**: If an action is not executable by the connected wallet, the button is disabled with an explicit reason; no mock progress is disguised as production Safe consensus.
