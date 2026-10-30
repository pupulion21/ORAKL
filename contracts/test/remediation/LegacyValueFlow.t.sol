// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {QiePredictionMarket} from "../../src/QiePredictionMarket.sol";
import {TestBase} from "../helpers/TestBase.sol";

contract LegacyValueFlowTest is TestBase {
    function testLegacyClaimAndRefundOnlyUseCallerEntitlementAcrossMarkets() public {
        QiePredictionMarket m = new QiePredictionMarket();
        address alice = address(0xa11ce);
        address bob = address(0xb0b);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        uint64 close = uint64(block.timestamp + 100);
        uint256 win = m.createMarket("q", "criteria", "source", address(this), close, close + 100);
        uint256 invalid = m.createMarket("q", "criteria", "source", address(this), close, close + 100);
        vm.prank(alice);
        m.stake{value: 2 ether}(win, QiePredictionMarket.Side.YES);
        vm.prank(bob);
        m.stake{value: 3 ether}(invalid, QiePredictionMarket.Side.NO);
        vm.warp(close);
        m.resolve(win, QiePredictionMarket.Outcome.YES);
        m.resolve(invalid, QiePredictionMarket.Outcome.INVALID);
        vm.prank(bob);
        vm.expectRevert(QiePredictionMarket.NothingToClaim.selector);
        m.claimTo(win, bob);
        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.NothingToRefund.selector);
        m.refundTo(invalid, alice);
        vm.prank(alice);
        m.claimTo(win, bob);
        vm.prank(bob);
        m.refundTo(invalid, alice);
        assertEq(m.totalPaidOut(), 5 ether, "only authorized entitlements moved");
        assertEq(m.totalEscrow(), 0, "no stranded accounting");
    }
}
