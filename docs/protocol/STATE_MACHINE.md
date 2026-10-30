# Market state machine

The authoritative state is `marketState(id)`. A stored OPEN becomes CLOSED at `closeTime` without a transaction. `getMarket().storedState` retains OPEN until a proposal; clients must use the derived view.

| Operation | Preconditions | Result |
| --- | --- | --- |
| createMarket | finance active/unpaused; valid immutable metadata/times; exact creation bond | OPEN |
| predict | OPEN and timestamp < closeTime; minimum/cap | OPEN |
| proposeResult | CLOSED; timestamp in [resolutionTime, maxResolutionTime − challengePeriod − arbitrationPeriod); exact bond, evidence, YES/NO/INVALID | PROPOSED |
| challengeResult | PROPOSED; timestamp < challengeDeadline; independent challenger, exact bond/evidence | DISPUTED |
| finalizeResult | PROPOSED; uninterrupted activity epoch; timestamp in [challengeDeadline, maxResolutionTime) | FINALIZED for YES/NO, CANCELLED for INVALID |
| settleDispute | DISPUTED; snapshotted arbitrator only; timestamp < arbitrationDeadline; decision/evidence | FINALIZED for YES/NO, CANCELLED for INVALID |
| cancelExpiredMarket | nonterminal; timestamp >= arbitrationDeadline if disputed, otherwise >= maxResolutionTime | CANCELLED, INVALID, refunds |

`challengeDeadline = proposedAt + challengePeriod`; `arbitrationDeadline = challengeDeadline + arbitrationPeriod`. Even a last-minute challenge receives a full arbitration period. A proposal is disallowed if those full windows cannot fit. At exact deadline, challenge/arbitration/finalize permission ends before timeout permission begins; outcome cannot depend on transaction ordering across overlapping permissions.

Finalized YES/NO with zero winning collateral stays FINALIZED with `refundable=true`, fee/distributable zero. INVALID is CANCELLED. An empty market has no participant entitlement; terminal bond release still works. No reopening, repeat proposals, repeat challenges, changed terminal outcomes or post-close contributions exist. Claims are per-user settlement flags, never market states.

Time passage never sends a transaction. Anyone can execute finalization/timeout; callers pay gas. If nobody executes a terminal action, users can execute it themselves. No keeper/admin availability is necessary for the refund fallback.
