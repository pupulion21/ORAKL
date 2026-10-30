// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolStorage, ProtocolConfig} from "../helpers/OraklTestBase.sol";

contract MarketResolverTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testDerivedCloseAndProposalWindow() public {
        uint256 id = _create();
        assertTrue(factory.marketState(id) == T.State.OPEN, "open");
        _badProposal(id, T.Outcome.YES, HASH, 2 ether, ProtocolStorage.InvalidState.selector);
        vm.warp(close);
        assertTrue(factory.marketState(id) == T.State.CLOSED, "derived closed");
        _badProposal(id, T.Outcome.YES, HASH, 2 ether, ProtocolStorage.InvalidTime.selector);
        vm.warp(resolution);
        _badProposal(id, T.Outcome.UNRESOLVED, HASH, 2 ether, ProtocolStorage.InvalidOutcome.selector);
        _badProposal(id, T.Outcome.YES, bytes32(0), 2 ether, ProtocolStorage.InvalidEvidence.selector);
        _badProposal(id, T.Outcome.YES, HASH, 1, ProtocolStorage.IncorrectValue.selector);
        _propose(id, T.Outcome.YES);
        T.Market memory m = factory.getMarket(id);
        assertTrue(factory.marketState(id) == T.State.PROPOSED, "proposed");
        assertTrue(m.proposalEvidence == HASH, "evidence");
        assertEq(m.challengeDeadline, resolution + 1 hours, "fixed deadline");
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.finalizeResult(id);
        vm.warp(m.challengeDeadline);
        factory.finalizeResult(id);
        assertTrue(factory.marketState(id) == T.State.FINALIZED, "finalized");
    }

    function testLateProposalRejectedReservesFullDisputeWindow() public {
        uint256 id = _create();
        vm.warp(expiry - 2 hours);
        _badProposal(id, T.Outcome.YES, HASH, 2 ether, ProtocolStorage.InvalidTime.selector);
        vm.warp(expiry - 2 hours - 1);
        vm.prank(alice);
        factory.proposeResult{value: 2 ether}(id, T.Outcome.YES, HASH);
        assertEq(factory.getMarket(id).arbitrationDeadline, expiry - 1, "full window reserved");
    }

    function testArbitratorCannotProposeAndProposerCannotSelfChallenge() public {
        uint256 id = _create();
        vm.warp(resolution);
        vm.deal(arbitrator, 10 ether);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.proposeResult{value: 2 ether}(id, T.Outcome.YES, HASH);
        _propose(id, T.Outcome.YES);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
    }

    function testChallengesValidateEvidenceBondAndDeadline() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidEvidence.selector);
        factory.challengeResult{value: 3 ether}(id, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.IncorrectValue.selector);
        factory.challengeResult{value: 3 ether + 1}(id, HASH);
        vm.warp(factory.getMarket(id).challengeDeadline);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        factory.finalizeResult(id);
    }

    function testDisputeRequiresArbitratorAndBlocksDirectFinalization() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(governance);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidOutcome.selector);
        factory.settleDispute(id, T.Outcome.UNRESOLVED, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidEvidence.selector);
        factory.settleDispute(id, T.Outcome.NO, bytes32(0));
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        assertTrue(factory.getMarket(id).finalOutcome == T.Outcome.NO, "independent decision");
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.cancelExpiredMarket(id);
    }

    function testDisputedInvalidDecisionEnablesRefundAndNoFee() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.INVALID, HASH);
        assertTrue(factory.marketState(id) == T.State.CANCELLED, "invalid cancellation");
        assertEq(factory.feeLiability(), 0, "no fee");
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testArbitrationTimeoutIsBoundedAndCannotRaceDecision() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        uint256 deadline = factory.getMarket(id).arbitrationDeadline;
        vm.warp(deadline - 1);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelExpiredMarket(id);
        vm.warp(deadline);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.prank(guardian);
        config.pause();
        factory.cancelExpiredMarket(id);
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testUnproposedAndUnfinalizedMarketsExpireWithRefunds() public {
        uint256 first = _create();
        uint256 second = _create();
        _propose(second, T.Outcome.YES);
        vm.warp(expiry - 1);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelExpiredMarket(first);
        vm.warp(expiry);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.finalizeResult(second);
        factory.cancelExpiredMarket(first);
        factory.cancelExpiredMarket(second);
        assertTrue(
            factory.marketState(first) == T.State.CANCELLED && factory.marketState(second) == T.State.CANCELLED,
            "terminal"
        );
    }

    function testPauseAndDeactivationBlockProposalAndChallengeDeposits() public {
        uint256 first = _create();
        uint256 second = _create();
        _propose(first, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.challengeResult{value: 3 ether}(first, HASH);
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.proposeResult{value: 2 ether}(second, T.Outcome.YES, HASH);
        vm.prank(guardian);
        config.deactivateFinance();
        vm.prank(governance);
        config.unpause();
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.challengeResult{value: 3 ether}(first, HASH);
    }

    function testInterruptedChallengeWindowCannotFinalizeEvenAfterResume() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        vm.prank(governance);
        config.unpause();
        vm.warp(factory.getMarket(id).challengeDeadline);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        vm.warp(expiry);
        factory.cancelExpiredMarket(id);
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testDeactivationInvalidatesUncontestedProposalButDisputesCanSettle() public {
        uint256 id = _create();
        uint256 disputed = _create();
        _propose(id, T.Outcome.YES);
        _propose(disputed, T.Outcome.NO);
        _challenge(disputed);
        vm.prank(guardian);
        config.deactivateFinance();
        _activate();
        vm.warp(factory.getMarket(id).challengeDeadline);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        vm.prank(arbitrator);
        factory.settleDispute(disputed, T.Outcome.YES, HASH);
        assertTrue(factory.marketState(disputed) == T.State.FINALIZED, "arbitration still available");
    }

    function _badProposal(uint256 id, T.Outcome outcome, bytes32 hash, uint256 value, bytes4 err) private {
        vm.prank(alice);
        vm.expectRevert(err);
        factory.proposeResult{value: value}(id, outcome, hash);
    }
}
