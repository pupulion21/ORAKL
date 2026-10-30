# ORAKL v1 candidate interface — generated

**CANDIDATE_NOT_FROZEN, P0.3 security candidate; final protocol approval required.** Full-return bonds only. No deployment or activation authorized.

Generated from compiler artifacts; tuple definitions, full outputs, indexed event fields, errors, hashes and source identity are in [interface-manifest.json](interface-manifest.json).

Refresh offline: `node scripts/export-orakl-candidate-interface.mjs --write`; verify: `--check`. Read the [P0.3 interface changes](../../../docs/migration/P0_3_INTERFACE_CHANGES.md) before using these ABIs.

## MarketFactory

ABI: [MarketFactory.abi.json](MarketFactory.abi.json). SHA256: `6545c154f812f485eb5e7588200e29dad1448d60bd58ae9c935ac776d7a02a4c`.

| Function (canonical ABI types) | Selector | Mutability |
| --- | --- | --- |
| `bondLiability()` | `0x508647c9` | view |
| `cancelExpiredMarket(uint256)` | `0xd6479e99` | nonpayable |
| `cancelInterruptedMarket(uint256)` | `0x97fa17b5` | nonpayable |
| `challengeResult(uint256,bytes32)` | `0x68d5a7a3` | payable |
| `claim(uint256)` | `0x379607f5` | nonpayable |
| `claimBond(uint256,uint8,address)` | `0xa363ea5c` | nonpayable |
| `claimRefund(uint256)` | `0x5b7baf64` | nonpayable |
| `claimRefundTo(uint256,address)` | `0x737a0a1a` | nonpayable |
| `claimTo(uint256,address)` | `0x30e1198b` | nonpayable |
| `createMarket(bytes32,string,uint64,uint64,uint64)` | `0x6b250e4d` | payable |
| `feeLiability()` | `0x36ebd86f` | view |
| `finalizeResult(uint256)` | `0x2ec7d5ae` | nonpayable |
| `getBond(uint256,uint8)` | `0x5b25e1ce` | view |
| `getClaimable(uint256,address)` | `0xb961cbe1` | view |
| `getMarket(uint256)` | `0xeb44fdd3` | view |
| `getPoolTotals(uint256)` | `0x38e16a6a` | view |
| `getPosition(uint256,address)` | `0xd29f541d` | view |
| `interruptionRefundTime(uint256)` | `0x3d4480b3` | view |
| `marketCount()` | `0xec979082` | view |
| `marketState(uint256)` | `0x0b7afd5a` | view |
| `participantLiability()` | `0xc9d21a46` | view |
| `predict(uint256,uint8)` | `0x84ec1ed2` | payable |
| `proposeResult(uint256,uint8,bytes32)` | `0x1620b27b` | payable |
| `protocolConfig()` | `0xf5efbb4f` | view |
| `settleDispute(uint256,uint8,bytes32)` | `0x44a5fa68` | nonpayable |
| `submitEvidence(uint256,bytes32)` | `0x912da4db` | nonpayable |
| `totalAccounted()` | `0x2964e4e6` | view |
| `totalBondsDeposited()` | `0xfe03a460` | view |
| `totalBondsPaid()` | `0xd047358e` | view |
| `totalContributions()` | `0x37c08923` | view |
| `totalFeesAccrued()` | `0x73f38ee0` | view |
| `totalFeesWithdrawn()` | `0xfffeaf60` | view |
| `totalParticipantPaid()` | `0x44b2c176` | view |
| `unaccountedBalance()` | `0x382e8547` | view |
| `withdrawProtocolFees(uint256,address)` | `0x00af038d` | nonpayable |

| Event (canonical ABI types) | topic0 | Indexed fields |
| --- | --- | --- |
| `BondDeposited(uint256,uint8,address,uint256)` | `0x0e89d8f2cdd4e0a3a09524782191f48bf1c45a3fd5b098e9d30e4f0c4612abe8` | marketId, bondType, owner |
| `BondReleased(uint256,uint8,address,address,uint256)` | `0x62439fad92c0b8b05a12fed907e5e97e14323464b0b8331d4f2c62c60ea9490f` | marketId, bondType, owner |
| `DisputeEvidenceSubmitted(uint256,address,bytes32)` | `0xee0324d17e85288161de1f23ac51a0ec3f8453dda3d0e58ec058b2ba238c9433` | marketId, contributor, evidenceHash |
| `DisputeSettled(uint256,address,uint8,bytes32)` | `0x30d4f328727f5341b8d77791409e75d8fe9b62a823ed16a9ebfea62b65261af7` | marketId, arbitrator |
| `MarketCancelled(uint256,address,uint8)` | `0xd745bc4926f66c66a050fd875ed3576a4a83b15687c676545eab138f2f46cf1f` | marketId, caller |
| `MarketChallenged(uint256,address,bytes32,uint64)` | `0x53bc4f37a03361dfa6b39980ec7fe28c44b0acfd274eec1ef86a50e23ec8ccea` | marketId, challenger |
| `MarketCreated(uint256,address,bytes32,string,uint64,uint64,uint64,(uint16,uint128,uint128,uint128,uint128,uint128,uint32,uint32,address))` | `0xdbc313a1912bb2ce57998ed38c97416bf41875e2437bbafae84c3d24bbd21f12` | marketId, creator, metadataHash |
| `MarketFinalized(uint256,uint8,bool)` | `0x85b170884be76a0add832e558e917cd38e321c9a134222ca90c62e5d25e80513` | marketId |
| `MarketOutcomeProposed(uint256,address,uint8,bytes32,uint64)` | `0x40b12c9308756284bb5d8e040b7963f61e935651013984ce0856e9b49ce63d0d` | marketId, proposer |
| `PredictionPlaced(uint256,address,uint8,uint256)` | `0x07b75caee18334b4449f5d17757762cdceb0f9fd39ea0f000c175f359abbcc34` | marketId, participant |
| `ProtocolFeeAccrued(uint256,uint256)` | `0xa7d3ed4c08f0a22ed87b5588418154edb430223dc6ecf5acdf1654acac9fbba3` | marketId |
| `ProtocolFeeWithdrawn(address,address,uint256)` | `0x5878feeed994dd9f6c62cda75c4fb2fa60eb14dbe85b3f7e7ac2280b13dc365a` | caller, recipient |
| `RefundClaimed(uint256,address,address,uint256)` | `0x86574f50b7038f6a2fe27fdd6900e0f387b0d518b091b743c427911e62650f78` | marketId, participant |
| `RewardClaimed(uint256,address,address,uint256)` | `0xd7566a1f449b7ee89a6af29f319e117c231ea862057eb65395ca2bf70283b1c8` | marketId, participant |

## ProtocolConfig

ABI: [ProtocolConfig.abi.json](ProtocolConfig.abi.json). SHA256: `ca814a020dbb43eb58d93b917dbc8685c92fbd3a0fa15d5376dedbeae34c0301`.

| Function (canonical ABI types) | Selector | Mutability |
| --- | --- | --- |
| `MAX_BOND()` | `0x01761699` | view |
| `MAX_FEE_BPS()` | `0xd55be8c6` | view |
| `RECOVERY_DELAY()` | `0x47b45652` | view |
| `ROLE_CHECK_GAS()` | `0x20d330df` | view |
| `activateFinance(bytes32)` | `0x2edba2a3` | nonpayable |
| `activationAfter()` | `0xebff4a34` | view |
| `activeRoleState()` | `0xd25b5de7` | view |
| `activityEpoch()` | `0x2143dda9` | view |
| `approveRelease(bytes32)` | `0x36f67274` | nonpayable |
| `approvedDigest()` | `0x1da1cf11` | view |
| `approvedRelease()` | `0x3086f9b0` | view |
| `approvedRoleState()` | `0x04ea7334` | view |
| `bindFactory(address)` | `0xcaa109be` | nonpayable |
| `complianceApprover()` | `0xed4f6e37` | view |
| `currentRoleState()` | `0x44205c18` | view |
| `deactivateFinance()` | `0x9724d2a0` | nonpayable |
| `deploymentChainId()` | `0xcd0d0096` | view |
| `factory()` | `0xc45a0155` | view |
| `financialActive()` | `0x46178b38` | view |
| `governance()` | `0x5aa6e675` | view |
| `guardian()` | `0x452a9320` | view |
| `interruptedAt(uint64)` | `0x114f16fe` | view |
| `parameters()` | `0x89035730` | view |
| `pause()` | `0x8456cb59` | nonpayable |
| `paused()` | `0x5c975abb` | view |
| `releaseDigest(bytes32)` | `0x26186644` | view |
| `reportRoleDrift()` | `0x5a39aafa` | nonpayable |
| `requireArbitrator(address,bytes32)` | `0x91df355b` | view |
| `requireChallengeActivity(address)` | `0x9b100a91` | view |
| `requireFinancialActivity(address)` | `0x15c6ea38` | view |
| `requireGovernanceAuthority(address)` | `0xbb3464be` | view |
| `requireUncontestedSettlement()` | `0x16d01a8a` | view |
| `roleFingerprint(address)` | `0x465f11cc` | view |
| `setParameters((uint16,uint128,uint128,uint128,uint128,uint128,uint32,uint32,address))` | `0x2d0e94f8` | nonpayable |
| `unpause()` | `0x3f4ba83a` | nonpayable |

| Event (canonical ABI types) | topic0 | Indexed fields |
| --- | --- | --- |
| `ActivityInterrupted(uint64,uint64,address)` | `0xa57a2f1d2ac6f3edf166c4956f009beffe85bfec7b2047d4b4724a58733b6bd9` | epoch, caller |
| `FactoryBound(address)` | `0x223ed41fd6ed03a561a021bd1e19f3bd6bab57e440422809cf7c117ab75ee274` | factory |
| `FinanceActivated(bytes32,bytes32)` | `0x49fa2f2df50ae5669ecd69679418b3c7af43bc7b879e0a0de18869fc8b04ef4b` | release, digest |
| `FinanceDeactivated(address)` | `0x54ae5f475d2ea1b7b921881391ea06936b23b6cef8bfe6751d8e39a63fc64fbe` | caller |
| `ParametersConfigured(bytes32)` | `0x1e843b3a03f4124d8dd043a5f476b7ef8566a974bde6c500f446893d6939173b` | parametersHash |
| `PauseChanged(bool,address)` | `0x007399144da1af487abfd29504c088166edf0ad343b64eade59600fa1ffd873f` | caller |
| `ReleaseApproved(bytes32,bytes32,uint64)` | `0xd91027677fc5ef9c1e222add1805d64b380743b932b090a1c33b4f46042e451c` | release, digest |
| `RoleDriftReported(address)` | `0xb3c1f589096dc42dc84aba292fae0e34a3365dd70f3fd9a0a9495b819b7f67e1` | reporter |

