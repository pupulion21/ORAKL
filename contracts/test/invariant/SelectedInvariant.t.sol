// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {SelectedBase} from "../selected/SelectedBase.sol";
import {TestBase} from "../helpers/TestBase.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

contract SelectedHandler is SelectedBase {
    struct G {
        uint256 y;
        uint256 n;
        uint256 s;
        uint256 paid;
        uint256 refund;
        uint256 fee;
        uint256 bondPaid;
        uint64 end;
        uint64 max;
        uint64 d;
        uint64 a;
        uint64 epoch;
        address arb;
        T.State state;
        T.Outcome proposal;
        T.Outcome outcome;
        uint256[8] yes;
        uint256[8] no;
        uint256[8] stake;
        uint256[8] prefix;
        bool[8] settled;
        bool[8] claimed;
        bool kClaimed;
        bool pClaimed;
    }
    mapping(uint256 => G) internal ledger;
    address[8] public actors;
    address[2] public arbiters;
    uint256 public count;
    uint256 public inflow;
    uint256 public outflow;
    uint256 public forced;
    uint256 public feeOut;
    uint256 public epoch;
    bool public active = true;
    bool public bad;
    mapping(uint256 => uint256) public firstBreak;

    constructor() {
        _deploySelected();
        arbiters = [arbitrator, address(new MutableMultisig(400, 5))];
        for (uint256 i; i < 8; ++i) {
            actors[i] = address(uint160(10000 + i));
            vm.deal(actors[i], 1e30);
        }
        create();
        deposit(0, 0, true, 2000);
        deposit(0, 1, false, 3000);
        vm.warp(resolution);
        propose(0, 0);
        stake(0, 0, 1);
        stake(0, 1, 3);
        vm.warp(ledger[0].d);
        decide(0, 1);
        claimBondAction(0, 2, 0);
        create();
        vm.warp(resolution);
        propose(1, 2);
        stake(1, 2, 1);
        vm.warp(ledger[1].d);
        decide(1, 2);
        create();
        deposit(2, 3, true, 1000);
    }

    function protocol() external view returns (SelectedMarketFactory) {
        return selected;
    }

    function ghost(uint256 id) external view returns (G memory) {
        return ledger[id];
    }

    function create() public {
        if (!active || count >= 12) return;
        uint256 id = _new();
        G storage g = ledger[id];
        g.end = close;
        g.max = expiry;
        g.epoch = uint64(epoch);
        g.arb = arbitrator;
        g.state = T.State.OPEN;
        ++count;
        inflow += 1 ether;
    }

    function deposit(uint256 id, uint256 who, bool yes, uint256 amountSeed) public {
        if (count == 0 || !active) return;
        id %= count;
        who %= 8;
        G storage g = ledger[id];
        if (g.state != T.State.OPEN || block.timestamp >= g.end || g.epoch != epoch) return;
        uint256 amount = (1 + amountSeed % 1000) * 0.01 ether;
        if (g.y + g.n + amount > 100 ether) return;
        uint256 global;
        uint256 arb;
        for (uint256 i; i < count; ++i) {
            if (!_terminal(ledger[i])) {
                global += ledger[i].y + ledger[i].n;
                if (ledger[i].arb == g.arb) arb += ledger[i].y + ledger[i].n;
            }
        }
        if (global + amount > 300 ether || arb + amount > 200 ether) return;
        _predict(id, actors[who], yes ? T.Side.YES : T.Side.NO, amount);
        if (yes) {
            g.y += amount;
            g.yes[who] += amount;
        } else {
            g.n += amount;
            g.no[who] += amount;
        }
        inflow += amount;
    }

    function advance(uint256 dt) public {
        vm.warp(block.timestamp + dt % 4 days);
    }

    function propose(uint256 id, uint8 result) public {
        if (!active || count == 0) return;
        id %= count;
        G storage g = ledger[id];
        if (
            g.state != T.State.OPEN || g.epoch != epoch || block.timestamp < g.end + 100
                || block.timestamp >= g.max - 6 days
        ) return;
        T.Outcome o = T.Outcome(1 + result % 3);
        _propose(id, o);
        g.proposal = o;
        g.state = T.State.PROPOSED;
        g.d = uint64(block.timestamp + 48 hours);
        g.a = g.d + 96 hours;
        inflow += 10 ether;
    }

    function stake(uint256 id, uint256 who, uint256 amountSeed) public {
        if (!active || count == 0) return;
        id %= count;
        who %= 8;
        G storage g = ledger[id];
        if (
            g.epoch != epoch || (g.state != T.State.PROPOSED && g.state != T.State.DISPUTED) || block.timestamp >= g.d
                || g.stake[who] != 0
        ) return;
        uint256 amount = 1 ether + amountSeed % 100 ether;
        _stake(id, actors[who], amount);
        g.prefix[who] = g.s;
        g.stake[who] = amount;
        g.s += amount;
        g.state = T.State.DISPUTED;
        inflow += amount;
    }

    function evidence(uint256 id) public {
        if (count == 0) return;
        id %= count;
        G storage g = ledger[id];
        if ((g.state == T.State.PROPOSED || g.state == T.State.DISPUTED) && block.timestamp < g.d) {
            selected.submitEvidence(id, HASH);
        }
    }

    function decide(uint256 id, uint8 result) public {
        if (count == 0) return;
        id %= count;
        G storage g = ledger[id];
        T.Outcome o = T.Outcome(1 + result % 3);
        if (g.state == T.State.DISPUTED) {
            if (block.timestamp < g.d || block.timestamp >= g.a) return;
            vm.prank(g.arb);
            selected.settleDispute(id, o, HASH);
        } else if (g.state == T.State.PROPOSED) {
            if (!active || g.epoch != epoch || block.timestamp < g.d || block.timestamp >= g.max) return;
            selected.finalizeResult(id);
            o = g.proposal;
        } else {
            return;
        }
        _finish(g, o);
    }

    function cancel(uint256 id) public {
        if (count == 0) return;
        id %= count;
        G storage g = ledger[id];
        if (_terminal(g)) return;
        uint256 expiry_ = g.state == T.State.DISPUTED ? g.a : g.max;
        if (g.epoch != epoch) {
            uint256 early = g.state == T.State.DISPUTED ? g.a : firstBreak[g.epoch] + 48 hours;
            if (early > g.max) early = g.max;
            if (block.timestamp >= early) {
                selected.cancelInterruptedMarket(id);
                _finish(g, T.Outcome.INVALID);
                return;
            }
        }
        if (block.timestamp < expiry_) return;
        selected.cancelExpiredMarket(id);
        _finish(g, T.Outcome.INVALID);
    }

    function interrupt() public {
        vm.prank(guardian);
        config.pause();
        firstBreak[epoch] = block.timestamp;
        ++epoch;
        active = false;
    }

    function recover(bool switchArb) public {
        if (active) return;
        if (switchArb) {
            T.Parameters memory p = config.parameters();
            p.arbitrator = p.arbitrator == arbiters[0] ? arbiters[1] : arbiters[0];
            vm.prank(governance);
            config.setParameters(p);
            firstBreak[epoch] = block.timestamp;
            ++epoch;
            arbitrator = p.arbitrator;
        }
        _activate();
        active = true;
    }

    function claim(uint256 id, uint256 who) public {
        if (count == 0) return;
        id %= count;
        who %= 8;
        G storage g = ledger[id];
        if (!_terminal(g) || g.settled[who]) return;
        bool refundable = _refund(g);
        uint256 contribution = refundable ? g.yes[who] + g.no[who] : g.outcome == T.Outcome.YES ? g.yes[who] : g.no[who];
        if (contribution == 0) return;
        uint256 amount =
            refundable ? contribution : contribution * (g.y + g.n - g.fee) / (g.outcome == T.Outcome.YES ? g.y : g.n);
        vm.prank(actors[who]);
        if (refundable) selected.claimRefund(id);
        else selected.claim(id);
        g.settled[who] = true;
        if (refundable) g.refund += amount;
        else g.paid += amount;
        outflow += amount;
    }

    function entitlement(uint256 id, uint8 kind, uint256 who) public view returns (uint256) {
        G storage g = ledger[id];
        if (!_terminal(g)) return 0;
        if (kind == 0) return g.kClaimed ? 0 : 1 ether;
        bool neutral = _refund(g) || g.s == 0;
        if (kind == 1) {
            if (g.pClaimed || g.proposal == T.Outcome.UNRESOLVED) return 0;
            return neutral ? 10 ether : g.outcome == g.proposal ? 10 ether + g.s : 0;
        }
        if (g.claimed[who] || g.stake[who] == 0) return 0;
        if (neutral) return g.stake[who];
        if (g.outcome == g.proposal) return 0;
        return g.stake[who] + 10 ether * (g.prefix[who] + g.stake[who]) / g.s - 10 ether * g.prefix[who] / g.s;
    }

    function claimBondAction(uint256 id, uint8 kind, uint256 who) public {
        if (count == 0) return;
        id %= count;
        kind %= 3;
        who %= 8;
        G storage g = ledger[id];
        if (!_terminal(g)) return;
        if (
            kind == 0 && g.kClaimed || kind == 1 && (g.pClaimed || g.proposal == T.Outcome.UNRESOLVED) || kind == 2
                && (g.claimed[who] || g.stake[who] == 0)
        ) return;
        uint256 amount = entitlement(id, kind, who);
        vm.prank(kind == 2 ? actors[who] : alice);
        selected.claimBond(id, T.BondType(kind), alice);
        if (kind == 0) g.kClaimed = true;
        else if (kind == 1) g.pClaimed = true;
        else g.claimed[who] = true;
        g.bondPaid += amount;
        outflow += amount;
    }

    function withdrawFee(uint256 seed) public {
        if (!active) return;
        uint256 available;
        for (uint256 i; i < count; ++i) {
            available += ledger[i].fee;
        }
        available -= feeOut;
        if (available == 0) return;
        uint256 amount = 1 + seed % available;
        vm.prank(governance);
        selected.withdrawProtocolFees(amount, alice);
        feeOut += amount;
        outflow += amount;
    }

    function faultStake(uint256 id, uint256 who, uint8 role, uint8 fault) public {
        address wallet = role % 3 == 0 ? governance : role % 3 == 1 ? compliance : arbitrator;
        MutableMultisig(wallet).setFault(1 + fault % 5);
        stake(id, who, 0);
        MutableMultisig(wallet).setFault(0);
    }

    function force(uint64 value) public {
        vm.deal(address(selected), address(selected).balance + value);
        forced += value;
    }

    function _finish(G storage g, T.Outcome o) private {
        g.outcome = o;
        g.state = o == T.Outcome.INVALID ? T.State.CANCELLED : T.State.FINALIZED;
        if (!_refund(g)) g.fee = (g.y + g.n) * 2 / 100;
    }

    function _terminal(G storage g) private view returns (bool) {
        return g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
    }

    function _refund(G storage g) private view returns (bool) {
        return g.outcome == T.Outcome.INVALID || (g.outcome == T.Outcome.YES ? g.y : g.n) == 0;
    }
}

contract SelectedInvariantTest is TestBase {
    SelectedHandler private handler;
    SelectedMarketFactory private protocol;

    function setUp() public {
        vm.warp(1_800_000_000);
        handler = new SelectedHandler();
        protocol = handler.protocol();
    }

    function targetContracts() external view returns (address[] memory a) {
        a = new address[](1);
        a[0] = address(handler);
    }

    function invariant_SelectedSolvencyAndConservation() public view {
        assertEq(protocol.totalAccounted(), handler.inflow() - handler.outflow(), "ghost inflows/outputs");
        assertEq(address(protocol).balance, protocol.totalAccounted() + handler.forced(), "forced excluded");
    }

    function invariant_SelectedExposureGlobalAndArbitrator() public view {
        uint256 total;
        uint256[2] memory arb;
        for (uint256 i; i < handler.count(); ++i) {
            SelectedHandler.G memory g = handler.ghost(i);
            bool terminal = g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
            assertEq(protocol.exposureReleased(i), terminal, "exactly once release");
            if (!terminal) {
                total += g.y + g.n;
                arb[g.arb == handler.arbiters(0) ? 0 : 1] += g.y + g.n;
            }
        }
        assertEq(protocol.totalUnresolvedExposure(), total, "unresolved ghost");
        assertLe(total, 300 ether, "global cap");
        for (uint256 a; a < 2; ++a) {
            assertEq(protocol.unresolvedExposureByArbitrator(handler.arbiters(a)), arb[a], "arb ghost");
            assertLe(arb[a], 200 ether, "arb cap");
        }
    }

    function invariant_SelectedExactBondEntitlements() public view {
        uint256 liability;
        for (uint256 i; i < handler.count(); ++i) {
            SelectedHandler.G memory g = handler.ghost(i);
            uint256 original = 1 ether + (g.proposal == T.Outcome.UNRESOLVED ? 0 : 10 ether) + g.s;
            liability += original - g.bondPaid;
            bool terminal = g.state == T.State.FINALIZED || g.state == T.State.CANCELLED;
            uint256 quotes;
            for (uint8 k; k < 2; ++k) {
                uint256 q = protocol.getBondEntitlement(i, T.BondType(k), address(0xa11ce));
                assertEq(q, handler.entitlement(i, k, 0), "owner quote");
                quotes += q;
            }
            for (uint256 a; a < 8; ++a) {
                uint256 q = protocol.getBondEntitlement(i, T.BondType.CHALLENGE, handler.actors(a));
                assertEq(q, handler.entitlement(i, 2, a), "tranche quote");
                quotes += q;
            }
            if (terminal) assertEq(quotes + g.bondPaid, original, "K+P+S exact no dust");
            else assertEq(quotes, 0, "no early reward");
        }
        assertEq(protocol.bondLiability(), liability, "bond isolated");
    }

    function invariant_SelectedPoolsFeesAndFinality() public view {
        uint256 liability;
        uint256 fees;
        for (uint256 i; i < handler.count(); ++i) {
            SelectedHandler.G memory g = handler.ghost(i);
            T.Market memory m = protocol.getMarket(i);
            assertEq(m.yesPool, g.y, "yes ghost");
            assertEq(m.noPool, g.n, "no ghost");
            assertEq(uint256(m.finalOutcome), uint256(g.outcome), "finality");
            assertEq(m.protocolFee, g.fee, "fee");
            assertEq(m.paidOut, g.paid, "payouts");
            assertEq(m.refunded, g.refund, "refunds");
            liability += g.y + g.n - g.paid - g.refund - g.fee;
            fees += g.fee;
        }
        assertEq(protocol.participantLiability(), liability, "participant reserve");
        assertEq(protocol.feeLiability(), fees - handler.feeOut(), "fee reserve");
    }
}
