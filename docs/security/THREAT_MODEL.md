# ORAKL P0 threat model and security review

Scope: new native-collateral protocol and preserved legacy boundary. This is first-party engineering review with automated testing, not an independent audit. See [initial audit](../audit/INITIAL_REPOSITORY_AUDIT.md), [accounting model](../protocol/ACCOUNTING_INVARIANTS.md) and [executed test report](../testing/FOUNDRY_TEST_REPORT.md).

## Assets and authority

Assets: participant principal/payout entitlements, three categories of bond principal, accrued protocol fees, immutable market rules/outcomes, release identity, and metadata/evidence availability. Only the financial facade holds accounted funds; config holds none. Raw native balance is never the pool denominator.

Roles: permissionless creator/contributor/proposer/challenger/finalizer/timeout caller; immutable per-market arbitrator; immutable governance/compliance role contracts and guardian. Governance can configure future terms, bind one facade, activate an approved release, pause/unpause, deactivate and withdraw **accrued fees only**. Compliance can attest a release and deactivate; guardian can pause/deactivate. No role has a pool rescue, upgrade, arbitrary bond slash or outcome rewrite method.

## Threats and controls

| Threat | Control / residual limitation |
| --- | --- |
| Immediate creator-selected false settlement | New markets use optimistic proposals, full challenge window, independent disputed arbitration and immutable evidence/timing; no direct legacy resolve selector. Arbitrator/proposer truthfulness is not guaranteed. |
| Premature/late result, challenge or arbitration | Exclusive timestamp boundaries; proposal reserves full challenge+arbitration windows; terminal states are irreversible. Validator timestamp discretion remains, so no randomness or sub-block real-world precision is assumed. |
| Arbiter disappearance | Anyone cancels at the bounded arbitration deadline; other unresolved markets at max deadline; terminal refunds/bond withdrawals do not need an admin/backend. |
| Pause blocks challenge then proposal finalizes | Fixed using activity epochs: any interruption after proposal prevents uncontested finalization even after resumption. Refund at max deadline remains. Existing disputes may still arbitrate. |
| Deposits before release through zero bonds or alternate payable path | All four payable entries check active/unpaused/bound-facade/chain status, including zero value. receive/fallback reject. Forced credits cannot be prevented but remain nonspendable surplus. |
| Fake audit/compliance approval | Separate role attestations bound to chain, facade runtime/address and parameter digest. Humans must verify actual audit/legal evidence. A commitment or activation event is not certification. |
| Governance changes economics of funded market | Immutable per-market parameter snapshot; future-term changes deactivate finance and require fresh approval. No upgrade/proxy/delegatecall. |
| Privileged fee withdrawal drains pools/bonds | Accrued fee liability ceiling; settlement reclassifies once; withdrawal cannot debit participant/bond ledgers. |
| Confiscation or arbitrary disputed-bond punishment | Conservative return-to-depositor policy for all terminal outcomes; no slashing API. Economic deterrence is incomplete and requires a separate production decision. |
| Reentrant/hostile recipient | Pinned OZ storage ReentrancyGuard across financial transitions, CEI before native calls, exact failure rollback, claimant-selected alternate recipient. |
| Double payout/refund/bond claim | One per-user settlement flag, exclusive refund/payout modes, one per-category bond flag; state changed before send. |
| Overflow, rounding exploitation, order dependence | uint128 aggregate pool cap, checked uint256 ledgers, full-precision Math.mulDiv floor, fixed total denominators; tiny payouts may be zero; dust stays reserved. |
| Forced native balance manipulation | Balance/accounted/surplus separation; no donation-derived contribution or fee and no surplus rescue. |
| Mutable/absent/malicious metadata | Immutable nonzero content commitment and bounded IPFS URI shape only. Services must validate CID/content hash, safely render untrusted text, redundantly pin evidence and publish exact rules; P0 does not prove content validity. |
| Reorgs, RPC/wallet substitution, wrong ABI | Existing frontend unchanged with runtime/chain/session/receipt checks; v1 integration must separately bind both contract identities, use confirmed same-block reconciliation and reorg-aware indexing. No production manifest is generated. |
| Admin credential compromise | Distinct multisig interfaces, disjoint owner sets at validation, guardian pause/deactivate and refund fallback. Owner/module changes or dishonest multisig implementations cannot be proved safe by interface calls. |
| Protocol/market service censorship | Direct timeout, claim/refund/bond calls do not depend on hosted UI. Pauses can deny new activity and force refunds; there is no guaranteed availability. |

## Automated finding triage

Slither's full source scope includes legacy plus v1, excluding test/script/vendor paths from reports. Its `arbitrary-send-eth` high-severity flags for the two native-transfer helpers are expected owner-directed pull payments: new call sites are participant settlement, bond withdrawal and governance withdrawal capped by fee liability; legacy call sites are owner claims/refunds. Both helpers are internal/private, recipient validation precedes use, all callers are nonreentrant and debits are bounded before transfer. Adversarial tests verify rollback, redirect, reentrancy and isolation. These are reviewed detector matches, **not a claim that Slither returned zero findings**.

Low timestamp flags correspond to explicit deadline checks, not randomness. Informational low-level-call flags cover checked native sends and a view-only config-binding probe. Initial missing-zero-check warnings were addressed with explicit pre-assignment constructor checks. The final report records final tool counts/exit code. An early parallel build/Slither invocation failed reading build-info; isolated sequential execution succeeded without dependency changes. Raw findings remain available for independent reviewers; no detector is silenced in source merely to obtain a green report.

## Remaining release blockers and trust assumptions

- Independent review of code, economic incentive design, emergency policy, exact production settings and remediation is mandatory. Passing tests does not prove absence of vulnerabilities.
- Refundable-only bonds are intentionally nonpunitive; nuisance disputes and dishonest proposals can exhaust arbitration availability or delay settlement. Production bond economics and arbitration service/security requirements remain unresolved.
- Actual governance/compliance/arbitration signer independence, Safe code/modules, key custody, role rotation and incident response must be verified outside these contracts. No installed multisig is supplied.
- Claims and dust have no expiry/sweep. All unclaimed funds remain reserved indefinitely. Production residual policy is open.
- No on-chain per-user jurisdiction eligibility is implemented. Mainnet financial release remains blocked pending the required legal/operational decisions.
- Native currency identity/decimals, QIE creation/opcode/envelope/gas behavior and explorer verification are not fully established; deployment is disabled.
- Facade bytecode is close to the EIP-170 size limit under the pinned optimizer-off build. A regression test enforces the limit; further features require size review and potentially an explicitly approved/audited build-profile decision.
- No backend/indexer/IPFS pinning or v1 UI is delivered in P0. Metadata availability and real-world evidence correctness remain external trust boundaries.

No live transaction, production release approval, Mainnet deployment, production activation, push or PR was performed for this refactor.
