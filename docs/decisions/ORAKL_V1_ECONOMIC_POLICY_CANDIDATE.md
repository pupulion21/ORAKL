# ORAKL v1 economic policy candidate

**PROPOSED_NOT_APPROVED.** This describes a counterfactual for owner review, not the executable contract. Current [bond claims](../../contracts/src/ProtocolStorage.sol#L90) return each deposited principal to its owner; [settlement](../../contracts/src/PredictionPool.sol#L94) snapshots market terms and charges the configured fee only for a nonempty winning side. No owner approval is inferred from this document.

K is the creation principal, P the proposal principal, C the single formal challenge principal, and all numbers are indivisible native base units. The candidate always returns K to its depositor at terminal settlement. A challenged market has these candidate entitlements:

| Proposal | Final | Proposer | Challenger | Total |
|---|---|---:|---:|---:|
| YES | YES | P+C | 0 | P+C |
| YES | NO | 0 | P+C | P+C |
| YES | INVALID | P | C | P+C |
| NO | YES | 0 | P+C | P+C |
| NO | NO | P+C | 0 | P+C |
| NO | INVALID | P | C | P+C |
| INVALID | YES | 0 | P+C | P+C |
| INVALID | NO | 0 | P+C | P+C |
| INVALID | INVALID | P | C | P+C |

No proposal returns deposited K only; uncontested proposal returns P; expired proposal, arbitration timeout, and emergency cancellation return every deposited principal. Final INVALID returns P and C even if an objection caused it. This policy may penalize good-faith errors, and the challenge alone does not prove dishonesty. It requires a deterministic separate bond-entitlement ledger, immutable market policy version, exactly-once pull withdrawals and new events/ABI, plus a full audit; it must not touch participant collateral or let governance choose recipients.

The candidate's treatment of a binary outcome with an empty winning side or an entirely empty pool remains an **explicit owner choice**: apply the binary matrix despite participant refunds, or return all bonds neutrally. Neither choice is implemented. A zero P or C conserves principal algebraically but removes the corresponding deterrent; positive bonds for economically active markets are a recommendation requiring approved limits, affordability and eligibility assumptions. No payout exists when both sides are empty. INVALID, empty winning side, expiry, and cancellation make the participant pool refundable and fee-free under current code.

The per-market fee candidate is 200 basis points on the whole pool when a binary winner is nonempty, using floor(T*feeBps/10000). It is not a production default or a guarantee of fairness: one-sided winning pools can still pay a fee. The same wallet may hold both sides; each position is settled exactly once. Rounding dust remains in participant liability; neither it nor unclaimed rewards may be silently swept. Recipients may revert or reenter: owner-selected pull payments must roll back on failure, remain isolated and be tested in both claim orders.

[Bond and challenger analysis](../economics/ORAKL_V1_BOND_AND_REWARD_ANALYSIS.md) covers manipulation; [exposure and spam model](../economics/ORAKL_V1_EXPOSURE_AND_SPAM_MODEL.md) covers correlated markets and terminal liabilities. Exact decisions and evidentiary approval requirements are in the [owner ledger](ORAKL_V1_OWNER_DECISIONS.md).
