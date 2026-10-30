# Simpler connection and maintenance UX

The public interface now keeps attention on browsing, creating, and resolving markets. `#/network` shows network, platform, and wallet status with plain next steps. Existing `#/deploy` links open this same overview.

JSON imports, deployment, RPC diagnostics, hashes, and publishing instructions are at `#/developer`. They are reached through Advanced options on the connection page and use initially collapsed native disclosures. Irreversible deployment still uses the existing review dialog and wallet approval. This presentation is not an admin authorization boundary; contract and wallet checks remain responsible for real permissions.

The resource link is now Resolve markets, with clearer wallet-assignment instructions. The create form explains what the resolver does. Loading no longer briefly reports a missing deployment in the result-review flow. Public footer stats use market and stake totals; internal escrow details are limited to developer tools.

## Validation

- TypeScript checking, all 39 unit tests, and the Vite production build pass.
- `browser-evidence.json`: seven behavior groups covering navigation, native keyboard disclosures, configuration validation, review/cancellation with zero signed transactions, assigned-market behavior, responsive layout, larger text, reduced motion, and loading/missing/error/wrong-network states.
- Five axe-core WCAG 2 A/AA and 2.1 AA scans pass. `connected-accessibility.json` records a sixth scan of the connected market-detail flow. These automated scans complement visual checks and do not establish complete accessibility conformance.
- `receipt-regression.json`: original-hash recovery for create, stake, and deployment continues to work; out-of-range timestamps remain safe. Its three wallet writes use controlled fixtures only.
- `production-live-check.json`: the production build connects to the existing QIE Testnet contract through real read-only RPC requests. The old URL works and the consumer page contains no developer form or deployment action.
- Screenshots cover desktop, 768px tablet, 375px phone, landscape, expanded developer controls, failure states, and the real network connection.

No live chain transaction or new deployment was performed for this UX change. The active contract remains `0x43A666a9a305232E6a10fae8507d67EF64F02C98`. The design rationale is in `design-system/qie-predict/pages/network.md`.
