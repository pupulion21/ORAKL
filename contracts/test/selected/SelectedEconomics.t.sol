// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {SelectedBase} from "./SelectedBase.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolStorage} from "../../src/ProtocolStorage.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

contract SelectedEconomicsTest is SelectedBase {
    function setUp() public {
        _deploySelected();
    }

    function testMatrixAllNineTimesFourPoolShapes() public {
        for (uint8 shape; shape < 4; ++shape) {
            for (uint8 p = 1; p <= 3; ++p) {
                for (uint8 f = 1; f <= 3; ++f) {
                    _matrix(shape, T.Outcome(p), T.Outcome(f));
                }
            }
        }
    }

    function _matrix(uint8 shape, T.Outcome proposal, T.Outcome final_) internal {
        uint256 id = _new();
        if (shape == 0 || shape == 1) _predict(id, bob, T.Side.YES, 6 ether);
        if (shape == 0 || shape == 2) _predict(id, carol, T.Side.NO, 4 ether);
        _propose(id, proposal);
        _stake(id, bob, 1 ether);
        _stake(id, carol, 3 ether);
        uint256 d = selected.getMarket(id).challengeDeadline;
        _decision(id, final_);
        T.Market memory m = selected.getMarket(id);
        bool neutral = final_ == T.Outcome.INVALID || (final_ == T.Outcome.YES && shape != 0 && shape != 1)
            || (final_ == T.Outcome.NO && shape != 0 && shape != 2);
        uint256 pExpected = neutral ? 10 ether : final_ == proposal ? 14 ether : 0;
        uint256 bExpected = neutral ? 1 ether : final_ == proposal ? 0 : 3.5 ether;
        uint256 cExpected = neutral ? 3 ether : final_ == proposal ? 0 : 10.5 ether;
        assertEq(selected.getBondEntitlement(id, T.BondType.PROPOSAL, alice), pExpected, "proposal");
        assertEq(selected.getBondEntitlement(id, T.BondType.CHALLENGE, bob), bExpected, "challenger1");
        assertEq(selected.getBondEntitlement(id, T.BondType.CHALLENGE, carol), cExpected, "challenger2");
        assertEq(m.challengeDeadline, d, "D immutable");
        assertEq(m.refundable, neutral, "refund");
        assertEq(m.protocolFee, neutral ? 0 : (uint256(m.yesPool) + m.noPool) * 2 / 100, "fee");
        _bond(id, T.BondType.CHALLENGE, carol);
        _bond(id, T.BondType.PROPOSAL, alice);
        _bond(id, T.BondType.CHALLENGE, bob);
        _bond(id, T.BondType.CREATION, alice);
        assertEq(selected.bondLiability(), 0, "all K+P+S withdrawn");
        _assertConservation();
    }

    function testHundredTwentyEightChallengersAndClaimOrder() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        for (uint256 i; i < 128; ++i) {
            address who = address(uint160(10000 + i));
            _stake(id, who, 1 ether + i);
        }
        _decision(id, T.Outcome.NO);
        uint256 total;
        for (uint256 i = 128; i > 0; --i) {
            total += _bond(id, T.BondType.CHALLENGE, address(uint160(9999 + i)));
        }
        assertEq(total, selected.totalChallengeStake(id) + 10 ether, "telescoping exact P");
        _bond(id, T.BondType.PROPOSAL, alice);
        _bond(id, T.BondType.CREATION, alice);
        assertEq(selected.bondLiability(), 0, "no reward dust");
    }

    function testDuplicateLateEarlyAndUnauthorized() public {
        uint256 id = _new();
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(SelectedMarketFactory.DuplicateStake.selector);
        selected.challengeResult{value: 1 ether}(id, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        selected.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(carol);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        selected.settleDispute(id, T.Outcome.NO, HASH);
        vm.warp(selected.getMarket(id).challengeDeadline);
        vm.prank(carol);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        selected.challengeResult{value: 1 ether}(id, HASH);
        vm.prank(arbitrator);
        selected.settleDispute(id, T.Outcome.INVALID, HASH);
        _bond(id, T.BondType.CHALLENGE, bob);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.AlreadyClaimed.selector);
        selected.claimBond(id, T.BondType.CHALLENGE, bob);
    }

    function testPauseEvidenceAndNeutralEmergencyExit() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 20 ether);
        _propose(id, T.Outcome.NO);
        _stake(id, bob, 1 ether);
        vm.prank(guardian);
        config.pause();
        selected.submitEvidence(id, HASH);
        vm.prank(carol);
        vm.expectRevert();
        selected.challengeResult{value: 1 ether}(id, HASH);
        vm.warp(selected.getMarket(id).arbitrationDeadline);
        selected.cancelInterruptedMarket(id);
        assertEq(selected.totalUnresolvedExposure(), 0, "release");
        assertEq(_bond(id, T.BondType.CHALLENGE, bob), 1 ether, "neutral");
        assertEq(_bond(id, T.BondType.PROPOSAL, alice), 10 ether, "P returned");
        vm.prank(bob);
        selected.claimRefund(id);
        _assertConservation();
    }

    function testTimeoutAndNoChallengeReturnPrincipals() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 1 ether);
        vm.warp(expiry);
        selected.cancelExpiredMarket(id);
        _bond(id, T.BondType.CREATION, alice);
        id = _new();
        _propose(id, T.Outcome.YES);
        vm.warp(selected.getMarket(id).challengeDeadline);
        selected.finalizeResult(id);
        assertEq(_bond(id, T.BondType.PROPOSAL, alice), 10 ether, "no imaginary C");
        id = _new();
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 2 ether);
        vm.warp(selected.getMarket(id).arbitrationDeadline);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        selected.settleDispute(id, T.Outcome.YES, HASH);
        selected.cancelExpiredMarket(id);
        assertEq(_bond(id, T.BondType.CHALLENGE, bob), 2 ether, "timeout principal");
    }

    function testMinimumStakeAndForbiddenCallers() public {
        uint256 id = _new();
        _propose(id, T.Outcome.YES);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.IncorrectValue.selector);
        selected.challengeResult{value: 1 ether - 1}(id, HASH);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        selected.challengeResult{value: 1 ether}(id, HASH);
        vm.deal(arbitrator, 2 ether);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        selected.challengeResult{value: 1 ether}(id, HASH);
    }

    function testFuzzTelescopingAndSplit(uint96 a, uint96 b, uint96 c) public {
        uint256 id = _new();
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        uint256 x = 1 ether + uint256(a) % 100 ether;
        uint256 y = 1 ether + uint256(b) % 100 ether;
        uint256 z = 1 ether + uint256(c) % 100 ether;
        _stake(id, bob, x);
        _stake(id, carol, y);
        address other = address(0xdead);
        _stake(id, other, z);
        _decision(id, T.Outcome.NO);
        uint256 sum = selected.getBondEntitlement(id, T.BondType.CHALLENGE, bob)
            + selected.getBondEntitlement(id, T.BondType.CHALLENGE, carol)
            + selected.getBondEntitlement(id, T.BondType.CHALLENGE, other);
        assertEq(sum, x + y + z + 10 ether, "all principal + exact P");
        _assertConservation();
    }
}
