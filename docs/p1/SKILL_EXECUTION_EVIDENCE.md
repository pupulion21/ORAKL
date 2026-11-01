# ORAKL Protocol P1 — Skill Execution Evidence

- **Author**: Antigravity (Google DeepMind Advanced Agentic Coding)
- **Branch**: `feature/orakl-p1-end-to-end`
- **Execution Date**: 2026-11-01
- **Standard Applied**: Matt Pocock Engineering Skill Suite + QIE-FORGE Blockchain Domain Suite (v0.6.0-ecosystem.2)
- **Status**: `VERIFIED & DOCUMENTED`

---

## 1. Overview & Skill Framework Integration

Per the mandatory ORAKL P1 repository instructions, all code modifications, bug diagnostics, test designs, and verification procedures were conducted using two integrated skill systems:
1. **Matt Pocock Skills Suite**:
   - [`diagnosing-bugs`](file:///home/pupulion/.gemini/config/skills/diagnosing-bugs/SKILL.md): Rigorous 8-step reproducible defect resolution.
   - [`tdd`](file:///home/pupulion/.gemini/config/skills/tdd/SKILL.md): Strict Red-Green-Refactor test-driven development.
   - [`code-review`](file:///home/pupulion/.gemini/config/skills/code-review/SKILL.md): Dual-axis review (Standards & Spec) across all modified files.
2. **QIE-FORGE Blockchain Suite (v0.6.0-ecosystem.2)**:
   - **D04 — Smart Contracts**: ABI verification, integer arithmetic, and exposure budgets.
   - **D05 — Wallets**: EIP-1193 provider encapsulation, wallet session gating, and account switching.
   - **D06 — Transactions**: Transaction confirmation wait (`waitMined`), receipt status verification, zero blind retries.
   - **D07 — Frontend**: Synchronized state management, integer formatting, and UI controls.
   - **D13 — Debugging**: Receipt status diagnostics, block timestamp reconciliation, and failure tracing.
   - **D14 — Deployment**: Strict local boundary enforcement (Chain ID 31337), loopback binding, and deployment verification.

---

## 2. Matt Pocock Skill Execution Evidence

### 2.1 Diagnosing-Bugs Loop Applications

During P1 browser E2E development, several non-trivial issues were diagnosed and resolved using the 8-step `diagnosing-bugs` discipline:

#### Defect 1: Proposal Buttons Permanently Disabled in UI
- **Symptom**: In Scenario A (and B), Playwright timed out waiting for `button[data-action="propose-yes"]` to become enabled.
- **Root Cause Analysis**: Line 1249 in `frontend/src/local/main.ts` evaluated `const deadlinePassed = now >= Number(market.challengeDeadline);`. Because `challengeDeadline` is uninitialized (`0n`) until a proposal is submitted, `now >= 0` evaluated to `true`, permanently locking proposal buttons.
- **Smallest Correct Fix**: Replaced the check with the true proposal window:
  ```typescript
  const latest = Number(market.maxResolutionTime) - deployment.parameters.challengePeriod - deployment.parameters.arbitrationPeriod;
  const proposalClosed = now > latest;
  ```
- **Verification**: Proposal buttons enabled cleanly upon close time and accepted UI submissions.

#### Defect 2: Market Creation Time Check Mismatch
- **Symptom**: Market creation form submitted but flashed `Resolution time must be after the closing time` and aborted.
- **Root Cause Analysis**: `contracts/src/MarketFactory.sol` enforces `if (resolutionTime < closeTime) revert InvalidTime();`, allowing `resolutionTime == closeTime`. The frontend condition `if (resolutionTime <= closeTime)` improperly rejected equality.
- **Smallest Correct Fix**: Updated `frontend/src/local/main.ts` to `if (resolutionTime < closeTime)`.
- **Verification**: Market creations with `resolutionTime == closeTime` succeed reliably.

#### Defect 3: Arbitrator Settlement State Assertion in INVALID Outcome
- **Symptom**: Scenario B failed at `assert(mRecB.storedState === 4, 'Market #1 must be RESOLVED')`.
- **Root Cause Analysis**: Under `contracts/src/MarketResolver.sol`:
  ```solidity
  if (outcome == T.Outcome.INVALID) {
      m.storedState = T.State.CANCELLED; // enum value 5
      emit MarketCancelled(id, msg.sender, 2);
  }
  ```
  Settling INVALID intentionally transitions the market to state 5 (`CANCELLED`) with `refundable = true` and `protocolFee = 0n`.
- **Smallest Correct Fix**: Updated E2E runner assertion in `scripts/p1/run-browser-e2e.mjs` to assert `mRecB.storedState === 5` and `mRecB.refundable === true`.
- **Verification**: Scenario B completed 14 on-chain browser transactions to 100% completion.

#### Defect 4: Protocol Deactivation After Scenario C Emergency Pause
- **Symptom**: Scenario D failed on Market D1 creation with transaction reverted.
- **Root Cause Analysis**: In Scenario C, `ProtocolConfig.pause()` invoked `_interrupt()`, setting `paused = true` and `financialActive = false`. Guardian cannot unpause (`onlyGovernance`). Restoring the protocol requires:
  1. Compliance `approveRelease` via 2-of-2 multisig.
  2. 24h (`86400s`) recovery delay advance on Anvil.
  3. Governance `unpause()` via 2-of-2 multisig.
  4. Governance `activateFinance()` via 2-of-2 multisig.
- **Smallest Correct Fix**: Implemented `multisigExecuteBothOwners` in `run-browser-e2e.mjs` executing the full 4-stage governance restoration before Scenario D.
- **Verification**: Protocol restored with `paused = false` and `financialActive = true`; Scenario D succeeded.

#### Defect 5: Anvil Block Revert Check Mismatch (Viem Caching)
- **Symptom**: Scenario D failed at `assert(revertedBlock === snapBlock)` with `56 vs 55`.
- **Root Cause Analysis**: Viem's `publicClient.getBlockNumber()` caches block heights by default, capturing a stale block number before Anvil mined the snapshot state.
- **Smallest Correct Fix**: Switched block number reads to direct JSON-RPC `eth_blockNumber` via `request('eth_blockNumber', [])` with zero client-side caching.
- **Verification**: Snapshot and revert confirmed cleanly at exact block 55.

#### Defect 6: SPA Hash Routing DOM Cache During Reorg Rollback
- **Symptom**: In Scenario D, after Anvil rollback and canonical branch indexing, Playwright assertion `UI must display exact canonical Branch 2 market question` failed because the browser still rendered stale DOM for Market #3.
- **Root Cause Analysis**: The frontend is a single-page app utilizing `location.hash` (`#/market/3`). Navigating to `page.goto('...#/market/3')` when already at `#/market/3` does not trigger a `hashchange` event, preventing fresh API fetches.
- **Smallest Correct Fix**: Added `await page.reload({ waitUntil: 'networkidle' })` in D.6 before inspecting the DOM, forcing fresh API hydration.
- **Verification**: Browser DOM reloads, fetches canonical Market #3, displays canonical question, and confirms absence of orphaned question.

#### Defect 7: EIP-55 Address Checksum Sensitivity in Viem Contract Calls
- **Symptom**: Viem's `simulateContract` threw `InvalidAddressError: Address must match its checksum counterpart`.
- **Root Cause Analysis**: Viem accepts pure lowercase addresses as unchecksummed, but mixed-case addresses are strictly required to match their EIP-55 checksum.
- **Smallest Correct Fix**: Sanitized test address constants to uniform lowercase or wrapped with `getAddress()`.
- **Verification**: Double-claim simulation and bond claim calls execute cleanly without checksum rejection.

#### Defect 8: Frontend Session Provider Call Encapsulation
- **Symptom**: `tsc --noEmit` failed with TS2339: `Property 'provider' does not exist on type 'WalletSession'`.
- **Root Cause Analysis**: `WalletSession` in `frontend/src/wallet.ts` encapsulates the EIP-1193 provider and exposes `request<T>(method, params)` directly on the session instance.
- **Smallest Correct Fix**: Changed `state.session.provider.request` to `state.session.request<string>('personal_sign', [msgHex, publisher])`.
- **Verification**: `npm --prefix frontend run typecheck` and `npm --prefix frontend run build` pass with 0 errors.

---

### 2.2 Test-Driven Development (TDD) Evidence

All new features and remediations were developed test-first:

1. **Trusted Factory Validation (P1-FINAL-01)**:
   - **Red**: Created failing tests in `backend/test/publication-auth.test.ts` where a rogue factory signed with a valid signature was submitted, and where deployment manifest had tampered chain ID or was missing. Initially failed (routes passed client-supplied factory to auth verifier).
   - **Green**: Implemented server-side `resolveTrustedDeployment(config, prisma)` in `backend/src/api/server.ts` checking disk manifest / configuration integrity, binding chain ID, factory, and ProtocolConfig. Rogue factories now reject with `400 WRONG_FACTORY`; missing/tampered manifests fail closed with `503 DEPLOYMENT_UNAVAILABLE`.
   - **Refactor**: Added `trustedFactory` and `deploymentManifestPath` to `BackendConfig` in `backend/src/config.ts`. All 16 tests in `publication-auth.test.ts` pass green.

2. **Atomic Nonce Consumption & Publication (P1-FINAL-02)**:
   - **Red**: Created failing integration tests verifying that invalid content payloads do NOT consume the nonce (nonce remains usable on retry), and that database failures during artifact persistence trigger complete rollback of the nonce consumption.
   - **Green**: Decoupled `verifyPublicationAuth` (pure cryptographic checks) from `consumePublicationAuthNonce` (database insert) in `backend/src/evidence/auth.ts`. Content validation executes deterministically before touching the database. Nonce consumption and artifact persistence execute atomically within `deps.prisma.$transaction`.
   - **Refactor**: Wrapped rollback test with real database transactions. Nonce rollback confirmed by querying `prisma.authNonce.findUnique`.

3. **Hardened Browser Financial E2E (P1-FINAL-03)**:
   - **Red**: Previous browser runner relied on `blk.transactions[0]` heuristics and lacked client defense verification.
   - **Green**: Enhanced `window.__oraklTestWallet` to intercept all sent transactions and expose `sentTransactions` and `lastTxHash`. Implemented `waitBrowserTx(actionName, expected)` correlating exact transaction hashes, senders, and destinations. Added negative test suite:
     - `NEG.1`: Wrong chain rejection.
     - `NEG.2`: User cancellation (code 4001) handled without UI hang.
     - `NEG.3`: Dynamic account switch detection.
     - `NEG.4`: Duplicate submit button locked while busy.
   - Added double-claim rejection tests verifying `AlreadyClaimed` contract revert in Scenarios A and B. Added strict canonical reorg assertions in Scenario D.

4. **Signed Publication Replay Protection (P1-02)**:
   - **Red**: Created `backend/test/publication-auth.test.ts` testing domain-separated signature verification, wrong-chain rejection, wrong-factory rejection, expired deadline rejection, and duplicate nonce rejection (`409 REUSED_NONCE`).
   - **Green**: Implemented `backend/src/evidence/auth.ts`, `AuthNonce` PostgreSQL model with unique index, and integrated signature validation into `/api/v1/evidence` and `/api/v1/markets/metadata`.
   - **Refactor**: Created `frontend/src/selected/auth.ts` sharing exact typed structures with the backend.

5. **Frontend Financial Controls (P1-03)**:
   - Verified side selector encoding, exact BigInt wei stake parsing, multi-bond claims (`claimBond`) for CREATION (0), PROPOSAL (1), and CHALLENGE (2) with recipient redirection, and portfolio API reads. All 91 frontend Node tests pass green.

6. **Evidence Manifest Verification (P1-04)**:
   - Built `scripts/p1/verify-evidence-manifest.mjs` auditing existence, byte count, and SHA-256 checksum of every artifact in `docs/p1/evidence/MANIFEST.json` and `CHECKSUMS.txt`. 13/13 artifacts verified.

---

### 2.3 Matt Pocock Dual-Axis Code-Review Evidence

In accordance with [`code-review`](file:///home/pupulion/.gemini/config/skills/code-review/SKILL.md), the final diff was audited along two independent axes:

#### Axis 1: Standards
- **Fowler Smells Audit**:
  - *Mysterious Name*: All identifiers reveal exact semantics (`resolveTrustedDeployment`, `verifyPublicationAuth`, `consumePublicationAuthNonce`, `waitBrowserTx`).
  - *Duplicated Code*: Common EIP-1193 RPC mocking and transaction correlation logic consolidated in `scripts/p1/run-browser-e2e.mjs`.
  - *Feature Envy*: Session method `request` invoked directly on `state.session` rather than reaching into its private provider internals.
  - *Data Clumps*: Publication auth params bundled into typed `PublicationAuth` interfaces across frontend and backend.
  - *Primitive Obsession*: Amounts parsed as native BigInt wei rather than arbitrary floats or numbers.
- **Repository Rules & Style**:
  - Legacy contracts (`QiePredictionMarket.sol`, `deployments/qie-testnet.json`) strictly preserved untouched.
  - No public network broadcast, no unauthorized mainnet activation.
  - Fastify error envelopes comply with ADR-0012.

#### Axis 2: Spec Alignment
- **P1-FINAL-01**: Server-side trusted factory validation implemented; fails closed on missing/tampered manifest with 503; rejects rogue factories with 400.
- **P1-FINAL-02**: Decoupled cryptographic auth verification from nonce consumption; atomic transaction rollback on DB error; content validation before DB writes.
- **P1-FINAL-03**: Browser E2E correlates exact transaction receipts via `sentTransactions`; negative tests (NEG.1-4) verified; double-claims rejected with `AlreadyClaimed`; fee=0 on INVALID; strict Scenario D reorg assertions verified.

---

## 3. QIE-FORGE Blockchain Domain Execution Evidence

### 3.1 D04 — Smart Contracts
- **Selected ABI Strictness**: Interacted only with versioned ABI `SelectedMarketFactory` and `ProtocolConfig`.
- **Integer Arithmetic Invariant**: All values across contract calls, API payloads, and frontend inputs use exact native BigInt integers (wei). Zero floating-point representation for balances, stakes, or bond entitlements.

### 3.2 D05 — Wallets
- **EIP-1193 Provider Isolation**: Built `window.__oraklTestWallet` conforming strictly to EIP-1193 (`request({ method, params })`, `accountsChanged`, `chainChanged`).
- **Controlled Account Switching**: Playwright tests switch disposable local accounts (`switchAccount(address)`), triggering standard browser wallet events and UI updates without bypassing the frontend signing pipeline.

### 3.3 D06 — Transactions
- **Explicit Mining Wait**: Implemented `waitMined(blkBefore, actionName)` querying direct RPC block numbers and asserting `rc.status === 'success'`.
- **Zero Blind Retries**: Failed transactions fail fast with detailed reverts rather than arbitrary blind loops.

### 3.4 D07 — Frontend
- **Real Chromium UI Interactions**: Playwright interacts via genuine user actions: clicking buttons, filling inputs, selecting dropdown options, navigating hash routes (`#/market/0`, `#/create`, `#/portfolio`, `#/status`).
- **Synchronized State**: Dynamic re-renders upon account swap, live contract reads for claimable rewards/refunds, and multi-challenger tranche tables.

### 3.5 D14 — Deployment Boundaries
- **Strict Chain ID 31337 Isolation**: Automated financial transactions are prohibited on any network other than local Anvil.
- **Database Loopback Binding**: `backend/docker-compose.yml` binds PostgreSQL strictly to `127.0.0.1`.

---

## 4. Execution Metrics Summary

```
====================================================================================================
                        ORAKL P1 REMEDIATION & VERIFICATION SUMMARY
====================================================================================================
 Test Suite                     Tests Run    Passed    Failed    Duration
----------------------------------------------------------------------------------------------------
 Smart Contracts (Foundry)      235          235       0         101.97s
 Backend Vitest                 123          123       0         17.69s
 Frontend Node Test             91           91        0         0.79s
 Real Browser Financial E2E     4 Scenarios  36 Txs    0         95.2s
 Evidence Manifest Verification 13 Artifacts 13        0         0.08s
----------------------------------------------------------------------------------------------------
 Total Automated Checks         462          462       0         ~215s
====================================================================================================
```

**Final Verdict**: `P1 FINAL HARDENING VERIFIED — PUBLIC RELEASE BLOCKED`
