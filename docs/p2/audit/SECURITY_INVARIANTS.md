# ORAKL Protocol — Formal Security Invariants & Solvency Proofs

- **Document ID**: `ORAKL-P2-INVARIANTS-001`
- **Date**: 2026-11-01
- **Status**: `MATHEMATICAL INVARIANT SPECIFICATION`

---

## 1. Solvency & Balance Conservation Invariants

### Invariant A: Total Escrow & Balance Conservation
The native token balance held by the `SelectedMarketFactory` contract must always equal or exceed the sum of all active market principal escrows plus all unreturned participant and arbitrator bonds:

$$\text{address}(\text{SelectedMarketFactory}).\text{balance} \ge \sum_{m \in \text{Markets}} \left( \text{poolYES}_m + \text{poolNO}_m + \text{bonds}_m \right)$$

- **Enforcement**:
  - All incoming deposits strictly increase internal pool or bond variables by `msg.value`.
  - Disbursements strictly decrease internal balances before transferring native ether.
  - Reentrancy guards prevent recursive withdrawal attacks.

### Invariant B: Zero-Sum Pool Settlement & Exact Fee Conservation
Upon market settlement for a decisive outcome (YES or NO), the total sum disbursed to winning participants plus the protocol fee must exactly equal the total pool contributions:

$$\sum_{u \in \text{Winners}} \text{payout}(u) + \text{protocolFee} = \text{totalPool}$$

Where:
$$\text{protocolFee} = \lfloor \frac{\text{totalPool} \times \text{feeBps}}{10000} \rfloor$$
$$\text{distributablePool} = \text{totalPool} - \text{protocolFee}$$
$$\text{payout}(u) = \lfloor \frac{\text{contribution}(u) \times \text{distributablePool}}{\text{winningPool}} \rfloor$$

Any fractional integer truncation remainder $\Delta \le \text{winningPool}$ wei is safely retained in the contract or added to fee reserves, ensuring no insolvency occurs.

---

## 2. Economic & Dispute Invariants

### Invariant C: Neutral-INVALID 100% Refund Guarantee
If a market resolves to **INVALID** (or expires without arbitrator settlement):
1. Protocol fee is strictly **0 wei** ($F = 0$).
2. Every participant receives exactly 100% of their deposited principal:
   $$\text{payout}(u) = \text{contribution}_{\text{YES}}(u) + \text{contribution}_{\text{NO}}(u)$$
3. Proposer bond and creation bond are returned in full.
4. Challenger bonds are returned in full.

### Invariant D: Remainder-Free Telescopic Challenger Ladder
When a challenger ladder successfully overturns a false proposal:
- The proposer's 10 ETH bond is slashed and distributed among the $K$ registered challengers ($1 \le K \le 3$):
  $$\text{baseShare} = \lfloor \frac{\text{proposerBond}}{K} \rfloor$$
  $$\text{remainder} = \text{proposerBond} - (\text{baseShare} \times K)$$
- Challenger 1 receives: $\text{baseShare} + \text{remainder}$.
- Challengers 2 and 3 receive: $\text{baseShare}$.
- **Result**: Zero wei is trapped or stranded in the contract.

### Invariant E: Arbitrator Liability Exposure Budget
For any arbitrator address $A$:
$$\sum_{m \in \text{UnresolvedMarkets}(A)} \text{poolCap}_m \le \text{perArbitratorUnresolvedCap}$$
$$\sum_{m \in \text{AllUnresolvedMarkets}} \text{poolCap}_m \le \text{globalUnresolvedCap}$$

If adding a new market would cause an arbitrator's unresolved exposure to exceed `perArbitratorUnresolvedCap`, market creation reverts with `ArbitratorCapExceeded()`.

---

## 3. Governance & Lifecycle Invariants

### Invariant F: Enforced 24-Hour Timelock
Any parameter modification or financial activation must satisfy:
$$\text{block.timestamp} \ge \text{activationAfter}$$
$$\text{activationAfter} \ge \text{approvedAt} + 24\text{ hours}$$

Neither Governance nor Compliance can unilaterally accelerate or bypass this delay.

### Invariant G: Circuit Breaker Interrupt
Calling `ProtocolConfig.pause()` immediately causes:
1. `paused = true`
2. `approvedRelease = bytes32(0)` (invalidating any pending activation)
3. `epoch = epoch + 1`

Resuming operations requires Compliance to execute a new `approveRelease()` and waiting an additional 24 hours.
