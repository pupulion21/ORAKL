# Frontend ABI migration — requires separate approval

P0 does **not** change any file under `frontend/`, the deployed legacy contract, generated legacy ABI, `scripts/gen-abi-ts.mjs`, or the Testnet public manifest. The current English Vite/TypeScript UI continues to serve the legacy protocol. Do not import a v1 address into its legacy manifest: runtime and accounting checks must reject it.

## Current integration evidence

| File | Existing responsibility |
| --- | --- |
| `frontend/src/abi.ts:1` | Generated legacy ABI, creation bytecode and artifact digests. |
| `frontend/src/chain.ts:22` | Numeric outcome/side types and legacy market/position records. |
| `frontend/src/chain.ts:99` | Separate `getMarket` and string metadata reads. |
| `frontend/src/chain.ts:184` | Same-block global accounting reads. |
| `frontend/src/chain.ts:236` | Chain/runtime/accounting verification. |
| `frontend/src/chain.ts:330` | Legacy stake/create/resolve/claim/refund encoders. |
| `frontend/src/config.ts:17`, `frontend/src/constants.ts:3` | Testnet endpoints, chain 1983, native unit and explorer configuration. |
| `frontend/src/transactions.ts:38` | Receipt hash binding and original-hash recovery, independent of signing. |
| `frontend/src/wallet.ts:373` | Session generation/account/chain recheck, single eth_sendTransaction. |

Preserve those wallet/receipt safeguards in the future v1 adapter. A successful receipt is not real-world result correctness or verified chain finality.

## Function changes

| Legacy | v1 facade | Migration consequence |
| --- | --- | --- |
| `createMarket(string,string,string,address,uint64,uint64)` | `createMarket(bytes32,string,uint64,uint64,uint64)` payable | Immutable metadata content hash/IPFS URI; close/resolution/max deadlines; exact snapshotted creation bond. Arbitrator comes from configuration, not the creator form. |
| `stake(id,Side)` payable | `predict(id,Side)` payable | Whole msg.value is contribution; use minimum/cap/activation snapshot and live gate status. No ERC-20 approval. |
| `resolve(id,Outcome)` | Removed | Replace with proposal, challenge, uncontested finalization and arbitration flows. |
| `cancelIfExpired(id)` | `cancelExpiredMarket(id)` | Dispute deadline may precede max deadline; no early arbitrary cancellation. |
| `claim(id)`, `claimTo(id,recipient)` | Same selectors but new state/accounting | Bind to v1 deployment identity and new ABI. |
| `refund(id)`, `refundTo(id,recipient)` | `claimRefund(id)`, `claimRefundTo(id,recipient)` | Only terminal refundable markets; same owner-directed entitlement. |
| `projectedPayout`, `projectedRefund` | `getClaimable(id,user)` returns `(payout,refund)` | For terminal eligibility. Nonterminal indicative previews must use frozen fee/pools and remain explicitly variable. |
| `getMarketMeta` | Removed | Read immutable metadataHash/metadataURI in getMarket; retrieve/hash-verify content off-chain. |
| `remainingEscrow`, `totalEscrow`, `totalStakeReceived`, `totalPaidOut` | New market allocation fields and global liability/counter views | Never compare participant-only escrow to total balance without fee/bond liabilities. |

New payable calls: `proposeResult(id,Outcome,evidenceHash)` with exact proposal bond; `challengeResult(id,evidenceHash)` with exact challenge bond. New nonpayable calls: `finalizeResult(id)`, `settleDispute(id,Outcome,evidenceHash)`, `claimBond(id,BondType,recipient)`, `withdrawProtocolFees(amount,recipient)` (governance-only). Read `protocolConfig()`, configuration parameters, financialActive/paused/factory binding, activityEpoch, marketState, getBond, getPoolTotals and totalAccounted.

## Structs and enums

`Side`: 0 YES, 1 NO. `Outcome`: 0 UNRESOLVED, 1 YES, 2 NO, 3 INVALID. These numeric values are retained, but outcome alone no longer determines the lifecycle.

`State`: 0 OPEN, 1 CLOSED, 2 PROPOSED, 3 DISPUTED, 4 FINALIZED, 5 CANCELLED. Use `marketState(id)`; a stored OPEN may already be CLOSED by time. INVALID is CANCELLED. A YES/NO result with no winning collateral is FINALIZED and refundable. `Position` remains independent uint128 YES/NO and one settlement flag, now returned as a struct.

`getMarket` returns creator, metadata hash/URI, three timestamps, snapshotted `Parameters`, stored state, proposed/final outcomes, proposer/challenger, three evidence hashes, proposal activity epoch, challenge/arbitration deadlines, YES/NO pools, distributable allocation, fee, reward/refund counters and refundable flag. `Parameters` includes feeBps, three bond amounts, minimum, cap, challenge/arbitration periods and arbitrator. Parse all integer financial values as bigint.

Generate a **separate v1 ABI package** from `contracts/out/MarketFactory.sol/MarketFactory.json` and `ProtocolConfig` artifacts after an approved build; do not regenerate/replace the legacy `frontend/src/abi.ts` as part of P0. No production v1 manifest or activation UI is delivered.

## Event changes

Legacy `Staked`, `MarketResolved`, `Claimed`, `Refunded` become `PredictionPlaced`, `MarketOutcomeProposed`/`MarketChallenged`/`DisputeSettled`/`MarketFinalized`/`MarketCancelled`, `RewardClaimed`, `RefundClaimed`. `MarketCreated` now indexes market ID, creator and metadata hash; its data includes URI, three deadlines and full parameter snapshot, replacing the indexed per-market manual resolver. Cancellation reason 1 means timeout; 2 means INVALID.

`BondDeposited`, `BondReleased`, `ProtocolFeeAccrued`, `ProtocolFeeWithdrawn` must be indexed separately from prediction funds. `ProtocolConfig` emits binding, parameter hash, release approval/activation/deactivation and pause events. BondSlashed is absent under the conservative no-slashing policy. Result/event absence must not be invented by the indexer. Reconstruct by `(chainId,facadeAddress,txHash,logIndex)` with reorg-aware finality/replay handling in the future indexer.

## Required UX and network changes after approval

- Separate legacy/v1 deployment namespaces, ABI identities, market IDs, local persistence and portfolio queries. There is no transfer/migration of old escrow.
- Gate financial actions by verified config/facade linkage, runtime identities, active/unpaused state and chain. All four payable entries fail closed even at zero value.
- Show creation/proposal/challenge deposits separately from predictions. Never add bonds to pool share or estimated rewards. Warn of exact-value requirements and configuration changes before submission; a stale reviewed value must revert instead of overcharging.
- Replace manual resolver buttons with evidence submission, challenge countdown, public dispute review, authorized multisig arbitration and permissionless timeout/finalization. Explain trust assumptions. An interrupted proposal cannot finalize uncontested even after resume; show its refund deadline.
- Claim/refund/bond actions remain accessible while paused/deactivated. Recover failed native transfers with owner-directed recipients.
- Display net-of-fee variable payout estimates; pool distribution is not a probability. No sell position or token trading flow.
- Add wallet nonce/session authentication and metadata services separately; wallet connection alone is not server authentication.
- Keep current Testnet configuration intact. Mainnet configuration remains blocked as recorded in QIE_MAINNET_READINESS.md; never replace 1983 merely with a guessed chain ID or reuse Testnet native-currency assumptions.

Future frontend/indexer acceptance requires controlled wallet E2E journeys for every resolution/refund path, reorg/restart testing, same-block balance reconciliation and verified metadata availability. Existing frontend tests validate only the preserved legacy integration.
