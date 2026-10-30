// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T} from "../helpers/OraklTestBase.sol";

contract AccountingFuzzTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testFuzzPayoutFeeRoundingAndClaimOrder(
        uint96 a,
        uint96 b,
        uint96 n,
        uint16 feeSeed,
        bool reverse,
        bool yesWins
    ) public {
        uint256 x = bound(a, 1, 1e23);
        uint256 y = bound(b, 1, 1e23);
        uint256 z = bound(n, 1, 1e23);
        T.Parameters memory p = config.parameters();
        p.feeBps = uint16(bound(feeSeed, 0, 1000));
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        uint256 id = _create();
        T.Side win = yesWins ? T.Side.YES : T.Side.NO;
        _predict(id, alice, win, x);
        _predict(id, bob, win, y);
        _predict(id, carol, yesWins ? T.Side.NO : T.Side.YES, z);
        _finalize(id, yesWins ? T.Outcome.YES : T.Outcome.NO);
        uint256 fee = (x + y + z) * p.feeBps / 10000;
        uint256 distributable = x + y + z - fee;
        (uint256 ax,) = factory.getClaimable(id, alice);
        (uint256 by,) = factory.getClaimable(id, bob);
        assertEq(ax, x * distributable / (x + y), "independent alice formula");
        assertEq(by, y * distributable / (x + y), "independent bob formula");
        address first = reverse ? bob : alice;
        address second = reverse ? alice : bob;
        vm.prank(first);
        factory.claim(id);
        vm.prank(second);
        factory.claim(id);
        assertEq(factory.getMarket(id).paidOut, ax + by, "order independent");
        assertLe(ax + by, distributable, "payout bound");
        assertLt(distributable - ax - by, 2, "dust < winners");
        assertEq(factory.totalFeesAccrued(), fee, "exact fee");
        _assertConservation();
    }

    function testFuzzRefundAndNonpunitiveBondDistribution(
        uint96 contribution,
        uint96 creation,
        uint96 proposal,
        uint96 challenge,
        uint8 decision
    ) public {
        T.Parameters memory p = config.parameters();
        p.creationBond = uint128(bound(creation, 0, 1000 ether));
        p.proposalBond = uint128(bound(proposal, 0, 1000 ether));
        p.challengeBond = uint128(bound(challenge, 0, 1000 ether));
        vm.prank(governance);
        config.setParameters(p);
        _activate();
        uint256 amount = bound(contribution, 1, 1e23);
        uint256 id = _create();
        _predict(id, carol, T.Side.YES, amount);
        _propose(id, T.Outcome.YES);
        _challenge(id);
        if (decision % 4 == 0) {
            vm.warp(factory.getMarket(id).arbitrationDeadline);
            factory.cancelExpiredMarket(id);
        } else {
            _waitForArbitration(id);
            vm.prank(arbitrator);
            factory.settleDispute(id, T.Outcome(1 + decision % 3), HASH);
        }
        vm.prank(alice);
        factory.claimBond(id, T.BondType.CREATION, alice);
        vm.prank(alice);
        factory.claimBond(id, T.BondType.PROPOSAL, alice);
        vm.prank(bob);
        factory.claimBond(id, T.BondType.CHALLENGE, bob);
        assertEq(
            factory.totalBondsPaid(), uint256(p.creationBond) + p.proposalBond + p.challengeBond, "bond conservation"
        );
        if (factory.getMarket(id).refundable) {
            vm.prank(carol);
            factory.claimRefund(id);
            assertEq(factory.getMarket(id).refunded, amount, "full refund");
            assertEq(factory.feeLiability(), 0, "zero fee");
        } else {
            vm.prank(carol);
            factory.claim(id);
        }
        _assertConservation();
    }

    function testFuzzDeadlineAndCallerBoundaries(uint32 deltaSeed, bool authorized) public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        uint256 deadline = factory.getMarket(id).arbitrationDeadline;
        uint256 timestamp = deadline - 1 + bound(deltaSeed, 0, 2);
        vm.warp(timestamp);
        address caller = authorized ? arbitrator : carol;
        vm.prank(caller);
        (bool ok,) = address(factory).call(abi.encodeCall(factory.settleDispute, (id, T.Outcome.YES, HASH)));
        assertEq(ok, authorized && timestamp < deadline, "exclusive decision boundary");
        if (timestamp >= deadline) factory.cancelExpiredMarket(id);
        _assertConservation();
    }

    function testFuzzVariableParticipantsAndSettlementOrder(uint8 countSeed, uint256 seed, bool yesWins) public {
        uint256 count = 1 + countSeed % 12;
        uint256 id = _create();
        uint256[] memory amounts = new uint256[](count);
        bool[] memory sides = new bool[](count);
        uint256 total;
        uint256 winning;
        for (uint256 i; i < count; ++i) {
            amounts[i] = 1 + uint256(keccak256(abi.encode(seed, i))) % 1e18;
            sides[i] = (seed >> i) & 1 == 1;
            address who = address(uint160(0x100000 + i));
            vm.deal(who, amounts[i]);
            _predict(id, who, sides[i] ? T.Side.YES : T.Side.NO, amounts[i]);
            total += amounts[i];
            if (sides[i] == yesWins) winning += amounts[i];
        }
        _finalize(id, yesWins ? T.Outcome.YES : T.Outcome.NO);
        uint256 distributable = total - total * 200 / 10_000;
        uint256 paid;
        for (uint256 j; j < count; ++j) {
            uint256 i = (seed % count + j) % count;
            address who = address(uint160(0x100000 + i));
            if (winning == 0) {
                vm.prank(who);
                factory.claimRefund(id);
                paid += amounts[i];
            } else if (sides[i] == yesWins) {
                vm.prank(who);
                factory.claim(id);
                paid += amounts[i] * distributable / winning;
            }
        }
        T.Market memory m = factory.getMarket(id);
        assertEq(m.paidOut + m.refunded, paid, "all entitlements independently reconciled");
        assertLe(paid, winning == 0 ? total : distributable, "bounded distribution");
        _assertConservation();
    }
}
