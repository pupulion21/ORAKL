# ORAKL Design System — Precision, Conviction, Transparency

> **DOCUMENT ID**: `ORAKL-DS-001`  
> **VERSION**: 1.0.0  
> **TARGET**: ORAKL Protocol Selected Frontend (`/local.html`)  
> **STATUS**: `SPECIFICATION & IMPLEMENTATION STANDARD`  

---

## 1. Design Philosophy: Anti-AI-Slop

ORAKL is an institutional-grade decentralized prediction market protocol designed for high-integrity settlement. Its visual interface strictly rejects the tropes of generic AI-generated Web3 dashboards:

- **No Gratuitous Gradients**: No glowing purple backgrounds, radial gradient blobs, or decorative colored blurs.
- **No Glassmorphism**: No blurry frosted glass panels or fake translucent overlays. Structural depth is created via disciplined surface values and crisp 1px borders.
- **No Decorative Cards**: Content is organized into information-dense, scannable data layouts and structured tables inspired by professional trading software and Linear.
- **No Misleading Statistics**: Pool shares are clearly labeled as contribution distributions, never guaranteed odds, prices, or fixed payouts.
- **No Fabricated Multisig Progress**: All role authorizations, signers, and contract execution requirements are reported with 100% fidelity to the actual on-chain runtime state.

---

## 2. Color System & Design Tokens

The color palette is built on deep slate neutrals with high contrast text and purposeful functional accents:

```css
:root {
  /* Surface Layers (Disciplined Dark Slate) */
  --bg-canvas: #090d16;        /* Root document background */
  --bg-surface: #0f1523;       /* Sidebar and topbar chrome */
  --bg-panel: #141c2e;         /* Elevated cards and table rows */
  --bg-elevated: #1a253c;      /* Hover states and modals */
  --bg-subtle: #1e2b45;        /* Active selections and input backgrounds */

  /* Structural Dividers & Borders */
  --border-subtle: #1c273c;    /* Hairline separators */
  --border-default: #25344f;   /* Card, button, and input borders */
  --border-strong: #384d72;    /* Interactive hover borders */
  --border-focus: #3b82f6;     /* Keyboard focus ring */

  /* Editorial Typography */
  --text-primary: #f8fafc;     /* Headings, titles, and active values */
  --text-secondary: #cbd5e1;   /* Body copy and labels */
  --text-muted: #8494b2;       /* Metadata, captions, and placeholders */
  --text-disabled: #4e5d78;    /* Inactive controls and disabled text */

  /* Functional Accents */
  --accent-brand: #3b82f6;     /* Primary brand action blue */
  --accent-brand-hover: #2563eb;
  --accent-brand-subtle: #1d335a;
  
  --outcome-yes: #10b981;      /* Outcome YES (Mint Emerald) */
  --outcome-yes-bg: #092e22;
  --outcome-yes-border: #135d44;
  
  --outcome-no: #ef4444;       /* Outcome NO (Coral Rose) */
  --outcome-no-bg: #351419;
  --outcome-no-border: #73232c;
  
  --status-warn: #f59e0b;      /* Pending timelocks, dispute warnings */
  --status-warn-bg: #332009;
  --status-warn-border: #6e4616;

  --status-invalid: #a855f7;   /* Neutral-INVALID ruling */
  --status-invalid-bg: #29123b;
  --status-invalid-border: #56277d;

  /* Typography Stacks */
  --font-sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;

  /* Geometry & Radius */
  --radius-xs: 4px;            /* Badges, tags, and pills */
  --radius-sm: 6px;            /* Buttons, inputs, and small controls */
  --radius-md: 8px;            /* Standard cards and dialog panels */
  --radius-lg: 12px;           /* Large modal containers */

  /* Shadows (Restrained Elevation) */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px 0 rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 12px 32px 0 rgba(0, 0, 0, 0.65);
}
```

---

## 3. Typography Scale & Hierarchy

All numerical data, Ethereum addresses, hashes, and financial metrics utilize monospace font variants with tabular numbers (`font-variant-numeric: tabular-nums`) to ensure vertical alignment across data grids:

| Token / Class | Size | Line Height | Weight | Tracking | Primary Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display-1` | 28px | 34px | 600 (Semibold) | -0.6px | Market Detail Question Title |
| `heading-1` | 22px | 28px | 600 (Semibold) | -0.4px | Section Titles, Workspace Headers |
| `heading-2` | 16px | 22px | 600 (Semibold) | -0.2px | Card Headers, Table Group Labels |
| `body-default`| 14px | 20px | 400 (Regular) | Normal | Body text, descriptions, table cells |
| `body-sm` | 12px | 16px | 400 (Regular) | +0.2px | Subtitles, helper text, explanations |
| `caption` | 11px | 14px | 500 (Medium) | +0.5px | Status pills, table column headers (uppercase) |
| `mono-code` | 12px | 16px | 400 (Regular) | Normal | Addresses, bytecodes, hashes |
| `mono-stat` | 15px | 20px | 600 (Semibold) | Normal | Pool quantities, bond figures, countdowns |

---

## 4. Layout Architecture & Responsive Breakpoints

### Viewport Targets
- **Desktop Wide (`>= 1440px`)**: Fixed 240px sidebar, max 1440px fluid workspace content.
- **Desktop Standard (`1280px - 1439px`)**: Fixed 240px sidebar, fluid workspace.
- **Tablet (`768px - 1279px`)**: Collapsed icon-rail sidebar (64px) or topbar navigation, stacked market detail cards.
- **Mobile (`<= 767px`, down to 390px)**: Bottom navigation bar (48px height), full-width cards, horizontally scrollable data tables with sticky column headers.

### Grid & Spacing System
Built on a strict 4px/8px modular rhythm:
- `4px` (`space-1`): Micro gaps inside badges, button icon margins.
- `8px` (`space-2`): Input padding, gap between related items.
- `12px` (`space-3`): Card interior component spacing.
- `16px` (`space-4`): Standard padding for cards and table rows.
- `24px` (`space-6`): Distance between layout sections.
- `32px` (`space-8`): Workspace page header padding.

---

## 5. Component System Specification

### 5.1 Status Badges & Pills
Status pills encode market and contract state using deliberate color pairs:
- **`OPEN`**: Cyan/Blue tint (`bg: #0f2747`, `text: #60a5fa`, `border: #1e3a66`) — Staking is active.
- **`PROPOSED`**: Amber tint (`bg: #332009`, `text: #fbbf24`, `border: #6e4616`) — Outcome proposed, challenge window open.
- **`DISPUTED`**: Rose tint (`bg: #351419`, `text: #f87171`, `border: #73232c`) — Under official 3-of-5 Safe arbitration.
- **`FINALIZED`**: Emerald tint (`bg: #092e22`, `text: #34d399`, `border: #135d44`) — Settled and claimable.
- **`INVALID`**: Purple tint (`bg: #29123b`, `text: #c084fc`, `border: #56277d`) — Ruled neutral-invalid, full refund.

### 5.2 Resolution Progress Timeline
A multi-stage horizontal/vertical milestone component tracking real-time market lifecycle:
1. **Creation & Open Phase**: Displays market creator, creation bond, close timestamp.
2. **Proposal Phase**: Displays proposer address, proposed outcome, proposal bond, and challenge countdown timer.
3. **Challenge / Dispute Phase**: Displays challenger address, challenge bond, evidence hash, and arbitration window countdown.
4. **Final Settlement**: Displays final outcome, settling authority (Arbitration Safe vs Undisputed Finalization), and total rewards/refunds available.

### 5.3 Evidence Dossier Panel
- Itemizes every submitted evidence manifest.
- Distinguishes **Proposal Evidence**, **Challenge Evidence**, and **Arbitration Deliberation**.
- Includes an interactive **Inspect Evidence** trigger that opens a cryptographic proof modal displaying:
  - Canonical RFC 8785 JSON representation
  - Keccak-256 commitment hash
  - Submitter address
  - Cryptographic verification badge (Validated vs Tampered vs Missing)

### 5.4 Arbitration Dispute Queue Table
A high-density table replacing cluttered cards:
- Columns: `Case / Market ID`, `Market Title & Question`, `Proposed Outcome`, `Dispute Deadline`, `Evidence Count`, `Arbitration Safe Authority`, `Quick Action`.
- Row hover with clear 1px highlight.
- Direct link to Case Details with dedicated multi-sig action panel.

### 5.5 Action Cards & Form Affordances
- **No Dead Buttons**: When an action cannot be performed, the button is disabled and displays an explanatory tooltip or inline sub-label (e.g. `Wallet not an authorized arbitrator`, `Challenge window closed`, `Insufficient balance`).
- **Two-Column Market Detail**: Information and evidence on the left; user position, prediction input, and action triggers on the right.
- **Monospace Financial Inputs**: Currency and bond amounts always display ETH unit labels and format numbers with exact decimal places.

---

## 6. Accessibility (WCAG 2.1 AA Compliance)

1. **Color Contrast**: All primary text against background surfaces achieves at least `7:1` contrast ratio; secondary/muted text achieves at least `4.5:1`.
2. **Keyboard Navigation**:
   - `skip-link`: Direct jump to main content on tab.
   - Visible focus indicator: `outline: 2px solid var(--border-focus); outline-offset: 2px` on all buttons, inputs, links, and tabs.
   - Keyboard accessible modals with `Esc` close handling and focus trapping.
3. **Semantic HTML**: `<nav>`, `<aside>`, `<main>`, `<header>`, `<footer>`, `<dialog>`, `<table>`, `<thead>`, `<tbody>`, `<button>`. All icons include `aria-hidden="true"`.
4. **Reduced Motion**: Respects `prefers-reduced-motion: reduce` by disabling transitions and animations.
