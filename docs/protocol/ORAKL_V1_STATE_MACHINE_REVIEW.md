# ORAKL v1 state machine review

Candidate source: [MarketResolver](../../contracts/src/MarketResolver.sol), [ProtocolStorage](../../contracts/src/ProtocolStorage.sol), [ProtocolConfig](../../contracts/src/ProtocolConfig.sol). Original windows and the first-interruption exit are retained. All intervals below use the chain timestamp and assume timely canonical transaction inclusion.

| Transition or action | Required condition | Effect |
| --- | --- | --- |
| create → OPEN | valid parameters/deadlines, active full checks, exact K | snapshot terms, epoch and arbiter fingerprint |
| OPEN → CLOSED | timestamp reaches closeTime; derived view | prediction admission closes without a close transaction |
| CLOSED → PROPOSED | resolutionTime ≤ now < maxResolutionTime − challengePeriod − arbitrationPeriod; active full checks | proposal and original D/A fixed, exact P |
| PROPOSED → DISPUTED | now < D, narrow activity gate and current epoch, eligible caller, exact C | one challenger recorded; no timer reset |
| PROPOSED/DISPUTED → evidence event | nonzero hash and now < D | event only, including during pause; no state or bond claim |
| PROPOSED → FINALIZED/CANCELLED | D ≤ now < maxResolutionTime; current proposal epoch, active full role checks | optimistic proposed result; INVALID cancels |
| DISPUTED → FINALIZED/CANCELLED | D ≤ now < A; snapshotted authorized arbiter with valid declared control, nonzero decision evidence | binary final or INVALID cancellation; no early privileged override |
| DISPUTED → CANCELLED | now ≥ A | permissionless arbitration-timeout refunds |
| nonterminal → CANCELLED | now ≥ maxResolutionTime, except disputed uses A | permissionless timeout refunds |
| interrupted → CANCELLED | disputed: A; otherwise min(maxResolutionTime, first interruption + challengePeriod) | permissionless refund; later interruptions cannot reset first exit |

Exactly at D, evidence and challenge reject while eligible arbitration or uncontested finalization can proceed. Exactly at A, arbitration rejects and disputed timeout cancellation becomes available. Finalized and cancelled outcomes are terminal; empty winning pools are finalized as refundable. Existing claims and bond exits remain available during pause. The [P0.3 boundary and adversarial tests](../../contracts/test/security/P0_3Arbitration.t.sol) and [emergency recovery](../security/EMERGENCY_RECOVERY.md) support these properties. Arbitrator honesty, network inclusion and evidence availability remain external assumptions.
