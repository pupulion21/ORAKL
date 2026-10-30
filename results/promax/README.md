# English frontend redesign

Implemented using UI UX Pro Max financial-dashboard and typography guidance. The old cream/serif landing layout is replaced with a dark market workspace, persistent sidebar, topic photography, IBM Plex Sans, compact cards, and four-item mobile navigation. All interface copy, wallet prompts, errors, dates, and documentation are English.

The accepted design specification and skill-search decisions are in `../../design-system/qie-predict/MASTER.md`. The generic Enterprise Gateway landing fallback was rejected in favor of the explicit Financial Dashboard product match.

## Validation

- TypeScript type checking and Vite production build pass.
- All 39 frontend unit tests pass, including wallet/session checks, exact accounting math, and original-hash receipt recovery.
- `evidence.json`: 11 browser workflow groups; search/categories, empty recovery, bookmark persistence, draft creation, validation, portfolio gates, FAQ, keyboard shortcuts, skip link, modal focus/inert handling, delayed RPC, manifest errors, and responsive overflow checks at 375/390/768/1024/1440px.
- `accessibility.json`: axe-core WCAG 2 A/AA and 2.1 AA scans of seven routes at desktop and mobile plus the connection dialog; zero reported violations after correcting guide step-number contrast.
- `connected-accessibility.json`: additional scan of market detail, stake controls, connected wallet, and transaction history using controlled test fixtures.
- `receipt-regression.json`: create, stake, and deployment recover from delayed receipts without duplicate writes. Out-of-range uint64 dates render safely.
- `production-smoke.json`: built assets served locally; real read-only public RPC requests; verifies English document metadata, all topic images, self-hosted fonts, nine labeled starter ideas, and no document overflow or page errors.

These scans complement visual and keyboard checks; they do not establish complete accessibility conformance. Browser wallet and transaction tests use controlled fixtures and do not prove live extension compatibility, network finality, or actual QIE transactions.

## Images

`desktop.png` shows the market workspace. `mobile-375.png`, `mobile-390.png`, `tablet-768.png`, and `tablet-1024.png` show viewport captures. `create.png`, `portfolio.png`, `how-it-works.png`, `deploy.png`, `wallet-dialog.png`, and `detail-connected.png` cover other flows. `partial-error.png` shows discovery continuing after manifest failure. `production-live.png` shows the production bundle with real read-only network access.

Starter ideas are explicitly labeled and accept no stakes. No real deployment, market volume, probabilities, wallet balances, or signed transactions were invented. The contract still requires a verified public deployment before live markets are available.
