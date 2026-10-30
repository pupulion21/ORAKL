# ORAKL v1 protocol candidate specification

This baseline specification describes the retained P0.3 MarketFactory. The current LOCAL selected-economics root is SelectedMarketFactory, governed by [selected economics](../decisions/ORAKL_V1_SELECTED_ECONOMICS.md), [M1 review](../security/ORAKL_V1_MULTI_CHALLENGER_REVIEW.md) and [versioned interface](../migration/ORAKL_V1_SELECTED_INTERFACE_DELTA.md). No production release is approved.

Status: **candidate, not frozen**. The executable implementation is the P0.3 source at `9e256c1451d666889f9f248edee3e2e2d61f6d48`; this document does not authorize activation, deployment, or a change in economic policy. The [owner decision ledger](../decisions/ORAKL_V1_OWNER_DECISIONS.md) records unapproved choices.

## Components and immutable terms

[MarketFactory](../../contracts/src/MarketFactory.sol) inherits resolver, pool and storage into a single native-asset custody facade. It is non-upgradeable; the separate immutable config address must point to the correct verified bound configuration. The facade snapshots terms, epoch and arbitrator fingerprint at creation. Financial entry requires active/unpaused finance, correct binding and chain, and role checks. Config begins financially inactive; independent compliance approval and governance execution use a 24-hour review delay. Tests locally simulating activation do not certify a release.

Creation requires exact creation bond, valid metadata commitment and deadline ranges. Each prediction contributes native units to YES or NO and an individual position, subject to the immutable minimum and per-market cap. There is no outcome token, exchange, LP or early exit. The chain balance is shared but prediction, bond and fee liabilities are recorded separately. Forced transfers create unaccounted surplus, not predictions.

## Settlement and obligations

At or after resolutionTime, within its bounded proposal period, a non-arbitrator may propose YES, NO or INVALID with the exact proposal bond and nonzero evidence commitment. One distinct non-arbitrator/non-proposer challenger may deposit the exact challenge bond before the immutable challenge deadline D. Anyone may publish additional nonzero evidence commitments until D, including after challenge and while paused. Such events neither create a challenge nor alter financial entitlements. The [state review](ORAKL_V1_STATE_MACHINE_REVIEW.md) defines exact boundaries and timeout exits.

For a valid binary outcome with a nonempty winner, fee is floor(total pool × snapshotted feeBps / 10,000); distributable is total less fee. Each winner's claim is floor(its winning-side contribution × distributable / winning pool), calculated with full precision. INVALID, cancellation, and a binary outcome with an empty winner refund both contributions with zero fee. Each position is settled at most once; users direct their own pull payment to an eligible recipient. Dust remains accounted and there is no sweep.

Current bond logic returns each deposited principal to its recorded owner after terminal state, including disputed outcomes. The proposed redistribution matrix is **not executable policy**. Evidence does not determine truth; dispute resolution trusts the admitted arbitrator, with the operational requirements in the [admission standard](../security/ORAKL_V1_ARBITRATOR_ADMISSION_STANDARD.md). Full custody/value-flow and unmitigated risks are in the [threat model](../security/ORAKL_V1_THREAT_MODEL_FINAL_CANDIDATE.md).

## Release conditions

The exact economic choices, evidence convention and role admission require owner decisions; independent audit, network compatibility and applicable legal authorization are separate freeze gates. The [gate matrix](../audit/ORAKL_V1_FREEZE_GATE_MATRIX.md) is authoritative for candidate status, not proof of an audit. No deployment addresses or Mainnet activation are authorized.
