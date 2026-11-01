# ORAKL Protocol — Canonical Safe v1.4.1 Anvil Deployment Evidence

**Document ID:** `ORAKL-P3-SAFE-DEPLOYMENT-EVIDENCE`  
**Execution Context:** Isolated Local Anvil Node (`chainId: 31337`)  
**Status:** `LOCAL_ENGINEERING_VERIFIED — PUBLIC_RELEASE_BLOCKED`  
**Safe Global Core Protocol Version:** `v1.4.1` (Git Commit `aa14911666deb13cdbbe37c37253a55918525437`)  
**Date:** 2026-11-01  

> [!CAUTION]
> **SIMULATION ONLY — STRICTLY NON-PRODUCTION:**  
> All contracts, wallets, private keys, and addresses documented herein were deployed strictly on an isolated local Anvil development chain (Chain ID `31337`) using disposable default development accounts. No production Safe wallets have been created or funded. No transactions have been broadcast to public QIE networks or any public blockchain. Financial activation on any public network remains strictly prohibited.

---

## 1. Environment & Network Configuration

- **Host:** `127.0.0.1`
- **RPC Ports:** `8547` (Integration Runner), `8549` (Deployment Verification Gate)
- **Chain ID:** `31337` (EVM Paris)
- **Gas Limit:** `60,000,000`
- **Disposable Mnemonic:** `test test test test test test test test test test test junk`
- **Deployer (Account 0):** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

---

## 2. Infrastructure Deployment Receipts

Official Safe Core Protocol contracts were compiled with Solidity `0.7.6` (`optimizer = false`, `evm_version = istanbul`) and deployed directly to Anvil:

| Component | Contract Artifact | On-Chain Address | Runtime Codehash (Keccak-256) |
| :--- | :--- | :--- | :--- |
| **Mastercopy Singleton** | `Safe.sol` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4` |
| **Proxy Factory** | `SafeProxyFactory.sol` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |

### Codehash Verification
The deployed runtime codehashes match the canonical official Safe v1.4.1 deployment registry values:
- `Safe.sol` singleton runtime code matches canonical byte-for-byte across all 23,579 bytes.
- `SafeProxyFactory.sol` runtime code matches canonical byte-for-byte across all 2,674 bytes.

---

## 3. Safe Proxy Instances Deployed

Three role-separated 3-of-5 Safe proxy instances were created via `SafeProxyFactory.createProxyWithNonce()` with initializer call to `setup()`:

### 3.1 Governance Safe (3-of-5)
- **Role:** Protocol Governance (`onlyGovernance` in `ProtocolConfig`)
- **Proxy Address:** `0x4B60958B978639ED492C1353be1CF24849bEbDfB`
- **Salt Nonce:** `101`
- **Threshold:** `3`
- **Configured Owners (5):**
  1. `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Account 1)
  2. `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` (Account 2)
  3. `0x90F79bf6EB2c4f870365E785982E1f101E93b906` (Account 3)
  4. `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` (Account 4)
  5. `0x9965507D1a55bcC2695C58ba16FB37d819B0A4df` (Account 5)
- **Mastercopy Pointer (Storage Slot 0):** `0x0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3` (Matches Singleton)

### 3.2 Compliance Approver Safe (3-of-5)
- **Role:** Regulatory and Compliance Verification (`approveRelease` in `ProtocolConfig`)
- **Proxy Address:** `0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968`
- **Salt Nonce:** `102`
- **Threshold:** `3`
- **Configured Owners (5):**
  1. `0x976EA74026E726554dB657fA54763abd0C3a0aa9` (Account 6)
  2. `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` (Account 7)
  3. `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` (Account 8)
  4. `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` (Account 9)
  5. `0xBcd4042DE499D14e55001CcbB24a551F3b954096` (Account 10)
- **Mastercopy Pointer (Storage Slot 0):** `0x0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3` (Matches Singleton)

### 3.3 Arbitration Safe (3-of-5)
- **Role:** Market Dispute Resolution and Neutral Settlement (`arbitrateMarket` in `SelectedMarketFactory`)
- **Proxy Address:** `0x71C95911E9a5D330f4D621842EC243EE1343292e`
- **Salt Nonce:** `103`
- **Threshold:** `3`
- **Configured Owners (5):**
  1. `0x71bE63f3384f5fb98995898A86B02Fb2426c5788` (Account 11)
  2. `0xFABB0ac9d68B0B445fB7357272Ff202C5651694a` (Account 12)
  3. `0x1CBd3b2770909CEBcA0582574184Ebdd45654722` (Account 13)
  4. `0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097` (Account 14)
  5. `0xcd3B766CCDd6AE721141F452C550Ca635964ce71` (Account 15)
- **Mastercopy Pointer (Storage Slot 0):** `0x0000000000000000000000005fbdb2315678afecb367f032d93f642f64180aa3` (Matches Singleton)

### 3.4 Guardian Account
- **Role:** Emergency Pause Guardian (Immediate killswitch)
- **Address:** `0x2546BcD3c84621e976D8185a91A922aE77ECEc30` (Account 16)
- **Disjoint Constraint:** Confirmed not an owner of Governance, Compliance, or Arbitration Safe.

---

## 4. Separation of Powers & Invariant Audit

All three Safes were validated against `ProtocolConfig._disjoint()` requirements:
1. `governance` owners ∩ `complianceApprover` owners = ∅ (0 shared keys)
2. `governance` owners ∩ `arbitrator` owners = ∅ (0 shared keys)
3. `complianceApprover` owners ∩ `arbitrator` owners = ∅ (0 shared keys)
4. Guardian address is strictly excluded from all three Safe owner sets.
5. Storage slot `0x0000000000000000000000000000000000000000000000000000000000000000` on each proxy points immutably to the genuine `Safe.sol` singleton.
