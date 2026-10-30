// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {P0_3TestBase, T, ProtocolStorage, ProtocolConfig, MarketFactory, IProtocolConfig} from "./P0_3TestBase.sol";
import {
    GuardedArbitratorMock,
    MutableProxyWalletMock,
    RestrictedWalletExecutionMock,
    OpenWalletExecutionMock,
    SharedControllerWalletMock
} from "./ArbitrationDoubles.sol";

contract P0_3ArbitrationTest is P0_3TestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deployMutable(true);
    }

    function testPausedDisputeMustWaitThenCanHonorOriginalArbitrationAuthority() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        uint256 challengeAt = factory.getMarket(id).challengeDeadline;
        uint256 arbitrationAt = factory.getMarket(id).arbitrationDeadline;
        vm.prank(guardian);
        config.pause();
        assertTrue(_submit(id, observer, HASH), "independent evidence while paused");
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.settleDispute(id, T.Outcome.INVALID, HASH);
        vm.warp(challengeAt);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.cancelInterruptedMarket(id);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.INVALID, HASH);
        assertEq(factory.getMarket(id).arbitrationDeadline, arbitrationAt, "snapshot upper deadline");
        vm.prank(carol);
        factory.claimRefund(id);
        _allBonds(id);
        assertEq(factory.totalAccounted(), 0, "all principal exits while finance halted");
        _assertConservation();
    }

    function testEvidenceContributorsAndEmergencyRolesHaveNoArbitrationOverride() public {
        uint256 id = _create();
        _propose(id, T.Outcome.NO);
        _challenge(id);
        assertTrue(_submit(id, observer, HASH), "evidence contributor");
        _waitForArbitration(id);
        address[6] memory callers = [alice, bob, observer, governance, compliance, guardian];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(ProtocolStorage.Unauthorized.selector);
            factory.settleDispute(id, T.Outcome.YES, HASH);
        }
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        _assertConservation();
    }

    function testNoDecisionCanResetEvidenceOrArbitrationDeadlines() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        T.Market memory m = factory.getMarket(id);
        _challenge(id);
        for (uint256 i; i < 8; ++i) {
            assertTrue(_submit(id, observer, keccak256(abi.encode(i))), "additional evidence");
        }
        vm.prank(guardian);
        config.pause();
        vm.prank(governance);
        config.deactivateFinance();
        assertEq(factory.getMarket(id).challengeDeadline, m.challengeDeadline, "immutable lower bound");
        assertEq(factory.getMarket(id).arbitrationDeadline, m.arbitrationDeadline, "immutable upper bound");
        vm.warp(m.arbitrationDeadline);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        factory.cancelInterruptedMarket(id);
        _allBonds(id);
        _assertConservation();
    }

    function testDecisionAndEvidenceValidationStillApplyAtPermittedBoundary() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        _waitForArbitration(id);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidOutcome.selector);
        factory.settleDispute(id, T.Outcome.UNRESOLVED, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidEvidence.selector);
        factory.settleDispute(id, T.Outcome.YES, bytes32(0));
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
    }

    function testHiddenModuleCannotBypassTimingButRemainsArbitrationTrust_RESIDUAL() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        bytes32 pinned = config.roleFingerprint(arbitrator);
        a.installHiddenModule(observer);
        a.setGuardMarker(address(1234));
        a.setImplementationMarker(address(5678));
        assertTrue(config.roleFingerprint(arbitrator) == pinned, "views cannot establish genuine execution");
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        a.executeFromHiddenModule(address(factory), abi.encodeCall(factory.settleDispute, (id, T.Outcome.NO, HASH)));
        _waitForArbitration(id);
        vm.prank(observer);
        a.executeFromHiddenModule(address(factory), abi.encodeCall(factory.settleDispute, (id, T.Outcome.NO, HASH)));
        assertEq(
            uint256(factory.getMarket(id).finalOutcome),
            uint256(T.Outcome.NO),
            "admitted dishonest wallet still has authority"
        );
        _assertConservation();
    }

    function testMutableProxySingletonCannotBypassTimingButCanHideExecutionDrift_RESIDUAL() public {
        RestrictedWalletExecutionMock original = new RestrictedWalletExecutionMock();
        OpenWalletExecutionMock malicious = new OpenWalletExecutionMock();
        MutableProxyWalletMock proxy = new MutableProxyWalletMock(address(original), address(this));
        _selectArbitrator(address(proxy));
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        bytes32 pinned = config.roleFingerprint(address(proxy));
        bytes memory request = abi.encodeCall(factory.settleDispute, (id, T.Outcome.NO, HASH));
        vm.prank(observer);
        vm.expectRevert();
        RestrictedWalletExecutionMock(address(proxy)).execute(address(factory), request);
        proxy.upgrade(address(malicious));
        assertTrue(config.roleFingerprint(address(proxy)) == pinned, "outer code and declared owners unchanged");
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        OpenWalletExecutionMock(address(proxy)).execute(address(factory), request);
        _waitForArbitration(id);
        vm.prank(observer);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.prank(observer);
        OpenWalletExecutionMock(address(proxy)).execute(address(factory), request);
        assertEq(
            uint256(factory.getMarket(id).finalOutcome),
            uint256(T.Outcome.NO),
            "proxy admission is an external trust boundary"
        );
        _assertConservation();
    }

    function testUnsafeGuardHasBoundedRefundExitAndNoUnauthorizedFallback() public {
        GuardedArbitratorMock wallet = new GuardedArbitratorMock(address(this));
        _selectArbitrator(address(wallet));
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.NO);
        _challenge(id);
        _waitForArbitration(id);
        wallet.setBlocked(true);
        vm.expectRevert(GuardedArbitratorMock.GuardBlocked.selector);
        wallet.execute(address(factory), abi.encodeCall(factory.settleDispute, (id, T.Outcome.YES, HASH)));
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.warp(factory.getMarket(id).arbitrationDeadline);
        factory.cancelExpiredMarket(id);
        vm.prank(carol);
        factory.claimRefund(id);
        _allBonds(id);
        assertEq(factory.totalAccounted(), 0, "guard denial cannot lock user principal forever");
        _assertConservation();
    }

    function testBiasedArbitratorCanChooseInvalidToRefundItsLosingStake_RESIDUAL() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 600 ether);
        vm.deal(arbitrator, 400 ether);
        _predict(id, arbitrator, T.Side.NO, 400 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        _waitForArbitration(id);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.INVALID, HASH);
        (, uint256 refund) = factory.getClaimable(id, arbitrator);
        assertEq(refund, 400 ether, "biased decision can benefit an arbiter's losing position");
        assertEq(factory.getMarket(id).protocolFee, 0, "invalidity never funds fee or penalty");
        _allBonds(id);
        _assertConservation();
    }

    function testDeclaredOwnerOverlapCannotPassArbitrationAuthorityChecks() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        _waitForArbitration(id);
        g.setOwner(0, address(300));
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        vm.warp(factory.getMarket(id).arbitrationDeadline);
        factory.cancelExpiredMarket(id);
        _allBonds(id);
        _assertConservation();
    }

    function testDisjointDeclaredOwnersCanShareOneExecutionController_RESIDUAL() public {
        SharedControllerWalletMock gov = new SharedControllerWalletMock(100, observer);
        SharedControllerWalletMock comp = new SharedControllerWalletMock(200, observer);
        SharedControllerWalletMock arb = new SharedControllerWalletMock(300, observer);
        governance = address(gov);
        compliance = address(comp);
        arbitrator = address(arb);
        T.Parameters memory p = config.parameters();
        p.arbitrator = arbitrator;
        config = new ProtocolConfig(governance, compliance, guardian, p);
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(observer);
        gov.execute(address(config), abi.encodeCall(config.bindFactory, (address(factory))));
        vm.prank(observer);
        comp.execute(address(config), abi.encodeCall(config.approveRelease, (RELEASE)));
        vm.warp(config.activationAfter());
        vm.prank(observer);
        gov.execute(address(config), abi.encodeCall(config.activateFinance, (RELEASE)));
        assertTrue(config.financialActive(), "local mock: declared disjoint owners do not prove control independence");
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        _waitForArbitration(id);
        vm.prank(observer);
        arb.execute(address(factory), abi.encodeCall(factory.settleDispute, (id, T.Outcome.NO, HASH)));
        assertEq(
            uint256(factory.getMarket(id).finalOutcome),
            uint256(T.Outcome.NO),
            "one hidden actor can control all three admitted roles"
        );
        _assertConservation();
    }

    function testFuzzOriginalArbitrationBoundaries(uint8 boundarySeed, uint8 outcomeSeed) public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _predict(id, observer, T.Side.NO, 20 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        T.Market memory m = factory.getMarket(id);
        uint256 mode = boundarySeed % 5;
        uint256 at = mode == 0
            ? m.challengeDeadline - 1
            : mode == 1
                ? m.challengeDeadline
                : mode == 2 ? m.arbitrationDeadline - 1 : mode == 3 ? m.arbitrationDeadline : m.arbitrationDeadline + 1;
        vm.warp(at);
        T.Outcome decision = T.Outcome(1 + outcomeSeed % 3);
        vm.prank(arbitrator);
        (bool ok,) = address(factory).call(abi.encodeCall(factory.settleDispute, (id, decision, HASH)));
        assertEq(ok, at >= m.challengeDeadline && at < m.arbitrationDeadline, "original inclusive/exclusive bounds");
        if (at >= m.arbitrationDeadline) factory.cancelExpiredMarket(id);
        assertEq(factory.getMarket(id).challengeDeadline, m.challengeDeadline, "lower boundary immutable");
        assertEq(factory.getMarket(id).arbitrationDeadline, m.arbitrationDeadline, "upper boundary immutable");
        _assertConservation();
    }

    function _selectArbitrator(address next) private {
        T.Parameters memory p = config.parameters();
        p.arbitrator = next;
        vm.prank(governance);
        config.setParameters(p);
        arbitrator = next;
        _activate();
    }

    function _allBonds(uint256 id) private {
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(id, T.BondType.CHALLENGE, bob);
    }
}
