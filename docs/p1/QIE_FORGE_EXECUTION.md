# QIE-Forge Execution Record

**Status**: Verified & Active
**Execution Timestamp**: 2026-10-31T09:35:00Z
**Suite Version**: `0.6.0-ecosystem.2`
**Release ID**: `3aa11f7a34b9db51b1b9de243a4642af4eed6fe734c24e287ad0bd93888bd11b`
**Integrity Manifest Path**: `/home/pupulion/.agents/skills/qie/MANIFEST.json`
**Skill Router Path**: `/home/pupulion/.agents/skills/qie/SKILL.md`

---

## 1. Installed Suite Discovery & Router Verification

The router at `/home/pupulion/.agents/skills/qie/SKILL.md` and integrity manifest at `/home/pupulion/.agents/skills/qie/MANIFEST.json` were discovered, opened, and verified.

- **Manifest Release**: `0.6.0-ecosystem.2`
- **Schema Version**: `1.4.0`
- **Knowledge SHA256**: `7e33122310507f5ac24c716bfe2b3f9438625bb8ccabdc53e37435a64ebe1eab`
- **Policy SHA256**: `6aed0efdc077c47769d7988ff9211575b6bb25c2be5ef8bc890ceb29b044b86e`

Installed topical skill directories in `/home/pupulion/.agents/skills/`:
- `qie` (entry router)
- `qie-smart-contracts` (Domain D04)
- `qie-transactions` (Domain D06)
- `qie-frontend` (Domain D07)
- `qie-debug` (Domain D13)
- `qie-deployment` (Domain D14)
- `qie-wallets` (Domain D05)
- `qie-networks` (Domain D01/D02)
- `qie-ecosystem` (Domain D09/D10)

---

## 2. Modules Read & Applied Guidance

### D04 — Smart Contracts (`qie-smart-contracts`)
- **File Read**: `/home/pupulion/.agents/skills/qie-smart-contracts/SKILL.md`
- **Applied Rules**:
  - Pinned Foundry recipe discipline (`forge`, `solc 0.8.37`).
  - Separation between compilation, local test pass, deployment preparation, chain inclusion, and application effects.
  - Bytecode deployment does not verify application finality.
  - Contract source preservation: Do not overwrite tested protocol implementations with mock templates.

### D06 — Transactions (`qie-transactions`)
- **File Read**: `/home/pupulion/.agents/skills/qie-transactions/SKILL.md`
- **Applied Rules**:
  - Receipt observation vs application effects: Transaction CLI exit code 0 or receipt presence does NOT prove application success; must inspect status and decoded events.
  - Never automatically replace or blindly resubmit pending/unconfirmed transactions.
  - Integer BigInt accounting strictly enforced for all wei/token calculations.

### D07 — Frontend (`qie-frontend`)
- **File Read**: `/home/pupulion/.agents/skills/qie-frontend/SKILL.md`
- **Applied Rules**:
  - Strict EVM network selection (Chain ID gating, disconnecting/disabling actions on wrong chain).
  - ABI-bound reads derived from explicitly reviewed ABIs (`contracts/abi/orakl-v1-selected-candidate/`).
  - Read invalidation and state refresh after provider/account change.
  - BigInt integer accounting for all balances, stakes, payouts, and pool caps.
  - No credentials in client configuration.

### D13 — Debugging (`qie-debug`)
- **File Read**: `/home/pupulion/.agents/skills/qie-debug/SKILL.md`
- **Applied Rules**:
  - Isolate build, transport, submission, execution, and application failures.
  - Stop on wrong chain; never treat mock pass as production readiness.
  - Redacted error reporting; zero leakage of private keys or sensitive credentials.

### D14 — Deployment Preparation (`qie-deployment`)
- **File Read**: `/home/pupulion/.agents/skills/qie-deployment/SKILL.md`
- **Applied Rules**:
  - Production gating: Local simulated deployment is strictly flagged `LOCAL_SIMULATION`.
  - No public broadcast, no mainnet deployment, no real-value financial activation.
  - Concrete verification checklists and deployment manifests with immutable digests.
