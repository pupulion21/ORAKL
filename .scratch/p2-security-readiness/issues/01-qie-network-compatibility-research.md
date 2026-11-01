# ORAKL-P2-01: QIE Network Compatibility Research & Read-Only RPC Probing

Status: resolved
Type: research
Blocked by: none

## Description

Perform read-only investigation and probing of QIE public networks (Testnet Chain ID 1983, Mainnet Chain ID 1990) based on official documentation (`https://docs.qie.digital/`) and verified RPC endpoints.

## Objectives
1. Read official documentation regarding RPC endpoints, network identifiers, native currency symbols, and block explorer endpoints.
2. Execute read-only RPC probes (`eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, `eth_gasPrice`, `eth_feeHistory`, `eth_estimateGas`) using bounded requests (timeout 10s, max 1MB response).
3. Determine whether QIE supports EIP-1559 dynamic fee transactions or legacy Type 0 transactions only.
4. Benchmark observed block gas limits, block generation intervals, and timestamp progression.
5. Create deliverables:
   - `docs/p2/QIE_NETWORK_COMPATIBILITY.md`
   - `docs/p2/RPC_VERIFICATION_RESULTS.json`
   - `docs/p2/EVM_COMPATIBILITY_MATRIX.md`
   - `docs/p2/QIE_RPC_RISK_REGISTER.md`

## Acceptance Criteria
- Zero public-chain transactions broadcast.
- Zero private keys or real funds used.
- All probe results captured deterministically in structured JSON.
- Any unreachable or unsupported RPC methods clearly recorded as UNVERIFIED or UNSUPPORTED, never assumed.
