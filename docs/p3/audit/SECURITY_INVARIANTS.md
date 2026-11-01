# ORAKL Protocol — Formal Security Invariants Specification

**Document ID:** `ORAKL-P3-SECURITY-INVARIANTS`  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Date:** 2026-11-01  

> [!IMPORTANT]
> This document specifies the non-negotiable formal security invariants enforced by the ORAKL smart contracts across state transitions, role authorizations, timelocks, and collateral accounting.

---

## 1. Governance & Role Authorization Invariants

### Invariant G-1: Role Disjointness
$$\forall w_1, w_2 \in \{\text{Governance}, \text{Compliance}, \text{Arbitrator}\}, w_1 \neq w_2 \implies \text{Owners}(w_1) \cap \text{Owners}(w_2) = \emptyset$$
- **Enforcement:** `ProtocolConfig._walletState()` and `_disjoint()`.
- **Failure Mode:** Reverts `InvalidMultisig()`.

### Invariant G-2: Guardian Exclusion
$$\forall w \in \{\text{Governance}, \text{Compliance}, \text{Arbitrator}\}, \text{Guardian} \notin \text{Owners}(w)$$
- **Enforcement:** `ProtocolConfig._walletState()`.
- **Failure Mode:** Reverts `InvalidMultisig()`.

### Invariant G-3: Asymmetric Emergency Pause Authority
$$\text{Guardian can pause immediately; Guardian cannot unpause or modify parameters.}$$
$$\text{Unpause} \iff \text{Caller} = \text{Governance} \land \text{Approved}(\text{Compliance}) \land \text{TimelockSatisfied}$$
- **Enforcement:** `ProtocolConfig.pause()`, `ProtocolConfig.unpause()`.
- **Failure Mode:** Reverts `Unauthorized()` if Guardian attempts unpause; reverts `NotApproved()` if unpausing without compliance approval.

### Invariant G-4: Mandatory 24-Hour Timelock
$$t_{\text{activation}} \ge t_{\text{approval}} + 86,400 \text{ seconds}$$
- **Enforcement:** `ProtocolConfig.activateFinance()`, `ProtocolConfig.setParameters()`.
- **Failure Mode:** Reverts `InvalidTimelock()`.

---

## 2. Market Lifecycle & Financial Invariants

### Invariant F-1: Fixed-Tier Pilot Exposure Caps
$$\text{TotalUnresolvedExposure} \le \text{GlobalUnresolvedCap} = 3 \times \text{PoolCap}$$
$$\forall a \in \text{Arbitrators}, \text{UnresolvedExposureByArbitrator}(a) \le 2 \times \text{PoolCap}$$
- **Enforcement:** `SelectedMarketFactory._validateExposure()`.
- **Failure Mode:** Reverts `ExposureExceeded()`.

### Invariant F-2: Neutral INVALID Settlement (No Proposer Confiscation)
$$\text{Disposition}(\text{INVALID}) = \text{NEUTRAL} \implies \text{ProposerBond refunded} \land \text{ChallengerStakes refunded} \land \text{ProtocolFee} = 0$$
- **Enforcement:** `SelectedMarketFactory.settle()`.
- **Guarantee:** Invalid markets never redistribute collateral to speculative winners or penalize honest proposers for subjective ambiguity.

### Invariant F-3: Collateral Solvency & Exact Balance Conservation
$$\text{ContractBalance} \ge \text{TotalActivePools} + \text{BondLiability} + \text{PendingFees}$$
- **Enforcement:** Internal accounting across `createMarket`, `predict`, `challengeResult`, and `claimProceeds`.
- **Guarantee:** The contract is 100% fully reserved at all times.

---

## 3. Safe Global Integration Invariants

### Invariant S-1: Multi-Signature Quorum
$$\forall \text{Tx}, |\text{ValidSignatures}(\text{Tx})| \ge \text{Threshold} = 3$$
- **Enforcement:** `Safe.sol:checkNSignatures()`.
- **Failure Mode:** Reverts `GS020`.

### Invariant S-2: Ascending Owner Address Ordering
$$\forall i < j, \text{Signer}_i < \text{Signer}_j$$
- **Enforcement:** `Safe.sol:checkNSignatures()`.
- **Failure Mode:** Reverts `GS026`.

### Invariant S-3: EIP-712 Domain Isolation
$$\text{DomainSeparator} = \text{keccak256}(\text{EIP712Domain}(\dots, \text{chainId}, \text{proxyAddress}))$$
- **Enforcement:** `Safe.sol:domainSeparator()`.
- **Failure Mode:** Cross-chain or cross-proxy replays revert `GS026`.
