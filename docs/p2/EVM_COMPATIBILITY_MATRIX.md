# ORAKL Protocol — QIE EVM Compatibility Matrix

- **Document ID**: `ORAKL-P2-EVM-001`
- **Date**: 2026-11-01
- **Status**: `TECHNICAL BENCHMARK EVIDENCE`

---

## 1. EVM Hardfork Evaluation

| EVM Hardfork | Key EIPs Introduced | QIE EVM Status | Empirical Verification Method | ORAKL Compatibility Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Frontier / Homestead / Spurious Dragon** | Base EVM instructions, REVERT, STATICCALL | **SUPPORTED** | Standard EVM calls pass | Fully compatible |
| **Berlin** | EIP-2929, EIP-2930 (Access lists) | **SUPPORTED** | Base EVM gas schedule | Fully compatible |
| **London** | EIP-1559 (Base fee dynamic burn) | **SUPPORTED** | `eth_feeHistory` returns baseFeePerGas | Fully compatible; Type 2 transactions supported |
| **Paris (The Merge)** | EIP-3675, EIP-4399 (PREVRANDAO replacing DIFFICULTY) | **SUPPORTED** | Block header inspection | ORAKL pinned target is `paris` |
| **Shanghai** | EIP-3855 (`PUSH0`), EIP-3651, EIP-3860 | **SUPPORTED** | `eth_call` with opcode `0x5f` executed successfully | Fully compatible; PUSH0 works |
| **Cancun** | EIP-1153 (`TSTORE`/`TLOAD`), EIP-4844 (Blobs), EIP-5656 (`MCOPY`), EIP-6780 | **UNSUPPORTED** | `eth_call` with `0x5d` returned `invalid opcode: opcode 0x5d not defined` | **BLOCKER FOR CANCUN TARGET**: Compiler target must NOT be `cancun` |
| **Prague / Electra** | Future hardforks | **UNSUPPORTED** | Not implemented on QIE | N/A |

---

## 2. Solidity Compiler Target Discipline

### Current ORAKL Foundry Configuration
Under [`contracts/foundry.toml`](file:///home/pupulion/orakl/contracts/foundry.toml):
```toml
solc_version = "0.8.37"
evm_version = "paris"
optimizer = false
bytecode_hash = "none"

additional_compiler_profiles = [{ name = "orakl", optimizer = true, optimizer_runs = 50, via_ir = false }]
```

### Compatibility Analysis
1. **Targeting `paris`**:
   - `solc` targeting `paris` emits `PUSH1 0x00` instead of `PUSH0` (`0x5f`).
   - Does NOT emit transient storage (`TSTORE`/`TLOAD`) or `MCOPY`.
   - Guaranteed to execute safely on QIE nodes without throwing `invalid opcode`.
2. **Optimizer Settings**:
   - `optimizer_runs = 50` produces compact bytecode designed for low-frequency deployment and moderate runtime efficiency.
   - Bytecode sizes for `SelectedMarketFactory` and `ProtocolConfig` fit comfortably within EIP-170 constraints.
3. **Recommendation**:
   - Keep `evm_version = "paris"` as the pinned production compiler configuration. Do not upgrade to `cancun`.
