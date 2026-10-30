// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ProtocolStorage} from "./ProtocolStorage.sol";
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";

abstract contract PredictionPool is ProtocolStorage {
    event PredictionPlaced(uint256 indexed marketId, address indexed participant, T.Side side, uint256 amount);
    event RewardClaimed(uint256 indexed marketId, address indexed participant, address recipient, uint256 amount);
    event RefundClaimed(uint256 indexed marketId, address indexed participant, address recipient, uint256 amount);
    event ProtocolFeeAccrued(uint256 indexed marketId, uint256 amount);
    event ProtocolFeeWithdrawn(address indexed caller, address indexed recipient, uint256 amount);

    function predict(uint256 id, T.Side side) external payable nonReentrant financialEntry {
        T.Market storage m = _market(id);
        _requireCurrentMarket(m);
        if (marketState(id) != T.State.OPEN) revert InvalidState();
        if (msg.value < m.terms.minContribution) revert BelowMinimum();
        uint256 total = uint256(m.yesPool) + m.noPool;
        if (msg.value > uint256(m.terms.poolCap) - total) revert PoolCapExceeded();
        T.Position storage p = _positions[id][msg.sender];
        if (side == T.Side.YES) {
            m.yesPool += uint128(msg.value);
            p.yes += uint128(msg.value);
        } else {
            m.noPool += uint128(msg.value);
            p.no += uint128(msg.value);
        }
        participantLiability += msg.value;
        totalContributions += msg.value;
        emit PredictionPlaced(id, msg.sender, side, msg.value);
    }

    function getClaimable(uint256 id, address user) public view returns (uint256 payout, uint256 refund) {
        T.Market storage m = _market(id);
        T.Position storage p = _positions[id][user];
        if (!_terminal(m) || p.settled) return (0, 0);
        if (m.refundable) return (0, uint256(p.yes) + p.no);
        return (_payout(m, p), 0);
    }

    function claim(uint256 id) external nonReentrant {
        _settle(id, msg.sender, false);
    }

    function claimTo(uint256 id, address recipient) external nonReentrant {
        _settle(id, recipient, false);
    }

    function claimRefund(uint256 id) external nonReentrant {
        _settle(id, msg.sender, true);
    }

    function claimRefundTo(uint256 id, address recipient) external nonReentrant {
        _settle(id, recipient, true);
    }

    function withdrawProtocolFees(uint256 amount, address recipient) external nonReentrant {
        if (msg.sender != protocolConfig.governance()) revert Unauthorized();
        protocolConfig.requireGovernanceAuthority(msg.sender);
        _recipient(recipient);
        if (amount == 0 || amount > feeLiability) revert NothingToClaim();
        feeLiability -= amount;
        totalFeesWithdrawn += amount;
        _send(recipient, amount);
        emit ProtocolFeeWithdrawn(msg.sender, recipient, amount);
    }

    function _settle(uint256 id, address recipient, bool refund) private {
        T.Market storage m = _market(id);
        if (!_terminal(m) || m.refundable != refund) revert InvalidState();
        T.Position storage p = _positions[id][msg.sender];
        if (p.settled) revert AlreadyClaimed();
        uint256 contribution = refund ? uint256(p.yes) + p.no : (m.finalOutcome == T.Outcome.YES ? p.yes : p.no);
        if (contribution == 0) revert NothingToClaim();
        _recipient(recipient);
        uint256 amount = refund ? contribution : _payout(m, p);
        p.settled = true;
        if (refund) m.refunded += amount;
        else m.paidOut += amount;
        participantLiability -= amount;
        totalParticipantPaid += amount;
        _send(recipient, amount);
        if (refund) emit RefundClaimed(id, msg.sender, recipient, amount);
        else emit RewardClaimed(id, msg.sender, recipient, amount);
    }

    function _payout(T.Market storage m, T.Position storage p) private view returns (uint256) {
        uint256 winning = m.finalOutcome == T.Outcome.YES ? m.yesPool : m.noPool;
        uint256 userWinning = m.finalOutcome == T.Outcome.YES ? p.yes : p.no;
        return Math.mulDiv(userWinning, m.distributablePool, winning);
    }

    function _allocateSettlement(uint256 id, T.Market storage m, T.Outcome outcome) internal {
        uint256 total = uint256(m.yesPool) + m.noPool;
        uint256 winning = outcome == T.Outcome.YES ? m.yesPool : m.noPool;
        m.finalOutcome = outcome;
        m.refundable = outcome == T.Outcome.INVALID || winning == 0;
        if (!m.refundable) {
            uint256 fee = Math.mulDiv(total, m.terms.feeBps, 10_000);
            m.protocolFee = fee;
            m.distributablePool = total - fee;
            participantLiability -= fee;
            feeLiability += fee;
            totalFeesAccrued += fee;
            emit ProtocolFeeAccrued(id, fee);
        }
    }
}
