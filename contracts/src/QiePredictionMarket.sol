// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title QiePredictionMarket — binary YES/NO pari-mutuel market settled in native QIE.
/// @notice Self-contained MVP. Collateral is the chain's native coin (QIE on QIE EVM
///         Testnet chain id 1983). There is no ERC-20, no allowance, no approve and no
///         admin custody: every wei that enters through `stake` is accounted to the
///         market it was staked on.
///
/// Trust model
/// -----------
/// The `resolver` chosen at creation is a MANUAL, TRUSTED party. Resolution is not
/// decentralized and no oracle is used. The resolver can only pick an outcome; it has
/// no function to move escrow, change metadata, upgrade this contract, or override an
/// outcome. A market with an absent/malicious resolver can only be cancelled after
/// `resolveDeadline` by anyone, which enables full refunds.
///
/// Time windows (no overlap, no gap)
/// ---------------------------------
///   staking    : [creation, closeTime)          stake requires block.timestamp < closeTime
///   resolution : [closeTime, resolveDeadline)   resolver only
///   cancellation: [resolveDeadline, infinity)   anyone, only while UNRESOLVED
///
/// There is no automatic cancellation and no automatic resolution.
///
/// Payout
/// ------
/// `payout = floor(userWinningStake * totalPool / totalWinningStake)` using
/// OpenZeppelin `Math.mulDiv` (full-precision, rounds down). The rounding remainder
/// ("dust") stays locked in that market's escrow forever. There is no sweep, no
/// rescue function and no admin withdrawal. Losing-side stakes are distributed to the
/// winning side through the pool; they are not refundable after a valid resolution.
///
/// Refunds
/// -------
/// `refund` is enabled only when:
///   * the market resolved INVALID,
///   * the market was cancelled after the resolution deadline, or
///   * the resolved winning side has zero stake (NO_WINNING_STAKE).
/// An expired-but-unresolved market must be cancelled explicitly first; this contract
/// never auto-cancels. Refunds return the caller's full YES + NO stake.
///
/// Accounting
/// ----------
/// Per market: `yesStake + noStake - paidOut == remainingEscrow`.
/// Global:     `sum(receivedStake) - sum(paidOut) == totalEscrow`.
/// Native balance: `address(this).balance == totalEscrow + unaccountedBalance`.
/// `unaccountedBalance` can only grow through forced transfers (selfdestruct or a
/// block reward style credit); no function spends it. It is reported, never used.
///
/// Metadata limits are byte limits on UTF-8 encoded strings:
/// question <= 280 bytes, criteria <= 2000 bytes, source <= 512 bytes. Metadata,
/// resolver, closeTime and resolveDeadline are immutable after creation.
contract QiePredictionMarket is ReentrancyGuard {
    // ---------------------------------------------------------------- errors
    error EmptyQuestion();
    error QuestionTooLong(uint256 length, uint256 maximum);
    error EmptyCriteria();
    error CriteriaTooLong(uint256 length, uint256 maximum);
    error EmptySource();
    error SourceTooLong(uint256 length, uint256 maximum);
    error ZeroResolver();
    error CloseTimeNotInFuture();
    error ResolveDeadlineNotAfterClose();
    error MarketNotFound();
    error MarketClosed();
    error ZeroAmount();
    error TotalPoolCapExceeded();
    error NotResolver();
    error ResolutionNotOpen();
    error ResolutionWindowClosed();
    error AlreadyResolved();
    error InvalidOutcome();
    error MarketNotResolved();
    error WinningSideEmpty();
    error NothingToClaim();
    error AlreadySettled();
    error RefundNotEnabled();
    error NothingToRefund();
    error AlreadyCancelled();
    error ResolutionWindowStillOpen();
    error InvalidRecipient();
    error NativeTransferFailed();
    error DirectTransferRejected();

    // ----------------------------------------------------------------- types
    enum Side {
        YES,
        NO
    }

    enum Outcome {
        UNRESOLVED,
        YES,
        NO,
        INVALID
    }

    struct Market {
        address creator;
        uint64 closeTime;
        address resolver;
        uint64 resolveDeadline;
        Outcome outcome;
        bool cancelled;
        uint128 yesStake;
        uint128 noStake;
        uint256 paidOut;
    }

    struct MarketMeta {
        string question;
        string criteria;
        string source;
    }

    struct Position {
        uint128 yes;
        uint128 no;
        bool settled;
    }

    struct MarketView {
        address creator;
        address resolver;
        uint64 closeTime;
        uint64 resolveDeadline;
        Outcome outcome;
        bool cancelled;
        uint256 yesStake;
        uint256 noStake;
        uint256 paidOut;
        uint256 remainingEscrow;
        bool refundable;
    }

    // --------------------------------------------------------------- events
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        address indexed resolver,
        uint64 closeTime,
        uint64 resolveDeadline
    );
    event Staked(uint256 indexed marketId, address indexed staker, Side side, uint256 amount);
    event MarketResolved(uint256 indexed marketId, address indexed resolver, Outcome outcome);
    event MarketCancelled(uint256 indexed marketId, address indexed caller);
    event Claimed(uint256 indexed marketId, address indexed account, address recipient, uint256 amount);
    event Refunded(uint256 indexed marketId, address indexed account, address recipient, uint256 amount);

    // --------------------------------------------------------------- bounds
    uint256 public constant MAX_QUESTION_BYTES = 280;
    uint256 public constant MAX_CRITERIA_BYTES = 2000;
    uint256 public constant MAX_SOURCE_BYTES = 512;
    uint256 public constant MAX_TOTAL_POOL = type(uint128).max;

    // ---------------------------------------------------------------- state
    /// @notice Number of markets created; market ids are `0 .. marketCount - 1`.
    uint256 public marketCount;
    /// @notice Sum of all native value received through `stake`.
    uint256 public totalStakeReceived;
    /// @notice Sum of all native value sent through `claim` / `refund`.
    uint256 public totalPaidOut;

    mapping(uint256 => Market) private _markets;
    mapping(uint256 => MarketMeta) private _meta;
    mapping(uint256 => mapping(address => Position)) private _positions;

    // ------------------------------------------------------------- creation
    /// @notice Create a market. All metadata, the resolver and both deadlines are
    ///         immutable after this call. The creator does not receive any special
    ///         privilege afterwards.
    function createMarket(
        string calldata question,
        string calldata criteria,
        string calldata source,
        address resolver,
        uint64 closeTime,
        uint64 resolveDeadline
    ) external returns (uint256 marketId) {
        _validateMetadata(question, criteria, source);

        if (resolver == address(0)) revert ZeroResolver();
        if (closeTime <= block.timestamp) revert CloseTimeNotInFuture();
        if (resolveDeadline <= closeTime) revert ResolveDeadlineNotAfterClose();

        marketId = marketCount++;
        _markets[marketId].creator = msg.sender;
        _markets[marketId].closeTime = closeTime;
        _markets[marketId].resolver = resolver;
        _markets[marketId].resolveDeadline = resolveDeadline;
        _meta[marketId] = MarketMeta({question: question, criteria: criteria, source: source});

        emit MarketCreated(marketId, msg.sender, resolver, closeTime, resolveDeadline);
    }

    // -------------------------------------------------------------- staking
    /// @notice Stake native QIE on YES or NO while `block.timestamp < closeTime`.
    /// @dev The full `msg.value` is the stake. Zero is rejected. The market's total
    ///      pool is capped at type(uint128).max so the packed pool fields cannot
    ///      overflow and the accounting stays exact.
    function stake(uint256 marketId, Side side) external payable nonReentrant {
        Market storage m = _requireMarket(marketId);
        if (block.timestamp >= m.closeTime) revert MarketClosed();

        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();

        uint256 newYes = uint256(m.yesStake);
        uint256 newNo = uint256(m.noStake);
        if (side == Side.YES) {
            newYes += amount;
        } else {
            newNo += amount;
        }
        if (newYes + newNo > MAX_TOTAL_POOL) revert TotalPoolCapExceeded();

        m.yesStake = uint128(newYes);
        m.noStake = uint128(newNo);

        Position storage p = _positions[marketId][msg.sender];
        if (side == Side.YES) {
            p.yes = uint128(uint256(p.yes) + amount);
        } else {
            p.no = uint128(uint256(p.no) + amount);
        }

        totalStakeReceived += amount;
        emit Staked(marketId, msg.sender, side, amount);
    }

    // ----------------------------------------------------------- resolution
    /// @notice Resolve the market to YES, NO or INVALID. Resolver-only, inside
    ///         `[closeTime, resolveDeadline)`, exactly once.
    function resolve(uint256 marketId, Outcome outcome) external nonReentrant {
        Market storage m = _requireMarket(marketId);
        if (msg.sender != m.resolver) revert NotResolver();
        if (block.timestamp < m.closeTime) revert ResolutionNotOpen();
        if (block.timestamp >= m.resolveDeadline) revert ResolutionWindowClosed();
        if (m.outcome != Outcome.UNRESOLVED) revert AlreadyResolved();
        if (outcome == Outcome.UNRESOLVED) revert InvalidOutcome();

        m.outcome = outcome;
        emit MarketResolved(marketId, msg.sender, outcome);
    }

    /// @notice Cancel an unresolved market once its resolution deadline has passed.
    ///         Callable by anyone. Cancellation enables full refunds; it does not move
    ///         funds by itself and it cannot be reversed.
    function cancelIfExpired(uint256 marketId) external nonReentrant {
        Market storage m = _requireMarket(marketId);
        if (block.timestamp < m.resolveDeadline) revert ResolutionWindowStillOpen();
        if (m.outcome != Outcome.UNRESOLVED) revert AlreadyResolved();
        if (m.cancelled) revert AlreadyCancelled();

        m.cancelled = true;
        emit MarketCancelled(marketId, msg.sender);
    }

    // ------------------------------------------------------- claim / refund
    /// @notice Claim the caller's winner payout to the caller.
    function claim(uint256 marketId) external nonReentrant {
        _claim(marketId, msg.sender, msg.sender);
    }

    /// @notice Claim the caller's winner payout to a recipient chosen by the caller.
    ///         Only the entitlement owner can direct the payout. The recipient cannot
    ///         be the zero address or this contract.
    function claimTo(uint256 marketId, address recipient) external nonReentrant {
        _claim(marketId, msg.sender, recipient);
    }

    /// @notice Refund the caller's full YES + NO stake to the caller when refunds are
    ///         enabled for this market.
    function refund(uint256 marketId) external nonReentrant {
        _refund(marketId, msg.sender, msg.sender);
    }

    /// @notice Refund the caller's full stake to a recipient chosen by the caller.
    ///         Only the entitlement owner can direct the refund. The recipient cannot
    ///         be the zero address or this contract.
    function refundTo(uint256 marketId, address recipient) external nonReentrant {
        _refund(marketId, msg.sender, recipient);
    }

    // --------------------------------------------------------------- views
    function getMarket(uint256 marketId) external view returns (MarketView memory result) {
        Market storage m = _requireMarket(marketId);
        result = MarketView({
            creator: m.creator,
            resolver: m.resolver,
            closeTime: m.closeTime,
            resolveDeadline: m.resolveDeadline,
            outcome: m.outcome,
            cancelled: m.cancelled,
            yesStake: uint256(m.yesStake),
            noStake: uint256(m.noStake),
            paidOut: m.paidOut,
            remainingEscrow: _remainingEscrow(m),
            refundable: _refundEnabled(m)
        });
    }

    function getMarketMeta(uint256 marketId)
        external
        view
        returns (string memory question, string memory criteria, string memory source)
    {
        _requireMarket(marketId);
        MarketMeta storage meta = _meta[marketId];
        return (meta.question, meta.criteria, meta.source);
    }

    function getPosition(uint256 marketId, address account)
        external
        view
        returns (uint256 yes, uint256 no, bool settled)
    {
        _requireMarket(marketId);
        Position storage p = _positions[marketId][account];
        return (uint256(p.yes), uint256(p.no), p.settled);
    }

    /// @notice Payout the account would receive from `claim` right now (0 if not claimable).
    function projectedPayout(uint256 marketId, address account) external view returns (uint256) {
        Market storage m = _requireMarket(marketId);
        if (m.outcome != Outcome.YES && m.outcome != Outcome.NO) return 0;

        uint256 winningStake = _winningStake(m);
        if (winningStake == 0) return 0;

        Position storage p = _positions[marketId][account];
        if (p.settled) return 0;

        uint256 userWinning = m.outcome == Outcome.YES ? uint256(p.yes) : uint256(p.no);
        if (userWinning == 0) return 0;

        return Math.mulDiv(userWinning, uint256(m.yesStake) + uint256(m.noStake), winningStake);
    }

    /// @notice Refund the account would receive right now (0 if refunds are not enabled).
    function projectedRefund(uint256 marketId, address account) external view returns (uint256) {
        Market storage m = _requireMarket(marketId);
        if (!_refundEnabled(m)) return 0;

        Position storage p = _positions[marketId][account];
        if (p.settled) return 0;
        return uint256(p.yes) + uint256(p.no);
    }

    /// @notice Escrow still held for one market, including locked rounding dust.
    function remainingEscrow(uint256 marketId) external view returns (uint256) {
        return _remainingEscrow(_requireMarket(marketId));
    }

    /// @notice Global escrow across all markets.
    function totalEscrow() external view returns (uint256) {
        return totalStakeReceived - totalPaidOut;
    }

    /// @notice Native balance not attributable to stakes: forced transfers only.
    ///         Rounding dust is NOT part of this number; it remains in `remainingEscrow`.
    function unaccountedBalance() external view returns (uint256) {
        return address(this).balance - (totalStakeReceived - totalPaidOut);
    }

    function refundEnabled(uint256 marketId) external view returns (bool) {
        return _refundEnabled(_requireMarket(marketId));
    }

    // ------------------------------------------------------------ internals
    function _validateMetadata(string calldata question, string calldata criteria, string calldata source) private pure {
        uint256 length = bytes(question).length;
        if (length == 0) revert EmptyQuestion();
        if (length > MAX_QUESTION_BYTES) revert QuestionTooLong(length, MAX_QUESTION_BYTES);

        length = bytes(criteria).length;
        if (length == 0) revert EmptyCriteria();
        if (length > MAX_CRITERIA_BYTES) revert CriteriaTooLong(length, MAX_CRITERIA_BYTES);

        length = bytes(source).length;
        if (length == 0) revert EmptySource();
        if (length > MAX_SOURCE_BYTES) revert SourceTooLong(length, MAX_SOURCE_BYTES);
    }

    function _requireMarket(uint256 marketId) private view returns (Market storage m) {
        if (marketId >= marketCount) revert MarketNotFound();
        m = _markets[marketId];
    }

    function _winningStake(Market storage m) private view returns (uint256) {
        if (m.outcome == Outcome.YES) return uint256(m.yesStake);
        if (m.outcome == Outcome.NO) return uint256(m.noStake);
        return 0;
    }

    function _remainingEscrow(Market storage m) private view returns (uint256) {
        return uint256(m.yesStake) + uint256(m.noStake) - m.paidOut;
    }

    function _refundEnabled(Market storage m) private view returns (bool) {
        if (m.cancelled) return true;
        if (m.outcome == Outcome.INVALID) return true;
        if (m.outcome == Outcome.YES || m.outcome == Outcome.NO) return _winningStake(m) == 0;
        return false;
    }

    function _claim(uint256 marketId, address account, address recipient) private {
        Market storage m = _requireMarket(marketId);
        _validateRecipient(recipient);

        if (m.outcome != Outcome.YES && m.outcome != Outcome.NO) revert MarketNotResolved();

        uint256 winningStake = _winningStake(m);
        if (winningStake == 0) revert WinningSideEmpty();

        Position storage p = _positions[marketId][account];
        if (p.settled) revert AlreadySettled();

        uint256 userWinning = m.outcome == Outcome.YES ? uint256(p.yes) : uint256(p.no);
        if (userWinning == 0) revert NothingToClaim();

        uint256 payout = Math.mulDiv(userWinning, uint256(m.yesStake) + uint256(m.noStake), winningStake);

        // Checks-effects-interactions: settle and account before the native transfer.
        p.settled = true;
        m.paidOut += payout;
        totalPaidOut += payout;

        _sendNative(recipient, payout);
        emit Claimed(marketId, account, recipient, payout);
    }

    function _refund(uint256 marketId, address account, address recipient) private {
        Market storage m = _requireMarket(marketId);
        _validateRecipient(recipient);

        if (!_refundEnabled(m)) revert RefundNotEnabled();

        Position storage p = _positions[marketId][account];
        if (p.settled) revert AlreadySettled();

        uint256 amount = uint256(p.yes) + uint256(p.no);
        if (amount == 0) revert NothingToRefund();

        p.settled = true;
        m.paidOut += amount;
        totalPaidOut += amount;

        _sendNative(recipient, amount);
        emit Refunded(marketId, account, recipient, amount);
    }

    function _validateRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
    }

    /// @dev Native transfer with an explicit success check. All gas is forwarded, so
    ///      smart-contract recipients are not limited to the 2300 gas stipend.
    function _sendNative(address recipient, uint256 amount) private {
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    // --------------------------------------------------------- native guard
    /// @dev Plain QIE transfers are not a funding path. Only `stake` may receive value.
    receive() external payable {
        revert DirectTransferRejected();
    }

    fallback() external payable {
        revert DirectTransferRejected();
    }
}
