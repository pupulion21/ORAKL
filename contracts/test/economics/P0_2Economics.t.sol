// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    OraklTestBase,
    T,
    ProtocolStorage,
    ProtocolConfig,
    MarketFactory,
    IProtocolConfig
} from "../helpers/OraklTestBase.sol";
import {AdversarialReceiver} from "../unit/BondsAndTransfers.t.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

/// @dev These tests preserve full bond returns. Residual tests demonstrate trust/economic limits, not fixes.
contract P0_2EconomicsTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testTinyFalseWinningPositionCanReceiveAlmostEntirePool_RESIDUAL() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 999 ether);
        _predict(id, alice, T.Side.NO, 1 ether);
        // No monitor challenges a dishonest answer. The contract cannot infer real-world truth.
        _finalize(id, T.Outcome.NO);
        (uint256 amount,) = factory.getClaimable(id, alice);
        assertEq(amount, 980 ether, "1 native unit position receives 98 percent of whole pool");
        vm.prank(alice);
        factory.claim(id);
        assertEq(factory.totalFeesAccrued(), 20 ether, "fee computed on entire contribution pool");
        _assertConservation();
    }

    function testOneSidedValidResultPaysFeeWhileInvalidRefundsAll_RESIDUAL() public {
        uint256 valid = _create();
        uint256 invalid = _create();
        _predict(valid, bob, T.Side.YES, 1000 ether);
        _predict(invalid, bob, T.Side.YES, 1000 ether);
        _propose(valid, T.Outcome.YES);
        _propose(invalid, T.Outcome.INVALID);
        vm.warp(factory.getMarket(valid).challengeDeadline);
        factory.finalizeResult(valid);
        factory.finalizeResult(invalid);
        (uint256 payout,) = factory.getClaimable(valid, bob);
        (, uint256 refund) = factory.getClaimable(invalid, bob);
        assertEq(payout, 980 ether, "own capital is fee-bearing");
        assertEq(refund, 1000 ether, "invalid does not charge fee");
        assertEq(factory.getMarket(invalid).protocolFee, 0, "no fee on invalidity");
        _assertConservation();
    }

    function testFirstChallengerCapturesSlotButCannotBypassArbitrator_RESIDUAL() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.NO);
        _challenge(id); // Bob can be Alice's second wallet; address inequality proves no independence.
        vm.prank(carol);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.challengeResult{value: 3 ether}(id, keccak256("independent corrective evidence"));
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.YES, keccak256("independent decision evidence"));
        _claimAllBonds(id);
        assertEq(factory.totalBondsPaid(), 10 ether, "coalition bonds all returned under executable policy");
        _assertConservation();
    }

    function testArbitratorMayResolveImmediatelyAfterCapturedChallenge_RESIDUAL() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        assertLt(block.timestamp, factory.getMarket(id).challengeDeadline, "original challenge window still open");
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        assertEq(uint256(factory.marketState(id)), uint256(T.State.FINALIZED), "trusted adjudication can be immediate");
        // A minimum independent evidence-intake/appeal delay is NOT implemented or silently introduced.
        _assertConservation();
    }

    function testFullReturnMatrixAllProposalAndArbitrationOutcomes() public {
        for (uint8 proposed = 1; proposed <= 3; ++proposed) {
            for (uint8 decision = 1; decision <= 3; ++decision) {
                uint256 id = _create();
                _predict(id, bob, T.Side.YES, 6 ether);
                _predict(id, carol, T.Side.NO, 4 ether);
                _propose(id, T.Outcome(proposed));
                _challenge(id);
                vm.prank(arbitrator);
                factory.settleDispute(id, T.Outcome(decision), HASH);
                uint256 outstanding = factory.bondLiability();
                _claimAllBonds(id);
                assertEq(factory.bondLiability(), outstanding - 10 ether, "all nine cases return owner principals");
                bool invalid = decision == 3;
                assertEq(factory.getMarket(id).refundable, invalid, "binary winners nonempty");
                assertEq(
                    factory.getMarket(id).protocolFee, invalid ? 0 : 0.2 ether, "fee depends on final decision only"
                );
                _assertConservation();
            }
        }
    }

    function testRepeatedEmptyCreationRecyclesBondWithoutPermanentSpamCost_RESIDUAL() public {
        uint256 balanceBefore = alice.balance;
        for (uint256 i; i < 6; ++i) {
            uint256 id = _create();
            vm.warp(factory.getMarket(id).maxResolutionTime);
            factory.cancelExpiredMarket(id);
            vm.prank(alice);
            factory.claimBond(id, T.BondType.CREATION, alice);
        }
        assertEq(factory.marketCount(), 6, "creation permissionless and repeatable");
        assertEq(alice.balance, balanceBefore, "principal recycles; VM excludes real transaction gas");
        assertEq(factory.totalAccounted(), 0, "no permanent protocol creation charge");
    }

    function testPerMarketCapDoesNotEnforceAggregateExposure_RESIDUAL() public {
        T.Parameters memory terms = config.parameters();
        terms.poolCap = 10 ether;
        vm.prank(governance);
        config.setParameters(terms);
        _activate();
        for (uint256 i; i < 4; ++i) {
            uint256 id = _create();
            _predict(id, bob, T.Side.YES, 10 ether);
        }
        assertEq(factory.participantLiability(), 40 ether, "shared arbitrator exposure exceeds one market cap");
        _assertConservation();
    }

    function testUint128CapBoundaryAndMultipleBothSideContributions() public {
        uint256 id = _create();
        uint256 cap = type(uint128).max;
        vm.deal(bob, cap + 1);
        _predict(id, bob, T.Side.YES, cap - 2);
        _predict(id, bob, T.Side.YES, 1);
        _predict(id, bob, T.Side.NO, 1);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.PoolCapExceeded.selector);
        factory.predict{value: 1}(id, T.Side.NO);
        _finalize(id, T.Outcome.YES);
        (uint256 payout,) = factory.getClaimable(id, bob);
        assertEq(payout, cap - cap * 200 / 10_000, "full range fixed denominator payout");
        vm.prank(bob);
        factory.claim(id);
        assertEq(factory.participantLiability(), 0, "only winner receives all distributable collateral");
        _assertConservation();
    }

    function testSmallestUnitRoundingReservesDustAcrossMixedMarkets() public {
        uint256 resolved = _create();
        uint256 refundable = _create();
        _predict(resolved, alice, T.Side.YES, 1);
        _predict(resolved, bob, T.Side.YES, 1);
        _predict(resolved, carol, T.Side.NO, 1);
        _predict(refundable, carol, T.Side.NO, 7);
        _propose(resolved, T.Outcome.YES);
        _propose(refundable, T.Outcome.YES); // Empty winner: FINALIZED + refundable, not CANCELLED.
        vm.warp(factory.getMarket(resolved).challengeDeadline);
        factory.finalizeResult(resolved);
        factory.finalizeResult(refundable);
        vm.prank(alice);
        factory.claim(resolved);
        vm.prank(bob);
        factory.claim(resolved);
        vm.prank(carol);
        factory.claimRefund(refundable);
        assertEq(factory.participantLiability(), 1, "rounding residual remains a participant reserve");
        assertEq(factory.feeLiability(), 0, "fee floors to zero");
        assertEq(factory.getMarket(refundable).refunded, 7, "separate market refunds isolated");
        assertEq(
            uint256(factory.marketState(refundable)), uint256(T.State.FINALIZED), "refund does not imply cancelled"
        );
        _assertConservation();
    }

    function testAllTermsAndEvidenceRemainCommittedThroughEmergencyArbitration() public {
        uint256 id = _create();
        T.Market memory before = factory.getMarket(id);
        bytes32 proposal = keccak256("public proposal bytes");
        bytes32 challenge = keccak256("public objection bytes");
        bytes32 decision = keccak256("public decision bytes");
        vm.warp(resolution);
        vm.prank(alice);
        factory.proposeResult{value: 2 ether}(id, T.Outcome.INVALID, proposal);
        vm.prank(bob);
        factory.challengeResult{value: 3 ether}(id, challenge);
        T.Parameters memory next = config.parameters();
        next.feeBps = 1000;
        next.creationBond = 0;
        next.proposalBond = 0;
        next.challengeBond = 0;
        next.minContribution = 100;
        next.poolCap = 100;
        next.challengePeriod = 7 days;
        next.arbitrationPeriod = 30 days;
        vm.prank(governance);
        config.setParameters(next);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.YES, decision);
        T.Market memory after_ = factory.getMarket(id);
        assertTrue(
            keccak256(abi.encode(before.terms)) == keccak256(abi.encode(after_.terms)), "all nine terms immutable"
        );
        assertEq(after_.metadataURI, before.metadataURI, "URI immutable");
        assertTrue(after_.metadataHash == before.metadataHash, "metadata commitment immutable");
        assertTrue(after_.arbitratorFingerprint == before.arbitratorFingerprint, "old arbiter identity");
        assertEq(after_.closeTime, before.closeTime, "close immutable");
        assertEq(after_.resolutionTime, before.resolutionTime, "resolution immutable");
        assertEq(after_.maxResolutionTime, before.maxResolutionTime, "maximum immutable");
        assertTrue(after_.proposalEvidence == proposal && after_.challengeEvidence == challenge, "distinct evidence");
        assertTrue(after_.decisionEvidence == decision, "decision commitment");
        _claimAllBonds(id);
        _assertConservation();
    }

    function testNonzeroCommitmentDoesNotProveEvidenceAvailability_RESIDUAL() public {
        uint256 id = _create();
        vm.warp(resolution);
        vm.prank(alice);
        factory.proposeResult{value: 2 ether}(id, T.Outcome.YES, bytes32(uint256(1)));
        assertTrue(factory.getMarket(id).proposalEvidence == bytes32(uint256(1)), "hash presence only");
        // No claim of content retrieval, real-world correctness, CID validation or backend availability.
    }

    function testRevertingArbitratorCannotBlockParticipantOrBondRefundAfterTimeout() public {
        MutableMultisig mutableArb = new MutableMultisig(700, 2);
        T.Parameters memory terms = config.parameters();
        terms.arbitrator = address(mutableArb);
        vm.prank(governance);
        config.setParameters(terms);
        _activate();
        uint256 id = _create();
        _predict(id, carol, T.Side.NO, 123);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        mutableArb.setFault(1);
        vm.prank(address(mutableArb));
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.warp(factory.getMarket(id).arbitrationDeadline);
        factory.cancelExpiredMarket(id);
        vm.prank(carol);
        factory.claimRefund(id);
        _claimAllBonds(id);
        assertEq(factory.totalAccounted(), 0, "withdrawal exit never queries reverting role getters");
        assertEq(factory.totalFeesAccrued(), 0, "timeout fee zero");
        _assertConservation();
    }

    function testRestoredRoleViewsDoNotProveUninterruptedChallengeAvailability_RESIDUAL() public {
        MutableMultisig mutableGov = new MutableMultisig(100, 2);
        governance = address(mutableGov);
        T.Parameters memory terms = config.parameters();
        config = new ProtocolConfig(governance, compliance, guardian, terms);
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        config.bindFactory(address(factory));
        _activate();
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.NO);
        uint256 originalEpoch = config.activityEpoch();
        mutableGov.setOwner(0, address(1099));
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        // No independently funded observer reports the drift before the old control views return.
        // A reverted challenge cannot persist an interruption; real-world truth is not observable on-chain.
        vm.warp(factory.getMarket(id).challengeDeadline);
        mutableGov.setOwner(0, address(100));
        factory.finalizeResult(id);
        assertEq(config.activityEpoch(), originalEpoch, "unreported transient drift leaves no protocol history");
        assertEq(uint256(factory.getMarket(id).finalOutcome), uint256(T.Outcome.NO), "restored current views pass");
        _assertConservation();
    }

    function testRejectedBondTransferThenCrossMarketReentrancyRemainsIsolated() public {
        AdversarialReceiver receiver = new AdversarialReceiver(factory);
        vm.deal(address(receiver), 100 ether);
        uint256 first = _create();
        uint256 second = _create();
        receiver.invoke(abi.encodeCall(factory.predict, (first, T.Side.YES)), 10 ether);
        receiver.invoke(abi.encodeCall(factory.predict, (second, T.Side.NO)), 20 ether);
        _propose(first, T.Outcome.YES);
        _propose(second, T.Outcome.INVALID);
        vm.warp(factory.getMarket(first).challengeDeadline);
        factory.finalizeResult(first);
        factory.finalizeResult(second);
        receiver.setBehavior(true, false, "");
        uint256 before = factory.totalAccounted();
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        factory.claimBond(first, T.BondType.CREATION, address(receiver));
        assertEq(factory.totalAccounted(), before, "failed bond transfer fully rolled back");
        receiver.setBehavior(false, true, abi.encodeCall(factory.claimRefund, (second)));
        receiver.invoke(abi.encodeCall(factory.claim, (first)), 0);
        assertTrue(receiver.blocked(), "cross-market nested refund blocked");
        assertFalse(factory.getPosition(second, address(receiver)).settled, "second entitlement unaffected");
        receiver.setBehavior(false, false, "");
        receiver.invoke(abi.encodeCall(factory.claimRefundTo, (second, bob)), 0);
        _assertConservation();
    }

    function testFuzzSameBlockPauseAndCancellationOrder(uint8 stateSeed, bool ordinaryFirst) public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        if (stateSeed % 3 != 0) _propose(id, T.Outcome.YES);
        if (stateSeed % 3 == 2) _challenge(id);
        vm.prank(guardian);
        config.pause();
        T.Market memory m = factory.getMarket(id);
        vm.warp(m.storedState == T.State.DISPUTED ? m.arbitrationDeadline : m.maxResolutionTime);
        if (ordinaryFirst) factory.cancelExpiredMarket(id);
        else factory.cancelInterruptedMarket(id);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        if (ordinaryFirst) factory.cancelInterruptedMarket(id);
        else factory.cancelExpiredMarket(id);
        vm.prank(carol);
        factory.claimRefund(id);
        assertEq(factory.totalFeesAccrued(), 0, "exactly one refund path; no fee at either boundary");
        assertEq(factory.getMarket(id).refunded, 10 ether, "principal refunded once");
        _assertConservation();
    }

    function testFuzzZeroAndPositiveBondMatrix(uint8 pSeed, uint8 cSeed, uint8 outcomeSeed) public {
        T.Parameters memory terms = config.parameters();
        terms.proposalBond = pSeed % 2 == 0 ? 0 : 2 ether;
        terms.challengeBond = cSeed % 2 == 0 ? 0 : 3 ether;
        vm.prank(governance);
        config.setParameters(terms);
        _activate();
        uint256 id = _create();
        _propose(id, T.Outcome.INVALID);
        _challenge(id);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome(1 + outcomeSeed % 3), HASH);
        _claimAllBonds(id);
        assertEq(factory.totalBondsPaid(), 5 ether + terms.proposalBond + terms.challengeBond, "no implicit slash");
        assertEq(factory.totalAccounted(), 0, "zero participation, zero fee, all bonds released");
        _assertConservation();
    }

    function _claimAllBonds(uint256 id) private {
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(id, T.BondType.CHALLENGE, bob);
    }
}
