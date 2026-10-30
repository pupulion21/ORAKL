# P0.3 challenge integrity

Status: **implemented security candidate, final protocol approval required; economics/freeze remain blocked**. Source: [MarketResolver.sol](../../contracts/src/MarketResolver.sol), submitEvidence:27, challengeResult:61, finalizeResult:77, settleDispute:87; [ProtocolConfig.sol](../../contracts/src/ProtocolConfig.sol), requireChallengeActivity:152.

## Evidence exclusion correction

P0.2 accepted one bonded challenger and had no independent intake path. Baseline trace `docs/testing/p0-3/baseline-pocs-1.txt` reproduces capture. Eight regressions committed at3518891 failed against unchanged production source; after production correction7f9ca5e the same eight passed. `P0_3RegressionTest.testIndependentEvidenceRemainsOpenAfterCapturedFirstChallenge` now proves the previously excluded observer can submit, the exact event is emitted, no market/financial state changes, bond ownership stays with the first challenger and the observer cannot settle.

`submitEvidence(uint256,bytes32)` is nonpayable and accepts any contributor in PROPOSED or DISPUTED before the original challengeDeadline. A nonzero bytes32 commitment is required. It emits `DisputeEvidenceSubmitted(uint256 indexed marketId,address indexed contributor,bytes32 indexed evidenceHash)`. No new storage array, map, count, reward, fee, bond ownership or deadline change. The native-value entry list remains creation, prediction, proposal and formal challenge only. Reentrancy protection is shared with the financial facade.

Evidence remains available during explicit pause/deactivation and old-epoch quarantine. This is safe because it accepts no native collateral or settlement authority. It calls no role/config getter. Bond admission still rejects an explicit pause/deactivation/old epoch. A valid **funded formal challenge**, not an evidence event alone, changes PROPOSED→DISPUTED. Do not present unbonded evidence as a guaranteed block on optimistic settlement.

## Why the entire original window remains reachable

Let proposal time be p, snapshotted challenge period c, original deadline D=p+c and arbitration deadline A=D+a. No authorized terminal transition can occur before D after the correction:

- Uncontested finalization requires now>=D; disputed settlement now also requires now>=D and now<A.
- Ordinary cancellation needs maxResolutionTime or A, both later than D because creation/proposal reserve the original windows.
- A PROPOSED emergency exit is min(maxResolutionTime, firstInterruption+c). Interruption follows proposal, so firstInterruption+c>=D; original max is also later than D. A disputed emergency exit stays A.
- Interruption only changes config epoch/release state, not the proposal's deadline/state. Additional pauses cannot move the first recorded exit.

Thus captured first challenge, authorized early arbitration, role getter faults and explicit emergency intervention cannot terminate the event channel early under the protocol's timestamp/transaction-inclusion assumptions. At exact D, intake closes and eligible settlement begins. No timer extension or separate review period was added. Network-wide transaction censorship, consensus timestamp behavior and RPC/indexer availability are outside this guarantee.

## Event-only versus stored commitments

| Design | Cost and integrity | Limit / decision |
| --- | --- | --- |
| **Selected: fixed event commitment** | O(1) contract work, fixed-word arguments, three indexed fields plus signature topic. No history scan, storage-growth dependency or slot cap. | Contract cannot read its prior logs to enforce content consideration; availability/indexing remain off-chain. Appropriate because settlement never iterates/validates evidence contents. |
| Mapping keyed by market/contributor/hash | O(1) insert/read, no global cap needed; duplicate policy can be per publisher. | Permanent state/gas cost with no current on-chain consumer. Does not prove relevance, truth, accessibility or that an arbiter reads it. A global hash dedup rule can give a front-runner misleading priority. |
| Stored capped queue/array | Supports on-chain enumeration up to a chosen bound. | A small global cap can be filled by attacker submissions; an uncapped settlement scan can exceed gas limits. Rejected for this correction. |

Solidity describes events as [transaction logs for off-chain subscribers](https://docs.soliditylang.org/en/latest/contracts.html#events); logs are not contract-readable storage. This mechanism intentionally does not pretend event publication proves adjudication or availability.

## Duplicates, indexing, off-chain dependencies

Repeated commitments are permitted and produce distinct logs; lookup cost is zero. No first-seen hash owns content or earns a reward. Index by `(chainId,facade,blockHash,txHash,logIndex)` and associate markets by `(chainId,facade,marketId)`. Topics are signature, marketId, contributor, commitment. Keep provenance on duplicates; rollback/replay on reorg. Blockspace/gas-funded spam remains possible, but cannot exhaust a small protocol slot limit or make settlement scan past records. Indexer implementations must stream/paginate/filter without allowing spam to silently exclude independent evidence.

Publishers must make committed content available using the separately approved content-addressed schema/storage process, and readers must verify retrieved bytes. The contract commits the supplied hash association and sender, not its algorithm/schema/CID correspondence or real-world truth. Same hash in different markets remains a distinct event association. Retention, redundant pinning, authoritative-source rules and evidence interpretation require owner/product/arbitration approval. There is no automatic data-availability oracle or enforcement that an arbiter reads the logs.

## Economic capture remains separate

The first formal challenger remains the only owner of that market's challenge-bond record. Current Solidity still returns each principal to its original depositor; it does not pay a successful-challenge bounty. Under the **unapproved** candidate, a proposer/challenger coalition can capture P+C internally and front-run/dilute a future bounty. Evidence-entry exclusion is corrected, while the economic slot problem is **PARTIALLY MITIGATED overall / BLOCKED ON ECONOMIC DECISION**. [Two O(1) multiple-bonded alternatives and approval matrix](../protocol/P0_3_ECONOMIC_APPROVAL_MATRIX.md) are analysis only.

## Executable evidence

[Security tests](../../contracts/test/security/P0_3Evidence.t.sol) cover512 spam/duplicate logs followed by independent intake, exact topics/market/contributor association, PROPOSED and DISPUTED, full-window access through repeated pauses and broken getters, nonpayability/malformed calls, zero hashes/unknown/closed/terminal markets, unbonded evidence semantics, native callback reentrancy, forced balances and deadline fuzzing. [Stateful handler](../../contracts/test/invariant/OraklInvariant.t.sol) preserves A–N and adds O/P, with nonvacuous accepted evidence, faulted objections and early-decision attempts. Final actual counts/results are in the [verification report](../testing/P0_3_VERIFICATION_REPORT.md).
