# P1 integration handoff — candidate only

The [full P0.3 ABI inventory](P0_3_INTERFACE_CHANGES.md) and [candidate manifest](../../contracts/abi/orakl-v1-candidate/interface-manifest.json) identify exact selectors, event topics, tuple order, source hashes and artifacts. No production address is supplied. Use a verified matching Factory/Config pair; P0.3 additions require the new pair. The legacy Testnet frontend, ABI and manifest are a separate deployment and remain unchanged. The interface and candidate evidence schema require final owner approval and may change before freeze.

| User/role action | Contract behavior and UI implication |
| --- | --- |
| Informational evidence | `submitEvidence(id,hash)` emits only an indexed commitment, works before D even after challenge or during pause. It does not create a bonded objection. Distribute and verify off-chain bytes separately. |
| Formal challenge | `challengeResult(id,hash)` sends exact snapshotted C while PROPOSED, before D, with active/bound/chain/epoch conditions. A role getter fault alone does not disable it. One bonded slot only. |
| Uncontested finalization | Anyone calls `finalizeResult` after D with full release/control checks and before maximum expiry. Evidence submission alone does not prevent this. |
| Disputed arbitration | Only snapshotted arbitrator with valid control may `settleDispute` for D ≤ now < A; show trust boundary and decision evidence. |
| Emergency or ordinary expiry | `cancelInterruptedMarket` uses first-interruption exit; `cancelExpiredMarket` uses original expiry. Both yield refundable terminal state without changing bond owners. |
| Reward / refund | Participant calls `claim`/`claimTo` or `claimRefund`/`claimRefundTo` for its own unsettled position; show confirmed receipt and refresh contract state. |
| Bond claim | `claimBond` returns the actual owner's deposited principal under present rules; no punitive policy or challenger reward may be advertised. |
| Governance / compliance | Separate privileged release, pause, configuration and fee operations; these are not participant controls or audit/legal certification. |

Index events by chain, verified facade, block hash, transaction hash and log index; handle reorgs and preserve duplicates. The candidate [evidence profile](../security/ORAKL_V1_EVIDENCE_INTEGRITY_SPEC.md) explicitly separates commitment, availability, integrity, source authenticity and factual adjudication. Pool percentages are contribution shares, and return previews vary with future contributions. Network switching, wallet signature, pending/reverted/confirmed states and canonical confirmations must be presented honestly. QIE finality, wallet behavior, indexing range and native denomination remain unverified operational dependencies.
