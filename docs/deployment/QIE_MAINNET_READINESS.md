# QIE Mainnet readiness — BLOCKED

Checked: 2026-10-30. No Mainnet transaction, signature, deployment or activation occurred. Network reads do not authorize a launch. Existing Testnet deployment history remains at [results/deployment](../../results/deployment/README.md).

## Evidence and unresolved configuration

The [official QIE network documentation](https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet) lists Mainnet chain 1990 (`0x7c6`), five RPC hosts `rpc1mainnet.qie.digital` through `rpc5mainnet.qie.digital`, and [mainnet.qie.digital](https://mainnet.qie.digital/) as explorer. Its displayed native symbol is **QIEV3**, whereas the PRD uses QIE; the page does not specify native decimals. Do not silently resolve that discrepancy.

[Captured JSON-RPC observations](evidence/mainnet-rpc-observation.json) show all five HTTPS endpoints responding with chain `0x7c6`, nonzero block height, block data and gas-price/estimation results. These are point-in-time observations, not evidence of independent providers, uptime, finality or load tolerance. The zero-value probe to `0x0000000000000000000000000000000000000002` returned `0x5244` (21,060 gas). That destination is a standard EVM precompile; this observation is not an ordinary EOA-transfer or ORAKL gas benchmark. No ORAKL creation, contract write or payout gas benchmark has been performed on Mainnet. Native symbol/decimals, finality policy and deployment compatibility remain **UNVERIFIED**.

| Requirement | Status |
| --- | --- |
| Authoritative chain ID/RPC/explorer listing | VERIFIED AS DOCUMENTED; chain ID corroborated by live read-only RPC. |
| Native currency symbol/decimals | UNRESOLVED; QIEV3/QIE discrepancy; decimals unverified. |
| RPC historical reads/log limits/reorg/finality behavior | UNVERIFIED for production requirements. |
| Contract creation/runtime/opcode and transaction-envelope support | UNVERIFIED for these v1 contracts on Mainnet. Paris compilation is retained, not proof of compatibility. |
| Contract deployment/payout/bond/dispute gas | UNVERIFIED. |
| Explorer source verification procedure | UNTESTED on Mainnet; do not reuse Testnet API assumptions. |
| Production governance/compliance/arbitration multisigs | NOT CONFIGURED. |
| Independent audit/compliance approval/economics | NOT COMPLETE. |
| Indexer/metadata services, alerts, backups/recovery | NOT IMPLEMENTED by P0. |
| Production network config / deployment permission | DISABLED; `qie-mainnet.readiness.json` deliberately cannot serve as a deployment manifest. |

## Deployment strategy after separate authorization

1. Resolve all identity/currency questions with authoritative QIE documentation/maintainers; archive dated evidence. Benchmark redundant read endpoints, log queries, historical blocks, simulation, gas behavior, chain reorganizations and finality. Do not send live writes under this task.
2. Obtain explicit approved economic parameters and independent security review of **the exact build**. Retain dependency/compiler pins or approve/audit any change. Confirm runtime and initcode size against chain limits; current engineering target follows EIP-170. Do not assume future code additions will fit.
3. Configure three verified multisigs (governance, compliance approver, arbitrator), each with threshold >=2 and 2–32 distinct nonzero owners, disjoint signer sets; independently verify code, owners, modules/guards and operational control. Set an independent guardian for emergency pause/deactivation. No production addresses are invented here.
4. After explicit deployment permission, deploy ProtocolConfig inactive, then MarketFactory referencing it. Record chain/address/constructor arguments, transaction/receipt/block identity, creation/runtime/source/settings hashes and ownership/role evidence. Never reuse or replace the legacy Testnet manifest.
5. Governance binds the correct facade once. Verify runtime bytecode, links, parameters, liabilities/balance and `financialActive=false`. Source verification requires standard-json input, exact pinned solc/Paris/v1-optimizer-on-runs-50/viaIR-false/metadata-none settings, constructor arguments, and the explorer's **confirmed** verification interface. A successful receipt is not explorer verification or finality.
6. Finish production frontend adapter, metadata pinning/indexer, consistent-block reconciliation, monitoring and recovery rehearsals. Run gated end-to-end tests with no real-value pools.
7. Operational release is a separate ceremony. Publish the audited build, remediation evidence, required compliance authorization, immutable role/parameter checks and a release-document commitment. Compliance attests that commitment; governance separately activates the matching digest. The contract cannot determine whether humans actually completed those reviews. Activation must not be described as certification. This task never performs either production approval or activation.

`contracts/script/DeployInactive.s.sol` is **local rehearsal only**, rejects chain IDs other than 31337, has no broadcast calls and deliberately leaves contracts unbound/unapproved/inactive. A production broadcast tool is intentionally unavailable until network/readiness decisions are resolved.

## Emergency procedures

- Guardian/governance calls pause to stop all new deposits. Guardian/governance/compliance can deactivate and invalidate the release. Alert users and preserve exact transaction/block observations; do not automatically resend writes.
- Any interruption invalidates outstanding uncontested proposals through activityEpoch. Existing disputes can still be arbitrated; expired markets can be cancelled by anyone. Keep claim/refund/bond instructions available independently of the frontend/backend.
- Reconcile participant, fee and bond liabilities at one sufficiently confirmed block; unsolicited native balances are surplus, not deposits. There is no pool rescue/seizure function.
- On compromised operational keys, pause/deactivate with an independent remaining authorized role, secure multisig owners/modules, investigate and independently review. Immutable role-contract addresses and per-market arbitrators cannot be replaced by an emergency admin. If the arbitrator is unavailable, use the bounded refund fallback.
- On RPC failure, use only verified alternate endpoints after chain identity checks; recover receipts by original hash. Stop dependent signing if identity/state cannot be verified. A backend/indexer failure cannot prevent direct on-chain terminal claims.
- Resumption requires verified remediation, fresh compliance release approval and governance activation as applicable; unpausing alone does not reactivate finance or repair invalidated proposals. Document public incidents and remaining market deadlines.

## P0.1 additional blockers and completed local controls

No new live network probe or transaction was performed during P0.1. The earlier dated RPC observations are retained; they do not prove current production readiness or QIE-specific code/initcode limits. Local builds now isolate v1 optimizer-on/runs-50/Paris from the untouched optimizer-off legacy build. Standard EIP-170/EIP-3860 engineering size margins are tested; actual QIE Mainnet limits, transaction envelopes, cold-wallet getter/reporter gas and explorer verification remain to be independently verified. Do not infer Mainnet compatibility from local Foundry gas reports.

Local recovery/control code is implemented, but release still requires: (1) approved bond economics and positive-bond/exposure policy or an explicitly chosen alternative; (2) independently verified genuine wallet implementations, singleton/proxy behavior, modules, guards, fallback handlers and signer/control independence; (3) approval of emergency abort trust and the 24-hour release-review minimum; (4) independent security audit/remediation and applicable compliance/eligibility authorization; (5) metadata/indexer/monitoring and incident-recovery services. The adversarial hidden-module test intentionally demonstrates that plausible getters do not prove execution authorization. Observable drift checks do not remove this blocker.

Pause/deactivation now revokes approvals and finance, quarantines old unresolved markets and enables bounded principal refunds. Every new review must occur while finance is disabled, commit the current epoch/controls/build, wait 24 hours and receive separate governance unpause/activation. Terminal user/bond claims remain available. No P0.1 broadcast or activation script was introduced; the local-only rehearsal remains unbound/unapproved/inactive on construction.
