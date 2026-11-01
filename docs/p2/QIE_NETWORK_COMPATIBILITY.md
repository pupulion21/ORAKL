# ORAKL Protocol — QIE Network Compatibility Report

- **Document ID**: `ORAKL-P2-NET-001`
- **Date**: 2026-11-01
- **Author**: Lead Blockchain Security Engineer & Infrastructure Architect
- **Status**: `VERIFIED READ-ONLY EVIDENCE — NOT PRODUCTION AUTHORIZATION`
- **Primary Source**: `https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet`
- **Investigation Boundary**: Strictly bounded read-only JSON-RPC probes. Zero transactions broadcast; zero accounts funded.

---

## 1. Executive Summary

This report establishes empirical and documented technical compatibility between the ORAKL protocol and the QIE EVM blockchain environment across **QIE Testnet (Chain ID 1983)** and **QIE Mainnet (Chain ID 1990)**.

Live read-only RPC probing conducted on 2026-11-01 confirmed:
1. **Network Identity**: QIE Testnet runs on Chain ID `1983` (`0x7bf`); QIE Mainnet runs on Chain ID `1990` (`0x7c6`).
2. **Endpoint Health & Availability**:
   - `https://rpc1testnet.qie.digital/`: **DOWN / CONNECTION REFUSED** (`curl: (7) Failed to connect to server`).
   - `https://rpc2testnet.qie.digital/`: **ONLINE / HEALTHY** (Latency: ~219ms).
   - `https://rpc1mainnet.qie.digital/`: **ONLINE / HEALTHY** (Latency: ~204ms).
   - `https://rpc2mainnet.qie.digital/`: **ONLINE / HEALTHY** (Latency: ~317ms).
3. **EVM Opcode Profile**:
   - **Shanghai EIP-3855 (`PUSH0`)**: **SUPPORTED** (empirically verified on Mainnet and Testnet via reproducible `eth_call` probe with initcode `0x60425f5360015ff3` returning `0x42`; raw JSON-RPC request and response preserved in [`RPC_VERIFICATION_RESULTS.json`](file:///home/pupulion/orakl/docs/p2/RPC_VERIFICATION_RESULTS.json)).
   - **Cancun EIP-1153 (`TSTORE`/`TLOAD`)**: **UNSUPPORTED** (empirically verified on Mainnet and Testnet via reproducible `eth_call` probe with initcode `0x604260005d60005c60005360016000f3` returning error `invalid opcode: opcode 0x5d not defined`; raw JSON-RPC request and response preserved in [`RPC_VERIFICATION_RESULTS.json`](file:///home/pupulion/orakl/docs/p2/RPC_VERIFICATION_RESULTS.json)).
   - **ORAKL Compiler Target (`evm_version = "paris"`)**: **100% COMPATIBLE**. Paris emits neither `PUSH0` nor Cancun transient storage opcodes, ensuring strict bytecode execution compatibility.
4. **Transaction & Gas Model**: Both networks support `eth_feeHistory` and EIP-1559 base fee accounting, with block gas limits set to `4,294,967,295` (uint32 max).
5. **Block Progression**: Average block generation intervals observed at ~3.75s on Mainnet and ~4.50s on Testnet.

---

## 2. Network Specifications

| Parameter | QIE Testnet (`qie-testnet`) | QIE Mainnet (`qie-mainnet`) | ORAKL Compatibility |
| :--- | :--- | :--- | :--- |
| **Chain ID** | `1983` (`0x7bf`) | `1990` (`0x7c6`) | Supported via chainId parameter |
| **Native Currency** | `QIE` (18 decimals) | `QIEV3` (18 decimals) | Supported via native BigInt wei |
| **Primary Documented RPC** | `https://rpc1testnet.qie.digital/` | `https://rpc1mainnet.qie.digital/` | RPC1 Testnet connection refused; RPC2 active |
| **Alternative Verified RPC** | `https://rpc2testnet.qie.digital/` | `https://rpc2mainnet.qie.digital/` | Verified responsive |
| **Block Explorer** | `https://testnet.qie.digital/` | `https://mainnet.qie.digital/` | Verified online |
| **Observed Client Version** | `Version dev ()\nCompiled at using Go go1.22.12` | `Version dev ()\nCompiled at using Go go1.22.2` | Go-Ethereum fork running on Cosmos SDK / Evmos base |
| **Block Gas Limit** | `4,294,967,295` gas | `4,294,967,295` gas | Ample headroom (EIP-170 deploy fits easily) |
| **Observed Gas Price** | `7 wei` | `1,125,000,000 wei` (~1.125 Gwei) | Compatible with dynamic or legacy pricing |
| **Base Fee Per Gas** | `7 wei` | `1,000,000,000 wei` (~1.0 Gwei) | EIP-1559 supported |
| **Observed Avg Block Time**| `~4.50 seconds` | `~3.75 seconds` | Compatible with 15-min minimum dispute horizons |

---

## 3. Read-Only RPC Capability Surface

Probing of 14 standard JSON-RPC methods was executed against active nodes using `probe-rpc-capabilities.mjs`:

| JSON-RPC Method | Testnet (`rpc2testnet`) | Mainnet (`rpc1mainnet`) | Observation Notes |
| :--- | :--- | :--- | :--- |
| `eth_chainId` | `0x7bf` (1983) | `0x7c6` (1990) | Matches documented identity |
| `eth_blockNumber` | Observed | Observed | Incrementing monotonically |
| `eth_getBlockByNumber` | Observed (`object`) | Observed (`object`) | Full header returned |
| `eth_getBalance` | Observed | Observed | Standard wei balances |
| `eth_getCode` | Observed (`0x`) | Observed (`0x`) | Contract bytecode lookup operational |
| `eth_call` | Observed | Observed | Read-only EVM simulation operational |
| `eth_getLogs` | Observed (`array(0)`)| Observed (`array(0)`)| Event indexing queries operational |
| `eth_getTransactionByHash`| Observed (`null`) | Observed (`null`) | Expected null for synthetic hash |
| `eth_getTransactionReceipt`| Observed (`null`)| Observed (`null`) | Expected null for synthetic hash |
| `eth_feeHistory` | Observed (`object`) | Observed (`object`) | Returns baseFeePerGas and gasUsedRatio arrays |
| `eth_gasPrice` | Observed (`0x7`) | Observed (`0x430e2340`) | Minimum gas price query operational |
| `eth_getTransactionCount`| Observed (`0x0`) | Observed (`0x0`) | Nonce lookup operational |
| `eth_getStorageAt` | Observed (`0x0...`) | Observed (`0x0...`) | Direct state slot read operational |

---

## 4. ORAKL Protocol Architectural Impact

1. **Transaction Submission**:
   - The frontend and indexer must support both EIP-1559 (`type: 'eip1559'`) and legacy (`type: 'legacy'`) transaction envelopes.
   - Recommended testnet gas price fallback: `1 Gwei` minimum priority fee to prevent transaction stalling.
2. **Indexer Polling Interval**:
   - Given 3.75s–4.5s block intervals, the indexer polling loop should be tuned to `2,500ms` to achieve prompt block synchronization without triggering RPC rate limits.
3. **Dispute Horizon Timers**:
   - Minimum resolution time horizon in `ProtocolConfig` is set to 15 minutes (`900s`), representing ~240 QIE blocks. This provides sufficient finality depth against potential chain reorganizations.
