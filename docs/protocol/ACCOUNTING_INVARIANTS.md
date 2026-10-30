# Accounting and executable invariants

Native-unit arithmetic only. Pool totals/positions are uint128 bounded by a snapshotted uint128 pool cap; sums and liabilities are uint256. Fees and payouts use pinned OpenZeppelin 5.4.0 `Math.mulDiv`, rounding down.

For a nonrefundable YES/NO result with a nonempty winning side:

```
T = yesPool + noPool
F = floor(T * feeBps / 10000)
D = T - F
userPayout = floor(userWinningContribution * D / winningPool)
```

Settlement reclassifies F from participant liability to fee liability exactly once. Before settlement all contributions remain participant liabilities. INVALID, timeout and zero-winner outcomes allocate no fee and refund original YES+NO contributions. Claim order never changes the numerator/denominator. A winning contribution may round to zero; its claim still sets the settlement flag without calling the receiver for zero value.

```
marketParticipantRemaining = T - protocolFee - paidOut - refunded
participantLiability = sum(marketParticipantRemaining)
bondLiability = sum(unclaimed deposited bonds)
feeLiability = totalFeesAccrued - totalFeesWithdrawn
totalAccounted = participantLiability + bondLiability + feeLiability
totalAccounted = totalContributions + totalBondsDeposited
                 - totalParticipantPaid - totalBondsPaid - totalFeesWithdrawn
balance = totalAccounted + forcedSurplus
```

Forced native funds cannot create contributions, fees, bonds or entitlements. There is no sweep for surplus, rounding dust or unclaimed funds. Dust stays in participant liability indefinitely; a production dust/unclaimed policy remains open. No participant iteration occurs on-chain.

`contracts/test/invariant/OraklInvariant.t.sol` implements A–J using a handler and independent ghost ledger:

| ID | Executable check |
| --- | --- |
| A | Native balance covers all liabilities; exact excess equals forced credits. |
| B | Repeat participant/bond withdrawals never succeed. |
| C | Paid rewards equal ghost payments and never exceed the distributable pool. |
| D | Refunds equal ghost refunds and never exceed contributions. |
| E | Fee accounting matches independent accrual/withdrawal; participant reserves exclude only allocated fees; unauthorized withdrawals/arbitration fail. |
| F | Bond ownership, principal, claimed flags and remaining liability match ghost deposits/payments. |
| G | Refund and payout modes are exclusive; refundable markets have no fee/distributable allocation. |
| H | State and final outcome match independently maintained transition history. |
| I | All actor positions match independent contribution history and sum to market pools. |
| J | Independent total inflows less three withdrawal categories equal all remaining liabilities. |

Handler actions randomize creators, actors, markets, sides, amounts, future fees/bonds/minimums, time boundaries, outcomes, challengers, arbitration authorization, pause state, claim ordering and forced credits. Dedicated unit tests cover failed-transfer rollback and cross-function reentrancy. See the executed test report for settings/results; invariants are bounded tests, not formal proof.

## P0.1 extensions

Accounting formulas and bond principals are unchanged. The stateful handler now uses eight actors including a rejecting receiver, 24-market bound, independent epoch/first-interruption ghost state, premature cancellation/revival/unauthorized resume attempts and redirected failed payments. New invariant K checks review delay/epoch authorization; L checks immutable first-interruption exit times. Default reproducible campaign: 2,048 fuzz runs, 128 invariant sequences × depth 64, fail_on_revert=true, seed 0x4f52414b4c503031. See the P0.1 executed report for actual results and second-seed evidence.
