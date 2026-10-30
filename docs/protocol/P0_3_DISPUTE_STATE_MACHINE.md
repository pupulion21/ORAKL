# P0.3 dispute state machine — candidate safety design

The P0.3 task explicitly authorizes implementing reviewable timing/evidence/admission corrections. **Final protocol approval/freeze is still missing.** No bond/slashing/fee/payout policy is approved or changed. Initial design is recorded before regression tests and production edits; final implementation/evidence is linked in the verification report.

Implemented source: [Resolver submitEvidence/challenge/finality](../../contracts/src/MarketResolver.sol), lines27/61/77/87; [Config admission](../../contracts/src/ProtocolConfig.sol), lines146/152/156; [config interface](../../contracts/src/interfaces/IProtocolConfig.sol). Production correction7f9ca5e follows failing regressions3518891.

## Minimal changes selected

1. Add nonpayable `submitEvidence(uint256 marketId,bytes32 evidenceHash)` to the facade through MarketResolver. Accept nonzero commitments in PROPOSED **and** DISPUTED, only `now < challengeDeadline`. Any address may submit; no reward, bond, settlement authority or financial-state change. Only a formal bonded challenge changes PROPOSED→DISPUTED. Evidence alone does not stop optimistic finalization.
2. Emit `DisputeEvidenceSubmitted(uint256 indexed marketId,address indexed contributor,bytes32 indexed evidenceHash)`. No evidence array, count, dedup mapping or global cap. Full event identity is chainId/contract/blockHash/txHash/logIndex; marketId/hash/contributor are filterable topics. Duplicates are separate log entries; indexers may group equal hashes while preserving provenance. Fixed-word arguments, no raw evidence payload or on-chain iteration. No deadlines reset.
3. Evidence intake remains available through pause/deactivation/quarantine while the recorded market is PROPOSED/DISPUTED and its original window is open. It receives no native value, calls no role/config getters and cannot revive a market. This prevents an emergency or broken role view from censoring the event channel. Terminal states and the exact end boundary reject. Explicit emergency refund cannot finalize a winner and remains unchanged.
4. Replace **only** challengeResult's full financialEntry with `ProtocolConfig.requireChallengeActivity(address(this))`: require finance explicitly active, unpaused, correct nonzero bound facade, original deployment chain. The resolver still requires current creation epoch, PROPOSED, open window, permitted caller, nonzero evidence and exact snapshotted challenge bond. No live wallet owner/threshold/code fingerprint query on this path. Creation/prediction/proposal/uncontested finalization/fees keep existing full checks; arbitration keeps snapshot authority/control validation; claims remain getter-independent.
5. For disputed settlement require **challengeDeadline <= now < arbitrationDeadline**. Existing upper deadline, authorized snapshot arbiter, decision/evidence validation, terminal finality and refund fallback remain. No additional review period, extension, admin override, appeal or finality reversal.

## Transition and access table

| Market / action | Time interval | Explicit pause/old epoch | Effect |
| --- | --- | --- | --- |
| PROPOSED → submitEvidence | Before challengeDeadline | Still available | Event only; no state/economics/authority change |
| DISPUTED → submitEvidence | Before challengeDeadline | Still available | Same, including nonregistered observers after slot capture |
| PROPOSED → challengeResult | Before challengeDeadline | Reject native bond admission | One unchanged challenge bond; DISPUTED; no live role getters |
| PROPOSED → finalizeResult | At/after challengeDeadline, before max | Reject | Existing full live-control gate; original proposed answer |
| DISPUTED → settleDispute | At/after challengeDeadline, before arbitrationDeadline | Existing snapshot-arbitration rules remain | Authorized YES/NO→FINALIZED; INVALID→CANCELLED; binary empty winner remains refundable |
| Nonterminal → cancelExpiredMarket | Disputed: arbitrationDeadline; others: max | Available | CANCELLED/INVALID, principal refunds, fee zero |
| Interrupted → cancelInterruptedMarket | Original first-interruption grace; disputed original arbitrationDeadline | Available | Same existing full refunds; no shortening of challenge window to a payout |
| Terminal → claims/refunds/bond release | No deadline added | Available | Existing owner-directed exactly-once entitlements |

On exact challengeDeadline, evidence/challenge reject and eligible finalization/arbitration may execute. At exact arbitrationDeadline, arbitration rejects and disputed timeout cancellation is available. Proposers/challengers/arbiters cannot move either timestamp. Immediate-after-capture arbitration must fail in a regression against baseline; all valid arbitration fixtures must advance monotonically to the original lower boundary.

## Threat reasoning

A captured first bonded slot no longer closes the evidence channel, and the arbiter cannot finalize before that channel's original deadline. This fixes the demonstrated *evidence-entry exclusion* and *early decision path*, not economic challenger independence or required consideration of logs. Role changes/getter faults cannot veto a valid funded objection while activity is explicitly active; an accepted challenge persists DISPUTED so restored views cannot permit uncontested finalization. Actual pause/deactivation/epoch changes still reject bonds and preserve quarantine/refunds.

New gate risk: a nuisance challenge remains possible during broken role views, as during healthy operation. It locks the same exact C, never reallocates other bond ownership or escrow. A drifted/unavailable arbiter cannot satisfy snapshot validation; existing deadline gives full refund. Broadening only protective objections prevents privileged view censorship while other financial activity fails closed. An authorized emergency can still abort unresolved markets to refunds. A malicious admitted arbiter may decide falsely after the full window; that separate trust problem is not fixed by a timer.

Event-only intake cannot make evidence accessible or truthful, guarantee indexing availability/finality, or force an arbiter to read/consider it. Evidence publishers must make the committed bytes available off-chain; indexers reconcile confirmed logs, retain all provenance and verify bytes under an approved schema/hash convention. No economic or evidence-content interpretation is silently selected. Multi-bonded challengers, aggregate exposure, service costs, slashing and appeals remain owner decisions.
