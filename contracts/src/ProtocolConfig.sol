// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {IMultisig} from "./interfaces/IMultisig.sol";

/// @notice Observable wallet control checks do not prove honest execution, audit or legal approval.
contract ProtocolConfig is IProtocolConfig {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidMultisig();
    error NotApproved();
    error FinancialActivityDisabled();
    error AlreadyBound();
    error ControlChanged();
    error ControlUnchanged();
    error InsufficientCheckGas();
    uint16 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MAX_BOND = 1_000_000 ether;
    uint256 public constant RECOVERY_DELAY = 24 hours;
    uint256 public constant ROLE_CHECK_GAS = 2_000_000;
    address public immutable override governance;
    address public immutable complianceApprover;
    address public immutable guardian;
    uint256 public immutable deploymentChainId;
    address public factory;
    bool public financialActive;
    bool public paused;
    uint64 public override activityEpoch;
    mapping(uint64 => uint64) public override interruptedAt;
    bytes32 public approvedRelease;
    bytes32 public approvedDigest;
    bytes32 public approvedRoleState;
    bytes32 public activeRoleState;
    uint64 public activationAfter;
    T.Parameters private _parameters;

    event FactoryBound(address indexed factory);
    event ParametersConfigured(bytes32 indexed parametersHash);
    event ReleaseApproved(bytes32 indexed release, bytes32 indexed digest, uint64 activationAfter);
    event FinanceActivated(bytes32 indexed release, bytes32 indexed digest);
    event FinanceDeactivated(address indexed caller);
    event PauseChanged(bool paused, address indexed caller);
    event ActivityInterrupted(uint64 indexed epoch, uint64 interruptedAt, address indexed caller);
    event RoleDriftReported(address indexed reporter);

    constructor(address governance_, address compliance_, address guardian_, T.Parameters memory initial) {
        if (
            governance_ == address(0) || compliance_ == address(0) || guardian_ == address(0)
                || guardian_ == governance_ || guardian_ == compliance_
        ) revert InvalidConfiguration();
        governance = governance_;
        complianceApprover = compliance_;
        guardian = guardian_;
        deploymentChainId = block.chainid;
        _validateParameters(initial);
        _parameters = initial;
    }
    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    function parameters() external view override returns (T.Parameters memory) {
        return _parameters;
    }

    function bindFactory(address facade) external onlyGovernance {
        if (factory != address(0)) revert AlreadyBound();
        if (facade.code.length == 0) revert InvalidConfiguration();
        (bool ok, bytes memory data) = facade.staticcall(abi.encodeWithSignature("protocolConfig()"));
        if (!ok || data.length != 32 || abi.decode(data, (address)) != address(this)) revert InvalidConfiguration();
        factory = facade;
        emit FactoryBound(facade);
    }

    function setParameters(T.Parameters calldata next) external onlyGovernance {
        _validateParameters(next);
        _parameters = next;
        _interrupt();
        emit ParametersConfigured(keccak256(abi.encode(next)));
    }

    function currentRoleState() public view returns (bytes32) {
        return _roleState(_parameters.arbitrator);
    }

    function roleFingerprint(address wallet) external view override returns (bytes32 fingerprint) {
        (fingerprint,) = _walletState(wallet);
    }

    function releaseDigest(bytes32 release) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(this).codehash,
                factory,
                factory.codehash,
                _parameters,
                activityEpoch,
                currentRoleState(),
                release
            )
        );
    }

    function approveRelease(bytes32 release) external {
        if (msg.sender != complianceApprover) revert Unauthorized();
        if (release == bytes32(0) || factory == address(0) || financialActive || block.chainid != deploymentChainId) {
            revert NotApproved();
        }
        approvedRoleState = currentRoleState();
        approvedRelease = release;
        approvedDigest = releaseDigest(release);
        activationAfter = uint64(block.timestamp + RECOVERY_DELAY);
        emit ReleaseApproved(release, approvedDigest, activationAfter);
    }

    function activateFinance(bytes32 release) external onlyGovernance {
        _requireApproved(release);
        if (paused) revert NotApproved();
        activeRoleState = approvedRoleState;
        financialActive = true;
        emit FinanceActivated(release, approvedDigest);
    }

    function unpause() external onlyGovernance {
        _requireApproved(approvedRelease);
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        _interrupt();
    }

    function deactivateFinance() external {
        if (msg.sender != governance && msg.sender != guardian && msg.sender != complianceApprover) {
            revert Unauthorized();
        }
        _interrupt();
    }

    function requireFinancialActivity(address facade) external view override {
        if (
            !financialActive || paused || facade != factory || factory == address(0)
                || block.chainid != deploymentChainId
        ) revert FinancialActivityDisabled();
        _requireUnchangedRoles();
    }

    function requireUncontestedSettlement() external view override {
        if (!financialActive || paused || block.chainid != deploymentChainId) revert FinancialActivityDisabled();
        _requireUnchangedRoles();
    }

    function requireGovernanceAuthority(address caller) external view override {
        if (caller != governance) revert Unauthorized();
        _requireUnchangedRoles();
    }

    function requireArbitrator(address arbitrator, bytes32 expected) external view override {
        (bytes32 actual, address[] memory arbOwners) = _walletState(arbitrator);
        if (actual != expected) revert ControlChanged();
        (, address[] memory govOwners) = _walletState(governance);
        (, address[] memory compOwners) = _walletState(complianceApprover);
        _disjoint(govOwners, compOwners);
        _disjoint(arbOwners, govOwners);
        _disjoint(arbOwners, compOwners);
    }

    /// @notice Permissionless stop for observable drift. Wallet-view honesty remains an external assumption.
    function reportRoleDrift() external {
        if (!financialActive || paused || activeRoleState == bytes32(0)) revert NotApproved();
        // Guarantee the full check budget under EIP-150 plus enough gas to record the halt.
        if (gasleft() < ROLE_CHECK_GAS + ROLE_CHECK_GAS / 63 + 200_000) revert InsufficientCheckGas();
        try this.currentRoleState{gas: ROLE_CHECK_GAS}() returns (bytes32 observed) {
            if (observed == activeRoleState) revert ControlUnchanged();
        } catch { /* Bounded view failure is also an observable loss of valid declared control. */ }
        _interrupt();
        emit RoleDriftReported(msg.sender);
    }

    function _requireApproved(bytes32 release) private view {
        if (
            release == bytes32(0) || approvedRelease != release || block.timestamp < activationAfter
                || block.chainid != deploymentChainId || approvedDigest != releaseDigest(release)
        ) revert NotApproved();
    }

    function _requireUnchangedRoles() private view {
        if (activeRoleState == bytes32(0) || currentRoleState() != activeRoleState) revert ControlChanged();
    }

    function _interrupt() private {
        uint64 oldEpoch = activityEpoch;
        interruptedAt[oldEpoch] = uint64(block.timestamp);
        ++activityEpoch;
        financialActive = false;
        paused = true;
        approvedRelease = bytes32(0);
        approvedDigest = bytes32(0);
        approvedRoleState = bytes32(0);
        activationAfter = 0;
        emit ActivityInterrupted(oldEpoch, uint64(block.timestamp), msg.sender);
        emit FinanceDeactivated(msg.sender);
        emit PauseChanged(true, msg.sender);
    }

    function _validateParameters(T.Parameters memory p) private view {
        if (
            p.feeBps > MAX_FEE_BPS || p.creationBond > MAX_BOND || p.proposalBond > MAX_BOND
                || p.challengeBond > MAX_BOND || p.minContribution == 0 || p.poolCap < p.minContribution
                || p.challengePeriod < 1 hours || p.challengePeriod > 7 days || p.arbitrationPeriod < 1 hours
                || p.arbitrationPeriod > 30 days || p.arbitrator == guardian
        ) revert InvalidConfiguration();
        _roleState(p.arbitrator);
    }

    function _roleState(address arbitrator) private view returns (bytes32) {
        (bytes32 g, address[] memory go) = _walletState(governance);
        (bytes32 c, address[] memory co) = _walletState(complianceApprover);
        (bytes32 a, address[] memory ao) = _walletState(arbitrator);
        _disjoint(go, co);
        _disjoint(go, ao);
        _disjoint(co, ao);
        return keccak256(abi.encode(g, c, a, guardian));
    }

    function _walletState(address wallet) private view returns (bytes32 fingerprint, address[] memory owners) {
        if (wallet.code.length == 0) revert InvalidMultisig();
        bytes memory data = _boundedWalletRead(wallet, IMultisig.getOwners.selector, 200_000, 1088);
        if (data.length < 64) revert InvalidMultisig();
        owners = abi.decode(data, (address[]));
        data = _boundedWalletRead(wallet, IMultisig.getThreshold.selector, 30_000, 32);
        if (data.length != 32) revert InvalidMultisig();
        uint256 threshold = abi.decode(data, (uint256));
        if (owners.length < 2 || owners.length > 32 || threshold < 2 || threshold > owners.length) {
            revert InvalidMultisig();
        }
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == address(0) || owners[i] == guardian) revert InvalidMultisig();
            for (uint256 j; j < i; ++j) {
                if (owners[i] == owners[j]) revert InvalidMultisig();
            }
        }
        fingerprint = keccak256(abi.encode(wallet, wallet.codehash, owners, threshold));
    }

    /// @dev Allocate only the known ABI maximum; never copy arbitrary returndata.
    function _boundedWalletRead(address wallet, bytes4 selector, uint256 callGas, uint256 maxReturn)
        private
        view
        returns (bytes memory data)
    {
        bytes memory query = abi.encodeWithSelector(selector);
        data = new bytes(maxReturn);
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            ok := staticcall(callGas, wallet, add(query, 32), mload(query), add(data, 32), maxReturn)
            size := returndatasize()
        }
        if (!ok || size > maxReturn) revert InvalidMultisig();
        assembly ("memory-safe") { mstore(data, size) }
    }

    function _disjoint(address[] memory a, address[] memory b) private pure {
        for (uint256 i; i < a.length; ++i) {
            for (uint256 j; j < b.length; ++j) {
                if (a[i] == b[j]) revert InvalidMultisig();
            }
        }
    }
}
