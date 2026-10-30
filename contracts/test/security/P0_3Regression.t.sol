// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {P0_3TestBase, T, ProtocolStorage, MutableMultisig, EvidenceLogVm} from "./P0_3TestBase.sol";

/// @dev Each test was executed and failed against unchanged P0.2 production source before the correction.
contract P0_3RegressionTest is P0_3TestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deployMutable(true);
    }

    function testIndependentEvidenceRemainsOpenAfterCapturedFirstChallenge() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.NO);
        _challenge(id); // Alice and Bob can share beneficial control; no identity assumption.
        bytes32 beforeMarket = keccak256(abi.encode(factory.getMarket(id)));
        uint256 beforeLiabilities = factory.totalAccounted();
        logVm.recordLogs();
        assertTrue(_submit(id, observer, HASH), "captured challenge cannot close independent evidence intake");
        EvidenceLogVm.Log[] memory entries = logVm.getRecordedLogs();
        assertEq(entries.length, 1, "one deterministic evidence event");
        _assertEvidenceLog(entries[0], id, observer, HASH);
        assertTrue(
            keccak256(abi.encode(factory.getMarket(id))) == beforeMarket, "evidence changes no market terms/state"
        );
        assertEq(factory.totalAccounted(), beforeLiabilities, "no collateral or bond reward from evidence");
        assertEq(factory.getBond(id, T.BondType.CHALLENGE).owner, bob, "first bond ownership unchanged");
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        _assertConservation();
    }

    function testIndependentEvidenceAcceptedBeforeFirstChallenge() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        assertTrue(_submit(id, observer, HASH), "PROPOSED evidence intake exists");
        assertEq(uint256(factory.marketState(id)), uint256(T.State.PROPOSED), "unbonded evidence is not a challenge");
        _assertConservation();
    }

    function testEarlyDisputedDecisionRejectedUntilOriginalChallengeBoundary() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        T.Market memory original = factory.getMarket(id);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.warp(original.challengeDeadline - 1);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.settleDispute(id, T.Outcome.INVALID, HASH);
        assertTrue(_submit(id, observer, HASH), "intake remains open one second before boundary");
        vm.warp(original.challengeDeadline);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        assertEq(uint256(factory.marketState(id)), uint256(T.State.FINALIZED), "decision at exact boundary");
        assertEq(factory.getMarket(id).arbitrationDeadline, original.arbitrationDeadline, "upper bound never extended");
        _assertConservation();
    }

    function testGovernanceDriftCannotVetoExistingChallenge() public {
        _challengeDuringOwnerDrift(0);
    }

    function testComplianceDriftCannotVetoExistingChallenge() public {
        _challengeDuringOwnerDrift(1);
    }

    function testArbitratorDriftCannotVetoExistingChallenge() public {
        _challengeDuringOwnerDrift(2);
    }

    function testRevertingMalformedGasBurningRoleViewsCannotVetoChallenges() public {
        for (uint256 role; role < 3; ++role) {
            for (uint8 fault = 1; fault <= 5; ++fault) {
                uint256 id = _create();
                _propose(id, T.Outcome.YES);
                MutableMultisig wallet = _role(role);
                wallet.setFault(fault);
                vm.prank(bob);
                factory.challengeResult{value: 3 ether, gas: 400_000}(id, HASH);
                assertEq(uint256(factory.marketState(id)), uint256(T.State.DISPUTED), "no live role getter veto");
                assertTrue(_submit(id, observer, HASH), "evidence independent of role getters");
                wallet.setFault(0);
                _assertConservation();
            }
        }
    }

    function testRestoringRoleAfterFailedBadValueAttemptCannotFinalizeAnAcceptedObjection() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.NO);
        g.setOwner(0, address(1099));
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.IncorrectValue.selector);
        factory.challengeResult{value: 1}(id, HASH);
        assertEq(factory.getBond(id, T.BondType.CHALLENGE).owner, address(0), "failed value creates no entitlement");
        vm.prank(bob);
        factory.challengeResult{value: 3 ether}(id, HASH);
        uint256 originalEpoch = config.activityEpoch();
        _waitForArbitration(id);
        g.setOwner(0, address(100));
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        assertEq(config.activityEpoch(), originalEpoch, "no drift observer required for objection persistence");
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        _assertConservation();
    }

    function _challengeDuringOwnerDrift(uint256 role) private {
        uint256 id = _create();
        _propose(id, T.Outcome.NO);
        _role(role).setOwner(0, address(uint160(1000 + role)));
        vm.prank(bob);
        factory.challengeResult{value: 3 ether}(id, HASH);
        assertEq(factory.getBond(id, T.BondType.CHALLENGE).owner, bob, "valid caller owns one exact bond");
        _waitForArbitration(id);
        _role(role).setOwner(0, address(uint160(100 + 100 * role)));
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        assertEq(uint256(factory.marketState(id)), uint256(T.State.DISPUTED), "restoration cannot erase objection");
        _assertConservation();
    }
}
