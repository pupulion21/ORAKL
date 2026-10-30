// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {PredictionPool} from "./PredictionPool.sol";
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";

abstract contract MarketResolver is PredictionPool {
    event MarketOutcomeProposed(
        uint256 indexed marketId,
        address indexed proposer,
        T.Outcome outcome,
        bytes32 evidenceHash,
        uint64 challengeDeadline
    );
    event MarketChallenged(
        uint256 indexed marketId, address indexed challenger, bytes32 evidenceHash, uint64 arbitrationDeadline
    );
    event DisputeSettled(
        uint256 indexed marketId, address indexed arbitrator, T.Outcome decision, bytes32 evidenceHash
    );
    event MarketFinalized(uint256 indexed marketId, T.Outcome outcome, bool refundable);
    event MarketCancelled(uint256 indexed marketId, address indexed caller, uint8 reasonCode);
    /// @notice Event-only commitment; does not grant a bond entitlement, objection state or settlement authority.
    event DisputeEvidenceSubmitted(uint256 indexed marketId, address indexed contributor, bytes32 indexed evidenceHash);

    /// @notice Independent evidence intake stays open for the original window, including during an emergency.
    /// @dev No role getter, evidence storage/cap/deduplication, financial allocation or deadline mutation.
    function submitEvidence(uint256 id, bytes32 evidenceHash) external nonReentrant {
        T.Market storage m = _market(id);
        if (m.storedState != T.State.PROPOSED && m.storedState != T.State.DISPUTED) revert InvalidState();
        if (block.timestamp >= m.challengeDeadline) revert InvalidTime();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        emit DisputeEvidenceSubmitted(id, msg.sender, evidenceHash);
    }

    function proposeResult(uint256 id, T.Outcome outcome, bytes32 evidenceHash)
        external
        payable
        nonReentrant
        financialEntry
    {
        T.Market storage m = _market(id);
        _requireCurrentMarket(m);
        if (marketState(id) != T.State.CLOSED) revert InvalidState();
        if (msg.sender == m.terms.arbitrator) revert Unauthorized();
        uint256 latest = uint256(m.maxResolutionTime) - m.terms.challengePeriod - m.terms.arbitrationPeriod;
        if (block.timestamp < m.resolutionTime || block.timestamp >= latest) revert InvalidTime();
        if (outcome == T.Outcome.UNRESOLVED) revert InvalidOutcome();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (msg.value != m.terms.proposalBond) revert IncorrectValue();
        m.proposalActivityEpoch = protocolConfig.activityEpoch();
        m.proposer = msg.sender;
        m.proposedOutcome = outcome;
        m.proposalEvidence = evidenceHash;
        m.challengeDeadline = uint64(block.timestamp + m.terms.challengePeriod);
        m.arbitrationDeadline = uint64(uint256(m.challengeDeadline) + m.terms.arbitrationPeriod);
        m.storedState = T.State.PROPOSED;
        _depositBond(id, T.BondType.PROPOSAL, m.terms.proposalBond);
        emit MarketOutcomeProposed(id, msg.sender, outcome, evidenceHash, m.challengeDeadline);
    }

    function challengeResult(uint256 id, bytes32 evidenceHash) external payable nonReentrant {
        protocolConfig.requireChallengeActivity(address(this));
        T.Market storage m = _market(id);
        _requireCurrentMarket(m);
        if (m.storedState != T.State.PROPOSED) revert InvalidState();
        if (block.timestamp >= m.challengeDeadline) revert InvalidTime();
        if (msg.sender == m.proposer || msg.sender == m.terms.arbitrator) revert Unauthorized();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (msg.value != m.terms.challengeBond) revert IncorrectValue();
        m.challenger = msg.sender;
        m.challengeEvidence = evidenceHash;
        m.storedState = T.State.DISPUTED;
        _depositBond(id, T.BondType.CHALLENGE, m.terms.challengeBond);
        emit MarketChallenged(id, msg.sender, evidenceHash, m.arbitrationDeadline);
    }

    function finalizeResult(uint256 id) external nonReentrant {
        T.Market storage m = _market(id);
        if (m.storedState != T.State.PROPOSED || m.proposalActivityEpoch != protocolConfig.activityEpoch()) {
            revert InvalidState();
        }
        if (block.timestamp < m.challengeDeadline || block.timestamp >= m.maxResolutionTime) revert InvalidTime();
        protocolConfig.requireUncontestedSettlement();
        _finish(id, m, m.proposedOutcome);
    }

    function settleDispute(uint256 id, T.Outcome decision, bytes32 evidenceHash) external nonReentrant {
        T.Market storage m = _market(id);
        if (m.storedState != T.State.DISPUTED) revert InvalidState();
        if (msg.sender != m.terms.arbitrator) revert Unauthorized();
        protocolConfig.requireArbitrator(m.terms.arbitrator, m.arbitratorFingerprint);
        if (block.timestamp < m.challengeDeadline || block.timestamp >= m.arbitrationDeadline) revert InvalidTime();
        if (decision == T.Outcome.UNRESOLVED) revert InvalidOutcome();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        m.decisionEvidence = evidenceHash;
        emit DisputeSettled(id, msg.sender, decision, evidenceHash);
        _finish(id, m, decision);
    }

    function cancelExpiredMarket(uint256 id) external nonReentrant {
        T.Market storage m = _market(id);
        if (_terminal(m)) revert InvalidState();
        uint256 expiry = m.storedState == T.State.DISPUTED ? m.arbitrationDeadline : m.maxResolutionTime;
        if (block.timestamp < expiry) revert InvalidTime();
        m.finalOutcome = T.Outcome.INVALID;
        m.storedState = T.State.CANCELLED;
        m.refundable = true;
        emit MarketCancelled(id, msg.sender, 1);
    }

    /// @notice Earliest permissionless emergency refund; zero if no interruption.
    function interruptionRefundTime(uint256 id) public view returns (uint256) {
        T.Market storage m = _market(id);
        if (m.creationActivityEpoch == protocolConfig.activityEpoch() || _terminal(m)) return 0;
        if (m.storedState == T.State.DISPUTED) return m.arbitrationDeadline;
        uint256 graceEnd = uint256(protocolConfig.interruptedAt(m.creationActivityEpoch)) + m.terms.challengePeriod;
        return graceEnd < m.maxResolutionTime ? graceEnd : m.maxResolutionTime;
    }

    function cancelInterruptedMarket(uint256 id) external nonReentrant {
        T.Market storage m = _market(id);
        uint256 readyAt = interruptionRefundTime(id);
        if (readyAt == 0 || _terminal(m)) revert InvalidState();
        if (block.timestamp < readyAt) revert InvalidTime();
        m.finalOutcome = T.Outcome.INVALID;
        m.storedState = T.State.CANCELLED;
        m.refundable = true;
        emit MarketCancelled(id, msg.sender, 3);
    }

    function _finish(uint256 id, T.Market storage m, T.Outcome outcome) private {
        _allocateSettlement(id, m, outcome);
        if (outcome == T.Outcome.INVALID) {
            m.storedState = T.State.CANCELLED;
            emit MarketCancelled(id, msg.sender, 2);
        } else {
            m.storedState = T.State.FINALIZED;
            emit MarketFinalized(id, outcome, m.refundable);
        }
    }
}
