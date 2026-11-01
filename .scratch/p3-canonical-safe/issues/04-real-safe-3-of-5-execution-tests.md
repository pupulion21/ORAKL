# 04: Real Safe 3-of-5 Execution Tests

**What to build:**
Implement an exhaustive automated integration test suite executing 28 real Safe execution scenarios with genuine EIP-712 transaction hashing, signature packing (`r, s, v`), threshold checks, signer ordering, nonce incrementation, cross-chain rejection, and `ProtocolConfig` role enforcement. Retain `Safe3Of5.sol` strictly as legacy simulation. Document results in `docs/p3/SAFE_REAL_INTEGRATION_TEST_RESULTS.md`.

**Blocked by:** 03 (Real Safe Singleton and Proxy Deployment on Anvil)

**Status:** resolved

- [x] Implemented 28 comprehensive test scenarios against real Safe proxy instances
- [x] Verified threshold 3-of-5 enforcement and rejection of 2 signatures
- [x] Verified rejection of unregistered, duplicate, unordered, or tampered signatures
- [x] Verified rejection of wrong chain ID or wrong Safe proxy address signatures
- [x] Verified nonce replay defense and atomic nonce increments
- [x] Verified Governance Safe executes `bindFactory()` and `activateFinance()`
- [x] Verified Compliance Safe executes `approveRelease()`
- [x] Verified 24-hour timelock (`RECOVERY_DELAY`) cannot be bypassed
- [x] Verified guardian emergency pause invalidates pending release approvals
- [x] Verified Arbitration Safe executes dispute resolution within authorization boundaries
- [x] Delivered `docs/p3/SAFE_REAL_INTEGRATION_TEST_RESULTS.md`
