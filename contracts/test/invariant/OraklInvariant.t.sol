// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, MarketFactory, ProtocolConfig} from "../helpers/OraklTestBase.sol";

/// @dev Independent ghost ledger. All activation calls here are local simulation only.
contract RejectingStatefulActor {
    receive() external payable {
        revert("reject stateful native payment");
    }
}

contract OraklHandler is OraklTestBase {
    struct GMarket {
        uint256 yes;
        uint256 no;
        uint256 paid;
        uint256 refunded;
        uint256 fee;
        T.State state;
        T.Outcome proposed;
        T.Outcome outcome;
        uint64 closeAt;
        uint64 resolveAt;
        uint64 maxAt;
        uint64 proposalEpoch;
        uint64 creationEpoch;
        uint64 challengeAt;
        uint64 arbitrationAt;
        T.Parameters terms;
    }

    struct GPosition {
        uint256 yes;
        uint256 no;
        bool settled;
    }

    struct GBond {
        address owner;
        uint256 amount;
        bool claimed;
    }
    address[8] public actors;
    uint64 public ghostEpoch;
    mapping(uint64 => uint64) public epochBreak;
    bool public quarantineBypass;
    mapping(uint256 => GMarket) private ghost;
    mapping(uint256 => mapping(address => GPosition)) private positions;
    mapping(uint256 => mapping(uint8 => GBond)) private bonds;
    uint256 public deposits;
    uint256 public participantPaid;
    uint256 public bondPaid;
    uint256 public feePaid;
    uint256 public accrued;
    uint256 public forced;
    bool public doubleClaimSucceeded;
    bool public unauthorizedSucceeded;

    constructor() {
        _deploy(true);
        actors = [
            alice,
            bob,
            carol,
            address(0xdada),
            address(0xda01),
            address(0xda02),
            address(0xda03),
            address(new RejectingStatefulActor())
        ];
        for (uint256 i = 3; i < 8; ++i) {
            vm.deal(actors[i], 1e30);
        }
        create(0);
        create(1);
        predict(0, 0, true, 10 ether);
        predict(0, 1, false, 20 ether);
        predict(1, 0, true, 10 ether);
        predict(1, 1, false, 20 ether);
        advance(0, 0);
        propose(0, 0, 0);
        challenge(0, 1);
        arbitrate(0, 0, false);
        arbitrate(0, 1, true);
        claim(0, 1);
        claimBond(0, 0);
        claimBond(0, 1);
        claimBond(0, 2);
        fees(true, 1 ether);
        advance(1, 0);
        propose(1, 0, 0);
        advance(1, 1);
        finalize(1);
        claim(1, 0);
        create(2);
        predict(2, 7, true, 1 ether);
        togglePause(true);
        vm.warp(block.timestamp + 1 hours);
        emergencyCancel(2);
        claim(2, 7);
        togglePause(false);
        create(3);
    }

    function protocol() external view returns (MarketFactory) {
        return factory;
    }

    function settings() external view returns (ProtocolConfig) {
        return config;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function create(uint256 seed) public {
        if (factory.marketCount() >= 24 || !config.financialActive() || config.paused()) return;
        address who = actors[seed % 8];
        T.Parameters memory p = config.parameters();
        uint64 c = uint64(block.timestamp + bound(seed, 30, 500));
        uint64 r = c + 30;
        uint64 e = r + uint64(p.challengePeriod) + uint64(p.arbitrationPeriod) + uint64(bound(seed / 3, 100, 4000));
        vm.prank(who);
        uint256 id = factory.createMarket{value: p.creationBond}(HASH, "ipfs://stateful", c, r, e);
        GMarket storage g = ghost[id];
        g.creationEpoch = ghostEpoch;
        g.closeAt = c;
        g.resolveAt = r;
        g.maxAt = e;
        g.terms = p;
        bonds[id][0] = GBond(who, p.creationBond, false);
        deposits += p.creationBond;
    }

    function predict(uint256 seed, uint256 actorSeed, bool yes, uint96 amountSeed) public {
        if (!config.financialActive() || config.paused()) return;
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (g.creationEpoch != ghostEpoch || g.state != T.State.OPEN || block.timestamp >= g.closeAt) return;
        uint256 amount = bound(amountSeed, g.terms.minContribution, 1e20);
        if (amount > uint256(g.terms.poolCap) - g.yes - g.no) return;
        address who = actors[actorSeed % 8];
        vm.prank(who);
        factory.predict{value: amount}(id, yes ? T.Side.YES : T.Side.NO);
        if (yes) {
            g.yes += amount;
            positions[id][who].yes += amount;
        } else {
            g.no += amount;
            positions[id][who].no += amount;
        }
        deposits += amount;
    }

    function advance(uint256 seed, uint256 mode) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        uint256 target = mode % 5 == 0
            ? g.resolveAt
            : mode % 5 == 1
                ? g.challengeAt
                : mode % 5 == 2 ? g.arbitrationAt : mode % 5 == 3 ? g.maxAt : block.timestamp + bound(seed, 1, 3000);
        if (target > block.timestamp) vm.warp(target);
    }

    function propose(uint256 seed, uint256 actorSeed, uint8 outcomeSeed) public {
        if (!config.financialActive() || config.paused()) return;
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (
            g.creationEpoch != ghostEpoch || g.state != T.State.OPEN || block.timestamp < g.resolveAt
                || block.timestamp >= uint256(g.maxAt) - g.terms.challengePeriod - g.terms.arbitrationPeriod
        ) return;
        address who = actors[actorSeed % 8];
        T.Outcome outcome = T.Outcome(1 + outcomeSeed % 3);
        vm.prank(who);
        factory.proposeResult{value: g.terms.proposalBond}(id, outcome, HASH);
        g.proposalEpoch = config.activityEpoch();
        g.proposed = outcome;
        g.state = T.State.PROPOSED;
        g.challengeAt = uint64(block.timestamp + g.terms.challengePeriod);
        g.arbitrationAt = g.challengeAt + uint64(g.terms.arbitrationPeriod);
        bonds[id][1] = GBond(who, g.terms.proposalBond, false);
        deposits += g.terms.proposalBond;
    }

    function challenge(uint256 seed, uint256 actorSeed) public {
        if (!config.financialActive() || config.paused()) return;
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        address who = actors[actorSeed % 8];
        if (
            g.creationEpoch != ghostEpoch || g.state != T.State.PROPOSED || block.timestamp >= g.challengeAt
                || who == bonds[id][1].owner
        ) return;
        vm.prank(who);
        factory.challengeResult{value: g.terms.challengeBond}(id, HASH);
        g.state = T.State.DISPUTED;
        bonds[id][2] = GBond(who, g.terms.challengeBond, false);
        deposits += g.terms.challengeBond;
    }

    function finalize(uint256 seed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (
            g.state != T.State.PROPOSED || g.proposalEpoch != config.activityEpoch() || block.timestamp < g.challengeAt
                || block.timestamp >= g.maxAt
        ) return;
        factory.finalizeResult(id);
        _finish(id, g.proposed);
    }

    function arbitrate(uint256 seed, uint8 outcomeSeed, bool authorized) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (g.state != T.State.DISPUTED || block.timestamp >= g.arbitrationAt) return;
        T.Outcome outcome = T.Outcome(1 + outcomeSeed % 3);
        if (!authorized) {
            vm.prank(carol);
            (bool ok,) = address(factory).call(abi.encodeCall(factory.settleDispute, (id, outcome, HASH)));
            unauthorizedSucceeded = unauthorizedSucceeded || ok;
            return;
        }
        vm.prank(g.terms.arbitrator);
        factory.settleDispute(id, outcome, HASH);
        _finish(id, outcome);
    }

    function cancel(uint256 seed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (_terminal(g)) return;
        if (block.timestamp < (g.state == T.State.DISPUTED ? g.arbitrationAt : g.maxAt)) return;
        factory.cancelExpiredMarket(id);
        g.state = T.State.CANCELLED;
        g.outcome = T.Outcome.INVALID;
    }

    function claim(uint256 seed, uint256 actorSeed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        address who = actors[actorSeed % 8];
        GPosition storage p = positions[id][who];
        if (!_terminal(g) || p.settled) return;
        uint256 winning = g.outcome == T.Outcome.YES ? g.yes : g.no;
        bool refund = g.outcome == T.Outcome.INVALID || winning == 0;
        uint256 contribution = refund ? p.yes + p.no : (g.outcome == T.Outcome.YES ? p.yes : p.no);
        if (contribution == 0) return;
        uint256 owed = refund ? contribution : contribution * (g.yes + g.no - g.fee) / winning;
        vm.prank(who);
        if (refund) factory.claimRefundTo(id, actors[0]);
        else factory.claimTo(id, actors[0]);
        p.settled = true;
        participantPaid += owed;
        if (refund) g.refunded += owed;
        else g.paid += owed;
        vm.prank(who);
        (bool ok,) = address(factory)
            .call(refund ? abi.encodeCall(factory.claimRefund, (id)) : abi.encodeCall(factory.claim, (id)));
        doubleClaimSucceeded = doubleClaimSucceeded || ok;
    }

    function claimBond(uint256 seed, uint8 kindSeed) public {
        uint256 id = seed % factory.marketCount();
        uint8 kind = kindSeed % 3;
        if (!_terminal(ghost[id])) return;
        GBond storage b = bonds[id][kind];
        if (b.owner == address(0) || b.claimed) return;
        vm.prank(b.owner);
        factory.claimBond(id, T.BondType(kind), actors[0]);
        b.claimed = true;
        bondPaid += b.amount;
        vm.prank(b.owner);
        (bool ok,) = address(factory).call(abi.encodeCall(factory.claimBond, (id, T.BondType(kind), b.owner)));
        doubleClaimSucceeded = doubleClaimSucceeded || ok;
    }

    function fees(bool authorized, uint96 seed) public {
        uint256 available = accrued - feePaid;
        if (available == 0) return;
        uint256 amount = bound(seed, 1, available);
        if (!authorized) {
            vm.prank(alice);
            (bool ok,) = address(factory).call(abi.encodeCall(factory.withdrawProtocolFees, (amount, alice)));
            unauthorizedSucceeded = unauthorizedSucceeded || ok;
            return;
        }
        vm.prank(governance);
        factory.withdrawProtocolFees(amount, carol);
        feePaid += amount;
    }

    function forceNative(uint96 seed) public {
        uint256 amount = bound(seed, 1, 1e20);
        vm.deal(address(factory), address(factory).balance + amount);
        forced += amount;
    }

    function togglePause(bool pause_) public {
        if (pause_) {
            epochBreak[ghostEpoch] = uint64(block.timestamp);
            ++ghostEpoch;
            vm.prank(guardian);
            config.pause();
        } else {
            if (config.paused() || !config.financialActive()) _activate();
        }
    }

    function futureTerms(uint16 fee, uint64 bondSeed, uint8 minimumSeed) public {
        T.Parameters memory p = config.parameters();
        p.feeBps = uint16(bound(fee, 0, 1000));
        p.creationBond = uint128(bound(bondSeed, 0, 5 ether));
        p.proposalBond = p.creationBond / 2;
        p.challengeBond = p.creationBond / 3;
        p.minContribution = 1 + minimumSeed % 10;
        epochBreak[ghostEpoch] = uint64(block.timestamp);
        ++ghostEpoch;
        vm.prank(governance);
        config.setParameters(p);
        _activate();
    }

    function emergencyCancel(uint256 seed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (_terminal(g) || g.creationEpoch == ghostEpoch) return;
        uint256 ready = _refundAt(g);
        if (block.timestamp < ready) return;
        factory.cancelInterruptedMarket(id);
        g.state = T.State.CANCELLED;
        g.outcome = T.Outcome.INVALID;
    }

    function tryEarlyCancellation(uint256 seed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (_terminal(g) || g.creationEpoch == ghostEpoch || block.timestamp >= _refundAt(g)) return;
        (bool ok,) = address(factory).call(abi.encodeCall(factory.cancelInterruptedMarket, (id)));
        quarantineBypass = quarantineBypass || ok;
    }

    function tryQuarantinedWrites(uint256 seed) public {
        if (!config.financialActive() || config.paused()) return;
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        if (_terminal(g) || g.creationEpoch == ghostEpoch) return;
        vm.prank(alice);
        (bool p,) =
            address(factory).call{value: g.terms.minContribution}(abi.encodeCall(factory.predict, (id, T.Side.YES)));
        vm.prank(alice);
        (bool r,) = address(factory).call{value: g.terms.proposalBond}(
            abi.encodeCall(factory.proposeResult, (id, T.Outcome.YES, HASH))
        );
        vm.prank(bob);
        (bool c,) =
            address(factory).call{value: g.terms.challengeBond}(abi.encodeCall(factory.challengeResult, (id, HASH)));
        quarantineBypass = quarantineBypass || p || r || c;
    }

    function unauthorizedResume() public {
        if (!config.paused()) return;
        vm.prank(governance);
        (bool ok,) = address(config).call(abi.encodeCall(config.unpause, ()));
        unauthorizedSucceeded = unauthorizedSucceeded || ok;
    }

    function rejectingReceiverClaim(uint256 seed) public {
        uint256 id = seed % factory.marketCount();
        GMarket storage g = ghost[id];
        GPosition storage p = positions[id][actors[7]];
        if (!_terminal(g) || p.settled) return;
        uint256 winning = g.outcome == T.Outcome.YES ? g.yes : g.no;
        bool refund = g.outcome == T.Outcome.INVALID || winning == 0;
        uint256 userWinning = g.outcome == T.Outcome.YES ? p.yes : p.no;
        uint256 owed = refund ? p.yes + p.no : (winning == 0 ? 0 : userWinning * (g.yes + g.no - g.fee) / winning);
        if (owed == 0) return;
        vm.prank(actors[7]);
        (bool ok,) = address(factory)
            .call(refund ? abi.encodeCall(factory.claimRefund, (id)) : abi.encodeCall(factory.claim, (id)));
        quarantineBypass = quarantineBypass || ok;
    }

    function _refundAt(GMarket storage g) private view returns (uint256) {
        if (g.state == T.State.DISPUTED) return g.arbitrationAt;
        uint256 bound_ = uint256(epochBreak[g.creationEpoch]) + g.terms.challengePeriod;
        return bound_ < g.maxAt ? bound_ : g.maxAt;
    }

    function expectedRefundAt(uint256 id) external view returns (uint256) {
        GMarket storage g = ghost[id];
        return _terminal(g) || g.creationEpoch == ghostEpoch ? 0 : _refundAt(g);
    }

    function _finish(uint256 id, T.Outcome outcome) private {
        GMarket storage g = ghost[id];
        g.outcome = outcome;
        g.state = outcome == T.Outcome.INVALID ? T.State.CANCELLED : T.State.FINALIZED;
        uint256 winning = outcome == T.Outcome.YES ? g.yes : g.no;
        if (outcome != T.Outcome.INVALID && winning > 0) {
            g.fee = (g.yes + g.no) * g.terms.feeBps / 10000;
            accrued += g.fee;
        }
    }

    function _terminal(GMarket storage g) private view returns (bool) {
        return g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
    }

    function ghostMarket(uint256 id) external view returns (GMarket memory) {
        return ghost[id];
    }

    function ghostPosition(uint256 id, address who) external view returns (GPosition memory) {
        return positions[id][who];
    }

    function ghostBond(uint256 id, uint8 kind) external view returns (GBond memory) {
        return bonds[id][kind];
    }
}

contract OraklInvariantTest is OraklTestBase {
    OraklHandler internal handler;

    struct QuoteTotals {
        uint256 quotes;
        uint256 allPayouts;
        uint256 winners;
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        handler = new OraklHandler();
        factory = handler.protocol();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_A_Solvency() public view {
        assertLe(factory.totalAccounted(), address(factory).balance, "solvent");
        assertEq(address(factory).balance, factory.totalAccounted() + handler.forced(), "surplus excluded");
    }

    function invariant_B_NoDoubleClaim() public view {
        assertFalse(handler.doubleClaimSucceeded(), "no repeat withdrawal");
    }

    function invariant_C_PayoutBound() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            T.Market memory m = factory.getMarket(id);
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            assertEq(m.paidOut, g.paid, "payout ghost");
            assertLe(m.paidOut, m.distributablePool, "payout bounded");
        }
    }

    function invariant_D_RefundBound() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            T.Market memory m = factory.getMarket(id);
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            assertEq(m.refunded, g.refunded, "refund ghost");
            assertLe(m.refunded, g.yes + g.no, "refund bounded");
        }
    }

    function invariant_E_FeeIsolation() public view {
        uint256 principal;
        for (uint256 id; id < factory.marketCount(); ++id) {
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            principal += g.yes + g.no - g.paid - g.refunded - g.fee;
            assertEq(factory.getMarket(id).protocolFee, g.fee, "snapshot fee");
        }
        assertEq(factory.participantLiability(), principal, "participants independent of fees");
        assertEq(factory.feeLiability(), handler.accrued() - handler.feePaid(), "fees only");
        assertFalse(handler.unauthorizedSucceeded(), "no unauthorized arbitration or fees");
    }

    function invariant_F_BondIsolation() public view {
        uint256 outstanding;
        for (uint256 id; id < factory.marketCount(); ++id) {
            for (uint8 k; k < 3; ++k) {
                OraklHandler.GBond memory g = handler.ghostBond(id, k);
                T.Bond memory b = factory.getBond(id, T.BondType(k));
                assertEq(b.owner, g.owner, "bond owner");
                assertEq(b.amount, g.amount, "principal never slashed");
                assertEq(b.claimed, g.claimed, "bond paid once");
                if (!g.claimed) outstanding += g.amount;
            }
        }
        assertEq(factory.bondLiability(), outstanding, "isolated bonds");
        assertEq(factory.totalBondsPaid(), handler.bondPaid(), "bond outflows");
    }

    function invariant_G_TerminalConsistency() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            T.Market memory m = factory.getMarket(id);
            assertFalse(m.paidOut > 0 && m.refunded > 0, "exclusive paths");
            if (m.refundable) {
                assertEq(m.protocolFee, 0, "refund fee zero");
                assertEq(m.distributablePool, 0, "refund payout zero");
            }
            if (m.storedState == T.State.CANCELLED) {
                assertTrue(m.finalOutcome == T.Outcome.INVALID && m.refundable, "cancelled consistency");
            }
        }
    }

    function invariant_H_Finality() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            T.Market memory m = factory.getMarket(id);
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            assertEq(uint256(m.finalOutcome), uint256(g.outcome), "immutable final outcome");
            assertEq(uint256(m.storedState), uint256(g.state), "state matches independent history");
        }
    }

    function invariant_I_UserAccounting() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            uint256 yes;
            uint256 no;
            for (uint256 a; a < 8; ++a) {
                address who = handler.actorAt(a);
                T.Position memory p = factory.getPosition(id, who);
                OraklHandler.GPosition memory g = handler.ghostPosition(id, who);
                assertEq(p.yes, g.yes, "user yes");
                assertEq(p.no, g.no, "user no");
                assertEq(p.settled, g.settled, "settled");
                yes += p.yes;
                no += p.no;
            }
            T.Market memory m = factory.getMarket(id);
            assertEq(m.yesPool, yes, "sum yes");
            assertEq(m.noPool, no, "sum no");
        }
    }

    function invariant_J_Conservation() public view {
        uint256 paid = handler.participantPaid() + handler.bondPaid() + handler.feePaid();
        assertEq(factory.totalAccounted(), handler.deposits() - paid, "independent inflow/outflow conservation");
        assertEq(factory.totalContributions() + factory.totalBondsDeposited(), handler.deposits(), "received");
        assertEq(factory.totalParticipantPaid(), handler.participantPaid(), "participant withdrawals");
        assertEq(factory.totalFeesWithdrawn(), handler.feePaid(), "fee withdrawals");
    }

    function invariant_K_ReleaseAndEpochAuthorization() public view {
        ProtocolConfig c = handler.settings();
        assertEq(c.activityEpoch(), handler.ghostEpoch(), "independent interruption history");
        if (c.financialActive()) {
            assertFalse(c.paused(), "active release is unpaused");
            assertGe(block.timestamp, c.activationAfter(), "full review delay elapsed");
            assertTrue(c.approvedDigest() == c.releaseDigest(c.approvedRelease()), "epoch and control bound review");
        }
        assertFalse(handler.quarantineBypass(), "no early cancellation or revived funding");
    }

    function invariant_L_ImmutableEmergencyExit() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            assertEq(
                factory.interruptionRefundTime(id), handler.expectedRefundAt(id), "exit follows first interruption only"
            );
        }
    }

    function invariant_M_ImmutableTermsAndEvidence() public view {
        for (uint256 id; id < factory.marketCount(); ++id) {
            T.Market memory m = factory.getMarket(id);
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            assertTrue(keccak256(abi.encode(m.terms)) == keccak256(abi.encode(g.terms)), "all terms snapshotted");
            assertEq(m.closeTime, g.closeAt, "close commitment");
            assertEq(m.resolutionTime, g.resolveAt, "observation commitment");
            assertEq(m.maxResolutionTime, g.maxAt, "maximum commitment");
            assertEq(m.creationActivityEpoch, g.creationEpoch, "creation epoch commitment");
            assertTrue(m.metadataHash == HASH, "metadata commitment");
            assertEq(m.metadataURI, "ipfs://stateful", "URI commitment");
            if (m.proposer != address(0)) assertTrue(m.proposalEvidence == HASH, "proposal evidence retained");
            if (m.challenger != address(0)) assertTrue(m.challengeEvidence == HASH, "challenge evidence retained");
            if (m.decisionEvidence != bytes32(0)) assertTrue(m.decisionEvidence == HASH, "decision evidence retained");
        }
    }

    function invariant_N_QuotedEntitlementsAndDustReconcile() public view {
        uint256 remaining;
        for (uint256 id; id < factory.marketCount(); ++id) {
            OraklHandler.GMarket memory g = handler.ghostMarket(id);
            uint256 reserve = g.yes + g.no - g.paid - g.refunded - g.fee;
            remaining += reserve;
            uint256 winning = g.outcome == T.Outcome.YES ? g.yes : g.no;
            bool refund = g.outcome == T.Outcome.INVALID || winning == 0;
            bool terminal = g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
            QuoteTotals memory q = _quotes(id, g);
            if (!terminal) {
                assertEq(q.quotes, 0, "nonterminal quotes zero");
            } else if (refund) {
                assertEq(q.quotes, reserve, "all unclaimed principal quoted");
            } else {
                uint256 dust = g.yes + g.no - g.fee - q.allPayouts;
                assertLt(dust, q.winners, "floor residual bounded by winner count");
                assertEq(q.quotes + dust, reserve, "only floor dust exceeds quoted claims");
            }
        }
        assertEq(remaining, factory.participantLiability(), "quoted claims plus dust reconcile across markets");
    }

    function _quotes(uint256 id, OraklHandler.GMarket memory g) private view returns (QuoteTotals memory q) {
        uint256 winning = g.outcome == T.Outcome.YES ? g.yes : g.no;
        bool terminal = g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
        for (uint256 a; a < 8; ++a) {
            address actor = handler.actorAt(a);
            OraklHandler.GPosition memory p = handler.ghostPosition(id, actor);
            (uint256 payout, uint256 refundQuote) = factory.getClaimable(id, actor);
            if (!terminal || p.settled) assertEq(payout + refundQuote, 0, "no live or settled entitlement");
            q.quotes += payout + refundQuote;
            if (terminal && g.outcome != T.Outcome.INVALID && winning > 0) {
                uint256 contribution = g.outcome == T.Outcome.YES ? p.yes : p.no;
                if (contribution > 0) ++q.winners;
                q.allPayouts += contribution * (g.yes + g.no - g.fee) / winning;
            }
        }
    }
}
