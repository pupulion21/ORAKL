# 03: Real Safe Singleton and Proxy Deployment on Anvil

**What to build:**
Implement reproducible Anvil deployment scripts and harnesses deploying the genuine official Safe singleton, `SafeProxyFactory`, and three distinct Safe proxies (Governance Safe, Compliance Safe, and Arbitration Safe) with 5 distinct owners and threshold 3 each. Verify proxy initialization, `getOwners()`, `getThreshold()`, `nonce()`, codehashes, and bind to `ProtocolConfig`. Deliver evidence in `docs/p3/SAFE_ANVIL_DEPLOYMENT_EVIDENCE.md`.

**Blocked by:** 02 (Isolated Multi-Compiler Safe Build)

**Status:** resolved

- [x] Deployed official Safe singleton on isolated Anvil (31337)
- [x] Deployed official `SafeProxyFactory` on isolated Anvil (31337)
- [x] Deployed Governance Safe proxy (5 owners, threshold 3)
- [x] Deployed Compliance Safe proxy (5 owners, threshold 3)
- [x] Deployed Arbitration Safe proxy (5 owners, threshold 3)
- [x] Verified pairwise disjoint owner sets (`_disjoint`) and zero guardian overlap
- [x] Bound deployed Safe proxy instances to `ProtocolConfig`
- [x] Delivered `docs/p3/SAFE_ANVIL_DEPLOYMENT_EVIDENCE.md`
