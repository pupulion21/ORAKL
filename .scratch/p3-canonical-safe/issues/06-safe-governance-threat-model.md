# 06: Safe Governance Threat Model

**What to build:**
Perform and document an exhaustive threat modeling analysis of the canonical Safe 3-of-5 governance architecture integrated with ORAKL `ProtocolConfig`. Address signer compromise, collusion, module/guard vulnerabilities, delegatecall risks, transaction replay, hardware wallet display attacks, relayer manipulation, deadlock, and reorgs. Deliver in `docs/p3/SAFE_GOVERNANCE_THREAT_MODEL.md`.

**Blocked by:** 04 (Real Safe 3-of-5 Execution Tests)

**Status:** resolved

- [x] Evaluated 21 distinct threat vectors spanning multi-party governance and protocol integration
- [x] Verified unbypassable constraints of `ProtocolConfig` (timelocks, owner disjointness, guardian pause)
- [x] Analyzed off-chain risks (hardware wallet blind signing, relayer censorship, quorum deadlock)
- [x] Delivered `docs/p3/SAFE_GOVERNANCE_THREAT_MODEL.md`
