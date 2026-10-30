# ORAKL v1 P0 architecture

Status: local implementation, unaudited, finance disabled by default. Target: QIE Mainnet; the live legacy Testnet frontend and deployment remain separate.

## Custody boundary

`MarketFactory` is the deployable financial facade. `MarketResolver` and `PredictionPool` are abstract source modules inherited into this one non-upgradeable contract; `ProtocolStorage` supplies shared state and pull-transfer helpers. `ProtocolConfig` is a separate noncustodial contract. This is a deliberate alternative to four independently payable deployments: one balance and one ledger avoid cross-contract bond forwarding, wiring races, repeated authorization and split solvency assumptions. No delegatecall, proxy, migration or administrator escrow access exists.

Reusable legacy patterns: pinned OpenZeppelin 5.4.0 Math.mulDiv and storage ReentrancyGuard, capped pools, independent side contributions, immutable settlement, owner-directed pull payments, failed-transfer rollback and forced-balance separation. Legacy source, ABI and public Testnet manifest are preserved byte-for-byte.

## Parameters and trust

Creation snapshots fee, all three bonds, minimum contribution, pool cap, challenge/arbitration periods and arbitrator. Changes affect future markets only. Engineering bounds (not audited economic recommendations): fee <= 1000 bps; bonds <= 1,000,000 native units; minimum positive and <= uint128 pool cap; challenge 1 hour–7 days; arbitration 1 hour–30 days; creation horizon and resolution horizon each <= 365 days. Constructor takes explicit parameters; no production defaults are silently selected. Tests use fee 200 bps, creation bond 5 native units and illustrative proposal/challenge bonds.

Governance, compliance approver and arbitrator must expose multisig owner/threshold views, threshold >= 2, 2–32 distinct nonzero owners. Their owner sets must be disjoint at validation. This ABI check is not proof of genuine Safe implementation or future independent control: deployed code, modules, owners and signing policy require external verification. Role contract addresses are immutable except the arbitrator in future-market parameters; existing arbitrators are immutable snapshots. A separate immutable guardian can pause/deactivate, never seize funds. No mutable privileged pool recipient exists.

## Financial release

Config starts inactive. Governance binds exactly one facade referencing this config. Compliance records a nonzero release commitment bound to chain, facade address/runtime code hash and parameters. Governance separately activates that exact release. Changing parameters invalidates release approval and deactivates new financial activity. Approval is an on-chain attestation by trusted people, not proof of audit/legal facts. The deployment helper only constructs disabled contracts. Tests alone simulate approval/activation on the local EVM. No deployment script activates finance.

All payable facade entries (creation, contribution, proposal, challenge) check active/unpaused/exact facade binding before any deposit, including zero-value calls. Direct/unknown transfers revert. Nonpayable finalization, arbitration, timeout, claims, refunds and bond withdrawals remain available during pause/deactivation. Forced funds are reported as surplus and cannot change entitlements or be swept.

## Conservative P0 policies requiring product approval

Proposals and challenges are permissionless except the designated arbitrator cannot propose/challenge and a proposer cannot challenge its own proposal. Creators may propose but cannot arbitrate their own market or bypass a challenge. Every disputed decision must have nonzero evidence. All bond principals return to their original depositors after any terminal result, including INVALID and timeout; no slashing or dispute bounty exists until punitive economics are approved. This mitigates arbitrary confiscation but does not economically deter dishonest challenges. Dust/unclaimed entitlements stay reserved indefinitely; no sweep exists.

Any pause/deactivation advances an activity epoch; an earlier proposal cannot later finalize uncontested. Its immutable timeout still allows refunds. Existing disputes and terminal claims remain accessible.

No backend, metadata pinning, jurisdiction enforcement, production multisig setup or frontend migration is implemented by P0. Refer to the user-supplied PRD for the complete product scope and open decisions.
