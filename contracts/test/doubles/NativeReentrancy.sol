// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {QiePredictionMarket} from "../../src/QiePredictionMarket.sol";

/// @dev TEST DOUBLE ONLY. A contract staker that re-enters claim/refund from its
///      native receive hook. The re-entry must hit the market's nonReentrant guard;
///      the hook catches the revert so the outer payout can complete.
contract ReentrancyAttacker {
    QiePredictionMarket public market;
    uint256 public marketId;
    uint8 public mode; // 0 = claim, 1 = refund
    uint256 public attempts;
    bool public reentryReverted;

    function configure(QiePredictionMarket market_, uint256 marketId_, uint8 mode_) external {
        market = market_;
        marketId = marketId_;
        mode = mode_;
    }

    function stakeYes() external payable {
        market.stake{value: msg.value}(marketId, QiePredictionMarket.Side.YES);
    }

    function attack() external {
        if (mode == 0) {
            market.claim(marketId);
        } else {
            market.refund(marketId);
        }
    }

    receive() external payable {
        ++attempts;
        if (mode == 0) {
            try market.claim(marketId) {} catch { reentryReverted = true; }
        } else {
            try market.refund(marketId) {} catch { reentryReverted = true; }
        }
    }
}

/// @dev TEST DOUBLE ONLY. A contract staker whose receive hook always reverts. The
///      market must roll back its settlement and the owner must be able to redirect
///      the payout with claimTo/refundTo.
contract RevertingReceiver {
    QiePredictionMarket public market;
    uint256 public marketId;

    function configure(QiePredictionMarket market_, uint256 marketId_) external {
        market = market_;
        marketId = marketId_;
    }

    function stakeYes() external payable {
        market.stake{value: msg.value}(marketId, QiePredictionMarket.Side.YES);
    }

    function stakeNo() external payable {
        market.stake{value: msg.value}(marketId, QiePredictionMarket.Side.NO);
    }

    function claimTo(address recipient) external {
        market.claimTo(marketId, recipient);
    }

    function refundTo(address recipient) external {
        market.refundTo(marketId, recipient);
    }

    receive() external payable {
        revert("reverting receiver");
    }
}
