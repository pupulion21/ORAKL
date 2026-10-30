// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {P0_3TestBase, T, ProtocolStorage, ProtocolConfig, EvidenceLogVm} from "./P0_3TestBase.sol";
import {AdversarialReceiver} from "../unit/BondsAndTransfers.t.sol";

contract P0_3EvidenceTest is P0_3TestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deployMutable(true);
    }

    function testSpamAndDuplicateCommitmentsCannotExhaustEvidenceSlots() public {
        uint256 id = _create();
        _propose(id, T.Outcome.NO);
        _challenge(id);
        bytes32 before = keccak256(abi.encode(factory.getMarket(id)));
        uint256 liabilities = factory.totalAccounted();
        logVm.recordLogs();
        for (uint256 i; i < 512; ++i) {
            bytes32 commitment = i % 2 == 0 ? HASH : keccak256(abi.encode(i));
            vm.prank(bob);
            factory.submitEvidence{gas: 60_000}(id, commitment);
        }
        assertTrue(_submit(id, observer, HASH), "independent evidence accepted after attacker spam");
        EvidenceLogVm.Log[] memory logs = logVm.getRecordedLogs();
        assertEq(logs.length, 513, "every log has deterministic transaction log position");
        _assertEvidenceLog(logs[0], id, bob, HASH);
        _assertEvidenceLog(logs[2], id, bob, HASH);
        _assertEvidenceLog(logs[512], id, observer, HASH);
        assertTrue(keccak256(abi.encode(factory.getMarket(id))) == before, "no stored evidence list/counter or cap");
        assertEq(factory.totalAccounted(), liabilities, "gas-funded spam creates no entitlements");
        _waitForArbitration(id);
        vm.prank(arbitrator);
        factory.settleDispute{gas: 500_000}(id, T.Outcome.INVALID, HASH);
        _assertConservation();
    }

    function testEvidenceIntakeSurvivesPauseDeactivationAndRepeatedInterruptions() public {
        uint256 proposed = _create();
        uint256 disputed = _create();
        _propose(proposed, T.Outcome.YES);
        _propose(disputed, T.Outcome.NO);
        _challenge(disputed);
        uint256 challengeAt = factory.getMarket(proposed).challengeDeadline;
        uint256 arbitrationAt = factory.getMarket(disputed).arbitrationDeadline;
        vm.prank(guardian);
        config.pause();
        uint256 firstExit = factory.interruptionRefundTime(proposed);
        vm.prank(compliance);
        config.deactivateFinance();
        vm.prank(guardian);
        config.pause();
        g.setFault(2);
        c.setFault(4);
        a.setFault(1);
        assertTrue(_submit(proposed, observer, HASH), "paused proposed evidence");
        assertTrue(_submit(disputed, carol, HASH), "paused disputed evidence");
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.challengeResult{value: 3 ether}(proposed, HASH);
        vm.warp(challengeAt - 1);
        vm.prank(observer);
        factory.submitEvidence{gas: 60_000}(disputed, HASH);
        assertEq(factory.interruptionRefundTime(proposed), firstExit, "first emergency exit unchanged");
        assertEq(factory.getMarket(disputed).arbitrationDeadline, arbitrationAt, "full original arbitration exit");
        vm.warp(challengeAt);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.submitEvidence(disputed, HASH);
        factory.cancelInterruptedMarket(proposed);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelInterruptedMarket(disputed);
        vm.warp(arbitrationAt);
        factory.cancelInterruptedMarket(disputed);
        vm.prank(alice);
        factory.claimBond(proposed, T.BondType.CREATION, alice);
        vm.prank(bob);
        factory.claimBond(disputed, T.BondType.CHALLENGE, bob);
        _assertConservation();
    }

    function testEvidenceRejectsUnknownOpenClosedAndZeroCommitments() public {
        vm.expectRevert(ProtocolStorage.MarketNotFound.selector);
        factory.submitEvidence(0, HASH);
        uint256 id = _create();
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.submitEvidence(id, HASH);
        vm.warp(close);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.submitEvidence(id, HASH);
        _propose(id, T.Outcome.YES);
        vm.expectRevert(ProtocolStorage.InvalidEvidence.selector);
        factory.submitEvidence(id, bytes32(0));
        _assertConservation();
    }

    function testEvidenceIsNonpayableAndMalformedCallsDoNotFundAnything() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        uint256 before = address(factory).balance;
        vm.prank(observer);
        (bool paid,) = address(factory).call{value: 1}(abi.encodeCall(factory.submitEvidence, (id, HASH)));
        (bool short,) = address(factory).call(abi.encodePacked(factory.submitEvidence.selector));
        assertFalse(paid || short, "no value-bearing or malformed evidence path");
        assertEq(address(factory).balance, before, "no alternate funding entry");
        _assertConservation();
    }

    function testEvidencePermissionlessWithImmutableMarketAndContributorProvenance() public {
        uint256 first = _create();
        uint256 second = _create();
        _propose(first, T.Outcome.YES);
        _propose(second, T.Outcome.NO);
        address[5] memory submitters = [alice, bob, observer, governance, arbitrator];
        logVm.recordLogs();
        for (uint256 i; i < submitters.length; ++i) {
            assertTrue(_submit(i % 2, submitters[i], HASH), "permissionless fixed-word evidence");
        }
        EvidenceLogVm.Log[] memory logs = logVm.getRecordedLogs();
        assertEq(logs.length, 5, "one event per successful call");
        for (uint256 i; i < logs.length; ++i) {
            _assertEvidenceLog(logs[i], i % 2, submitters[i], HASH);
        }
        assertEq(factory.bondLiability(), 14 ether, "only creation and proposal principals");
        _assertConservation();
    }

    function testEvidenceAloneDoesNotGrantEconomicObjectionOrSettlementAuthority() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.YES);
        assertTrue(_submit(id, observer, HASH), "unbonded evidence recorded");
        assertEq(factory.getBond(id, T.BondType.CHALLENGE).owner, address(0), "no reward or bond fabricated");
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        _waitForArbitration(id);
        factory.finalizeResult(id);
        assertFalse(factory.getMarket(id).refundable, "only formal challenge stops optimistic settlement");
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.claimBond(id, T.BondType.CHALLENGE, observer);
        _assertConservation();
    }

    function testEvidenceEndBoundaryAndTerminalFinality() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        uint256 deadline = factory.getMarket(id).challengeDeadline;
        vm.warp(deadline - 1);
        assertTrue(_submit(id, observer, HASH), "window includes final second before boundary");
        vm.warp(deadline);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.submitEvidence(id, HASH);
        factory.finalizeResult(id);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.submitEvidence(id, HASH);
    }

    function testNativeCallbackCannotReenterEvidenceAcrossMarkets() public {
        AdversarialReceiver receiver = new AdversarialReceiver(factory);
        vm.deal(address(receiver), 100 ether);
        uint256 paid = _create();
        receiver.invoke(abi.encodeCall(factory.predict, (paid, T.Side.YES)), 10 ether);
        _finalize(paid, T.Outcome.YES);
        uint256 evidence = _create();
        _propose(evidence, T.Outcome.NO);
        receiver.setBehavior(false, true, abi.encodeCall(factory.submitEvidence, (evidence, HASH)));
        receiver.invoke(abi.encodeCall(factory.claim, (paid)), 0);
        assertTrue(receiver.blocked(), "same facade guard covers evidence callbacks");
        assertTrue(receiver.reason() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "explicit guard error");
        assertEq(factory.getMarket(paid).paidOut, 9.8 ether, "one valid withdrawal");
        receiver.setBehavior(false, false, "");
        receiver.invoke(abi.encodeCall(factory.submitEvidence, (evidence, HASH)), 0);
        _assertConservation();
    }

    function testForcedBalanceAndEvidenceCannotAlterPayoutDenominators() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 10 ether);
        _predict(id, carol, T.Side.NO, 20 ether);
        _propose(id, T.Outcome.YES);
        vm.deal(address(factory), address(factory).balance + 123);
        assertTrue(_submit(id, observer, HASH), "evidence despite surplus");
        _waitForArbitration(id);
        factory.finalizeResult(id);
        (uint256 quoted,) = factory.getClaimable(id, bob);
        assertEq(quoted, 29.4 ether, "fixed pool accounting ignores surplus/evidence");
        assertEq(factory.unaccountedBalance(), 123, "forced balance remains unallocated");
        _assertConservation();
    }

    function testFuzzEvidenceWindowAndDuplicateCommitments(uint8 timeSeed, bool disputed, bool validHash) public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        if (disputed) _challenge(id);
        uint256 deadline = factory.getMarket(id).challengeDeadline;
        uint256 at = deadline - 1 + timeSeed % 3;
        vm.warp(at);
        bytes32 commitment = validHash ? HASH : bytes32(0);
        bytes32 before = keccak256(abi.encode(factory.getMarket(id)));
        bool first = _submit(id, observer, commitment);
        bool second = _submit(id, observer, commitment);
        assertEq(first, at < deadline && validHash, "exclusive timestamp and nonzero hash");
        assertEq(second, first, "duplicate entry cannot corrupt/deduplicate away independent logs");
        assertTrue(keccak256(abi.encode(factory.getMarket(id))) == before, "intake has no stored market effect");
        _assertConservation();
    }
}
