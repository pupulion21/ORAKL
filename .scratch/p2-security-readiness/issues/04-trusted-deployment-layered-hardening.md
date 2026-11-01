# ORAKL-P2-04: Trusted Deployment Layered Validation, Codehash & Cache Hardening

Status: resolved
Type: task
Blocked by: 02

## Description

Harden the backend's deployment identity trust model in `backend/src/api/server.ts` and `resolveTrustedDeployment()` to ensure deployment authenticity is cryptographically and architecturally verified beyond file presence.

## Objectives
1. Implement a 10-layer deployment validation model: - RESOLVED
   - Origin verification
   - Chain ID consistency
   - Factory address verification
   - ProtocolConfig address verification
   - Factory-to-config on-chain/manifest linkage
   - Expected runtime bytecode Keccak-256 codehash verification
   - Approved ABI identity verification
   - Environment segregation (strict local vs public boundary)
   - Database deployment identity consistency
   - Fail-closed behavior on missing, stale, or conflicting facts
2. Implement authenticated deployment caching with freshness TTL to prevent redundant disk/RPC overhead per HTTP request. - RESOLVED (`deploymentCache` with TTL and `invalidateDeploymentCache()`)
3. Add Vitest regression tests in `backend/test/` asserting rejection of surrogate contracts, tampered codehashes, and cache invalidation. - RESOLVED (10/10 PASS in `backend/test/deployment-trust.test.ts`)
4. Create deliverable: - RESOLVED
   - `docs/p2/DEPLOYMENT_IDENTITY_TRUST_MODEL.md`

## Acceptance Criteria
- Codehash mismatch triggers fail-closed 503 DEPLOYMENT_UNAVAILABLE - VERIFIED.
- Cached context refreshes deterministically upon TTL expiration - VERIFIED.
- Zero breakage of existing P1 local integration and browser E2E tests - VERIFIED.
