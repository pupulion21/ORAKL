// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolStorage, MarketFactory} from "../helpers/OraklTestBase.sol";

contract AdversarialReceiver {
    MarketFactory public immutable factory;
    bool public reject;
    bool public reenter;
    bool public blocked;
    bytes4 public reason;
    bytes public payload;

    constructor(MarketFactory f) {
        factory = f;
    }

    function setBehavior(bool reject_, bool reenter_, bytes calldata payload_) external {
        reject = reject_;
        reenter = reenter_;
        payload = payload_;
    }

    function invoke(bytes calldata callData, uint256 value) external {
        (bool ok, bytes memory result) = address(factory).call{value: value}(callData);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }

    receive() external payable {
        if (reject) revert("fixture rejects payment");
        if (reenter) {
            (bool ok, bytes memory data) = address(factory).call(payload);
            blocked = !ok;
            reason = bytes4(data);
        }
    }
}

contract ForcedNative {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract BondsAndTransfersTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testAllBondPrincipalsReturnAfterDisputeNoPunitiveSlash() public {
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, 10 ether);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        assertEq(factory.bondLiability(), 10 ether, "three categories");
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.NO, HASH);
        uint256 principal = factory.participantLiability();
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(id, T.BondType.CHALLENGE, bob);
        assertEq(factory.bondLiability(), 0, "all bonds released");
        assertEq(factory.participantLiability(), principal, "bond isolation");
        assertEq(factory.totalBondsPaid(), 10 ether, "principal only, no slash");
        _assertConservation();
    }

    function testBondClaimsRequireTerminalOwnerAndSingleWithdrawal() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        factory.claimBond(id, T.BondType.CREATION, alice);
        _propose(id, T.Outcome.INVALID);
        vm.warp(factory.getMarket(id).challengeDeadline);
        factory.finalizeResult(id);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.claimBond(id, T.BondType.CREATION, bob);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.InvalidRecipient.selector);
        factory.claimBond(id, T.BondType.CREATION, address(0));
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, carol);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.AlreadyClaimed.selector);
        factory.claimBond(id, T.BondType.CREATION, carol);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.claimBond(id, T.BondType.CHALLENGE, alice);
    }

    function testArbitrationTimeoutReturnsEveryBondUnslashed() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        vm.warp(factory.getMarket(id).arbitrationDeadline);
        factory.cancelExpiredMarket(id);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(id, T.BondType.CHALLENGE, bob);
        assertEq(factory.totalBondsPaid(), 10 ether, "no timeout confiscation");
        _assertConservation();
    }

    function testNoSlashingOrAdminRescueEntryPoint() public {
        uint256 id = _create();
        uint256 before = factory.totalAccounted();
        vm.prank(governance);
        (bool slash,) = address(factory).call(abi.encodeWithSignature("slashBond(uint256,uint8)", id, 0));
        vm.prank(governance);
        (bool rescue,) = address(factory).call(abi.encodeWithSignature("withdraw(uint256)", 5 ether));
        assertFalse(slash || rescue, "no arbitrary slashing or custody");
        assertEq(factory.totalAccounted(), before, "unchanged");
    }

    function testRejectedClaimRollsBackAndOwnerCanRedirect() public {
        (uint256 id, AdversarialReceiver receiver) = _receiverMarket(T.Side.YES);
        _finalize(id, T.Outcome.YES);
        receiver.setBehavior(true, false, "");
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        receiver.invoke(abi.encodeCall(factory.claim, (id)), 0);
        assertFalse(factory.getPosition(id, address(receiver)).settled, "claim rollback");
        assertEq(factory.getMarket(id).paidOut, 0, "paid rollback");
        receiver.invoke(abi.encodeCall(factory.claimTo, (id, alice)), 0);
        _assertConservation();
    }

    function testRejectedRefundAndBondReleaseRollbackAndRedirect() public {
        (uint256 id, AdversarialReceiver receiver) = _receiverMarket(T.Side.NO);
        _finalize(id, T.Outcome.INVALID);
        receiver.setBehavior(true, false, "");
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        receiver.invoke(abi.encodeCall(factory.claimRefund, (id)), 0);
        assertFalse(factory.getPosition(id, address(receiver)).settled, "refund rollback");
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        factory.claimBond(id, T.BondType.CREATION, address(receiver));
        assertFalse(factory.getBond(id, T.BondType.CREATION).claimed, "bond rollback");
        receiver.invoke(abi.encodeCall(factory.claimRefundTo, (id, alice)), 0);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        _assertConservation();
    }

    function testRejectedFeeWithdrawalRollback() public {
        (uint256 id, AdversarialReceiver receiver) = _receiverMarket(T.Side.YES);
        _finalize(id, T.Outcome.YES);
        receiver.setBehavior(true, false, "");
        uint256 fee = factory.feeLiability();
        vm.prank(governance);
        vm.expectRevert(ProtocolStorage.TransferFailed.selector);
        factory.withdrawProtocolFees(fee, address(receiver));
        assertEq(factory.feeLiability(), fee, "fee rollback");
        assertEq(factory.totalFeesWithdrawn(), 0, "withdrawn rollback");
        vm.prank(governance);
        factory.withdrawProtocolFees(fee, alice);
        _assertConservation();
    }

    function testReentrantClaimRefundBondAndFeeAreGuarded() public {
        (uint256 id, AdversarialReceiver receiver) = _receiverMarket(T.Side.YES);
        _finalize(id, T.Outcome.YES);
        receiver.setBehavior(false, true, abi.encodeCall(factory.claim, (id)));
        receiver.invoke(abi.encodeCall(factory.claim, (id)), 0);
        _assertGuard(receiver);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, address(receiver));
        _assertGuard(receiver);
        uint256 fee = factory.feeLiability();
        vm.prank(governance);
        factory.withdrawProtocolFees(fee, address(receiver));
        _assertGuard(receiver);
        uint256 other = factory.createMarket{value: 5 ether}(
            HASH,
            "ipfs://next",
            uint64(block.timestamp + 100),
            uint64(block.timestamp + 200),
            uint64(block.timestamp + 3 hours)
        );
        receiver.invoke(abi.encodeCall(factory.predict, (other, T.Side.NO)), 1 ether);
        vm.warp(factory.getMarket(other).maxResolutionTime);
        factory.cancelExpiredMarket(other);
        receiver.setBehavior(false, true, abi.encodeCall(factory.claimRefund, (other)));
        receiver.invoke(abi.encodeCall(factory.claimRefund, (other)), 0);
        _assertGuard(receiver);
        _assertConservation();
    }

    function testSelfdestructSurplusExcludedFromEveryLedger() public {
        uint256 id = _create();
        _predict(id, alice, T.Side.YES, 10 ether);
        vm.deal(address(this), 123);
        new ForcedNative{value: 123}(payable(address(factory)));
        assertEq(factory.unaccountedBalance(), 123, "actual forced surplus");
        assertEq(factory.participantLiability(), 10 ether, "not a contribution");
        _assertConservation();
    }

    function _receiverMarket(T.Side side) private returns (uint256 id, AdversarialReceiver receiver) {
        id = _create();
        receiver = new AdversarialReceiver(factory);
        vm.deal(address(receiver), 100 ether);
        receiver.invoke(abi.encodeCall(factory.predict, (id, side)), 10 ether);
        vm.deal(address(this), 100 ether);
    }

    function _assertGuard(AdversarialReceiver receiver) private view {
        assertTrue(receiver.blocked(), "nested call blocked");
        assertTrue(receiver.reason() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "guard reason");
    }
}
