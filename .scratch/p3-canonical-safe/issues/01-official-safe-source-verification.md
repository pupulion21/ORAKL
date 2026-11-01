# 01: Official Safe Source Verification

**What to build:**
Verify and pin the genuine, unmodified official Safe Global v1.4.1 release artifacts, exact Git commit SHA (`aa14911666deb13cdbbe37c37253a55918525437`), dependency packages (`@safe-global/safe-contracts@1.4.1-2` and `@safe-global/safe-deployments@1.37.66`), compiled ABI hashes, and canonical deployed runtime codehashes (`Safe` `0x1fe2df...` and `SafeProxyFactory` `0x50c3cd...`). Document provenance, audit references, compiler version, and QIE opcode compatibility in `docs/p3/SAFE_SOURCE_PROVENANCE.md`.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Pinned official Safe release tag `v1.4.1` and commit `aa14911666deb13cdbbe37c37253a55918525437`
- [x] Verified integrity of `@safe-global/safe-contracts@1.4.1-2` and `@safe-global/safe-deployments@1.37.66`
- [x] Confirmed canonical runtime codehashes match upstream Safe deployments exactly
- [x] Evaluated QIE opcode compatibility: Solc 0.7.6 bytecode verified free of `PUSH0` and `TSTORE`/`TLOAD`
- [x] Delivered `docs/p3/SAFE_SOURCE_PROVENANCE.md`

## Answer
Official Safe Core Protocol v1.4.1 has been verified and pinned with full cryptographic identity matching upstream canonical deployments across 400+ EVM chains. Documented in `docs/p3/SAFE_SOURCE_PROVENANCE.md`.
