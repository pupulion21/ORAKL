// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

library ProtocolTypes {
    enum Side {
        YES,
        NO
    }
    enum Outcome {
        UNRESOLVED,
        YES,
        NO,
        INVALID
    }
    enum State {
        OPEN,
        CLOSED,
        PROPOSED,
        DISPUTED,
        FINALIZED,
        CANCELLED
    }
    enum BondType {
        CREATION,
        PROPOSAL,
        CHALLENGE
    }

    struct Parameters {
        uint16 feeBps;
        uint128 creationBond;
        uint128 proposalBond;
        uint128 challengeBond;
        uint128 minContribution;
        uint128 poolCap;
        uint32 challengePeriod;
        uint32 arbitrationPeriod;
        address arbitrator;
    }

    struct Market {
        address creator;
        bytes32 metadataHash;
        string metadataURI;
        uint64 closeTime;
        uint64 resolutionTime;
        uint64 maxResolutionTime;
        Parameters terms;
        State storedState;
        Outcome proposedOutcome;
        Outcome finalOutcome;
        address proposer;
        address challenger;
        bytes32 proposalEvidence;
        bytes32 challengeEvidence;
        bytes32 decisionEvidence;
        uint64 proposalActivityEpoch;
        uint64 challengeDeadline;
        uint64 arbitrationDeadline;
        uint128 yesPool;
        uint128 noPool;
        uint256 distributablePool;
        uint256 protocolFee;
        uint256 paidOut;
        uint256 refunded;
        bool refundable;
    }

    struct Position {
        uint128 yes;
        uint128 no;
        bool settled;
    }

    struct Bond {
        address owner;
        uint128 amount;
        bool claimed;
    }
}
