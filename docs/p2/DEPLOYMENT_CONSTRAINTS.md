# ORAKL Protocol — Deployment Constraints & Preconditions

- **Document ID**: `ORAKL-P2-DEP-001`
- **Date**: 2026-11-01
- **Status**: `MANDATORY DEPLOYMENT PRECONDITIONS`

---

## 1. Smart Contract Deployment Order & Binding Sequence

```mermaid
flowchart TD
    D1["1. Deploy Role Multi-Sigs (Governance, Compliance, Arbitrator)"] --> D2["2. Deploy ProtocolConfig(gov, comp, arb, guardian)"]
    D2 --> D3["3. Deploy SelectedMarketFactory(config)"]
    D3 --> D4["4. Call config.bindFactory(factory) by Governance Safe"]
    D4 --> D5["5. Call config.approveRelease(activationAfter) by Compliance Safe"]
    D5 --> D6["6. Mandatory 24-hour Timelock Delay (86,400s)"]
    D6 --> D7["7. Call config.activateFinance() by Governance Safe"]
    D7 --> D8["8. Verification: factory.isFinancialActive() == true"]
```

---

## 2. Mandatory Pre-Deployment Constraints

1. **EVM Version Enforced**: Must never compile for `cancun` on QIE target networks. Pinned to `paris`.
2. **Cold Wallet Multisig Ownership**:
   - `Governance` Safe must possess 5 distinct signers with threshold 3.
   - `Compliance` Safe must possess 5 distinct signers with threshold 3.
   - No overlap greater than 1 signer across role sets to maintain institutional separation.
3. **Immutable Factory Binding**:
   - Once `ProtocolConfig.bindFactory(factory)` is invoked, the binding is irreversible. Factory replacement requires a new deployment cycle and liquidity migration.
4. **Mandatory Timelock**:
   - `activationAfter` must be at least `block.timestamp + 86400`. The contract enforces this requirement on-chain; premature activation reverts with `DelayNotElapsed()`.
5. **No Public Key Ingestion**:
   - Signer keys must remain on secure hardware modules (Ledger, Trezor, Safe CLI).
