// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {SelectedBase} from "./SelectedBase.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";
import {ProtocolStorage} from "../../src/ProtocolStorage.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";

contract SelectedAdversariesTest is SelectedBase {
    function setUp() public {
        _deploySelected();
    }

    function testCoalitionCanStillRecoverOwnBondsAndBiasInvalid_RESIDUAL() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 99 ether);
        _predict(id, carol, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        _stake(id, carol, 90 ether);
        _decision(id, T.Outcome.INVALID);
        assertEq(_bond(id, T.BondType.PROPOSAL, alice), 10 ether, "coalition P principal survives INVALID");
        assertEq(_bond(id, T.BondType.CHALLENGE, carol), 90 ether, "C survives INVALID");
        vm.prank(carol);
        selected.claimRefund(id);
        assertEq(selected.feeLiability(), 0, "biased refund fee zero");
    }

    function testThinFalseWinnerAndNoHonestChallenge_RESIDUAL() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 99.99 ether);
        _predict(id, carol, T.Side.NO, 0.01 ether);
        _finalize(id, T.Outcome.NO);
        (uint256 payout,) = selected.getClaimable(id, carol);
        assertEq(payout, 98 ether, "thin winner obtains whole distributable pool");
        assertEq(_bond(id, T.BondType.PROPOSAL, alice), 10 ether, "no challenge no slashing");
    }

    function testLargeStakeCannotOverflowFullPrecisionReward() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.NO, 1 ether);
        _propose(id, T.Outcome.YES);
        uint256 x = uint256(1) << 200;
        vm.deal(bob, x);
        vm.prank(bob);
        selected.challengeResult{value: x}(id, HASH);
        vm.deal(carol, x);
        vm.prank(carol);
        selected.challengeResult{value: x}(id, HASH);
        _decision(id, T.Outcome.NO);
        uint256 sum = selected.getBondEntitlement(id, T.BondType.CHALLENGE, bob)
            + selected.getBondEntitlement(id, T.BondType.CHALLENGE, carol);
        assertEq(sum, 2 * x + 10 ether, "512-bit product round-trip");
        _assertConservation();
    }

    function testCeilRatiosAtSmallAtomicTier() public {
        T.Parameters memory p = T.Parameters(200, 2, 11, 2, 1, 101, 48 hours, 96 hours, arbitrator);
        ProtocolConfig c = new ProtocolConfig(governance, compliance, guardian, p);
        SelectedMarketFactory f = new SelectedMarketFactory(IProtocolConfig(address(c)));
        assertEq(f.globalUnresolvedCap(), 303, "ceil tier");
        assertEq(f.perArbitratorUnresolvedCap(), 202, "arb tier");
        p.proposalBond = 10;
        ProtocolConfig bad = new ProtocolConfig(governance, compliance, guardian, p);
        vm.expectRevert(SelectedMarketFactory.InvalidSelectedTerms.selector);
        new SelectedMarketFactory(IProtocolConfig(address(bad)));
    }

    function testNoStakeWithdrawalBeforeTerminalAndZeroEntitlementMarkedOnce() public {
        uint256 id = _new();
        _predict(id, bob, T.Side.YES, 1 ether);
        _propose(id, T.Outcome.YES);
        _stake(id, bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(ProtocolStorage.InvalidState.selector);
        selected.claimBond(id, T.BondType.CHALLENGE, bob);
        _decision(id, T.Outcome.YES);
        uint256 balance_ = bob.balance;
        vm.prank(bob);
        selected.claimBond(id, T.BondType.CHALLENGE, bob);
        assertEq(bob.balance, balance_, "losing tranche no transfer");
        assertTrue(selected.getChallengeStake(id, bob).claimed, "zero recorded once");
        assertEq(_bond(id, T.BondType.PROPOSAL, alice), 11 ether, "uphold exactly P+S");
    }

    function testSplitAndOrderingRoundingIsBoundedNotIdentitySecurity() public {
        // A tiny fixed tier makes the atomic-unit ordering effect visible; all actual terms still fixed ratios.
        T.Parameters memory p = T.Parameters(200, 1, 1, 1, 1, 7, 48 hours, 96 hours, arbitrator);
        ProtocolConfig c = new ProtocolConfig(governance, compliance, guardian, p);
        SelectedMarketFactory f = new SelectedMarketFactory(IProtocolConfig(address(c)));
        vm.prank(governance);
        c.bindFactory(address(f));
        vm.prank(compliance);
        c.approveRelease(HASH);
        vm.warp(c.activationAfter());
        vm.prank(governance);
        c.activateFinance(HASH);
        uint64 end = uint64(block.timestamp + 100);
        vm.prank(alice);
        uint256 id = f.createMarket{value: 1}(HASH, "ipfs://tiny", end, end, end + 8 days);
        vm.prank(bob);
        f.predict{value: 1}(id, T.Side.NO);
        vm.warp(end);
        vm.prank(alice);
        f.proposeResult{value: 1}(id, T.Outcome.YES, HASH);
        vm.prank(bob);
        f.challengeResult{value: 1}(id, HASH);
        vm.prank(carol);
        f.challengeResult{value: 1}(id, HASH);
        vm.warp(f.getMarket(id).challengeDeadline);
        vm.prank(arbitrator);
        f.settleDispute(id, T.Outcome.NO, HASH);
        assertEq(f.getBondEntitlement(id, T.BondType.CHALLENGE, bob), 1, "first interval no atom");
        assertEq(f.getBondEntitlement(id, T.BondType.CHALLENGE, carol), 2, "last interval receives atom");
    }
}
