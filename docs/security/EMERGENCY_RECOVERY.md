# Emergency recovery — P0.1 implementation contract

Status: authorized engineering safety remediation; unaudited, financially inactive. Punitive economics are not changed.

## Market recovery

Every market snapshots `creationActivityEpoch`. Each interruption records `interruptedAt[oldEpoch]` before advancing activityEpoch. That original record never changes. All old-epoch unresolved markets are quarantined: predict/propose/challenge and uncontested finalization reject even after the platform is reapproved. There is no partial challenge-window restart and no administrative resettlement.

```
interrupted = creationActivityEpoch < config.activityEpoch
ordinaryExpiry = DISPUTED ? arbitrationDeadline : maxResolutionTime
emergencyExpiry = DISPUTED ? arbitrationDeadline
                  : min(maxResolutionTime, firstInterruption + challengePeriod)
```

Anyone can execute `cancelInterruptedMarket` at emergencyExpiry; `cancelExpiredMarket` retains the ordinary deadline. Result is CANCELLED/INVALID, fee zero, full participant principal and unchanged bond-return policy. In PROPOSED state, emergencyExpiry cannot precede the originally promised challengeDeadline: interruption occurs after proposal and adds a full challengePeriod; maxResolutionTime already reserves the original windows. No admin chooses a result or receiver. OPEN cancellation is an explicit emergency-only extension, not ordinary early withdrawal or selling positions. Exact times are exposed by `interruptionRefundTime` and indexed events.

Existing disputes may be adjudicated before their original arbitrationDeadline by the unchanged, independently checked snapshotted arbitrator. Emergency actors cannot cut that period short. If declared control changes or adjudication is unavailable, ordinary timeout refunds remain permissionless. Finalized/cancelled markets are never changed by later emergencies. Participant claims/refunds and bond withdrawals do not query external multisig views, so malicious/reverting wallet getters cannot block them.

A short pause sacrifices unresolved markets to principal refunds; resumption supports newly created markets only. This prevents challenge censorship followed by payout finalization but retains privileged abort/denial risk. Repeated pauses, deactivations, configuration changes and later epochs cannot move a market's first-interruption deadline. No script signs, broadcasts or activates contracts.

## Release authorization

Pause/deactivation by authorized emergency roles revokes finance and all pending release approval, records an interruption and advances the epoch. Governance cannot independently undo a guardian intervention. Compliance must freshly approve a nonzero release commitment; a 24-hour review delay must fully elapse. Governance then explicitly unpauses (if paused) and activates that exact epoch/control/parameter-bound digest. Approval at the same timestamp is never immediately executable; exact boundary is inclusive at activationAfter. New emergency calls revoke old approvals, including approvals waiting during an existing pause.

The delay is a transparent technical review minimum, not evidence of audit/compliance completion. Humans still verify audit artifacts, legal authorization, deployed roles and incident remediation. Governance/compliance collusion can authorize a bad release; a guardian can repeatedly deny availability. Neither role can redirect participant or bond liabilities.

## Observable role drift

Owners, thresholds and outer runtime identities are pinned on review and rechecked for financial admission and uncontested finalization. Each market also pins its arbitrator fingerprint. Changed/reverting/malformed observable control fails closed. A permissionless drift reporter can record an interruption when a currently active release no longer matches; bounded calls and explicit sufficient-gas checks must prevent a reporter manufacturing a failure through gas starvation. This cannot detect a malicious wallet that lies consistently or a module/guard/implementation change not reflected in the checked views.

Operationally, verify real Safe-compatible implementations, singleton/storage layout, owners, threshold, modules, guards, fallback handlers and cross-role signer/control independence before approval and continuously afterward. Do not advertise interface checks as proof of multisig execution security. Unknown wallet code/configuration remains a production blocker.
