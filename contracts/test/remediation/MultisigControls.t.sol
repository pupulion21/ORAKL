// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    OraklTestBase,
    T,
    ProtocolConfig,
    MarketFactory,
    IProtocolConfig,
    ProtocolStorage
} from "../helpers/OraklTestBase.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

contract MultisigControlsTest is OraklTestBase {
    MutableMultisig internal g;
    MutableMultisig internal c;
    MutableMultisig internal a;

    function setUp() public {
        vm.warp(1_800_000_000);
        _mutableDeploy(2);
    }

    function _mutableDeploy(uint256 count) private {
        g = new MutableMultisig(100, count);
        c = new MutableMultisig(200, count);
        a = new MutableMultisig(300, count);
        governance = address(g);
        compliance = address(c);
        arbitrator = address(a);
        config = new ProtocolConfig(
            governance,
            compliance,
            guardian,
            T.Parameters(200, 5 ether, 2 ether, 3 ether, 1, type(uint128).max, 1 hours, 1 hours, arbitrator)
        );
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        config.bindFactory(address(factory));
        _activate();
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 3 hours;
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(carol, 1e30);
    }

    function testSignerDriftBeforeActivationInvalidatesApprovalAndDelay() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        uint256 ready = config.activationAfter();
        g.setOwner(1, address(500));
        vm.warp(ready);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.unpause();
        _activate();
        assertTrue(config.financialActive(), "new declared control reviewed after full delay");
    }

    function testThresholdDowngradeBlocksDepositsAndPermissionlessReportEnablesExit() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        g.setThreshold(1);
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        factory.predict{value: 1}(id, T.Side.YES);
        config.reportRoleDrift();
        assertFalse(config.financialActive(), "fail closed");
        vm.warp(factory.interruptionRefundTime(id));
        factory.cancelInterruptedMarket(id);
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testOverlappingOwnersOrGuardianOwnerFailClosed() public {
        g.setOwner(0, address(200));
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.currentRoleState();
        g.setOwner(0, guardian);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.currentRoleState();
    }

    function testArbitratorRotationBlocksDisputeDecisionButPreservesTimeout() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        a.setOwner(1, address(600));
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.warp(factory.getMarket(id).arbitrationDeadline);
        factory.cancelExpiredMarket(id);
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testControlDriftBlocksUncontestedFinalizationAndFees() public {
        uint256 finalized = _create();
        uint256 proposed = _create();
        _predict(finalized, bob, T.Side.YES, 1 ether);
        _propose(finalized, T.Outcome.YES);
        _propose(proposed, T.Outcome.NO);
        vm.warp(factory.getMarket(finalized).challengeDeadline);
        factory.finalizeResult(finalized);
        c.setOwner(1, address(700));
        vm.warp(factory.getMarket(proposed).challengeDeadline);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.finalizeResult(proposed);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.withdrawProtocolFees(1, alice);
        vm.prank(bob); // Payouts do not query wallet views.
        factory.claim(finalized);
        config.reportRoleDrift();
        _assertConservation();
    }

    function testRevertingGasBurningOversizedMalformedViewsCanBeReportedSafely() public {
        for (uint8 fault = 1; fault <= 5; ++fault) {
            _mutableDeploy(2);
            uint256 id = _create();
            _predict(id, bob, T.Side.YES, 1);
            g.setFault(fault);
            config.reportRoleDrift();
            vm.warp(factory.interruptionRefundTime(id));
            factory.cancelInterruptedMarket(id);
            vm.prank(bob);
            factory.claimRefund(id);
            vm.prank(alice);
            factory.claimBond(id, T.BondType.CREATION, alice);
            _assertConservation();
        }
    }

    function testGasStarvationCannotManufactureRoleDrift() public {
        uint64 epoch = config.activityEpoch();
        (bool ok, bytes memory result) = address(config).call{gas: 500_000}(abi.encodeCall(config.reportRoleDrift, ()));
        assertFalse(ok, "insufficient validation budget rejected");
        assertTrue(bytes4(result) == ProtocolConfig.InsufficientCheckGas.selector, "explicit gas guard");
        assertEq(config.activityEpoch(), epoch, "no false interruption");
        assertTrue(config.financialActive(), "still active");
        vm.expectRevert(ProtocolConfig.ControlUnchanged.selector);
        config.reportRoleDrift();
    }

    function testMaximumDeclaredOwnerSetsFitReporterBudgetWithoutFalsePositive() public {
        _mutableDeploy(32);
        vm.expectRevert(ProtocolConfig.ControlUnchanged.selector);
        config.reportRoleDrift();
        a.setOwner(31, address(900));
        config.reportRoleDrift();
        assertFalse(config.financialActive(), "actual drift detected");
    }

    function testHiddenModulesGuardsAndImplementationCanEvadeViewFingerprint_RESIDUAL() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        bytes32 before = config.roleFingerprint(arbitrator);
        a.installHiddenModule(carol);
        a.setGuardMarker(address(900));
        a.setImplementationMarker(address(901));
        assertTrue(config.roleFingerprint(arbitrator) == before, "declared views cannot prove execution policy");
        vm.prank(carol);
        a.executeFromHiddenModule(address(factory), abi.encodeCall(factory.settleDispute, (id, T.Outcome.NO, HASH)));
        assertTrue(
            factory.getMarket(id).finalOutcome == T.Outcome.NO, "admitted lying wallet remains trusted authority"
        );
        // Deliberate adversarial proof of an operational blocker, not a claimed fixed vulnerability.
    }

    function testInvalidObservableMultisigCannotReceiveFreshApproval() public {
        vm.prank(guardian);
        config.pause();
        a.setThreshold(1);
        vm.prank(compliance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.approveRelease(RELEASE);
    }

    function testFuzzReporterGasCannotCreateFalseDrift(uint32 gasSeed) public {
        uint64 epoch = config.activityEpoch();
        (bool ok,) = address(config).call{gas: bound(gasSeed, 1, 3_000_000)}(abi.encodeCall(config.reportRoleDrift, ()));
        assertFalse(ok, "healthy state always rejects a drift report");
        assertEq(config.activityEpoch(), epoch, "caller gas cannot manufacture an interruption");
        assertTrue(config.financialActive(), "honest live state retained");
    }

    function testOversizedReturnRejectedWithinBoundedCallerBudget() public {
        g.setFault(3);
        (bool ok, bytes memory reason) =
            address(config).staticcall{gas: 30_000}(abi.encodeCall(config.roleFingerprint, (governance)));
        assertFalse(ok, "oversized return rejects");
        assertTrue(
            bytes4(reason) == ProtocolConfig.InvalidMultisig.selector,
            "bounded copy retains controlled error without caller exhaustion"
        );
    }
}
