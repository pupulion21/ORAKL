// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T} from "../helpers/OraklTestBase.sol";

contract LifecycleTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testParallelMarketsUncontestedDisputedInvalidAndExpired() public {
        uint256 valid = _create();
        uint256 disputed = _create();
        uint256 invalid = _create();
        uint256 expired = _create();
        for (uint256 i; i < 4; ++i) {
            _predict(i, alice, T.Side.YES, 10 ether);
            _predict(i, bob, T.Side.NO, 20 ether);
        }
        _propose(valid, T.Outcome.YES);
        _propose(disputed, T.Outcome.YES);
        _challenge(disputed);
        _propose(invalid, T.Outcome.INVALID);
        vm.prank(arbitrator);
        factory.settleDispute(disputed, T.Outcome.NO, HASH);
        vm.warp(factory.getMarket(valid).challengeDeadline);
        factory.finalizeResult(valid);
        factory.finalizeResult(invalid);
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        factory.claim(valid);
        vm.prank(bob);
        factory.claim(disputed);
        vm.prank(alice);
        factory.claimRefund(invalid);
        vm.prank(bob);
        factory.claimRefund(invalid);
        vm.warp(expiry);
        factory.cancelExpiredMarket(expired);
        vm.prank(alice);
        factory.claimRefund(expired);
        vm.prank(bob);
        factory.claimRefund(expired);
        for (uint256 i; i < 4; ++i) {
            vm.prank(alice);
            factory.claimBond(i, T.BondType.CREATION, alice);
        }
        for (uint256 i; i < 3; ++i) {
            vm.prank(alice);
            factory.claimBond(i, T.BondType.PROPOSAL, alice);
        }
        vm.prank(bob);
        factory.claimBond(disputed, T.BondType.CHALLENGE, bob);
        uint256 fee = factory.feeLiability();
        vm.prank(governance);
        factory.withdrawProtocolFees(fee, carol);
        assertEq(factory.totalContributions(), 120 ether, "deposited");
        assertEq(factory.totalParticipantPaid(), 1188 ether / 10, "paid or refunded");
        assertEq(factory.totalFeesWithdrawn(), 12 ether / 10, "valid pools only");
        assertEq(factory.totalAccounted(), 0, "all financial obligations discharged");
        _assertConservation();
    }
}
