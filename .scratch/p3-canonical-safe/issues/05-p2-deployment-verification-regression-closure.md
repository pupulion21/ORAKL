# 05: P2 Deployment Verification Regression Closure

**What to build:**
Upgrade deployment verification with a repeatable, automated integration test that launches a fresh isolated Anvil instance, deploys approved contracts, runs `verifyDeployment()` in `onchain-required` mode, asserts exit code 0, and cleanly terminates Anvil. Implement strict fail-closed enforcement when no independent trust anchor exists for a chain ID. Document evidence in `docs/p3/DEPLOYMENT_GATE_FINAL_EVIDENCE.md`.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Implemented live Anvil integration test in Vitest (`backend/test/deployment-verification-live.test.ts`)
- [x] Confirmed exit code 0, `success=true`, and `onchainStatus=VERIFIED`
- [x] Verified fail-closed behavior on unknown chain IDs or missing trust anchors
- [x] Preserved all existing negative regression checks (offline RPC, wrong chain ID, altered bytecode, linkage mismatch)
- [x] Verified Anvil process lifecycle and guaranteed port cleanup
- [x] Delivered `docs/p3/DEPLOYMENT_GATE_FINAL_EVIDENCE.md`
