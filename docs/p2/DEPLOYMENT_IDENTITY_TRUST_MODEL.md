# ORAKL Protocol — Deployment Identity Trust Model & Layered Validation

- **Document ID**: `ORAKL-P2-TRUST-MODEL-001`
- **Date**: 2026-11-01
- **Status**: `IMPLEMENTED & VERIFIED SPECIFICATION`

---

## 1. Overview & Threat Defense

In decentralized prediction market systems, off-chain service layers (e.g. metadata ingestion, evidence storage, and indexing services) must establish strict cryptographic and architectural binding to the authoritative on-chain contracts. A critical vulnerability arises if the service relies on self-referential or client-supplied contract addresses to authenticate transactions or verify evidence.

To eliminate this vector, ORAKL implements a **10-Layer Deployment Validation Pipeline** in `backend/src/api/server.ts` via `resolveTrustedDeployment()`.

```mermaid
flowchart TD
    Req["Incoming Request / API Call"] --> Cache{"Cache Valid?\n(now < expiresAt)"}
    Cache -->|Hit| ReturnCached["Return Cached TrustedDeployment"]
    Cache -->|Miss / Force| L1["Layer 1: Origin & Path Verification"]
    
    L1 --> L8["Layer 8: Environment Segregation (Safety Flag)"]
    L8 --> L7["Layer 7: Approved ABI Identity (mode & abiSha256)"]
    L7 --> L2["Layer 2: Chain ID Consistency"]
    L2 --> L3["Layer 3: Factory Address Verification"]
    L3 --> L4["Layer 4: ProtocolConfig Address Verification"]
    L4 --> L5["Layer 5: Factory-to-Config Linkage (immutables)"]
    L5 --> L6["Layer 6: Runtime Bytecode Codehash Verification"]
    L6 --> L9["Layer 9: Database Identity Consistency"]
    L9 --> L10["Layer 10: Fail-Closed Cache Storage & Return"]
    
    L1 -.->|Failure| Err["Throw 503 DEPLOYMENT_UNAVAILABLE"]
    L8 -.->|Failure| Err
    L7 -.->|Failure| Err
    L2 -.->|Failure| Err
    L3 -.->|Failure| Err
    L4 -.->|Failure| Err
    L5 -.->|Failure| Err
    L6 -.->|Failure| Err
    L9 -.->|Failure| Err
```

---

## 2. The 10-Layer Deployment Validation Pipeline

| Layer | Validation Stage | Failure Condition | Security Defended |
| :--- | :--- | :--- | :--- |
| **Layer 1** | **Origin & Path Verification** | Manifest file missing, unreadable, or invalid path | File tampering, arbitrary file injection |
| **Layer 2** | **Chain ID Consistency** | `manifest.network.chainId !== config.chainId` | Cross-chain replay or network mismatch |
| **Layer 3** | **Factory Address Verification** | Malformed hex or zero address (`0x0...0`) | Unset or null factory address |
| **Layer 4** | **ProtocolConfig Address Verification** | Malformed hex or zero address (`0x0...0`) | Unbound configuration contract |
| **Layer 5** | **Factory-to-Config Linkage** | Factory's `immutableAssignment[0]` mismatch with `protocolConfig` | Rogue factory bound to unauthorized configuration |
| **Layer 6** | **Runtime Bytecode Codehash Verification** | Missing codehash or mismatch against expected codehash | Surrogate / proxy contract masquerading as factory |
| **Layer 7** | **Approved ABI Identity** | `mode !== "local-selected"` or missing `abiSha256` | Incompatible or legacy ABI spoofing |
| **Layer 8** | **Environment Segregation** | `status !== "LOCAL_SIMULATION"` or `safety.publicDeployment === true` | Public mainnet/testnet configurations loaded into dev environment |
| **Layer 9** | **Database Identity Consistency** | Prisma DB `contractDeployment` record has differing address | Database-manifest desynchronization |
| **Layer 10** | **Fail-Closed Enforcement** | Any layer fails or throws | Complete rejection (503 HTTP status) without fallback |

---

## 3. Authenticated Deployment Caching Architecture

### 3.1 Purpose & Risk Mitigation
Under high read/write volume, resolving file manifests from disk and querying database tables on every single HTTP endpoint request introduces latency and file I/O contention.

### 3.2 Cache Mechanics
1. **Cache Keying**:
   The cache key uniquely compounds the environment variables:
   ```typescript
   const cacheKey = `${config.chainId}:${config.deploymentManifestPath ?? "default"}:${config.trustedFactory ?? "none"}:${config.expectedFactoryCodehash ?? "none"}`;
   ```
2. **Freshness TTL**:
   Configurable via `DEPLOYMENT_CACHE_TTL_MS` (default: 5,000 ms). Within the TTL, requests reuse the in-memory verified `TrustedDeployment` object.
3. **Explicit Invalidation**:
   `invalidateDeploymentCache()` purges the cache map instantly upon contract migrations, tests, or hot-reloads.
4. **Resilience**:
   If an underlying file is temporarily altered or transiently locked during a request, an active valid cache entry safely serves the verified context until expiration.

---

## 4. Verification Evidence

The 10-layer pipeline and cache mechanics are validated by an automated test suite in `backend/test/deployment-trust.test.ts`:
- `passes all 10 layers for a valid local simulation manifest`: **PASS**
- `Layer 1: rejects when manifest file is missing or unreadable`: **PASS**
- `Layer 2: rejects when chainId does not match server config`: **PASS**
- `Layer 3 & 4: rejects when factory or protocolConfig address is zero or invalid`: **PASS**
- `Layer 5: rejects when immutable binding does not match protocolConfig`: **PASS**
- `Layer 6: rejects when factory runtime codehash does not match expected codehash`: **PASS**
- `Layer 6: accepts when factory runtime codehash matches expected codehash`: **PASS**
- `Layer 7: rejects when abiSha256 is missing or invalid`: **PASS**
- `Layer 8: rejects manifest with publicDeployment=true in local simulation mode`: **PASS**
- `caches trusted deployment and honors freshness TTL and invalidation`: **PASS**

All 10 test cases execute and pass deterministically.
