# Bond economics — conservative P0 policy

The PRD leaves punitive economics open. P0 deliberately implements **no slashing, bounty, confiscation or arbitrator reward**. A challenge does not prove dishonesty. Constructor-supplied amounts are provisional and snapshotted per market; tests illustrate creation=5, proposal=2, challenge=3 native units. These are not production-approved prices. Zero amounts are permitted as an explicit future-market setting; zero-value calls still require activation.

| Bond | Deposit/owner | Release | INVALID / timeout / cancellation |
| --- | --- | --- | --- |
| CREATION | Exactly snapshotted creationBond at create; creator owns it. | After any terminal state. | Full principal back to creator. |
| PROPOSAL | Exactly proposalBond once at valid proposal; proposer owns it. | After any terminal state, whether upheld or rejected. | Full principal back to proposer. |
| CHALLENGE | Exactly challengeBond once before deadline; challenger owns it. | After any terminal state, whether challenge agrees with final decision or not. | Full principal back to challenger. |

Each category has its own `(owner, amount, claimed)` record. `claimBond(id,kind,recipient)` is callable only by its owner, only after FINALIZED/CANCELLED, exactly once, to a valid owner-selected recipient. No position is required to claim one's bond. An absent proposal/challenge has no bond owner or entitlement. Claims perform CEI and use the same nonreentrant financial facade as participant claims. Failed transfers restore flags/liabilities; a rejecting owner can redirect funds. Pausing/deactivation never blocks terminal bond claims.

For every decision YES, NO, INVALID, zero winning side, zero participation and missed arbitration/finalization deadline, the rule is identical: return deposited principal. No method can slash a bond, including governance. `BondSlashed` is deliberately absent until an actual approved mechanism exists; pretending it is implemented would be misleading. No positive slashing test exists because no slashing is authorized; tests verify unknown slashing/admin-rescue selectors reject and balances remain intact.

Risk: refundable-only bonds lock capital temporarily but provide no direct economic penalty for spam, dishonest proposals or nuisance disputes. Production requires explicit approved incentives, market-integrity review and potentially redesigned contracts plus audit. Existing markets cannot acquire a slashing rule retroactively. Eligibility and off-chain moderation are outside this P0 contract implementation.
