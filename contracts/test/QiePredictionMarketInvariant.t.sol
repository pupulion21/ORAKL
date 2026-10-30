// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {QiePredictionMarket} from "../src/QiePredictionMarket.sol";
import {TestBase} from "./helpers/TestBase.sol";

/// @dev Handler-based invariant suite for the native-QIE market. Ghost state mirrors
///      pools, paid-outs and settlement flags; the invariants compare it against chain
///      state and prove that the native balance is exactly escrow plus forced surplus.
contract MarketHandler is TestBase {
    QiePredictionMarket public market;
    address[4] public actors;
    uint256 public constant ACTOR_FUNDS = 1_000 ether;

    struct GhostMarket {
        uint128 yes;
        uint128 no;
        QiePredictionMarket.Outcome outcome;
        bool cancelled;
        uint64 closeTime;
        uint64 resolveDeadline;
        uint256 paid;
    }

    struct GhostPosition {
        uint128 yes;
        uint128 no;
        bool settled;
    }

    uint256[] public marketIds;
    mapping(uint256 => GhostMarket) public ghostMarket;
    mapping(uint256 => mapping(address => GhostPosition)) public ghostPosition;
    uint256 public directTransferred;

    constructor() {
        market = new QiePredictionMarket();
        actors = [makeAddr("actor0"), makeAddr("actor1"), makeAddr("actor2"), makeAddr("actor3")];
        for (uint256 i; i < actors.length; ++i) {
            vm.deal(actors[i], ACTOR_FUNDS);
        }
    }

    // ------------------------------------------------------------- actions
    function createMarket(uint256 seed) external {
        uint64 close = uint64(block.timestamp + bound(seed, 50, 500));
        uint64 deadline = close + uint64(bound(seed / 7, 50, 500));
        uint256 id = market.createMarket("q", "c", "s", address(this), close, deadline);
        GhostMarket storage g = ghostMarket[id];
        g.closeTime = close;
        g.resolveDeadline = deadline;
        marketIds.push(id);
    }

    function warp(uint256 deltaSeed) external {
        vm.warp(block.timestamp + bound(deltaSeed, 1, 200));
    }

    function stake(uint256 marketSeed, uint256 actorSeed, uint256 sideSeed, uint256 amountSeed) external {
        if (marketIds.length == 0) return;
        uint256 id = marketIds[marketSeed % marketIds.length];
        GhostMarket storage g = ghostMarket[id];
        if (g.outcome != QiePredictionMarket.Outcome.UNRESOLVED || g.cancelled) return;
        if (block.timestamp >= g.closeTime) return;

        address who = actors[actorSeed % actors.length];
        uint256 amount = bound(amountSeed, 1, 1e20);
        if (uint256(g.yes) + uint256(g.no) + amount > market.MAX_TOTAL_POOL()) return;
        if (who.balance < amount) return;

        QiePredictionMarket.Side side =
            sideSeed % 2 == 0 ? QiePredictionMarket.Side.YES : QiePredictionMarket.Side.NO;
        vm.prank(who);
        market.stake{value: amount}(id, side);

        GhostPosition storage p = ghostPosition[id][who];
        if (side == QiePredictionMarket.Side.YES) {
            g.yes = uint128(uint256(g.yes) + amount);
            p.yes = uint128(uint256(p.yes) + amount);
        } else {
            g.no = uint128(uint256(g.no) + amount);
            p.no = uint128(uint256(p.no) + amount);
        }
    }

    function resolve(uint256 marketSeed, uint256 outcomeSeed) external {
        if (marketIds.length == 0) return;
        uint256 id = marketIds[marketSeed % marketIds.length];
        GhostMarket storage g = ghostMarket[id];
        if (g.outcome != QiePredictionMarket.Outcome.UNRESOLVED || g.cancelled) return;
        if (block.timestamp < g.closeTime || block.timestamp >= g.resolveDeadline) return;

        uint256 pick = outcomeSeed % 3;
        QiePredictionMarket.Outcome outcome = pick == 0
            ? QiePredictionMarket.Outcome.YES
            : pick == 1
                ? QiePredictionMarket.Outcome.NO
                : QiePredictionMarket.Outcome.INVALID;
        market.resolve(id, outcome);
        g.outcome = outcome;
    }

    function cancelIfExpired(uint256 marketSeed) external {
        if (marketIds.length == 0) return;
        uint256 id = marketIds[marketSeed % marketIds.length];
        GhostMarket storage g = ghostMarket[id];
        if (g.outcome != QiePredictionMarket.Outcome.UNRESOLVED || g.cancelled) return;
        if (block.timestamp < g.resolveDeadline) return;

        market.cancelIfExpired(id);
        g.cancelled = true;
    }

    function claim(uint256 marketSeed, uint256 actorSeed) external {
        if (marketIds.length == 0) return;
        uint256 id = marketIds[marketSeed % marketIds.length];
        GhostMarket storage g = ghostMarket[id];
        if (g.outcome != QiePredictionMarket.Outcome.YES && g.outcome != QiePredictionMarket.Outcome.NO) return;

        uint256 winning = g.outcome == QiePredictionMarket.Outcome.YES ? uint256(g.yes) : uint256(g.no);
        if (winning == 0) return;

        address who = actors[actorSeed % actors.length];
        GhostPosition storage p = ghostPosition[id][who];
        if (p.settled) return;

        uint256 userWinning = g.outcome == QiePredictionMarket.Outcome.YES ? uint256(p.yes) : uint256(p.no);
        if (userWinning == 0) return;

        uint256 owed = (userWinning * (uint256(g.yes) + uint256(g.no))) / winning;
        vm.prank(who);
        market.claim(id);
        p.settled = true;
        g.paid += owed;
    }

    function refund(uint256 marketSeed, uint256 actorSeed) external {
        if (marketIds.length == 0) return;
        uint256 id = marketIds[marketSeed % marketIds.length];
        GhostMarket storage g = ghostMarket[id];

        uint256 winning = g.outcome == QiePredictionMarket.Outcome.YES ? uint256(g.yes) : uint256(g.no);
        bool refundable = g.cancelled || g.outcome == QiePredictionMarket.Outcome.INVALID
            || ((g.outcome == QiePredictionMarket.Outcome.YES || g.outcome == QiePredictionMarket.Outcome.NO)
                && winning == 0);
        if (!refundable) return;

        address who = actors[actorSeed % actors.length];
        GhostPosition storage p = ghostPosition[id][who];
        if (p.settled) return;

        uint256 owed = uint256(p.yes) + uint256(p.no);
        if (owed == 0) return;

        vm.prank(who);
        market.refund(id);
        p.settled = true;
        g.paid += owed;
    }

    /// @dev Simulates an unsolicited native credit (selfdestruct / forced transfer).
    function forcedTransfer(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1e20);
        vm.deal(address(market), address(market).balance + amount);
        directTransferred += amount;
    }

    // ----------------------------------------------------------- accessors
    function marketIdCount() external view returns (uint256) {
        return marketIds.length;
    }

    function marketIdAt(uint256 index) external view returns (uint256) {
        return marketIds[index];
    }

    function actorAt(uint256 index) external view returns (address) {
        return actors[index];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function ghostPools(uint256 id) external view returns (uint256 yes, uint256 no) {
        return (uint256(ghostMarket[id].yes), uint256(ghostMarket[id].no));
    }

    function ghostPaid(uint256 id) external view returns (uint256) {
        return ghostMarket[id].paid;
    }

    function ghostOutcome(uint256 id) external view returns (QiePredictionMarket.Outcome) {
        return ghostMarket[id].outcome;
    }

    function ghostCancelled(uint256 id) external view returns (bool) {
        return ghostMarket[id].cancelled;
    }

    function ghostPositionOf(uint256 id, address who)
        external
        view
        returns (uint256 yes, uint256 no, bool settled)
    {
        GhostPosition storage p = ghostPosition[id][who];
        return (uint256(p.yes), uint256(p.no), p.settled);
    }
}

contract QiePredictionMarketInvariantTest is TestBase {
    MarketHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        handler = new MarketHandler();
    }

    /// @dev Foundry invariant executor calls this view on the test contract. Returning
    ///      only the handler keeps the fuzzer from mutating contract state directly.
    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// @notice The native balance is exactly accounted escrow plus forced surplus.
    function invariant_balanceEqualsEscrowPlusSurplus() public view {
        QiePredictionMarket market = handler.market();
        uint256 balance = address(market).balance;
        uint256 escrow = market.totalEscrow();
        assertEq(balance, escrow + handler.directTransferred(), "balance == escrow + forced surplus");
        assertEq(market.unaccountedBalance(), handler.directTransferred(), "unaccounted == forced surplus");
    }

    /// @notice Global escrow equals the sum of every market's remaining escrow.
    function invariant_globalEscrowMatchesMarketSum() public view {
        QiePredictionMarket market = handler.market();
        uint256 count = handler.marketIdCount();
        uint256 sum;
        for (uint256 i; i < count; ++i) {
            sum += market.remainingEscrow(handler.marketIdAt(i));
        }
        assertEq(sum, market.totalEscrow(), "sum(market escrow) == total escrow");
    }

    /// @notice Per-market pools, outcome, cancellation and paid-out match ghost state,
    ///         and paid-out never exceeds the pool.
    function invariant_marketAccountingMatchesGhost() public view {
        QiePredictionMarket market = handler.market();
        uint256 count = handler.marketIdCount();
        for (uint256 i; i < count; ++i) {
            uint256 id = handler.marketIdAt(i);
            QiePredictionMarket.MarketView memory v = market.getMarket(id);
            (uint256 ghostYes, uint256 ghostNo) = handler.ghostPools(id);

            assertEq(v.yesStake, ghostYes, "yes pool matches ghost");
            assertEq(v.noStake, ghostNo, "no pool matches ghost");
            assertEq(v.paidOut, handler.ghostPaid(id), "paidOut matches ghost");
            assertEq(uint256(v.outcome), uint256(handler.ghostOutcome(id)), "outcome matches ghost");
            assertEq(v.cancelled, handler.ghostCancelled(id), "cancelled matches ghost");
            assertLe(v.paidOut, v.yesStake + v.noStake, "paidOut <= pool");
            assertEq(v.remainingEscrow, v.yesStake + v.noStake - v.paidOut, "escrow == pool - paid");
        }
    }

    /// @notice Positions and settlement flags match ghost state for every actor.
    function invariant_positionsMatchGhost() public view {
        QiePredictionMarket market = handler.market();
        uint256 marketCount = handler.marketIdCount();
        uint256 actorCount = handler.actorCount();
        for (uint256 i; i < marketCount; ++i) {
            uint256 id = handler.marketIdAt(i);
            for (uint256 a; a < actorCount; ++a) {
                address who = handler.actorAt(a);
                (uint256 ghostYes, uint256 ghostNo, bool ghostSettled) = handler.ghostPositionOf(id, who);
                (uint256 yes, uint256 no, bool settled) = market.getPosition(id, who);
                assertEq(yes, ghostYes, "position yes matches ghost");
                assertEq(no, ghostNo, "position no matches ghost");
                assertEq(settled, ghostSettled, "settled matches ghost");
            }
        }
    }

    /// @notice No market can pay out more than all markets received.
    function invariant_totalPaidOutNeverExceedsReceived() public view {
        QiePredictionMarket market = handler.market();
        assertLe(market.totalPaidOut(), market.totalStakeReceived(), "total paid <= total received");
    }
}
