// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {MarketFactory} from "./MarketFactory.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Selected LOCAL candidate v2: M1, neutral INVALID, fixed-tier exposure. Inactive until separately approved.
contract SelectedMarketFactory is MarketFactory {
    error InvalidSelectedTerms();
    error DuplicateStake();
    error ExposureExceeded();
    enum Disposition {
        NEUTRAL,
        PROPOSER,
        CHALLENGERS
    }

    struct Stake {
        uint256 amount;
        uint256 prefixBefore;
        bool claimed;
    }
    uint256 public immutable pilotPoolCap;
    uint256 public immutable globalUnresolvedCap;
    uint256 public immutable perArbitratorUnresolvedCap;
    uint256 public totalUnresolvedExposure;
    mapping(address => uint256) public unresolvedExposureByArbitrator;
    mapping(uint256 => bool) public exposureReleased;
    mapping(uint256 => uint256) public totalChallengeStake;
    mapping(uint256 => Disposition) public bondDisposition;
    mapping(uint256 => mapping(address => Stake)) private _stakes;
    event ChallengeStakeAccepted(
        uint256 indexed marketId,
        address indexed challenger,
        bytes32 indexed evidenceHash,
        uint256 amount,
        uint256 prefixBefore,
        uint256 totalStake
    );
    event SelectedSettlement(
        uint256 indexed marketId, Disposition disposition, uint256 totalStake, uint256 proposalBond
    );
    event ExposureReleased(uint256 indexed marketId, address indexed arbitrator, uint256 amount);

    constructor(IProtocolConfig config) MarketFactory(config) {
        T.Parameters memory p = config.parameters();
        pilotPoolCap = p.poolCap;
        globalUnresolvedCap = uint256(p.poolCap) * 3;
        perArbitratorUnresolvedCap = uint256(p.poolCap) * 2;
        _validateTerms(p, p.poolCap);
    }

    function _validateTerms(T.Parameters memory p, uint256 cap) private pure {
        if (
            cap == 0 || p.poolCap != cap || p.feeBps != 200 || p.proposalBond != Math.ceilDiv(cap, 10)
                || p.creationBond != Math.ceilDiv(cap, 100) || p.challengeBond != Math.ceilDiv(cap, 100)
                || p.minContribution != Math.ceilDiv(cap, 10000) || p.challengePeriod != 48 hours
                || p.arbitrationPeriod != 96 hours
        ) revert InvalidSelectedTerms();
    }

    function _validateCreation(T.Parameters memory p, uint64 resolutionTime, uint64 maxTime) internal view override {
        _validateTerms(p, pilotPoolCap);
        if (uint256(maxTime) < uint256(resolutionTime) + p.challengePeriod + p.arbitrationPeriod + 48 hours) {
            revert InvalidTime();
        }
    }

    function challengeResult(uint256 id, bytes32 evidenceHash) external payable override nonReentrant {
        protocolConfig.requireChallengeActivity(address(this));
        T.Market storage m = _market(id);
        _requireCurrentMarket(m);
        if (m.storedState != T.State.PROPOSED && m.storedState != T.State.DISPUTED) revert InvalidState();
        if (block.timestamp >= m.challengeDeadline) revert InvalidTime();
        if (msg.sender == m.proposer || msg.sender == m.terms.arbitrator) revert Unauthorized();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (msg.value < m.terms.challengeBond) revert IncorrectValue();
        Stake storage stake = _stakes[id][msg.sender];
        if (stake.amount != 0) revert DuplicateStake();
        uint256 prefix = totalChallengeStake[id];
        totalChallengeStake[id] = prefix + msg.value;
        stake.amount = msg.value;
        stake.prefixBefore = prefix;
        bondLiability += msg.value;
        totalBondsDeposited += msg.value;
        if (m.storedState == T.State.PROPOSED) {
            m.challenger = msg.sender;
            m.challengeEvidence = evidenceHash;
            m.storedState = T.State.DISPUTED;
            emit MarketChallenged(id, msg.sender, evidenceHash, m.arbitrationDeadline);
        }
        emit BondDeposited(id, T.BondType.CHALLENGE, msg.sender, msg.value);
        emit ChallengeStakeAccepted(id, msg.sender, evidenceHash, msg.value, prefix, totalChallengeStake[id]);
    }

    /// @notice Old single-owner CHALLENGE getter is not valid for M1; use getChallengeStake instead.
    function getBond(uint256 id, T.BondType kind) external view override returns (T.Bond memory) {
        _market(id);
        if (kind == T.BondType.CHALLENGE) revert InvalidState();
        return _bonds[id][kind];
    }

    function getChallengeStake(uint256 id, address owner) external view returns (Stake memory) {
        _market(id);
        return _stakes[id][owner];
    }

    /// @notice Outstanding terminal entitlement; zero also for a recorded losing tranche.
    function getBondEntitlement(uint256 id, T.BondType kind, address owner) public view returns (uint256) {
        T.Market storage m = _market(id);
        if (!_terminal(m)) return 0;
        uint256 s = totalChallengeStake[id];
        Disposition mode = bondDisposition[id];
        if (kind == T.BondType.CHALLENGE) {
            Stake storage stake = _stakes[id][owner];
            if (stake.claimed || stake.amount == 0 || mode == Disposition.PROPOSER) return 0;
            if (mode == Disposition.NEUTRAL) return stake.amount;
            uint256 p = m.terms.proposalBond;
            return
                stake.amount + Math.mulDiv(p, stake.prefixBefore + stake.amount, s)
                    - Math.mulDiv(p, stake.prefixBefore, s);
        }
        T.Bond storage b = _bonds[id][kind];
        if (b.owner != owner || b.claimed) return 0;
        if (kind == T.BondType.CREATION || mode == Disposition.NEUTRAL) return b.amount;
        return mode == Disposition.PROPOSER ? uint256(b.amount) + s : 0;
    }

    function claimBond(uint256 id, T.BondType kind, address recipient) external override nonReentrant {
        T.Market storage m = _market(id);
        if (!_terminal(m)) revert InvalidState();
        uint256 amount = getBondEntitlement(id, kind, msg.sender);
        if (kind == T.BondType.CHALLENGE) {
            Stake storage stake = _stakes[id][msg.sender];
            if (stake.amount == 0) revert Unauthorized();
            if (stake.claimed) revert AlreadyClaimed();
            stake.claimed = true;
        } else {
            T.Bond storage b = _bonds[id][kind];
            if (b.owner != msg.sender) revert Unauthorized();
            if (b.claimed) revert AlreadyClaimed();
            b.claimed = true;
        }
        _recipient(recipient);
        bondLiability -= amount;
        totalBondsPaid += amount;
        _send(recipient, amount);
        emit BondReleased(id, kind, msg.sender, recipient, amount);
    }

    function _beforePrediction(T.Market storage m, uint256 amount) internal override {
        address arb = m.terms.arbitrator;
        if (
            amount > globalUnresolvedCap - totalUnresolvedExposure
                || amount > perArbitratorUnresolvedCap - unresolvedExposureByArbitrator[arb]
        ) revert ExposureExceeded();
        totalUnresolvedExposure += amount;
        unresolvedExposureByArbitrator[arb] += amount;
    }

    function _onTerminal(uint256 id, T.Market storage m) internal override {
        if (exposureReleased[id]) revert InvalidState();
        exposureReleased[id] = true;
        uint256 amount = uint256(m.yesPool) + m.noPool;
        totalUnresolvedExposure -= amount;
        unresolvedExposureByArbitrator[m.terms.arbitrator] -= amount;
        if (!m.refundable && totalChallengeStake[id] != 0) {
            bondDisposition[id] = m.finalOutcome == m.proposedOutcome ? Disposition.PROPOSER : Disposition.CHALLENGERS;
        }
        emit ExposureReleased(id, m.terms.arbitrator, amount);
        emit SelectedSettlement(
            id, bondDisposition[id], totalChallengeStake[id], _bonds[id][T.BondType.PROPOSAL].amount
        );
    }
}
