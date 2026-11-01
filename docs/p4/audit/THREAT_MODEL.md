# ORAKL Protocol — Threat Model & Security Architecture

---

## 1. Actor Taxonomy & Permission Matrix

The ORAKL Protocol enforces a strict constitutional separation of powers across four governing entities and three market participant roles:

| Actor | Threshold / Keys | Permitted Actions | Prohibited Actions | Failure Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Governance Safe** | 3-of-5 Multisig | `bindFactory`, `setParameters`, `unpause`, `activateFinance` | Cannot approve releases, cannot settle disputes, cannot bypass timelocks | Malicious Governance cannot activate without Compliance approval |
| **Compliance Safe** | 3-of-5 Multisig | `approveRelease` (issues release tags) | Cannot execute protocol parameters, cannot unpause, cannot touch user funds | Stalled compliance prevents new financial activations |
| **Arbitration Safe** | 3-of-5 Multisig | `settleDispute` (within arbitration window) | Cannot modify protocol parameters, cannot change fees or bonds | Rogue arbitrator limited to per-arbitrator exposure cap |
| **Guardian** | Single EOA | `pause` (emergency circuit breaker) | Cannot unpause, cannot access funds, cannot modify parameters | Denial-of-service mitigated by Governance Safe unpause |
| **Proposer** | Any EOA | `proposeResult` (stakes proposal bond) | Cannot settle dispute, cannot withdraw early | Loss of proposal bond if disputed & overturned |
| **Challenger** | Any EOA | `challengeResult` (stakes challenge bond) | Cannot settle dispute | Loss of challenge bond if proposal upheld |
| **Predictor** | Any EOA | `predict` (deposit collateral to pool) | Cannot alter market state | Capped by global & per-arbitrator exposure limits |

---

## 2. Core Security Invariants

### Invariant 1: Separation of Powers (Disjoint Multisigs)
No address may simultaneously serve as a signer on more than one role Safe (`Governance`, `Compliance`, `Arbitration`).
- **Enforcement**: `ProtocolConfig._disjoint()` executes pairwise set intersection checks across all three signer sets whenever `requireArbitrator()` or role checks are evaluated.

### Invariant 2: Timelocked Staging (No Immediate Activation)
Financial activity cannot be enabled immediately upon deployment or unpausing.
- **Enforcement**: `activateFinance()` requires:
  1. `approvedRelease == releaseTag` (issued by Compliance Safe)
  2. `block.timestamp >= approvedReleaseAt + ACTIVATION_DELAY` (24-hour mandatory delay)

### Invariant 3: Emergency Circuit Breaker (Fail-Closed)
Any emergency pause halts all prediction creation and deposits immediately, cancels pending compliance approvals, and triggers an activity epoch interruption.
- **Enforcement**: `pause()` clears `approvedRelease = bytes32(0)` and increments `activityEpoch`. Unpausing requires a fresh Compliance Safe approval and a new 24-hour timelock delay.

### Invariant 4: Immutable Exposure Boundaries
Unresolved prediction capital cannot exceed fixed safety ceilings.
- **Enforcement**: `SelectedMarketFactory._beforePrediction()` asserts:
  - `totalUnresolvedExposure + amount <= globalUnresolvedCap` (300 ETH)
  - `unresolvedExposureByArbitrator[arb] + amount <= perArbitratorUnresolvedCap` (200 ETH)
  - Individual market pool cap: `100 ETH`.

### Invariant 5: Neutral-INVALID Fallback Economics
If a market is cancelled, expired, or ruled `INVALID`, all deposits are returned to participants with **zero protocol fee deduction**.

---

## 3. Threat Scenarios & Mitigations

```
                                    ATTACK TREE & DEFENSES
                                    
         [Attacker Objective: Drain Funds or Corrupt Settlement]
                                    |
      +-----------------------------+-----------------------------+
      |                             |                             |
[Timelock Bypass]         [Unauthorized Dispute]         [Governance Takeover]
      |                             |                             |
- Compliance required         - msg.sender == arbSafe        - 3-of-5 threshold
- 24h delay enforced          - Dispute window check         - Disjoint signers
- State verified              - Exposure capped              - Safe v1.4.1 EIP-712
```

### Threat A: Malicious Governance Signer Collusion
- **Attack**: 3 Governance signers collude to redirect market payouts or increase protocol fees beyond limits.
- **Defense**: Maximum fee is capped at 10% (`MAX_FEE_BPS = 1000`) in code. Governance cannot settle disputes or release funds directly.

### Threat B: Compromised Arbitrator
- **Attack**: Rogue arbitrator attempts to rule incorrectly on all markets.
- **Defense**: Exposure is bounded to `perArbitratorUnresolvedCap` (200 ETH). Markets must pass through an active 48-hour challenge window before dispute settlement is possible. If arbitrator keys are compromised, Guardian pauses the protocol immediately.

### Threat C: Signature Replay Across Chains or Proxies
- **Attack**: Attacker intercepts valid 3-of-5 signatures from a testnet or another Safe proxy and submits them on mainnet.
- **Defense**: Safe v1.4.1 enforces EIP-712 domain separation binding `chainId` and `verifyingContract`. Hashes signed for chain 31337 or Safe A are mathematically rejected by Safe B on any other chain (verified in Scenario 10 and 11).

### Threat D: Flash-Loan Governance Attacks
- **Attack**: Borrowing large token amounts in a single block to pass malicious proposals.
- **Defense**: ORAKL does not use token-weighted voting. Governance is managed exclusively by 3-of-5 multisig Safes with a 24-hour timelock. Flash loans have zero voting or execution power.
