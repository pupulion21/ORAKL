// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolStorage} from "../helpers/OraklTestBase.sol";
contract PredictionPoolTest is OraklTestBase {
    function setUp() public { vm.warp(1_800_000_000); _deploy(true); }
    function testBothSidesRepeatedAndPoolTotals() public {
        uint256 id = _create();
        _predict(id,alice,T.Side.YES,10 ether); _predict(id,alice,T.Side.YES,2 ether);
        _predict(id,alice,T.Side.NO,3 ether); _predict(id,bob,T.Side.NO,4 ether);
        T.Position memory p = factory.getPosition(id,alice);
        assertEq(p.yes,12 ether,"yes"); assertEq(p.no,3 ether,"no");
        (uint256 y,uint256 n,uint256 total) = factory.getPoolTotals(id);
        assertEq(y,12 ether,"yes total"); assertEq(n,7 ether,"no total"); assertEq(total,19 ether,"total");
        assertEq(factory.participantLiability(),19 ether,"participants"); _assertConservation();
    }
    function testContributionMinimumCloseAndCapBoundaries() public {
        uint256 id = _create();
        vm.prank(alice); vm.expectRevert(ProtocolStorage.BelowMinimum.selector); factory.predict(id,T.Side.YES);
        _predict(id,alice,T.Side.YES,1);
        vm.deal(bob,type(uint128).max);
        _predict(id,bob,T.Side.NO,type(uint128).max-1);
        vm.prank(carol); vm.expectRevert(ProtocolStorage.PoolCapExceeded.selector); factory.predict{value:1}(id,T.Side.YES);
        vm.warp(close);
        vm.prank(carol); vm.expectRevert(ProtocolStorage.InvalidState.selector); factory.predict{value:1}(id,T.Side.YES);
        _assertConservation();
    }
    function testFeeAndProportionalPayoutsExactlyOnce() public {
        uint256 id = _seed(); _finalize(id,T.Outcome.YES);
        T.Market memory m = factory.getMarket(id);
        assertEq(m.protocolFee,12 ether/10,"2 percent"); assertEq(m.distributablePool,588 ether/10,"distributable");
        vm.prank(alice); factory.claim(id); vm.prank(bob); factory.claimTo(id,carol);
        assertEq(factory.getMarket(id).paidOut,588 ether/10,"all payouts");
        assertEq(factory.participantLiability(),0,"no unpaid participants");
        vm.prank(alice); vm.expectRevert(ProtocolStorage.AlreadyClaimed.selector); factory.claim(id);
        vm.prank(carol); vm.expectRevert(ProtocolStorage.NothingToClaim.selector); factory.claim(id);
        vm.prank(bob); vm.expectRevert(ProtocolStorage.InvalidState.selector); factory.claimRefund(id);
        _assertConservation();
    }
    function testFeesCannotSpendParticipantsOrBondsAndAreAuthorized() public {
        uint256 id = _seed(); _finalize(id,T.Outcome.YES);
        uint256 bonds = factory.bondLiability(); uint256 participants = factory.participantLiability();
        vm.prank(alice); vm.expectRevert(ProtocolStorage.Unauthorized.selector); factory.withdrawProtocolFees(1,alice);
        vm.prank(governance); vm.expectRevert(ProtocolStorage.NothingToClaim.selector); factory.withdrawProtocolFees(12 ether/10+1,alice);
        vm.prank(governance); factory.withdrawProtocolFees(12 ether/10,carol);
        assertEq(factory.bondLiability(),bonds,"bond isolation"); assertEq(factory.participantLiability(),participants,"pool isolation");
        vm.prank(governance); vm.expectRevert(ProtocolStorage.NothingToClaim.selector); factory.withdrawProtocolFees(1,carol);
        _assertConservation();
    }
    function testInvalidRefundsBothSidesAndNoFees() public {
        uint256 id = _create(); _predict(id,alice,T.Side.YES,3 ether); _predict(id,alice,T.Side.NO,4 ether);
        _finalize(id,T.Outcome.INVALID);
        (,uint256 refund) = factory.getClaimable(id,alice); assertEq(refund,7 ether,"full refund");
        vm.prank(alice); factory.claimRefundTo(id,bob);
        assertEq(factory.getMarket(id).refunded,7 ether,"refunded"); assertEq(factory.feeLiability(),0,"no fees");
        vm.prank(alice); vm.expectRevert(ProtocolStorage.AlreadyClaimed.selector); factory.claimRefund(id);
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidState.selector); factory.claim(id);
        _assertConservation();
    }
    function testZeroWinningSideFullRefundAndEmptyMarket() public {
        uint256 id = _create(); uint256 empty = _create();
        _predict(id,bob,T.Side.NO,2 ether); _finalize(id,T.Outcome.YES);
        assertTrue(factory.getMarket(id).refundable,"zero-winner refund");
        assertEq(factory.getMarket(id).protocolFee,0,"no fees");
        vm.prank(bob); factory.claimRefund(id);
        vm.warp(expiry); factory.cancelExpiredMarket(empty);
        assertEq(factory.participantLiability(),0,"all principal returned"); _assertConservation();
    }
    function testTinyWinningPayoutRoundsToZeroWithoutDoubleSettlement() public {
        uint256 id = _create(); _predict(id,alice,T.Side.YES,1); _predict(id,bob,T.Side.YES,99);
        _finalize(id,T.Outcome.YES);
        (uint256 payout,) = factory.getClaimable(id,alice); assertEq(payout,0,"round to zero after fee");
        vm.prank(alice); factory.claim(id);
        assertTrue(factory.getPosition(id,alice).settled,"zero entitlement settled");
        vm.prank(bob); factory.claim(id);
        assertEq(factory.participantLiability(),1,"rounding remains reserved"); _assertConservation();
    }
    function testClaimBeforeSettlementAndInvalidRecipients() public {
        uint256 id = _seed();
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidState.selector); factory.claim(id);
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidState.selector); factory.claimRefund(id);
        _finalize(id,T.Outcome.YES);
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidRecipient.selector); factory.claimTo(id,address(0));
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidRecipient.selector); factory.claimTo(id,address(factory));
        vm.prank(alice); vm.expectRevert(ProtocolStorage.InvalidRecipient.selector); factory.claimTo(id,address(config));
    }
    function testPausePreservesUncontestedFinalizationClaimsAndBonds() public {
        uint256 id = _seed(); _propose(id,T.Outcome.YES);
        vm.prank(guardian); config.pause(); vm.prank(guardian); config.deactivateFinance();
        vm.warp(factory.getMarket(id).challengeDeadline); factory.finalizeResult(id);
        vm.prank(alice); factory.claim(id);
        vm.prank(alice); factory.claimBond(id,T.BondType.CREATION,alice);
        _assertConservation();
    }
    function testForcedBalanceHasNoEffectOnPayout() public {
        uint256 id = _seed(); vm.deal(address(factory),address(factory).balance+12345);
        assertEq(factory.unaccountedBalance(),12345,"surplus"); _finalize(id,T.Outcome.YES);
        (uint256 amount,) = factory.getClaimable(id,alice); assertEq(amount,147 ether/10,"unaffected");
        _assertConservation();
    }
    function _seed() private returns(uint256 id) {
        id = _create(); _predict(id,alice,T.Side.YES,10 ether); _predict(id,bob,T.Side.YES,30 ether); _predict(id,carol,T.Side.NO,20 ether);
    }
}
