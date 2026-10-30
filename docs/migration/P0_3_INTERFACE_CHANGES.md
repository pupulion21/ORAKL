# P0.3 interface changes — candidate, not frozen

Status: **CANDIDATE_NOT_FROZEN**, P0.3 safety design still needs final protocol approval. No frontend migration/deployment/activation is authorized. The functioning legacy frontend/Testnet source, ABI and manifest are unchanged. [Production correction](../../contracts/src/MarketResolver.sol), [configuration gate](../../contracts/src/ProtocolConfig.sol), [config interface](../../contracts/src/interfaces/IProtocolConfig.sol).

## Exact exported interface

The existing exporter was run after the restored noninstrumented force build. It verifies compiler metadata source hashes, compiler0.8.37, Paris, optimizer50/non-IR/metadata-none, selector uniqueness and exact generated content. The package records baseline8d850ae, protocolRevision P0.3, securityCandidateRequiresFinalProtocolApproval=true, null production network/addresses, and deployment/activation authorization false.

| Artifact | Exact ABI SHA256 / contents |
| --- | --- |
| [MarketFactory.abi.json](../../contracts/abi/orakl-v1-candidate/MarketFactory.abi.json) | `6545c154f812f485eb5e7588200e29dad1448d60bd58ae9c935ac776d7a02a4c`;35 functions/14 events |
| [ProtocolConfig.abi.json](../../contracts/abi/orakl-v1-candidate/ProtocolConfig.abi.json) | `ca814a020dbb43eb58d93b917dbc8685c92fbd3a0fa15d5376dedbeae34c0301`;35 functions/8 events |
| [interface-manifest.json](../../contracts/abi/orakl-v1-candidate/interface-manifest.json) | All70 canonical functions/selectors,22 event topics/index flags, errors/outputs, tuple order/enums, source hashes and unpatched artifact identities |
| [Generated tables](../../contracts/abi/orakl-v1-candidate/INTERFACE.md) | Full function/event inventory, not a deployment manifest |

No old function/event/error/constructor/tuple is removed or changed in ABI encoding. All old ABI entries must remain exact subsets in the preservation check. There are exactly three additions:

| Addition | Selector/topic0 | Behavior |
| --- | --- | --- |
| Factory `submitEvidence(uint256,bytes32)` | `0x912da4db` | Nonpayable, no output. Any publisher; PROPOSED/DISPUTED, nonzero commitment, now<D. Available through explicit pause/quarantine; no bond, reward, native allocation or formal objection state. |
| Factory `DisputeEvidenceSubmitted(uint256,address,bytes32)` | `0xee0324d17e85288161de1f23ac51a0ec3f8453dda3d0e58ec058b2ba238c9433` | All3 fields indexed: marketId, contributor, evidenceHash. Event data empty. No raw evidence list or storage counter. |
| Config `requireChallengeActivity(address)` | `0x9b100a91` | Public view predicate; active/unpaused/bound/chain checks, no live wallet query. Passing preflight changes no authority/state. |

Market tuple remains27 fields, Parameters9 fields, Position/Bond and all enums retain their exact encoding. Side YES0/NO1 differs from Outcome YES1/NO2/INVALID3. No BondSlashed/reward entitlement event exists because punitive economics are still unapproved.

## Behavioral changes with unchanged selectors

`challengeResult(uint256,bytes32)` remains payable with exact snapshotted C. It now uses the narrow active-facade gate rather than the complete live owner/threshold fingerprint gate. Existing market/current epoch, original window, caller exclusions, nonzero evidence, native value, one bonded slot and ownership stay unchanged. Bad role views cannot veto a correctly funded objection. Creation/predict/propose/uncontested finalization/fees still use full declared-role checks. Default-disabled/paused/deactivated/wrong-chain/unbound/old-epoch challenges still reject, including zero-C calls.

`settleDispute(uint256,uint8,bytes32)` now requires **D<=chain timestamp<A**, where D/A are the existing immutable challenge/arbitration deadlines. No early decision, extended/restarted window, extra review delay, admin override or appeal. Existing authorized snapshot arbiter may settle during pause after D; unavailable/invalid authority gives the original refund fallback at A.

Evidence submission is not a formal economic challenge. A PROPOSED market may still finalize at D if nobody submits a valid funded challenge, even if independent evidence events exist. After one formal challenge, later observers use submitEvidence; they do not own the first C, acquire arbitration rights or earn a hidden bounty. P1 must present those distinctions explicitly.

## P1/indexer requirements

Index all confirmed evidence logs by `(chainId,facade,blockHash,txHash,logIndex)` and associate by `(chainId,facade,marketId)`. Retain duplicate provenance; do not impose a small global submission count cutoff or load the whole history into settlement. Fetch/verify externally available content under the separately approved evidence schema; show absent/mismatched content explicitly. No event guarantees reading, truth or availability. Handle reorg rollback/replay and never treat a transaction hash alone as confirmation.

Keep evidence UI available in PROPOSED/DISPUTED until D during pause/quarantine, while disabling bond admission/new predictions according to actual gates. At D, evidence/challenge close and eligible finalization/arbitration begin; at A arbitration closes and disputed cancellation becomes available. Use chain time and stored deadlines. Preserve FINALIZED+refundable handling for an empty winning pool; claim/refund/bond withdrawals remain owner-directed and getter-independent. Do not automatically retry writes or submit emergency reports without a deliberate wallet action.

Do not reuse the full `requireFinancialActivity`/“all roles healthy” preflight to disable protective challenges or no-value evidence. P1 must use the new narrow predicate plus market/epoch/time/value checks for the former, and state/deadline/nonzero commitment for the latter. Role warnings should still fail closed for new-risk financial activity and disclose arbitration availability. A UI-level refusal is not a protocol security boundary.

Use a **matching verified Factory+ProtocolConfig build**. A P0.3 facade requires the new config predicate, while an old facade retains old challenge behavior; mixing versions is unsupported. Verify both artifact identities, immutable linkage/factory binding, chain and release state before any eventual integration. No automatic old-config fallback or legacy-ABI switch is introduced. The current candidate package has no deployed pair and cannot authorize signing. Runtime hashes are templates with immutable patches, not deployed-instance verification.

Reproduce from root after `cd contracts && forge build --force`: `node scripts/export-orakl-candidate-interface.mjs --write`, then `--check`. Existing Node tests cover exact call/event decoding, tampered ABI rejection and stale-source rejection; Solidity tests verify all new evidence topics and market associations. Further economic approval may change this ABI before freeze. [Verification](../testing/P0_3_VERIFICATION_REPORT.md), [freeze blockers](../audit/P0_3_PROTOCOL_FREEZE_READINESS.md).
