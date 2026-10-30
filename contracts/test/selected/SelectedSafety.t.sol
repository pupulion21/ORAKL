// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {SelectedBase} from "./SelectedBase.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolStorage} from "../../src/ProtocolStorage.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";
import {AdversarialReceiver} from "../unit/BondsAndTransfers.t.sol";

contract SelectedSafetyTest is SelectedBase {
    function setUp() public {
        _deploySelected();
    }

    function testExposureSaturationSwitchingArbitratorAndExactlyOnceRelease() public {
        uint256 a = _new();
        uint256 b = _new();
        _predict(a, bob, T.Side.YES, 100 ether);
        _predict(b, bob, T.Side.YES, 100 ether);
        uint256 c = _new();
        vm.prank(bob);
        vm.expectRevert(SelectedMarketFactory.ExposureExceeded.selector);
        selected.predict{value: 1 ether}(c, T.Side.NO);
        address old = arbitrator;
        address next = address(new MutableMultisig(400, 5));
        MutableMultisig(next).setThreshold(3);
        T.Parameters memory p = config.parameters();
        p.arbitrator = next;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        arbitrator = next;
        uint256 d = _new();
        _predict(d, bob, T.Side.YES, 100 ether);
        uint256 e = _new();
        vm.prank(bob);
        vm.expectRevert(SelectedMarketFactory.ExposureExceeded.selector);
        selected.predict{value: 1 ether}(e, T.Side.YES);
        assertEq(selected.totalUnresolvedExposure(), 300 ether, "global");
        assertEq(selected.unresolvedExposureByArbitrator(old), 200 ether, "old snapshot");
        vm.warp(selected.interruptionRefundTime(a));
        selected.cancelInterruptedMarket(a);
        assertEq(selected.totalUnresolvedExposure(), 200 ether, "release just a");
        assertEq(selected.unresolvedExposureByArbitrator(old), 100 ether, "snapshot release");
        vm.prank(bob);
        selected.claimRefund(a);
        _bond(a, T.BondType.CREATION, alice);
        assertEq(selected.totalUnresolvedExposure(), 200 ether, "claims no release");
        vm.expectRevert();
        selected.cancelInterruptedMarket(a);
        _assertConservation();
    }

    function testForcedFundsAndExpiredButNotCancelledStillCount() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 50 ether);
        vm.deal(address(selected), address(selected).balance + 123);
        vm.warp(expiry);
        assertEq(selected.totalUnresolvedExposure(), 50 ether, "expiry alone no release");
        selected.cancelExpiredMarket(id);
        assertEq(selected.unaccountedBalance(), 123, "forced value not exposure");
        assertEq(selected.totalUnresolvedExposure(), 0, "cancel release");
    }

    function testEveryRoleGetterFailureCannotCensorAdditionalStakes() public {
        uint256 id = _new();
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 1 ether);
        address[3] memory roles = [governance, compliance, arbitrator];
        for (uint256 r; r < 3; ++r) {
            for (uint8 fault = 1; fault <= 5; ++fault) {
                MutableMultisig(roles[r]).setFault(fault);
                _stake(id, address(uint160(20000 + r * 10 + fault)), 1 ether);
                selected.submitEvidence(id, HASH);
                MutableMultisig(roles[r]).setFault(0);
            }
        }
        assertEq(selected.totalChallengeStake(id), 16 ether, "all protective stakes");
        MutableMultisig(governance).setThreshold(1);
        _stake(id, carol, 1 ether);
        MutableMultisig(governance).setThreshold(2);
        vm.warp(selected.getMarket(id).challengeDeadline);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        selected.finalizeResult(id);
        _decision(id, T.Outcome.INVALID);
    }

    function testArbitratorDriftRejectsThenTimeoutNeutral() public {
        uint256 id = _new();
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 1 ether);
        _waitForArbitration(id);
        MutableMultisig(arbitrator).setOwner(0, address(0x1234));
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolConfig.ControlChanged.selector);
        selected.settleDispute(id, T.Outcome.NO, HASH);
        vm.warp(selected.getMarket(id).arbitrationDeadline);
        selected.cancelExpiredMarket(id);
        assertEq(_bond(id, T.BondType.CHALLENGE, bob), 1 ether, "neutral drift timeout");
    }

    function testReceiverFailureRollbackAndRedirectReentry() public {
        AdversarialReceiver receiver = new AdversarialReceiver(selected);
        vm.deal(address(receiver), 100 ether);
        uint256 id = _new();
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        receiver.invoke(abi.encodeCall(selected.challengeResult, (id, HASH)), 1 ether);
        _decision(id, T.Outcome.NO);
        receiver.setBehavior(true, false, "");
        uint256 before_ = selected.bondLiability();
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        receiver.invoke(abi.encodeCall(selected.claimBond, (id, T.BondType.CHALLENGE, address(receiver))), 0);
        assertEq(selected.bondLiability(), before_, "failed debit reverted");
        assertFalse(selected.getChallengeStake(id, address(receiver)).claimed, "flag rollback");
        receiver.setBehavior(
            false, true, abi.encodeCall(selected.claimBond, (id, T.BondType.CHALLENGE, address(receiver)))
        );
        receiver.invoke(abi.encodeCall(selected.claimBond, (id, T.BondType.CHALLENGE, address(receiver))), 0);
        assertEq(selected.getBondEntitlement(id, T.BondType.CHALLENGE, address(receiver)), 0, "no double entitlement");
        _assertConservation();
    }

    function testCreationValidatesExactTermsAndProposalOpportunity() public {
        T.Parameters memory p = config.parameters();
        p.proposalBond = 0;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 10 days;
        vm.prank(alice);
        vm.expectRevert(SelectedMarketFactory.InvalidSelectedTerms.selector);
        selected.createMarket{value: 1 ether}(HASH, "ipfs://test", close, resolution, expiry);
        vm.expectRevert(SelectedMarketFactory.InvalidSelectedTerms.selector);
        new SelectedMarketFactory(IProtocolConfig(address(config)));
    }

    function testProposalOpportunityExactBoundaryAndTermMutation() public {
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.InvalidTime.selector);
        selected.createMarket{value: 1 ether}(HASH, "ipfs://test", close, resolution, resolution + 8 days - 1);
        vm.prank(alice);
        uint256 id = selected.createMarket{value: 1 ether}(HASH, "ipfs://test", close, resolution, resolution + 8 days);
        T.Parameters memory p = config.parameters();
        p.poolCap = 99 ether;
        vm.prank(governance);
        config.setParameters(p);
        assertEq(selected.getMarket(id).terms.poolCap, 100 ether, "existing financial terms immutable");
        assertEq(selected.globalUnresolvedCap(), 300 ether, "deployment budget immutable");
    }

    function testZeroCapAndNonRatioConfigRejected() public {
        T.Parameters memory p = config.parameters();
        p.creationBond = 0;
        vm.prank(governance);
        config.setParameters(p);
        vm.expectRevert(SelectedMarketFactory.InvalidSelectedTerms.selector);
        new SelectedMarketFactory(IProtocolConfig(address(config)));
    }

    function testOwnerOverlapUnauthorizedClaimAndOldGetterReject() public {
        uint256 id = _new();
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 1 ether);
        _decision(id, T.Outcome.INVALID);
        vm.prank(carol);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        selected.claimBond(id, T.BondType.CHALLENGE, carol);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        selected.getBond(id, T.BondType.CHALLENGE);
    }

    function testLocalRehearsalInactiveByDefault() public {
        T.Parameters memory p = config.parameters();
        ProtocolConfig c = new ProtocolConfig(governance, compliance, guardian, p);
        SelectedMarketFactory f = new SelectedMarketFactory(IProtocolConfig(address(c)));
        vm.prank(governance);
        c.bindFactory(address(f));
        assertFalse(c.financialActive(), "default financial disable");
        vm.prank(alice);
        vm.expectRevert();
        f.createMarket{value: 1 ether}(HASH, "ipfs://test", close, resolution, expiry);
    }
}
