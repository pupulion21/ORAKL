# ORAKL Protocol — QIE RPC Risk Register

- **Document ID**: `ORAKL-P2-RPC-RISK-001`
- **Date**: 2026-11-01
- **Status**: `OPERATIONAL RISK REGISTER`

---

## 1. Risk Register

| Risk ID | Risk Event | Root Cause | Severity | Observed Evidence | Mitigation Strategy | Responsible Owner |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`RPC-01`** | **Single Point of Failure on RPC1** | Primary testnet RPC (`rpc1testnet.qie.digital`) is offline. | **HIGH** | `curl` returned `Connection refused` (port 443 closed). | Client and backend must configure multi-endpoint fallback arrays (e.g. `[rpc2testnet, rpc1testnet]`) with automated health checks. | DevOps / SRE |
| **`RPC-02`** | **Rate Limiting & Throttling on Public RPC** | Public infrastructure does not offer SLA or dedicated capacity. | **MEDIUM** | Standard public endpoints without API keys. | Deploy a dedicated private QIE validator/RPC node for the production indexer; use rate-limited exponential backoff in client. | Infrastructure |
| **`RPC-03`** | **Cancun Opcode Reverts** | Code compiled targeting `cancun` crashes on QIE nodes. | **CRITICAL** | `TSTORE` (0x5d) reverted with `invalid opcode`. | Enforce `evm_version = "paris"` in `foundry.toml` and CI compilation checks. | Smart Contract Lead |
| **`RPC-04`** | **Historical Block Log Range Limit** | Large block range `eth_getLogs` may time out or revert on public RPC. | **MEDIUM** | Common on Geth/Evmos forks (typically 2000-block cap). | Indexer chunks historical catch-up queries to 1000 blocks per request with checkpoint persistence. | Backend / Indexer Lead |
| **`RPC-05`** | **Timestamp Jitter & Reorgs** | Delegated PoS block generation can experience brief 1-2 block reorganizations. | **MEDIUM** | Observed block times vary between 3.5s and 5.0s. | Indexer implements 4096-block bounded rollback (`reorg.ts`); settlement requires dispute deadline expiry with safe confirmation buffer. | Indexer Lead |
| **`RPC-06`** | **RPC Man-In-The-Middle / Spoofing** | Compromised public RPC could serve altered block headers or event logs. | **CRITICAL** | Public HTTPS endpoints terminate at third-party load balancers. | Frontend verifies transaction receipts against connected wallet provider; backend validates against multiple redundant RPCs; codehashes verified on-chain. | Security Architect |
