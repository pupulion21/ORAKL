// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";

abstract contract ProtocolStorage is ReentrancyGuard {
    error MarketNotFound();
    error InvalidState();
    error InvalidTime();
    error InvalidMetadata();
    error IncorrectValue();
    error InvalidOutcome();
    error InvalidEvidence();
    error Unauthorized();
    error InvalidRecipient();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error DirectTransferRejected();
    error PoolCapExceeded();
    error BelowMinimum();

    IProtocolConfig public immutable protocolConfig;
    uint256 public marketCount;
    uint256 public participantLiability;
    uint256 public bondLiability;
    uint256 public feeLiability;
    uint256 public totalContributions;
    uint256 public totalParticipantPaid;
    uint256 public totalBondsDeposited;
    uint256 public totalBondsPaid;
    uint256 public totalFeesAccrued;
    uint256 public totalFeesWithdrawn;
    mapping(uint256 => T.Market) internal _markets;
    mapping(uint256 => mapping(address => T.Position)) internal _positions;
    mapping(uint256 => mapping(T.BondType => T.Bond)) internal _bonds;

    event BondDeposited(uint256 indexed marketId, T.BondType indexed bondType, address indexed owner, uint256 amount);
    event BondReleased(
        uint256 indexed marketId, T.BondType indexed bondType, address indexed owner, address recipient, uint256 amount
    );

    constructor(IProtocolConfig config) {
        protocolConfig = config;
    }

    modifier financialEntry() {
        _requireFinancialActivity();
        _;
    }

    function _requireFinancialActivity() private view {
        protocolConfig.requireFinancialActivity(address(this));
    }

    function getMarket(uint256 id) external view returns (T.Market memory) {
        return _market(id);
    }

    function getPosition(uint256 id, address user) external view returns (T.Position memory) {
        _market(id);
        return _positions[id][user];
    }

    function getBond(uint256 id, T.BondType kind) external view virtual returns (T.Bond memory) {
        _market(id);
        return _bonds[id][kind];
    }

    function marketState(uint256 id) public view returns (T.State) {
        T.Market storage m = _market(id);
        if (m.storedState == T.State.OPEN && block.timestamp >= m.closeTime) return T.State.CLOSED;
        return m.storedState;
    }

    function getPoolTotals(uint256 id) external view returns (uint256 yes, uint256 no, uint256 total) {
        T.Market storage m = _market(id);
        return (m.yesPool, m.noPool, uint256(m.yesPool) + m.noPool);
    }

    function totalAccounted() public view returns (uint256) {
        return participantLiability + bondLiability + feeLiability;
    }

    function unaccountedBalance() external view returns (uint256) {
        return address(this).balance - totalAccounted();
    }

    function claimBond(uint256 id, T.BondType kind, address recipient) external virtual nonReentrant {
        T.Market storage m = _market(id);
        if (!_terminal(m)) revert InvalidState();
        T.Bond storage b = _bonds[id][kind];
        if (b.owner != msg.sender) revert Unauthorized();
        if (b.claimed) revert AlreadyClaimed();
        _recipient(recipient);
        b.claimed = true;
        bondLiability -= b.amount;
        totalBondsPaid += b.amount;
        _send(recipient, b.amount);
        emit BondReleased(id, kind, msg.sender, recipient, b.amount);
    }

    function _beforePrediction(T.Market storage, uint256) internal virtual {}

    function _onTerminal(uint256, T.Market storage) internal virtual {}

    function _requireCurrentMarket(T.Market storage m) internal view {
        if (m.creationActivityEpoch != protocolConfig.activityEpoch()) revert InvalidState();
    }

    function _market(uint256 id) internal view returns (T.Market storage m) {
        if (id >= marketCount) revert MarketNotFound();
        return _markets[id];
    }

    function _terminal(T.Market storage m) internal view returns (bool) {
        return m.storedState == T.State.FINALIZED || m.storedState == T.State.CANCELLED;
    }

    function _depositBond(uint256 id, T.BondType kind, uint128 amount) internal {
        _bonds[id][kind] = T.Bond(msg.sender, amount, false);
        bondLiability += amount;
        totalBondsDeposited += amount;
        emit BondDeposited(id, kind, msg.sender, amount);
    }

    function _recipient(address recipient) internal view {
        if (recipient == address(0) || recipient == address(this) || recipient == address(protocolConfig)) {
            revert InvalidRecipient();
        }
    }

    function _send(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        revert DirectTransferRejected();
    }

    fallback() external payable {
        revert DirectTransferRejected();
    }
}
