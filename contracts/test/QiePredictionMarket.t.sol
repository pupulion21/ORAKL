// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {QiePredictionMarket} from "../src/QiePredictionMarket.sol";
import {ReentrancyAttacker, RevertingReceiver} from "./doubles/NativeReentrancy.sol";
import {TestBase} from "./helpers/TestBase.sol";

contract QiePredictionMarketTest is TestBase {
    uint256 internal constant T0 = 1_700_000_000;
    uint64 internal constant CLOSE_AT = uint64(T0 + 1000);
    uint64 internal constant DEADLINE_AT = uint64(T0 + 2000);

    QiePredictionMarket internal market;

    address internal creator = makeAddr("creator");
    address internal resolver = makeAddr("resolver");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");

    function setUp() public virtual {
        vm.warp(T0);
        market = new QiePredictionMarket();
        vm.deal(creator, 1_000 ether);
        vm.deal(resolver, 1_000 ether);
        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
        vm.deal(dave, 1_000 ether);
    }

    // --------------------------------------------------------------- helpers
    function _createDefaultMarket() internal returns (uint256) {
        vm.prank(creator);
        return market.createMarket(
            "Apakah X terjadi sebelum 31 Desember 2026?",
            "YES jika sumber resmi menyatakan X terjadi; NO jika tidak; INVALID jika tidak dapat diverifikasi.",
            "https://example.com/sumber-resmi",
            resolver,
            CLOSE_AT,
            DEADLINE_AT
        );
    }

    function _stake(address who, uint256 marketId, QiePredictionMarket.Side side, uint256 amount) internal {
        vm.prank(who);
        market.stake{value: amount}(marketId, side);
    }

    function _resolve(address who, uint256 marketId, QiePredictionMarket.Outcome outcome) internal {
        vm.prank(who);
        market.resolve(marketId, outcome);
    }

    function _repeat(bytes1 ch, uint256 length) internal pure returns (string memory) {
        bytes memory out = new bytes(length);
        for (uint256 i; i < length; ++i) {
            out[i] = ch;
        }
        return string(out);
    }

    function _seedWinningMarket() internal returns (uint256 marketId) {
        marketId = _createDefaultMarket();
        _stake(alice, marketId, QiePredictionMarket.Side.YES, 10 ether);
        _stake(bob, marketId, QiePredictionMarket.Side.YES, 30 ether);
        _stake(carol, marketId, QiePredictionMarket.Side.NO, 20 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, marketId, QiePredictionMarket.Outcome.YES);
    }

    // -------------------------------------------------------------- creation
    function testCreateMarketStoresImmutableFields() public {
        uint256 id = _createDefaultMarket();
        QiePredictionMarket.MarketView memory v = market.getMarket(id);

        assertEq(v.creator, creator, "creator");
        assertEq(v.resolver, resolver, "resolver");
        assertEq(uint256(v.closeTime), uint256(CLOSE_AT), "closeTime");
        assertEq(uint256(v.resolveDeadline), uint256(DEADLINE_AT), "resolveDeadline");
        assertTrue(v.outcome == QiePredictionMarket.Outcome.UNRESOLVED, "outcome");
        assertFalse(v.cancelled, "cancelled");
        assertEq(v.yesStake, 0, "yes stake");
        assertEq(v.noStake, 0, "no stake");
        assertEq(v.paidOut, 0, "paidOut");
        assertEq(v.remainingEscrow, 0, "remainingEscrow");
        assertFalse(v.refundable, "refundable");

        (string memory question, string memory criteria, string memory source) = market.getMarketMeta(id);
        assertEq(question, "Apakah X terjadi sebelum 31 Desember 2026?", "question");
        assertEq(
            criteria,
            "YES jika sumber resmi menyatakan X terjadi; NO jika tidak; INVALID jika tidak dapat diverifikasi.",
            "criteria"
        );
        assertEq(source, "https://example.com/sumber-resmi", "source");
        assertEq(market.marketCount(), 1, "marketCount");
    }

    function testMarketCountIncrements() public {
        _createDefaultMarket();
        _createDefaultMarket();
        assertEq(market.marketCount(), 2, "two markets");
    }

    function testCreateMarketAcceptsMaximumMetadata() public {
        vm.prank(creator);
        uint256 id = market.createMarket(
            _repeat(0x61, market.MAX_QUESTION_BYTES()),
            _repeat(0x62, market.MAX_CRITERIA_BYTES()),
            _repeat(0x63, market.MAX_SOURCE_BYTES()),
            resolver,
            CLOSE_AT,
            DEADLINE_AT
        );
        (string memory q, string memory c, string memory s) = market.getMarketMeta(id);
        assertEq(bytes(q).length, market.MAX_QUESTION_BYTES(), "question max");
        assertEq(bytes(c).length, market.MAX_CRITERIA_BYTES(), "criteria max");
        assertEq(bytes(s).length, market.MAX_SOURCE_BYTES(), "source max");
    }

    function testCreateMarketRejectsEmptyQuestion() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.EmptyQuestion.selector);
        market.createMarket("", "c", "s", resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsEmptyCriteria() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.EmptyCriteria.selector);
        market.createMarket("q", "", "s", resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsEmptySource() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.EmptySource.selector);
        market.createMarket("q", "c", "", resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsQuestionTooLong() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(QiePredictionMarket.QuestionTooLong.selector, uint256(281), uint256(280))
        );
        market.createMarket(_repeat(0x61, 281), "c", "s", resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsCriteriaTooLong() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(QiePredictionMarket.CriteriaTooLong.selector, uint256(2001), uint256(2000))
        );
        market.createMarket("q", _repeat(0x61, 2001), "s", resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsSourceTooLong() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(QiePredictionMarket.SourceTooLong.selector, uint256(513), uint256(512))
        );
        market.createMarket("q", "c", _repeat(0x61, 513), resolver, CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsZeroResolver() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.ZeroResolver.selector);
        market.createMarket("q", "c", "s", address(0), CLOSE_AT, DEADLINE_AT);
    }

    function testCreateMarketRejectsCloseTimeNotInFuture() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.CloseTimeNotInFuture.selector);
        market.createMarket("q", "c", "s", resolver, uint64(T0), DEADLINE_AT);

        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.CloseTimeNotInFuture.selector);
        market.createMarket("q", "c", "s", resolver, uint64(T0 - 1), DEADLINE_AT);
    }

    function testCreateMarketRejectsDeadlineNotAfterClose() public {
        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.ResolveDeadlineNotAfterClose.selector);
        market.createMarket("q", "c", "s", resolver, CLOSE_AT, CLOSE_AT);

        vm.prank(creator);
        vm.expectRevert(QiePredictionMarket.ResolveDeadlineNotAfterClose.selector);
        market.createMarket("q", "c", "s", resolver, CLOSE_AT, uint64(CLOSE_AT - 1));
    }

    // --------------------------------------------------------------- staking
    function testStakeSplitsPoolsAndPositions() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        _stake(bob, id, QiePredictionMarket.Side.NO, 3 ether);
        _stake(alice, id, QiePredictionMarket.Side.YES, 2 ether);

        QiePredictionMarket.MarketView memory v = market.getMarket(id);
        assertEq(v.yesStake, 12 ether, "yes pool");
        assertEq(v.noStake, 3 ether, "no pool");
        assertEq(v.paidOut, 0, "paidOut");
        assertEq(v.remainingEscrow, 15 ether, "escrow");
        assertEq(market.totalStakeReceived(), 15 ether, "total received");
        assertEq(address(market).balance, 15 ether, "native balance");

        (uint256 yes, uint256 no, bool settled) = market.getPosition(id, alice);
        assertEq(yes, 12 ether, "alice yes");
        assertEq(no, 0, "alice no");
        assertFalse(settled, "alice settled");
    }

    function testStakeRejectsZeroAmount() public {
        uint256 id = _createDefaultMarket();
        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.ZeroAmount.selector);
        market.stake{value: 0}(id, QiePredictionMarket.Side.YES);
    }

    function testStakeRejectsAtAndAfterCloseTime() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.MarketClosed.selector);
        market.stake{value: 1 ether}(id, QiePredictionMarket.Side.YES);

        vm.warp(CLOSE_AT + 1);
        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.MarketClosed.selector);
        market.stake{value: 1 ether}(id, QiePredictionMarket.Side.NO);
    }

    function testStakeRejectsUnknownMarket() public {
        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.MarketNotFound.selector);
        market.stake{value: 1 ether}(0, QiePredictionMarket.Side.YES);
    }

    function testStakeRejectsPoolCapExceeded() public {
        uint256 id = _createDefaultMarket();
        uint256 cap = market.MAX_TOTAL_POOL();
        vm.deal(alice, cap);

        vm.prank(alice);
        market.stake{value: cap}(id, QiePredictionMarket.Side.YES);

        vm.prank(bob);
        vm.expectRevert(QiePredictionMarket.TotalPoolCapExceeded.selector);
        market.stake{value: 1}(id, QiePredictionMarket.Side.NO);
    }

    function testDirectNativeTransferRejected() public {
        vm.deal(address(this), 2);
        (bool ok,) = address(market).call{value: 1}("");
        assertFalse(ok, "plain transfer must revert");

        (ok,) = address(market).call{value: 1}(hex"deadbeef");
        assertFalse(ok, "unknown selector with value must revert");
        assertEq(address(market).balance, 0, "market balance");
        assertEq(market.unaccountedBalance(), 0, "unaccounted");
    }

    // ------------------------------------------------------------ resolution
    function testResolveOnlyResolver() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.NotResolver.selector);
        market.resolve(id, QiePredictionMarket.Outcome.YES);
    }

    function testResolveBeforeCloseTimeReverts() public {
        uint256 id = _createDefaultMarket();
        vm.prank(resolver);
        vm.expectRevert(QiePredictionMarket.ResolutionNotOpen.selector);
        market.resolve(id, QiePredictionMarket.Outcome.YES);
    }

    function testResolveAtCloseTimeSucceeds() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.NO);
        assertTrue(market.getMarket(id).outcome == QiePredictionMarket.Outcome.NO, "outcome NO");
    }

    function testResolveAtDeadlineReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(DEADLINE_AT);

        vm.prank(resolver);
        vm.expectRevert(QiePredictionMarket.ResolutionWindowClosed.selector);
        market.resolve(id, QiePredictionMarket.Outcome.YES);
    }

    function testResolveTwiceReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        vm.prank(resolver);
        vm.expectRevert(QiePredictionMarket.AlreadyResolved.selector);
        market.resolve(id, QiePredictionMarket.Outcome.NO);
    }

    function testResolveUnresolvedOutcomeRejected() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);

        vm.prank(resolver);
        vm.expectRevert(QiePredictionMarket.InvalidOutcome.selector);
        market.resolve(id, QiePredictionMarket.Outcome.UNRESOLVED);
    }

    function testResolveInvalidEnablesRefund() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);
        assertTrue(market.refundEnabled(id), "refundable after INVALID");
    }

    function testResolveUnknownMarketReverts() public {
        vm.warp(CLOSE_AT);
        vm.prank(resolver);
        vm.expectRevert(QiePredictionMarket.MarketNotFound.selector);
        market.resolve(0, QiePredictionMarket.Outcome.YES);
    }

    // ----------------------------------------------------------- cancellation
    function testCancelBeforeDeadlineReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(DEADLINE_AT - 1);

        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.ResolutionWindowStillOpen.selector);
        market.cancelIfExpired(id);
    }

    function testCancelAtDeadlineSucceeds() public {
        uint256 id = _createDefaultMarket();
        vm.warp(DEADLINE_AT);
        vm.prank(dave);
        market.cancelIfExpired(id);

        QiePredictionMarket.MarketView memory v = market.getMarket(id);
        assertTrue(v.cancelled, "cancelled");
        assertTrue(v.refundable, "refundable");
    }

    function testCancelTwiceReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(DEADLINE_AT);
        vm.prank(dave);
        market.cancelIfExpired(id);

        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.AlreadyCancelled.selector);
        market.cancelIfExpired(id);
    }

    function testCancelAfterResolutionReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);
        vm.warp(DEADLINE_AT);

        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.AlreadyResolved.selector);
        market.cancelIfExpired(id);
    }

    // ---------------------------------------------------------------- claims
    function testClaimPaysWinnersProRata() public {
        uint256 id = _seedWinningMarket();
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.prank(alice);
        market.claim(id);

        assertEq(alice.balance - aliceBefore, 15 ether, "alice payout");
        assertEq(market.getMarket(id).paidOut, 15 ether, "paidOut after alice");

        vm.prank(bob);
        market.claim(id);

        assertEq(bob.balance - bobBefore, 45 ether, "bob payout");
        assertEq(market.getMarket(id).paidOut, 60 ether, "paidOut after bob");
        assertEq(market.getMarket(id).remainingEscrow, 0, "escrow empty");
        assertEq(market.totalPaidOut(), 60 ether, "total paid");
        assertEq(market.unaccountedBalance(), 0, "no unaccounted");
    }

    function testClaimLosingSideReverts() public {
        uint256 id = _seedWinningMarket();
        vm.prank(carol);
        vm.expectRevert(QiePredictionMarket.NothingToClaim.selector);
        market.claim(id);
    }

    function testClaimBeforeResolutionReverts() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 1 ether);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.MarketNotResolved.selector);
        market.claim(id);
    }

    function testClaimOnInvalidMarketReverts() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 1 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.MarketNotResolved.selector);
        market.claim(id);
    }

    function testClaimTwiceReverts() public {
        uint256 id = _seedWinningMarket();
        vm.prank(alice);
        market.claim(id);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.AlreadySettled.selector);
        market.claim(id);
    }

    function testClaimWithoutPositionReverts() public {
        uint256 id = _seedWinningMarket();
        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.NothingToClaim.selector);
        market.claim(id);
    }

    function testClaimWhenWinningSideEmptyReverts() public {
        uint256 id = _createDefaultMarket();
        _stake(bob, id, QiePredictionMarket.Side.NO, 5 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        vm.prank(bob);
        vm.expectRevert(QiePredictionMarket.WinningSideEmpty.selector);
        market.claim(id);
        assertTrue(market.refundEnabled(id), "refund enabled");
    }

    function testClaimLeavesExactRoundingDustLocked() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 1);
        _stake(bob, id, QiePredictionMarket.Side.YES, 1);
        _stake(carol, id, QiePredictionMarket.Side.NO, 1);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);

        QiePredictionMarket.MarketView memory v = market.getMarket(id);
        assertEq(v.paidOut, 2, "paid out");
        assertEq(v.remainingEscrow, 1, "one wei dust locked");
        assertEq(market.totalEscrow(), 1, "global escrow is dust");
        assertEq(market.unaccountedBalance(), 0, "dust is accounted, not unaccounted");
        assertEq(address(market).balance, 1, "one wei remains");
    }

    // --------------------------------------------------------------- refunds
    function testRefundInvalidReturnsBothSides() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        _stake(bob, id, QiePredictionMarket.Side.NO, 4 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        market.refund(id);
        vm.prank(bob);
        market.refund(id);

        assertEq(alice.balance - aliceBefore, 10 ether, "alice refund");
        assertEq(bob.balance - bobBefore, 4 ether, "bob refund");
        assertEq(market.getMarket(id).paidOut, 14 ether, "paidOut");
        assertEq(market.getMarket(id).remainingEscrow, 0, "escrow empty");
    }

    function testRefundCancelledMarket() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        vm.warp(DEADLINE_AT);
        vm.prank(dave);
        market.cancelIfExpired(id);

        uint256 before = alice.balance;
        vm.prank(alice);
        market.refund(id);
        assertEq(alice.balance - before, 10 ether, "cancelled refund");
    }

    function testRefundExpiredMarketRequiresCancel() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        vm.warp(DEADLINE_AT);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.RefundNotEnabled.selector);
        market.refund(id);

        vm.prank(dave);
        market.cancelIfExpired(id);

        vm.prank(alice);
        market.refund(id);
        assertEq(market.getMarket(id).remainingEscrow, 0, "refunded after cancel");
    }

    function testRefundOnValidResolutionReverts() public {
        uint256 id = _seedWinningMarket();

        vm.prank(carol);
        vm.expectRevert(QiePredictionMarket.RefundNotEnabled.selector);
        market.refund(id);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.RefundNotEnabled.selector);
        market.refund(id);
    }

    function testRefundTwiceReverts() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 1 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);
        vm.prank(alice);
        market.refund(id);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.AlreadySettled.selector);
        market.refund(id);
    }

    function testRefundWithoutPositionReverts() public {
        uint256 id = _createDefaultMarket();
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.NothingToRefund.selector);
        market.refund(id);
    }

    function testRefundMixedPositionReturnsSum() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 3 ether);
        _stake(alice, id, QiePredictionMarket.Side.NO, 4 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        uint256 before = alice.balance;
        vm.prank(alice);
        market.refund(id);
        assertEq(alice.balance - before, 7 ether, "mixed refund");
    }

    function testRefundWhenWinningSideEmpty() public {
        uint256 id = _createDefaultMarket();
        _stake(bob, id, QiePredictionMarket.Side.NO, 5 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        uint256 before = bob.balance;
        vm.prank(bob);
        market.refund(id);
        assertEq(bob.balance - before, 5 ether, "refund on empty winning side");
        assertEq(market.getMarket(id).remainingEscrow, 0, "escrow empty");
    }

    // ----------------------------------------------------- claimTo / refundTo
    function testClaimToPaysChosenRecipient() public {
        uint256 id = _seedWinningMarket();
        uint256 aliceBefore = alice.balance;
        uint256 daveBefore = dave.balance;

        vm.prank(alice);
        market.claimTo(id, dave);

        assertEq(dave.balance - daveBefore, 15 ether, "recipient payout");
        assertEq(alice.balance, aliceBefore, "owner balance unchanged");
    }

    function testClaimToRejectsZeroAndMarketRecipient() public {
        uint256 id = _seedWinningMarket();

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.InvalidRecipient.selector);
        market.claimTo(id, address(0));

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.InvalidRecipient.selector);
        market.claimTo(id, address(market));
    }

    function testThirdPartyCannotClaimAnotherPosition() public {
        uint256 id = _seedWinningMarket();
        vm.prank(dave);
        vm.expectRevert(QiePredictionMarket.NothingToClaim.selector);
        market.claimTo(id, dave);
    }

    function testClaimToAfterClaimReverts() public {
        uint256 id = _seedWinningMarket();
        vm.prank(alice);
        market.claim(id);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.AlreadySettled.selector);
        market.claimTo(id, dave);
    }

    function testRefundToPaysChosenRecipient() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        uint256 daveBefore = dave.balance;
        vm.prank(alice);
        market.refundTo(id, dave);
        assertEq(dave.balance - daveBefore, 10 ether, "refund recipient");
    }

    function testRefundToRejectsZeroAndMarketRecipient() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 1 ether);
        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.InvalidRecipient.selector);
        market.refundTo(id, address(0));

        vm.prank(alice);
        vm.expectRevert(QiePredictionMarket.InvalidRecipient.selector);
        market.refundTo(id, address(market));
    }

    // ------------------------------------------------------------ reentrancy
    function testClaimReentrancyBlockedByGuard() public {
        uint256 id = _createDefaultMarket();
        ReentrancyAttacker attacker = new ReentrancyAttacker();
        attacker.configure(market, id, 0);
        vm.deal(address(this), 10 ether);
        attacker.stakeYes{value: 10 ether}();

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        attacker.attack();
        assertEq(attacker.attempts(), 1, "one reentry attempt");
        assertTrue(attacker.reentryReverted(), "reentry reverted");
        assertEq(market.getMarket(id).paidOut, 10 ether, "paid once");
        assertEq(address(attacker).balance, 10 ether, "payout received");
    }

    function testRefundReentrancyBlockedByGuard() public {
        uint256 id = _createDefaultMarket();
        ReentrancyAttacker attacker = new ReentrancyAttacker();
        attacker.configure(market, id, 1);
        vm.deal(address(this), 10 ether);
        attacker.stakeYes{value: 10 ether}();

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        attacker.attack();
        assertEq(attacker.attempts(), 1, "one reentry attempt");
        assertTrue(attacker.reentryReverted(), "reentry reverted");
        assertEq(market.getMarket(id).paidOut, 10 ether, "refunded once");
        assertEq(address(attacker).balance, 10 ether, "refund received");
    }

    function testRevertingReceiverRollsBackClaimAndAllowsRedirect() public {
        uint256 id = _createDefaultMarket();
        RevertingReceiver receiver = new RevertingReceiver();
        receiver.configure(market, id);
        vm.deal(address(receiver), 10 ether);
        receiver.stakeYes{value: 10 ether}();

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        vm.expectRevert(QiePredictionMarket.NativeTransferFailed.selector);
        receiver.claimTo(address(receiver));

        (,, bool settled) = market.getPosition(id, address(receiver));
        assertFalse(settled, "settlement rolled back");
        assertEq(market.getMarket(id).paidOut, 0, "paidOut rolled back");

        uint256 aliceBefore = alice.balance;
        receiver.claimTo(alice);
        assertEq(alice.balance - aliceBefore, 10 ether, "redirected payout");
        (,, settled) = market.getPosition(id, address(receiver));
        assertTrue(settled, "settled after redirect");
    }

    function testRevertingReceiverRollsBackRefundAndAllowsRedirect() public {
        uint256 id = _createDefaultMarket();
        RevertingReceiver receiver = new RevertingReceiver();
        receiver.configure(market, id);
        vm.deal(address(receiver), 10 ether);
        receiver.stakeNo{value: 10 ether}();

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.INVALID);

        vm.expectRevert(QiePredictionMarket.NativeTransferFailed.selector);
        receiver.refundTo(address(receiver));

        (,, bool settled) = market.getPosition(id, address(receiver));
        assertFalse(settled, "refund settlement rolled back");

        uint256 aliceBefore = alice.balance;
        receiver.refundTo(alice);
        assertEq(alice.balance - aliceBefore, 10 ether, "redirected refund");
        (,, settled) = market.getPosition(id, address(receiver));
        assertTrue(settled, "settled after redirect");
    }

    // --------------------------------------------------- isolation / surplus
    function testMarketsAreIsolated() public {
        uint256 first = _createDefaultMarket();
        uint256 second = _createDefaultMarket();

        _stake(alice, first, QiePredictionMarket.Side.YES, 10 ether);
        _stake(bob, first, QiePredictionMarket.Side.NO, 5 ether);
        _stake(carol, second, QiePredictionMarket.Side.YES, 7 ether);
        _stake(dave, second, QiePredictionMarket.Side.NO, 3 ether);

        vm.warp(CLOSE_AT);
        _resolve(resolver, first, QiePredictionMarket.Outcome.YES);
        vm.prank(alice);
        market.claim(first);

        QiePredictionMarket.MarketView memory secondBefore = market.getMarket(second);
        assertEq(secondBefore.yesStake, 7 ether, "second yes untouched");
        assertEq(secondBefore.noStake, 3 ether, "second no untouched");
        assertEq(secondBefore.paidOut, 0, "second paidOut untouched");
        assertEq(secondBefore.remainingEscrow, 10 ether, "second escrow untouched");
        assertEq(market.totalStakeReceived(), 25 ether, "total received");
        assertEq(market.totalPaidOut(), 15 ether, "total paid");
        assertEq(market.totalEscrow(), 10 ether, "global escrow");

        _resolve(resolver, second, QiePredictionMarket.Outcome.INVALID);
        vm.prank(carol);
        market.refund(second);
        vm.prank(dave);
        market.refund(second);

        assertEq(market.totalPaidOut(), 25 ether, "all paid");
        assertEq(market.totalEscrow(), 0, "global escrow empty");
        assertEq(address(market).balance, 0, "native balance empty");
    }

    function testForcedBalanceIsReportedButNotSpendable() public {
        uint256 id = _createDefaultMarket();
        _stake(alice, id, QiePredictionMarket.Side.YES, 10 ether);
        vm.deal(address(market), 10 ether + 1234);

        assertEq(market.unaccountedBalance(), 1234, "forced surplus reported");
        assertEq(market.totalEscrow(), 10 ether, "stake escrow unchanged");
        assertEq(market.getMarket(id).remainingEscrow, 10 ether, "market escrow unchanged");

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);
        vm.prank(alice);
        market.claim(id);

        assertEq(address(market).balance, 1234, "surplus remains");
        assertEq(market.unaccountedBalance(), 1234, "surplus still unaccounted");
        assertEq(market.totalEscrow(), 0, "all stake escrow paid");
    }

    // ------------------------------------------------------------------ fuzz
    function testFuzzClaimPayoutMatchesMulDiv(uint96 yesSeed, uint96 noSeed) public {
        uint256 yesAmount = bound(uint256(yesSeed), 1, 1e21);
        uint256 noAmount = bound(uint256(noSeed), 1, 1e21);

        uint256 id = _createDefaultMarket();
        vm.deal(alice, yesAmount);
        vm.deal(bob, noAmount);
        _stake(alice, id, QiePredictionMarket.Side.YES, yesAmount);
        _stake(bob, id, QiePredictionMarket.Side.NO, noAmount);

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        uint256 expected = Math.mulDiv(yesAmount, yesAmount + noAmount, yesAmount);
        uint256 before = alice.balance;
        vm.prank(alice);
        market.claim(id);
        assertEq(alice.balance - before, expected, "payout == mulDiv");
        assertEq(market.getMarket(id).remainingEscrow, yesAmount + noAmount - expected, "dust");
    }

    function testFuzzWinnerPayoutsNeverExceedPool(uint96 aSeed, uint96 bSeed, uint96 cSeed) public {
        uint256 a = bound(uint256(aSeed), 1, 1e20);
        uint256 b = bound(uint256(bSeed), 1, 1e20);
        uint256 c = bound(uint256(cSeed), 1, 1e20);
        uint256 total = a + b + c;
        uint256 winning = a + b;

        uint256 id = _createDefaultMarket();
        vm.deal(alice, a);
        vm.deal(bob, b);
        vm.deal(carol, c);
        _stake(alice, id, QiePredictionMarket.Side.YES, a);
        _stake(bob, id, QiePredictionMarket.Side.YES, b);
        _stake(carol, id, QiePredictionMarket.Side.NO, c);

        vm.warp(CLOSE_AT);
        _resolve(resolver, id, QiePredictionMarket.Outcome.YES);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);

        uint256 paid = (alice.balance - aliceBefore) + (bob.balance - bobBefore);
        assertLe(paid, total, "paid <= pool");
        assertEq(paid, Math.mulDiv(a, total, winning) + Math.mulDiv(b, total, winning), "payout formula");
        assertLt(total - paid, 2, "dust < number of winners");
        assertEq(market.getMarket(id).remainingEscrow, total - paid, "locked dust");
    }
}
