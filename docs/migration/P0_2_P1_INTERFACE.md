# P0.2 candidate interface for P1 development

Status: **CANDIDATE_NOT_FROZEN; integration/migration not approved**. Production Solidity and ABI are byte-for-byte unchanged from P0.1. This export supports interface review and later isolated P1 work. Do not replace `frontend/src/abi.ts`, legacy encoding, network configuration or public Testnet deployment. Economic approval may require an incompatible entitlement ABI before a final freeze.

## Exact machine-readable contract

| File | Contents |
| --- | --- |
| [MarketFactory.abi.json](../../contracts/abi/orakl-v1-candidate/MarketFactory.abi.json) | Complete current deployable facade ABI: inherited functions, outputs/components, events, errors, constructor, receive/fallback |
| [ProtocolConfig.abi.json](../../contracts/abi/orakl-v1-candidate/ProtocolConfig.abi.json) | Complete current noncustodial configuration/release ABI |
| [interface-manifest.json](../../contracts/abi/orakl-v1-candidate/interface-manifest.json) | ABI SHA256s, canonical selectors, event topic0/indexing, enums, exact struct order/types, source hashes, compiler/settings and unpatched artifact identity |
| [Generated interface tables](../../contracts/abi/orakl-v1-candidate/INTERFACE.md) | All68 function signatures and21 event signatures, selectors/topics and indexed fields |

Regenerate offline after `cd contracts && forge build` using `node scripts/export-orakl-candidate-interface.mjs --write` from repository root; verify with `--check`. Export verifies source keccak hashes against compiler metadata, compiler0.8.37, Paris, optimizer50, IR off, metadata hash none, and selector uniqueness. Candidate files have **no deployment addresses or production network** and both deployment/activation authorization false. Runtime hashes describe templates with immutable patches, not actual deployed-instance bytecode. Run the separate artifact-size/legacy identity check as well.

## Financial write calls and native values

All user protocol writes target **MarketFactory**, not its abstract modules and not ProtocolConfig. Quantities are integer smallest units; verified Mainnet currency scale remains a deployment blocker. No ERC20 approval or tradable outcome token exists.

| Canonical signature | msg.value | Conditions / interpretation |
| --- | --- | --- |
| `createMarket(bytes32,string,uint64,uint64,uint64)` | Exactly `config.parameters().creationBond` at inclusion | Returns uint256 id. Hash nonzero; URI8–256 bytes with ipfs:// prefix. Times UTC Unix seconds, uint64; valid chronology. Snapshots all9 terms, creation epoch, arbiter fingerprint. Value/terms race reverts rather than silently underpaying. |
| `predict(uint256,uint8)` | Contribution >= snapshot minimum, <=remaining total cap | Side YES=0, NO=1. Active release/current epoch/OPEN and timestamp<close. Separate balances for both sides and repeated contributions. |
| `proposeResult(uint256,uint8,bytes32)` | Exactly market terms.proposalBond | Outcome YES=1, NO=2, INVALID=3; UNRESOLVED=0 invalid. Resolution time reached; before latest proposal; active/current epoch; nonzero evidence. Creator may propose, but no unilateral instantaneous settlement. |
| `challengeResult(uint256,bytes32)` | Exactly market terms.challengeBond | Only first challenge; now<challengeDeadline; different address from proposer/arbiter. Evidence is objection only, not encoded counter-outcome. |
| `finalizeResult(uint256)` | 0 | Anyone; unchallenged; challengeDeadline<=now<max; active matching release/epoch. No direct trusted `resolveMarket` call. |
| `settleDispute(uint256,uint8,bytes32)` | 0 | Only snapshotted, independently declared-control-checked arbiter; now<arbitrationDeadline. Can decide immediately after challenge. Decision/evidence nonzero. Arbitration can operate while paused, under existing authority. |
| `cancelExpiredMarket(uint256)` | 0 | Anyone after max, or after arbitrationDeadline when disputed; full refund/INVALID. |
| `cancelInterruptedMarket(uint256)` | 0 | Anyone at nonzero `interruptionRefundTime`; full refund/INVALID. Old-epoch markets never reopen. |
| `claim(uint256)` / `claimTo(uint256,address)` | 0 | Caller owns winning position; terminal nonrefundable market; once. Redirect avoids rejecting receiver; total entitlement fixed at settlement. |
| `claimRefund(uint256)` / `claimRefundTo(uint256,address)` | 0 | Caller owns any contribution; terminal refundable market; once and incompatible with reward claim. |
| `claimBond(uint256,uint8,address)` | 0 | Caller owns CREATION=0, PROPOSAL=1, CHALLENGE=2; terminal; full own principal once under current policy. No punitive reward selector or `BondSlashed` event exists. |

Only the first four entries above are payable. Every one requires the financial gate even for zero native value. Direct receive/fallback reject. Forced native funds do not create positions, bonds or fee entitlements. Destinations exclude zero, facade and config. Failed native sends revert all entitlement/liability changes; user can retry deliberately with a valid alternate recipient. Never automatically retry writes because RPC status is unknown.

## Read model, state and tuple rules

`getMarket(uint256)` returns the27-field `ProtocolTypes.Market` tuple in compiler order, including nested9-field Parameters. `getPosition(uint256,address)` returns `(uint128 yes,uint128 no,bool settled)`; `getBond(uint256,uint8)` returns `(address owner,uint128 amount,bool claimed)`. `getPoolTotals` returns `(uint256 yes,uint256 no,uint256 total)`; `getClaimable` returns `(uint256 payout,uint256 refund)`. Decode using full ABI components, never manual offsets or old legacy market tuples. Exact names/types/order are in the manifest's `structures` object.

Enums: State OPEN0, CLOSED1, PROPOSED2, DISPUTED3, FINALIZED4, CANCELLED5; Side YES0/NO1 differs from Outcome YES1/NO2/INVALID3. `storedState` can remain OPEN after time closure; use `marketState(id)` for display and chain time for countdowns. `Position.settled` covers the user's whole market settlement; contributing on both sides does not permit both reward and refund.

**FINALIZED does not imply a reward.** A binary decision with an empty winning side has `refundable=true`, zero fee and full principal refund. INVALID always produces CANCELLED. Use `refundable` and `getClaimable`, not state name alone, to render Claim versus Refund. Losing positions have no reward; unclaimed entitlement floors and dust remain reserved. Payout estimate uses pool totals after the proposed contribution, snapshot fee and integer rounding; label as indicative contribution-dependent payout, never probability or fixed return.

`interruptionRefundTime(id)` returns0 for no applicable interruption or terminal state. Otherwise it is the first-interruption refund boundary, or the original arbitrationDeadline when disputed. An epoch change can quarantine OPEN/CLOSED markets even when `marketState` has not become CANCELLED yet. Show “interrupted; refund available at …” and an explicit cancellation step; do not offer renewed contributions/proposals/challenges after a new release activates.

## Events and indexer reconciliation

Subscribe to all13 facade events and8 config events using the exact generated ABI; the generated tables list all signatures, topic0 values and indexed fields. In particular, `MarketCreated` contains the full terms tuple and all deadlines. `PredictionPlaced` adds confirmed native contributions. `MarketOutcomeProposed`/`MarketChallenged` provide evidence and deadlines. `DisputeSettled` records the arbiter/decision commitment, followed by finalization/cancellation. `ProtocolFeeAccrued` is allocation, not a transfer. `BondReleased`, `RewardClaimed`, `RefundClaimed`, `ProtocolFeeWithdrawn` are outgoing accounting events.

`MarketCancelled` reason codes:1 ordinary expiry,2 INVALID decision,3 interruption refund. `MarketFinalized` contains outcome plus refundable flag. There is no CLOSED event solely on timestamp passage. There is no bond slash/reward event. At interruption, use `ActivityInterrupted(epoch,interruptedAt,caller)` to associate old creation epochs; `PauseChanged` alone is insufficient. Config parameter updates interrupt activity and affect only future markets' economics; existing unresolved markets are quarantined.

Persist `(chainId,contractAddress,transactionHash,logIndex)` with block hash/order and confirmation state. Reconcile events against `getMarket`, pool totals, positions, bond records and global participant/bond/fee liabilities; handle reorg rollback/replay. A wallet returning a transaction hash means submitted, not confirmed. The PRD indexer/API is a later implementation, not provided by this export.

## Evidence and release interface boundaries

Hashes are bytes32 presence/integrity commitments; current code cannot fetch or validate real-world evidence or verify URI/hash correspondence. Before migration, approve the raw-byte/hash/canonicalization schema and public evidence publication channel, verify fetched content, escape/sanitize display, show unavailable/mismatched content explicitly, and define INVALID rules. Do not infer Keccak JSON encoding or IPFS multihash algorithm from this candidate ABI alone.

P1 may read config status, roles, epoch, approval digest and activationAfter. `approveRelease` belongs to independent compliance; `unpause`, `activateFinance`, `setParameters`, `bindFactory` belong to governance; authorized emergency roles can interrupt. These are operational transactions, not consumer setup steps. No current ORAKL v1 release/deployment is approved. Native-send detector findings, role-honesty limits, financial-activation review, production network facts and economic decisions remain blockers in the [freeze checklist](../audit/P0_2_PROTOCOL_FREEZE_CHECKLIST.md).

Control errors are not ordinary transient RPC retries. Current fingerprint checks do not establish a history of uninterrupted challenge availability: unreported drift followed by restoration can permit finalization. A funded independent observer must explicitly report observable drift before it disappears, using `reportRoleDrift()` with the full documented gas reserve, to persist the quarantine. P1 must disclose this dependency and may present a deliberate report action/status; it must not silently send that transaction or claim that frontend refusal to finalize prevents other callers finalizing. Verified wallet change controls or a protocol redesign remain owner decisions.
