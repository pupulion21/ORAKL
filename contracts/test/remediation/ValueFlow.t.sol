// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolStorage} from "../helpers/OraklTestBase.sol";
import {AdversarialReceiver} from "../unit/BondsAndTransfers.t.sol";

contract ValueFlowTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testContractOwnersCanRedirectEachBondCategoryAfterRejectedTransfer() public {
        AdversarialReceiver receiver = new AdversarialReceiver(factory);
        vm.deal(address(receiver), 100 ether);
        for (uint8 kind = 0; kind < 3; ++kind) {
            if (close <= block.timestamp) {
                close = uint64(block.timestamp + 100);
                resolution = close + 100;
                expiry = resolution + 3 hours;
            }
            uint256 id;
            if (kind == 0) {
                id = factory.marketCount();
                receiver.invoke(
                    abi.encodeCall(factory.createMarket, (HASH, "ipfs://receiver", close, resolution, expiry)), 5 ether
                );
                _propose(id, T.Outcome.INVALID);
            } else if (kind == 1) {
                id = _create();
                vm.warp(resolution);
                receiver.invoke(abi.encodeCall(factory.proposeResult, (id, T.Outcome.INVALID, HASH)), 2 ether);
            } else {
                id = _create();
                _propose(id, T.Outcome.YES);
                receiver.invoke(abi.encodeCall(factory.challengeResult, (id, HASH)), 3 ether);
            }
            if (kind == 2) {
                vm.prank(arbitrator);
                factory.settleDispute(id, T.Outcome.INVALID, HASH);
            } else {
                vm.warp(factory.getMarket(id).challengeDeadline);
                factory.finalizeResult(id);
            }
            receiver.setBehavior(true, false, "");
            uint256 bondBefore = factory.bondLiability();
            uint256 paidBefore = factory.totalBondsPaid();
            vm.expectRevert(ProtocolStorage.TransferFailed.selector);
            receiver.invoke(abi.encodeCall(factory.claimBond, (id, T.BondType(kind), address(receiver))), 0);
            assertEq(factory.bondLiability(), bondBefore, "rollback liability");
            assertEq(factory.totalBondsPaid(), paidBefore, "rollback outflow");
            assertFalse(factory.getBond(id, T.BondType(kind)).claimed, "rollback exactly-once flag");
            receiver.invoke(abi.encodeCall(factory.claimBond, (id, T.BondType(kind), alice)), 0);
            assertTrue(factory.getBond(id, T.BondType(kind)).claimed, "owner redirects its entitlement");
            _assertConservation();
        }
    }

    function testPartialFeeWithdrawalsCannotConsumeBondsPoolsOrForcedSurplus() public {
        uint256 first = _create();
        uint256 second = _create();
        _predict(first, bob, T.Side.YES, 10 ether);
        _predict(first, carol, T.Side.NO, 20 ether);
        _predict(second, carol, T.Side.YES, 7 ether);
        _finalize(first, T.Outcome.YES);
        uint256 participants = factory.participantLiability();
        uint256 bonds = factory.bondLiability();
        vm.deal(address(factory), address(factory).balance + 777);
        uint256 fee = factory.feeLiability();
        vm.prank(governance);
        factory.withdrawProtocolFees(fee / 2, alice);
        vm.prank(governance);
        factory.withdrawProtocolFees(fee - fee / 2, alice);
        vm.prank(governance);
        vm.expectRevert(ProtocolStorage.NothingToClaim.selector);
        factory.withdrawProtocolFees(1, alice);
        assertEq(factory.participantLiability(), participants, "participant reserve");
        assertEq(factory.bondLiability(), bonds, "bond reserve");
        assertEq(factory.unaccountedBalance(), 777, "surplus untouched");
        _assertConservation();
    }

    function testNoExposedTransferHelperAndNoCrossOwnerClaims() public {
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _finalize(id, T.Outcome.YES);
        vm.prank(governance);
        (bool ok,) = address(factory).call(abi.encodeWithSignature("_send(address,uint256)", alice, 1 ether));
        assertFalse(ok, "internal helper has no external selector");
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.NothingToClaim.selector);
        factory.claimTo(id, alice);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.claimBond(id, T.BondType.CREATION, bob);
        _assertConservation();
    }

    function testZeroBondClaimDoesNotInvokeRejectingRecipient() public {
        T.Parameters memory p = config.parameters();
        p.creationBond = 0;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        uint256 id = _create();
        vm.warp(factory.getMarket(id).maxResolutionTime);
        factory.cancelExpiredMarket(id);
        AdversarialReceiver receiver = new AdversarialReceiver(factory);
        receiver.setBehavior(true, false, "");
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, address(receiver));
        assertTrue(factory.getBond(id, T.BondType.CREATION).claimed, "zero obligation settled once");
        _assertConservation();
    }
}
