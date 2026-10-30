// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolConfig, ProtocolStorage} from "../helpers/OraklTestBase.sol";

contract EmergencyRecoveryTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testFreshApprovalAndFullDelayRequiredToUnpauseAndActivate() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.unpause();
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        uint256 ready = config.activationAfter();
        vm.warp(ready - 1);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.unpause();
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
        vm.warp(ready);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
        vm.prank(governance);
        config.unpause();
        assertFalse(config.financialActive(), "unpause alone does not activate");
        vm.prank(governance);
        config.activateFinance(RELEASE);
        assertTrue(config.financialActive(), "independent delayed local release");
    }

    function testRepeatInterventionRevokesPendingReviewWithoutDelayingOldExit() public {
        expiry = close + 300 days;
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        uint256 first = factory.interruptionRefundTime(id);
        uint64 epoch = config.activityEpoch();
        uint64 at = config.interruptedAt(0);
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        uint256 approvedAt = config.activationAfter();
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(guardian);
        config.pause();
        assertEq(config.activityEpoch(), epoch + 1, "new interruption");
        assertEq(config.interruptedAt(0), at, "first record immutable");
        assertEq(factory.interruptionRefundTime(id), first, "same emergency exit");
        vm.warp(approvedAt);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.unpause();
        factory.cancelInterruptedMarket(id);
    }

    function testAllUnresolvedPhasesQuarantinedAndPrincipalRefundedDuringLongHalt() public {
        expiry = close + 300 days;
        uint256 proposed = _create();
        uint256 disputed = _create();
        uint256 closed = _create();
        for (uint256 i; i < 3; ++i) {
            _predict(i, bob, T.Side.YES, 1 ether);
        }
        _propose(proposed, T.Outcome.YES);
        _propose(disputed, T.Outcome.NO);
        _challenge(disputed);
        // A fresh market is OPEN while the earlier market is CLOSED.
        uint64 c = uint64(block.timestamp + 30 days);
        vm.prank(alice);
        uint256 open = factory.createMarket{value: 5 ether}(HASH, "ipfs://open", c, c, c + 30 days);
        _predict(open, bob, T.Side.NO, 2 ether);
        uint256 originalChallenge = factory.getMarket(proposed).challengeDeadline;
        uint256 originalArbitration = factory.getMarket(disputed).arbitrationDeadline;
        vm.prank(guardian);
        config.pause();
        uint256 ready = factory.interruptionRefundTime(proposed);
        assertGe(ready, originalChallenge, "never shorten promised challenge");
        assertEq(factory.interruptionRefundTime(disputed), originalArbitration, "full dispute period");
        vm.warp(ready - 1);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelInterruptedMarket(proposed);
        vm.warp(ready);
        factory.cancelInterruptedMarket(open);
        factory.cancelInterruptedMarket(closed);
        factory.cancelInterruptedMarket(proposed);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelInterruptedMarket(disputed);
        vm.warp(originalArbitration);
        factory.cancelInterruptedMarket(disputed);
        for (uint256 i; i < 4; ++i) {
            vm.prank(bob);
            factory.claimRefund(i);
            vm.prank(alice);
            factory.claimBond(i, T.BondType.CREATION, alice);
            assertEq(factory.getMarket(i).protocolFee, 0, "emergency has no fee");
        }
        vm.prank(alice);
        factory.claimBond(proposed, T.BondType.PROPOSAL, alice);
        vm.prank(alice);
        factory.claimBond(disputed, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(disputed, T.BondType.CHALLENGE, bob);
        assertEq(factory.totalAccounted(), 0, "all obligations discharged");
        _assertConservation();
    }

    function testResumeCannotRefuelReproposeChallengeOrFinalizeQuarantinedMarkets() public {
        expiry = close + 300 days;
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        _activate();
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.predict{value: 1}(id, T.Side.YES);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.proposeResult{value: 2 ether}(id, T.Outcome.NO, HASH);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        factory.cancelInterruptedMarket(id);
        uint256 next = _create();
        _predict(next, bob, T.Side.YES, 1 ether);
        _assertConservation();
    }

    function testAlreadyFinalizedOutcomeAndClaimsUnaffectedByAllInterventions() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _finalize(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        vm.prank(compliance);
        config.deactivateFinance();
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.cancelInterruptedMarket(id);
        vm.prank(bob);
        factory.claim(id);
        assertTrue(factory.getMarket(id).finalOutcome == T.Outcome.YES, "immutable outcome");
        _assertConservation();
    }

    function testEmergencyDeadlineCappedAtOriginalMaxAndZeroBondCases() public {
        T.Parameters memory p = config.parameters();
        p.creationBond = 0;
        p.proposalBond = 0;
        p.challengeBond = 0;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1);
        _propose(id, T.Outcome.INVALID);
        uint256 max = factory.getMarket(id).maxResolutionTime;
        vm.warp(max - 1);
        vm.prank(guardian);
        config.pause();
        assertEq(factory.interruptionRefundTime(id), max, "never extend max");
        vm.warp(max);
        factory.cancelInterruptedMarket(id);
        vm.prank(bob);
        factory.claimRefund(id);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        _assertConservation();
    }

    function testNoEmergencyCancellationWithoutInterruptionAndNoArbitraryDecision() public {
        uint256 id = _create();
        assertEq(factory.interruptionRefundTime(id), 0, "not interrupted");
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.cancelInterruptedMarket(id);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
    }

    function testFuzzFirstExitDoesNotMove(uint8 countSeed, uint32 deltaSeed) public {
        expiry = close + 300 days;
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        uint256 first = factory.interruptionRefundTime(id);
        for (uint256 i; i < 1 + countSeed % 8; ++i) {
            vm.warp(block.timestamp + bound(deltaSeed, 1, 100));
            vm.prank(guardian);
            config.pause();
            assertEq(factory.interruptionRefundTime(id), first, "bounded independent of further interruptions");
        }
        if (block.timestamp < first) vm.warp(first);
        factory.cancelInterruptedMarket(id);
        _assertConservation();
    }

    function testCannotReplaceLiveReleaseApprovalWithoutInterruption() public {
        bytes32 previous = config.approvedDigest();
        vm.prank(compliance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.approveRelease(HASH);
        assertTrue(config.approvedDigest() == previous, "live approval not overwritten");
    }
}
