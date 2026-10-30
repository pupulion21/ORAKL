# QIE Predict platform delivery

The existing QIE escrow application is now presented as an Indonesian prediction market platform. Local development preview is running at `http://localhost:5176/`.

Implemented product surfaces: market discovery with topic filters/search/status/sort; persistent browser watchlists scoped to deployment; clearly labelled idea discovery before deployment; create-from-idea drafts that require real rules and sources; market detail with YES/NO staking and settlement actions; portfolio; resolver panel; learning/FAQ; and verified deployment import/setup.

The design uses a warm light surface, burgundy primary actions and distinct YES/NO colors. The existing Vite/TypeScript architecture and Solidity contract/ABI are retained. No runtime dependencies were added. Application setup and operation are documented in the root README.

## Validation

| Check | Result |
| --- | --- |
| Root `npm run typecheck` | PASS |
| Root `npm test` | PASS, 39/39 tests |
| Root `npm run build` | PASS |
| Discovery/product browser checks | PASS, 11 workflows; no page errors |
| Receipt browser regressions | PASS, four scenarios with mock wallet/RPC; no page errors |
| Desktop/tablet/mobile | Inspected at 1440x1000, 768x1024 and 390x844; no document overflow |
| Design evidence checker | PASS for `evidence.json` |
| Live read-only QIE network preflight | PASS, observed chain 1983 and a nonzero latest block |

Product browser checks include combined category/search filters, empty/reset, bookmark persistence/removal, required criteria/source on drafts, disconnected portfolio, dialog keyboard focus/Escape/restore, accessible FAQ, search shortcut, skip navigation preserving the hash route, long titles, responsive pages, reduced motion, manifest errors and loading discovery. Transaction regressions cover an out-of-range timestamp and delayed create/stake/deploy receipt recovery without resubmitting writes. Completed transaction history automatically collapses so the prediction panel stays accessible.

Artifacts: [desktop](desktop.png), [tablet](tablet.png), [mobile](mobile.png), [connected market detail](detail-connected.png), [partial/error state](partial-error.png), [design/browser evidence](evidence.json), and [network observation](network-observation.json). Design constraints are in `../platform-design-contract.md`; receipt regression results are in `../browser-regression.json`.

The UI testing environment uses a simulated wallet/RPC. Values in the connected-detail screenshot belong only to that fixture. The live preflight is a separate read-only observation and does not prove extension compatibility, historical RPC read support or finality.

No public hosting deployment, live signing, or on-chain contract deployment was performed. Shared live markets require a verified deployment manifest at `frontend/public/deployments/qie-testnet.json`. Until then, discovery contains labelled ideas with draft actions, not invented funded markets or prices.
