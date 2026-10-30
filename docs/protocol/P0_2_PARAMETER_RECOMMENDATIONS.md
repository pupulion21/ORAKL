# P0.2 parameter recommendations

**Unapproved design ranges, not production configuration.** The [decision record](P0_2_ECONOMIC_DECISION.md) defines the candidate and missing approvals. No setter/default/compiler configuration is changed. Native amounts below are ratios; QIE Mainnet denomination, gas and monitor purchasing capacity still need verification. Test fixtures using 5/2/3 native units and a near-unbounded uint128 cap are not launch recommendations.

| Parameter | Current allowed implementation | Recommended owner-review range / rule | Trade-off and release requirement |
| --- | --- | --- | --- |
| Protocol fee | 0–1,000 bps, snapshotted | Consider **200 bps**, review **0–200 bps**; only valid nonempty winning side | Fees reduce returns even on own principal. Zero fee does not fix oracle risk. Owner must approve exact bps; 1,000 is a safety bound, not recommended pricing. |
| Proposal bond P | 0–1,000,000 native test units | **5–20% of enforced Tcap**, strictly positive for candidate B | Illustrative stress-review band, not validated security. Need affordable independent monitor capital and measured detection. Fixed P applies to the cap, not just today's pool. |
| Challenge bond C | Same bounds as P | **0.5–1.0 P**, strictly positive | Binary-only favorable-decision break-even rises from 1/3 to 1/2, excluding costs/INVALID. A high C deters honest monitors as well as nuisance disputes. |
| Creation bond K | 0–1,000,000 native units; full terminal return | Consider **0.05–0.25 P** refundable, subject to measured spam/lock budget | A provisional 5 QIE from the PRD is not adopted. N concurrent markets lock N*K but gas/capital can recycle; this is not a permanent spam fee. |
| Per-market total cap Tcap | Positive uint128, >=minimum; enforced on Y+N | Equivalent to **5–20 P** under above band; start at lower exposure until monitoring is demonstrated | Pool cap is total contribution, not net profit or YES/NO imbalance. No address-level cap is meaningful Sybil protection. Exact native amount remains unset. |
| Shared-arbitrator unresolved exposure | **No aggregate cap or concurrency limit** | Budget total unresolved pool exposure at **1–5 Tcap** initially as an operational stress limit; consider on-chain aggregate enforcement | This is a proposal, not a present guarantee. Repeated permissionless creation bypasses frontend limits. If a hard aggregate security bound is required, approve and implement it before freeze. |
| Minimum contribution | Positive uint128 <=Tcap | Set from measured gas and user affordability; stress review **0.001–0.01% of Tcap**, not a floor on oracle manipulation | A minimum can price out small users; even a minimum-size sole winner can receive nearly D. Exact native amount and wei conversion remain unresolved. |
| Challenge period | 1 hour–7 days, snapshotted | **24–72 hours** with continuously funded monitoring | Longer reaction time also increases capital lock and first-slot arbiter delay. Full duration, not a shortened resumed timer, must remain guaranteed. |
| Arbitration period | 1 hour–30 days, starts at challengeDeadline | **48–168 hours**, including evidence intake/review SLA | Existing arbiters may decide immediately after a challenge, before challengeDeadline. If all observers must have a minimum intake period, that is a separate unresolved contract timing decision. |
| Proposal period | `[resolutionTime, maxResolutionTime-challengePeriod-arbitrationPeriod)` | Reserve an additional **24–72 hours** for proposal availability; `maxResolutionTime > resolutionTime + proposalWindow + challenge + arbitration` | Boundary exclusive for proposal. Ordinary finalization expires at max, disputes at arbitrationDeadline. Avoid a year-long lock merely because the code permits it. |
| Emergency grace | Snapshotted challengePeriod after first interruption, capped by max; disputes keep original arbitrationDeadline | Retain P0.1 mechanism pending explicit approval of abort trust | Anyone can cancel on boundary; no actor may convert an interrupted proposal into a payout. Short pauses abort unresolved markets. |
| Review delay | Fixed 24 hours, separate compliance/governance | Retain as technical minimum, not a certification | Approvals bind epoch/config/code/declared owners. Fresh approval required after interventions; independent real role admission still necessary. |
| Dust / unclaimed collateral | Reserved indefinitely; no sweep or expiry | Retain reservation for first version unless a complete, independently reviewed claim-period policy is approved | Floor dust < number of winning wallets in smallest units; unclaimed entitlements are not dust. No admin sweep. |

## Conditional deterrence sensitivity

Let a stress case gain G=0.98*Tcap. With an external honest challenger and truthful arbitration, ignoring gas, `P/G >= (1-d)/d`:

| Assumed detection d | Required P/Tcap for nonpositive simplified expected gain |
| --- | --- |
| 0% | No finite bond |
| 50% | 98% |
| 90% | 10.8889% |
| 95% | 5.1579% |
| 99% | 0.9899% |

The recommended 5–20% review band **fails** in some scenarios above; it is a starting trade-off for owner discussion, not an established safe range. With a colluding first challenger, internal bond forfeiture is zero. With biased arbitration, P can reward the attacker. Increasing P alone fixes neither case. Require demonstrated monitoring coverage/capital, independent adjudication/evidence access, bounded aggregate exposure and explicit residual risk acceptance or redesign. No observation in this repository establishes d or arbitrator honesty.

## Selecting actual values before freeze

1. Approve the exact distribution matrix, INVALID cases and empty-pool cases, then specify an economics version committed at creation.
2. Verify native-unit scale and worst-case cold transaction costs; measure independent monitors' available capital and response times. Do not infer QIE denomination from Solidity's `ether` suffix or the legacy Testnet UI.
3. Set a loss budget for correlated markets, including external incentives; select enforced Tcap and shared-arbitrator limits before choosing P/C. Decide whether an operational-only aggregate target is acceptable for permissionless creation.
4. Select exact fee/K/minimum/durations, publish ambiguity/evidence/arbiter obligations, review creation-spam and slot-capture countermeasures, and obtain explicit owner approval.
5. Implement only the approved changes, update exact ABI/schema if necessary, rerun adversarial and static checks, then provide the final scope to independent auditors. Current full-return contracts remain financially inactive.
