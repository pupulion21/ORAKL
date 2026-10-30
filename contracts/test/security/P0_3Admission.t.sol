// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    P0_3TestBase,
    T,
    ProtocolStorage,
    ProtocolConfig,
    MarketFactory,
    IProtocolConfig,
    MutableMultisig
} from "./P0_3TestBase.sol";
import {AdditionalVm} from "../unit/ConfigurationBoundaries.t.sol";

contract P0_3AdmissionTest is P0_3TestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deployMutable(true);
    }

    function testThresholdReductionCannotCensorAnExistingObjection() public {
        for (uint256 i; i < 3; ++i) {
            uint256 id = _create();
            _propose(id, T.Outcome.NO);
            _role(i).setThreshold(1);
            vm.prank(bob);
            factory.challengeResult{value: 3 ether, gas: 400_000}(id, HASH);
            assertEq(
                uint256(factory.marketState(id)), uint256(T.State.DISPUTED), "objection accepted despite downgrade"
            );
            _role(i).setThreshold(2);
        }
        _assertConservation();
    }

    function testOtherFinancialPathsRetainFullLiveRoleChecks() public {
        uint256 feeMarket = _create();
        _predict(feeMarket, bob, T.Side.YES, 10 ether);
        _finalize(feeMarket, T.Outcome.YES);
        uint256 finalizable = _create();
        expiry = resolution + 2 days;
        uint256 closable = _create();
        _propose(finalizable, T.Outcome.NO);
        _waitForArbitration(finalizable);
        uint256 challengeable = _create();
        _propose(challengeable, T.Outcome.YES);
        uint64 longClose = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 open =
            factory.createMarket{value: 5 ether}(HASH, "ipfs://open", longClose, longClose, longClose + 2 days);
        g.setOwner(0, address(1099));
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.createMarket{value: 5 ether}(HASH, "ipfs://new", longClose, longClose, longClose + 2 days);
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.predict{value: 1}(open, T.Side.YES);
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.proposeResult{value: 2 ether}(closable, T.Outcome.YES, HASH);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.finalizeResult(finalizable);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        factory.withdrawProtocolFees(1, alice);
        vm.prank(bob);
        factory.challengeResult{value: 3 ether}(challengeable, HASH);
        vm.prank(bob);
        factory.claim(feeMarket); // Existing entitlements stay getter-independent.
        _assertConservation();
    }

    function testInactiveChallengeGateCannotAdmitValueOrUnknownMarket() public {
        _deployMutable(false);
        for (uint256 value; value < 2; ++value) {
            vm.prank(bob);
            vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
            factory.challengeResult{value: value}(0, HASH);
        }
        assertEq(factory.totalAccounted(), 0, "no activation bypass");
    }

    function testBoundFacadeAndChainChecksRemainRequired() public {
        uint256 id = _create();
        _propose(id, T.Outcome.NO);
        MarketFactory second = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        second.challengeResult{value: 3 ether}(id, HASH);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        config.requireChallengeActivity(address(0));
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        config.requireChallengeActivity(address(second));
        uint256 chain = block.chainid;
        AdditionalVm(address(vm)).chainId(chain + 1);
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        AdditionalVm(address(vm)).chainId(chain);
        vm.prank(bob);
        factory.challengeResult{value: 3 ether}(id, HASH);
        _assertConservation();
    }

    function testChallengeGateIsPublicPreflightNotExternalSettlementAuthority() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(observer);
        config.requireChallengeActivity(address(factory)); // Read-only predicate, as with the existing admission API.
        assertEq(uint256(factory.marketState(id)), uint256(T.State.PROPOSED), "view call changes no state");
        vm.prank(observer);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.activateFinance(RELEASE);
        vm.prank(observer);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.pause();
        _assertConservation();
    }

    function testExplicitEmergencyActionsStillBlockNativeChallengesAndKeepEvidenceOpen() public {
        for (uint8 action; action < 6; ++action) {
            if (action > 0) _deployMutable(true);
            uint256 id = _create();
            _predict(id, carol, T.Side.YES, 10 ether);
            _propose(id, T.Outcome.YES);
            if (action == 0 || action == 1) {
                vm.prank(action == 0 ? guardian : governance);
                config.pause();
            } else if (action < 5) {
                vm.prank(action == 2 ? compliance : action == 3 ? governance : guardian);
                config.deactivateFinance();
            } else {
                T.Parameters memory p = config.parameters();
                vm.prank(governance);
                config.setParameters(p);
            }
            vm.prank(bob);
            vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
            factory.challengeResult{value: 3 ether}(id, HASH);
            assertTrue(_submit(id, observer, HASH), "no-value evidence survives explicit interruption");
            vm.warp(factory.interruptionRefundTime(id));
            factory.cancelInterruptedMarket(id);
            vm.prank(carol);
            factory.claimRefund(id);
            assertEq(factory.getMarket(id).protocolFee, 0, "censored financial activity exits via full refund");
            _assertConservation();
        }
    }

    function testOldEpochCannotResumeChallengesAfterFreshReviewedActivation() public {
        expiry = close + 300 days;
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        uint256 first = factory.interruptionRefundTime(id);
        vm.prank(guardian);
        config.pause();
        _activate();
        assertEq(factory.interruptionRefundTime(id), first, "repeated intervention cannot postpone exit");
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.finalizeResult(id);
        factory.cancelInterruptedMarket(id);
        _assertConservation();
    }

    function testZeroChallengeBondStillRequiresExplicitActivationAndNoPause() public {
        T.Parameters memory p = config.parameters();
        p.challengeBond = 0;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        uint256 first = _create();
        uint256 second = _create();
        _propose(first, T.Outcome.YES);
        _propose(second, T.Outcome.YES);
        g.setFault(2);
        vm.prank(bob);
        factory.challengeResult(first, HASH);
        assertEq(factory.getBond(first, T.BondType.CHALLENGE).amount, 0, "no silent economic minimum introduced");
        vm.prank(guardian);
        config.pause();
        vm.prank(bob);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.challengeResult(second, HASH);
        _assertConservation();
    }

    function testProposerAndArbitratorStillCannotTakeChallengeBondSlot() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        vm.deal(arbitrator, 5 ether);
        g.setThreshold(1);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.prank(observer);
        factory.challengeResult{value: 3 ether}(id, HASH);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.challengeResult{value: 3 ether}(id, HASH);
        _assertConservation();
    }

    function testFuzzRoleRestorationKeepsObjectionAndExactBondAccounting(
        uint8 roleSeed,
        uint8 faultSeed,
        bool correctValue
    ) public {
        uint256 id = _create();
        _propose(id, T.Outcome.NO);
        uint256 which = roleSeed % 3;
        MutableMultisig wallet = _role(which);
        uint8 mode = faultSeed % 7;
        if (mode == 0) wallet.setOwner(0, address(1500));
        else if (mode == 1) wallet.setThreshold(1);
        else wallet.setFault(mode - 1);
        uint256 prior = factory.bondLiability();
        vm.prank(bob);
        (bool ok,) = address(factory).call{value: correctValue ? 3 ether : 1}(
            abi.encodeCall(factory.challengeResult, (id, HASH))
        );
        assertEq(ok, correctValue, "valid objection independent of live control getters");
        assertEq(factory.bondLiability(), prior + (correctValue ? 3 ether : 0), "exact bond admission or full rollback");
        wallet.setOwner(0, address(uint160(100 + 100 * which)));
        wallet.setThreshold(2);
        wallet.setFault(0);
        _waitForArbitration(id);
        if (correctValue) {
            vm.expectRevert(ProtocolStorage.InvalidState.selector);
            factory.finalizeResult(id);
            vm.prank(arbitrator);
            factory.settleDispute(id, T.Outcome.INVALID, HASH);
        } else {
            factory.finalizeResult(id); // No valid funded objection was submitted: no fabricated challenge state.
        }
        _assertConservation();
    }
}
