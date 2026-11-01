# ORAKL Protocol — Governance Authority Matrix

- **Document ID**: `ORAKL-P2-GOV-MATRIX-001`
- **Date**: 2026-11-01
- **Status**: `AUTHORITY BOUNDARY SPECIFICATION`

---

## 1. Privileged Function Matrix

| Target Contract | Function Selector | Privileged Role | Quorum Requirement | Enforced Preconditions | Consequences / State Effects |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ProtocolConfig` | `bindFactory(address)` | Governance | 3-of-5 Safe | `factory == address(0)`, facade returns matching `protocolConfig()` | Irreversibly binds factory |
| `ProtocolConfig` | `setParameters(...)` | Governance | 3-of-5 Safe | Valid parameter bounds | Deactivates finance, increments epoch, clears approval |
| `ProtocolConfig` | `approveRelease(bytes32)` | Compliance | 3-of-5 Safe | `release != 0`, `!financialActive`, `chainId == deploymentChainId` | Generates digest, sets 24h timelock (`activationAfter`) |
| `ProtocolConfig` | `activateFinance(bytes32)` | Governance | 3-of-5 Safe | `block.timestamp >= activationAfter`, `approvedRelease == release`, `!paused` | Activates financial operations on factory |
| `ProtocolConfig` | `unpause()` | Governance | 3-of-5 Safe | `_requireApproved(approvedRelease)` | Resumes protocol operations |
| `ProtocolConfig` | `pause()` | Guardian or Governance | 1-of-1 Guardian or 3-of-5 Safe | None (immediate emergency action) | Pauses market activity, clears approved release, bumps epoch |
| `ProtocolConfig` | `deactivateFinance()` | Guardian, Governance, or Compliance | Any of the three authorities | None | Deactivates finance immediately |
| `SelectedMarketFactory`| `settleDispute(...)` | Arbitrator | Arbitrator Authority | Market in `DISPUTED` state, within `arbitrationPeriod` | Finalizes outcome, triggers reward/refund distribution |
| `SelectedMarketFactory`| `cancelExpiredMarket(...)`| Permissionless | None | `block.timestamp > maxResolutionTime` | Transitions to `CANCELLED`, enables 100% principal refunds |
