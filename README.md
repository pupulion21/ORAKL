# QIE Predict

An English prediction market platform on **QIE EVM Testnet, chain 1983**. Stake native QIE on YES or NO. The contract holds stakes, distributes the final pool to winning positions, and enables refunds for invalid results or cancellation.

The frontend uses a dark market workspace designed with **UI UX Pro Max**: persistent topic navigation, photographic collections, readable market cards, a focused trading panel, and mobile bottom navigation. It is built with vanilla TypeScript, Vite, and viem. Fonts and images are self-hosted; asset sources and the font license are in `frontend/public/media/`. The design specification is in `design-system/qie-predict/MASTER.md`.

## QIE Testnet deployment

Live contract: [`0x43A666a9a305232E6a10fae8507d67EF64F02C98`](https://testnet.qie.digital/address/0x43A666a9a305232E6a10fae8507d67EF64F02C98). [Deployment transaction](https://testnet.qie.digital/tx/0x6b8d52be72cbb99137b047fd142f7cc83a3f5bf08daafdc4170caf307dbb71f1).

The bundled public manifest activates this contract after runtime-bytecode and accounting verification. The contract was deployed with official faucet tokens using a separate local deployment wallet. Its encrypted keystore stays under the Git-ignored `secrets/qie-testnet/` directory and is excluded from the frontend. Deployment and verification evidence is in `results/deployment/`.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm --prefix frontend ci
npm run dev
```

Open http://localhost:5176/. The default port is 5176. To use another port:

```sh
npm run dev -- --port 5177
```

```sh
npm run typecheck
npm test
npm run build
```

Static hosting output is in `frontend/dist`. Hash routing lets market links work without server rewrite rules.

Consumer pages show a simple connection overview. JSON imports, contract deployment, compiler hashes, and diagnostics live at `#/developer`, behind deliberate navigation and collapsed sections. This is a UX separation, not an admin authorization system; contract permissions and wallet approvals still enforce writes.

## Platform flows

- **Markets:** search, topic categories, status filters, sorting, and market details. Topics are inferred from question keywords; they do not alter contract rules.
- **Watchlist:** save markets or starter ideas in this browser. Saved market IDs are scoped to their contract address.
- **Create market:** enter a question, YES/NO/INVALID criteria, source, closing time, resolution deadline, and resolver. Draft before connecting; publishing requires a wallet and a verified contract.
- **Market details:** pool composition, rules, reference source, wallet position, payout estimates, staking, claims, refunds, and phase-appropriate resolver actions.
- **Portfolio:** open positions and claimable funds read from the contract. A disconnected wallet shows no fabricated balances.
- **Resolve markets:** manual settlement by the designated resolver within the contract’s resolution window.
- **How it works:** market mechanics, payouts, refunds, and Testnet information.

When no contract is active, discovery shows clearly labeled **starter ideas**. An idea fills only a draft question and dates. Criteria and sources must be supplied before publishing. Ideas have no pool, odds, volume, or staking action.

YES/NO percentages in funded markets show **pool share**, not probability or share price. Payout estimates can change before resolution. The resolver’s result is final. Payouts round down according to the contract; rounding dust remains in escrow.

## Maintain a QIE contract

1. Open **Network status** in the footer (`#/network`; old `#/deploy` links still work). Open **Advanced options → Developer tools** only when maintaining the platform connection.
2. For an existing contract, expand **Use a different contract** and paste its deployment manifest and select **Verify & connect**. Chain ID, runtime bytecode, and contract accounting must pass verification.
3. For a new deployment, expand **Deploy a separate platform**, connect on QIE Testnet, and review the deployment transaction, and approve in your wallet. The application never accesses private keys or seed phrases.
4. Download the manifest to `frontend/public/deployments/qie-testnet.json`, then rebuild and redeploy so all visitors use the same contract.

Imported configurations apply to the current tab session. Contracts are never silently activated from localStorage. No fabricated deployment address is included.

Default RPC endpoints are in `frontend/src/config.ts`. `VITE_QIE_RPC_URL` optionally overrides them; use a public endpoint because the value is bundled into the frontend. The app requires chain 1983.

## Transactions and verification

The confirmation dialog closes after the wallet returns a hash. Recover pending or unknown transactions with **Check receipt**, without resending. If a receipt succeeds but its application effect still needs verification, select **Recover result**. A successful receipt alone does not prove network finality.

Contract checks require Foundry and the compiler configured in `contracts/foundry.toml`:

```sh
cd contracts
forge test --offline
```

UI screenshots and browser evidence are in `results/promax/`. The simplified connection and developer-tools UX, accessibility checks, receipt recovery regression, and production read-only check are in `results/ux-simplification/`. Browser tests use controlled RPC and wallet fixtures; they do not prove live QIE Wallet extension compatibility or live signing. A separate read-only RPC observation is in `results/platform/network-observation.json`. The live deployment, actual receipt, runtime verification, and frontend activation are recorded separately in `results/deployment/`. These observations do not imply network finality or explorer source verification.
