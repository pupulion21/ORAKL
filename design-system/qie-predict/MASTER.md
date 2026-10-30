# QIE Predict — interface specification

English prediction market workspace. Apply consistently to discovery, watchlist, creation, market details, portfolio, resolver tools, setup, dialogs, and transaction history.

## Skill and reasoning

Source: UI UX Pro Max, `nextlevelbuilder/ui-ux-pro-max-skill`, installed at `/home/pupulion/.codex/skills/ui-ux-pro-max`.

Queries: `prediction market trading dashboard --design-system --density 8 --variance 5`; retry `financial trading platform --design-system --density 8 --variance 5`; explicit product lookup `trading dashboard --domain product`; typography lookup `financial dashboard sans --domain typography`.

Both general design-system outputs fell back to an unrelated Enterprise Gateway landing pattern. Their marketing-page structure was rejected. The explicit Financial Dashboard product match recommends Dark Mode, Data-Dense Dashboard, readable figures, and trust-blue with red/green semantic outcomes. The verified Financial Trust typography match recommends IBM Plex Sans. This specification applies those relevant results to the existing vanilla TypeScript/CSS stack.

## Visual system

- Canvas `#0c111b`, sidebar `#0a101a`, cards `#121b29`, borders `#263246`.
- Main text `#edf2fa`, secondary text `#a3b0c4`, links/focus `#85a9ff`.
- Primary action `#3968e8` with white text; YES `#64d9ae` on `#122f2a`; NO `#ff98a4` on `#36212b`.
- IBM Plex Sans: self-hosted WOFF2, 400/500/600/700, Latin and interface glyph subset. Base 16px/1.5, card questions 17–18px, page titles 30–36px, compact metadata 12px where space permits.
- 6–12px corners. Consistent 1.7px inline SVG icon strokes. No emoji navigation, glass card stacks, decorative charts, invented statistics, or huge marketing hero.
- Topic photographs are decorative inside named collection buttons; visible labels convey their meaning. Sources are recorded with the assets.

## Layout and behavior

Desktop: 232px persistent sidebar; top search/wallet bar; 36px main gutters; three topic collections and three market columns. Intermediate desktop uses a 210px sidebar and two market columns.

At 1024px and below: replace the sidebar with four-item bottom navigation and a horizontally scrollable topic strip. At 760px and below: search gets its own full-width row. At 520px and below: one market column and two compact featured collections, with duplicate starter messaging removed so the first question appears sooner. Technology remains available in topic navigation. All resources remain reachable in the mobile footer.

Market details keep pool/rules/position in the main column and a focused trading panel on desktop. Forms use explicit labels, source/rule helpers, byte counters, grouped sections, and review before wallet approval.

All display copy, placeholders, errors, toasts, dialogs, dates, and status labels are English. User-supplied on-chain questions remain unchanged.

## Data and states

Pool share is never labeled as probability. Empty pools display a dash and a neutral bar. Starter ideas have no invented shares, odds, activity, balance, or volume. They only prepare a draft; publishing remains gated by valid fields, a ready wallet, the correct network, and a verified deployment.

Status and pool sorting controls appear only with a verified active deployment. Support loading, missing deployment, disconnected wallet, empty search/watchlist/portfolio, RPC failure, invalid manifest, pending transaction, receipt recovery, and successful verified writes. Saved markets remain scoped to their deployment.

## Accessibility and verification

Visible keyboard focus, skip-to-main without changing the hash route, named icon buttons, visible form labels, text labels in addition to outcome colors, native disclosure controls, reduced-motion support, and modal focus trapping/restoration with an inert background. Touch actions target 44px. Browser review covers widths 375, 390, 768, 1024, and 1440, with long question text, actual asset loading, and measured document overflow.

Rendered evidence and behavior results: `results/promax/`. Wallet/RPC fixtures in that evidence are controlled test data, not live chain transactions.

Consumer connection status and developer maintenance follow the page override in `pages/network.md`.
