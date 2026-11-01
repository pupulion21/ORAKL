# ORAKL Protocol — Public Release Blockers & Pre-Deployment Gates

> **STATUS**: `P4 INTERNAL AUDIT HANDOFF READY — EXTERNAL AUDIT NOT PERFORMED — PUBLIC RELEASE BLOCKED`

---

## 1. Absolute Boundaries & Non-Authorization Notice

ORAKL is strictly classified as:

$$\mathbf{LOCAL\_ENGINEERING\_VERIFIED} \implies \mathbf{PUBLIC\_RELEASE\_BLOCKED}$$

Under no circumstances is any engineer, automated process, or agent authorized to:
- Deploy `ProtocolConfig` or `SelectedMarketFactory` to public QIE Testnet or Mainnet.
- Activate financial features (`financialActive = true`) on any network outside isolated local Anvil (`chainId 31337`).
- Commit or transmit real private keys, seed phrases, or production treasury funds.
- Claim that local test suite passes constitute an independent third-party security audit certification.

---

## 2. Comprehensive Release Blockers Register

### Blocker 1: Independent External Third-Party Security Audit
- **Condition**: A formal, independent audit by a reputable smart-contract security firm (e.g., OpenZeppelin, Trail of Bits, Certora, Spearbit, Ackee) has **not yet occurred**.
- **Action Required**: Handoff this P4 audit package to external auditors, remediate all external findings, and obtain a signed final audit report before any mainnet consideration.

### Blocker 2: Production Safe Multi-Sig Key Ceremony
- **Condition**: All automated and live tests execute with disposable BIP-39 mnemonic accounts (`test test test...`).
- **Action Required**: A formal, documented key generation ceremony must be conducted:
  - 5 disjoint hardware signers for Governance Safe (3-of-5).
  - 5 disjoint hardware signers for Compliance Safe (3-of-5).
  - 5 disjoint hardware signers for Arbitration Safe (3-of-5).
  - 1 independent Guardian EOA with offline monitoring capabilities.
  - No signer may overlap across any two roles.

### Blocker 3: Production Protocol Economics & Parameter Signoff
- **Condition**: The parameters utilized in P0–P4 (2% fee, 1 ETH creation bond, 10 ETH proposal bond, 1 ETH challenge bond, 100 ETH pool cap, 300 ETH global exposure cap) are provisional engineering and test fixtures.
- **Action Required**: Formal economic modeling and operational approval of live mainnet bond amounts, minimum prediction sizes, and fee rates.

### Blocker 4: QIE EVM Production Target Verification
- **Condition**: All automated tests execute on isolated Anvil. While Foundry and bytecodes are pinned to EVM `paris`, live transaction submission, gas metering, RPC throughput, and state finality on QIE EVM mainnet validators remain untested.
- **Action Required**: Conduct read-only RPC diagnostics and bounded canary testnet verification prior to any mainnet contract interaction.

### Blocker 5: Legal & Regulatory Review
- **Condition**: Prediction market mechanics, bond dispositions, and fee distributions may be subject to legal and regulatory constraints in various jurisdictions.
- **Action Required**: Comprehensive legal review and compliance clearance before public access.
