/** GENERATED FILE — do not edit by hand.
 *
 *  Source: contracts/abi/orakl-v1-selected-candidate/*.abi.json
 *  Regenerate: node scripts/p1/generate-selected-abi.mjs
 *  Verify:     node scripts/p1/generate-selected-abi.mjs --check
 *
 *  This module contains ONLY the selected-protocol candidate ABIs. The legacy
 *  QIE Testnet MarketFactory ABI is intentionally absent.
 */

/** sha256(SelectedMarketFactory.abi.json) = 1729c4a74541a74a3762112fa318dc248ac27fe5119b515900400b452f350d63 */
export const SELECTED_FACTORY_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "config",
        "type": "address",
        "internalType": "contract IProtocolConfig"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "fallback",
    "stateMutability": "payable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "bondDisposition",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum SelectedMarketFactory.Disposition"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bondLiability",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelExpiredMarket",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelInterruptedMarket",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "challengeResult",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimBond",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.BondType"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimRefund",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimRefundTo",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimTo",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createMarket",
    "inputs": [
      {
        "name": "metadataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "metadataURI",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "resolutionTime",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "maxResolutionTime",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "exposureReleased",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeLiability",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizeResult",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getBond",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.BondType"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Bond",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "claimed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getBondEntitlement",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.BondType"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getChallengeStake",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct SelectedMarketFactory.Stake",
        "components": [
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "prefixBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getClaimable",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "payout",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "refund",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMarket",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Market",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "metadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "closeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "resolutionTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxResolutionTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "terms",
            "type": "tuple",
            "internalType": "struct ProtocolTypes.Parameters",
            "components": [
              {
                "name": "feeBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "creationBond",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "proposalBond",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "challengeBond",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "minContribution",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "poolCap",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "challengePeriod",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "arbitrationPeriod",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "arbitrator",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "creationActivityEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "arbitratorFingerprint",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "storedState",
            "type": "uint8",
            "internalType": "enum ProtocolTypes.State"
          },
          {
            "name": "proposedOutcome",
            "type": "uint8",
            "internalType": "enum ProtocolTypes.Outcome"
          },
          {
            "name": "finalOutcome",
            "type": "uint8",
            "internalType": "enum ProtocolTypes.Outcome"
          },
          {
            "name": "proposer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "challenger",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "proposalEvidence",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "challengeEvidence",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "decisionEvidence",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "proposalActivityEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "challengeDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "arbitrationDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "yesPool",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "noPool",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "distributablePool",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "protocolFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paidOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refunded",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refundable",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPoolTotals",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "yes",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "no",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPosition",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Position",
        "components": [
          {
            "name": "yes",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "no",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "settled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "globalUnresolvedCap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "interruptionRefundTime",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketState",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.State"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "participantLiability",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "perArbitratorUnresolvedCap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pilotPoolCap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "predict",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.Side"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "proposeResult",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "protocolConfig",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IProtocolConfig"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settleDispute",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "decision",
        "type": "uint8",
        "internalType": "enum ProtocolTypes.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitEvidence",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "totalAccounted",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalBondsDeposited",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalBondsPaid",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalChallengeStake",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalContributions",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalFeesAccrued",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalFeesWithdrawn",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalParticipantPaid",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalUnresolvedExposure",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unaccountedBalance",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unresolvedExposureByArbitrator",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawProtocolFees",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "BondDeposited",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bondType",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum ProtocolTypes.BondType"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BondReleased",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bondType",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum ProtocolTypes.BondType"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeStakeAccepted",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "challenger",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "prefixBefore",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalStake",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DisputeEvidenceSubmitted",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "contributor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DisputeSettled",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "arbitrator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "decision",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ProtocolTypes.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExposureReleased",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "arbitrator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketCancelled",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonCode",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketChallenged",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "challenger",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "arbitrationDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketCreated",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "metadataHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "metadataURI",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "closeTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "resolutionTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "maxResolutionTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "terms",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct ProtocolTypes.Parameters",
        "components": [
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creationBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "proposalBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengeBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "minContribution",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "poolCap",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengePeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrationPeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrator",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketFinalized",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ProtocolTypes.Outcome"
      },
      {
        "name": "refundable",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketOutcomeProposed",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "proposer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ProtocolTypes.Outcome"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "challengeDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PredictionPlaced",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "participant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ProtocolTypes.Side"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProtocolFeeAccrued",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProtocolFeeWithdrawn",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundClaimed",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "participant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardClaimed",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "participant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SelectedSettlement",
    "inputs": [
      {
        "name": "marketId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "disposition",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum SelectedMarketFactory.Disposition"
      },
      {
        "name": "totalStake",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "proposalBond",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BelowMinimum",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DirectTransferRejected",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DuplicateStake",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExposureExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IncorrectValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidEvidence",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMetadata",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidOutcome",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRecipient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSelectedTerms",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTime",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MarketNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolCapExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;

/** sha256(ProtocolConfig.abi.json) = ca814a020dbb43eb58d93b917dbc8685c92fbd3a0fa15d5376dedbeae34c0301 */
export const SELECTED_CONFIG_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "compliance_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "guardian_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initial",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Parameters",
        "components": [
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creationBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "proposalBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengeBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "minContribution",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "poolCap",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengePeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrationPeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrator",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_BOND",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FEE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "RECOVERY_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROLE_CHECK_GAS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activateFinance",
    "inputs": [
      {
        "name": "release",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activationAfter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activeRoleState",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activityEpoch",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approveRelease",
    "inputs": [
      {
        "name": "release",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approvedDigest",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approvedRelease",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approvedRoleState",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bindFactory",
    "inputs": [
      {
        "name": "facade",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "complianceApprover",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentRoleState",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deactivateFinance",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deploymentChainId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "factory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "financialActive",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "governance",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "guardian",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "interruptedAt",
    "inputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "parameters",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Parameters",
        "components": [
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creationBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "proposalBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengeBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "minContribution",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "poolCap",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengePeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrationPeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrator",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "releaseDigest",
    "inputs": [
      {
        "name": "release",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reportRoleDrift",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requireArbitrator",
    "inputs": [
      {
        "name": "arbitrator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requireChallengeActivity",
    "inputs": [
      {
        "name": "facade",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requireFinancialActivity",
    "inputs": [
      {
        "name": "facade",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requireGovernanceAuthority",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requireUncontestedSettlement",
    "inputs": [],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "roleFingerprint",
    "inputs": [
      {
        "name": "wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "fingerprint",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setParameters",
    "inputs": [
      {
        "name": "next",
        "type": "tuple",
        "internalType": "struct ProtocolTypes.Parameters",
        "components": [
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creationBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "proposalBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengeBond",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "minContribution",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "poolCap",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "challengePeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrationPeriod",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "arbitrator",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ActivityInterrupted",
    "inputs": [
      {
        "name": "epoch",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "interruptedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FactoryBound",
    "inputs": [
      {
        "name": "factory",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FinanceActivated",
    "inputs": [
      {
        "name": "release",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FinanceDeactivated",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ParametersConfigured",
    "inputs": [
      {
        "name": "parametersHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PauseChanged",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReleaseApproved",
    "inputs": [
      {
        "name": "release",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "digest",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "activationAfter",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleDriftReported",
    "inputs": [
      {
        "name": "reporter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyBound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ControlChanged",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ControlUnchanged",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FinancialActivityDisabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientCheckGas",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidConfiguration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMultisig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotApproved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;

/** Candidate ABI identity, used to fail closed on an ABI mismatch. */
export const SELECTED_ABI_SHA256 = {
  SelectedMarketFactory: '1729c4a74541a74a3762112fa318dc248ac27fe5119b515900400b452f350d63',
  ProtocolConfig: 'ca814a020dbb43eb58d93b917dbc8685c92fbd3a0fa15d5376dedbeae34c0301',
} as const;

