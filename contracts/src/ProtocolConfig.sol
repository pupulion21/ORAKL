// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";
import {IMultisig} from "./interfaces/IMultisig.sol";

/// @notice Noncustodial release gate. Attestations are not cryptographic proof of audit/legal approval.
contract ProtocolConfig {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidMultisig();
    error NotApproved();
    error FinancialActivityDisabled();
    error AlreadyBound();
    uint16 public constant MAX_FEE_BPS = 1000;
    uint256 public constant MAX_BOND = 1_000_000 ether;
    address public immutable governance;
    address public immutable complianceApprover;
    address public immutable guardian;
    uint256 public immutable deploymentChainId;
    address public factory;
    bool public financialActive;
    bool public paused;
    bytes32 public approvedRelease;
    bytes32 public approvedDigest;
    T.Parameters private _parameters;

    event FactoryBound(address indexed factory);
    event ParametersConfigured(bytes32 indexed parametersHash);
    event ReleaseApproved(bytes32 indexed release, bytes32 indexed digest);
    event FinanceActivated(bytes32 indexed release, bytes32 indexed digest);
    event FinanceDeactivated(address indexed caller);
    event PauseChanged(bool paused, address indexed caller);

    constructor(address governance_, address compliance_, address guardian_, T.Parameters memory initial) {
        governance = governance_;
        complianceApprover = compliance_;
        guardian = guardian_;
        deploymentChainId = block.chainid;
        if (guardian_ == address(0) || guardian_ == governance_ || guardian_ == compliance_) revert InvalidConfiguration();
        _validateParameters(initial);
        _parameters = initial;
    }

    modifier onlyGovernance() { if (msg.sender != governance) revert Unauthorized(); _; }

    function parameters() external view returns (T.Parameters memory) { return _parameters; }

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
        _deactivate();
        emit ParametersConfigured(keccak256(abi.encode(next)));
    }

    function releaseDigest(bytes32 release) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), factory, factory.codehash, _parameters, release));
    }

    function approveRelease(bytes32 release) external {
        if (msg.sender != complianceApprover) revert Unauthorized();
        if (release == bytes32(0) || factory == address(0) || block.chainid != deploymentChainId) revert NotApproved();
        approvedRelease = release;
        approvedDigest = releaseDigest(release);
        emit ReleaseApproved(release, approvedDigest);
    }

    function activateFinance(bytes32 release) external onlyGovernance {
        if (release == bytes32(0) || approvedRelease != release || approvedDigest != releaseDigest(release)
            || block.chainid != deploymentChainId) revert NotApproved();
        financialActive = true;
        emit FinanceActivated(release, approvedDigest);
    }

    function deactivateFinance() external {
        if (msg.sender != governance && msg.sender != guardian && msg.sender != complianceApprover) revert Unauthorized();
        _deactivate();
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        paused = true;
        emit PauseChanged(true, msg.sender);
    }

    function unpause() external onlyGovernance {
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    function requireFinancialActivity(address facade) external view {
        if (!financialActive || paused || facade != factory || factory == address(0)
            || block.chainid != deploymentChainId) revert FinancialActivityDisabled();
    }

    function _deactivate() private {
        financialActive = false;
        approvedRelease = bytes32(0);
        approvedDigest = bytes32(0);
        emit FinanceDeactivated(msg.sender);
    }

    function _validateParameters(T.Parameters memory p) private view {
        if (p.feeBps > MAX_FEE_BPS || p.creationBond > MAX_BOND || p.proposalBond > MAX_BOND
            || p.challengeBond > MAX_BOND || p.minContribution == 0 || p.poolCap < p.minContribution
            || p.challengePeriod < 1 hours || p.challengePeriod > 7 days
            || p.arbitrationPeriod < 1 hours || p.arbitrationPeriod > 30 days
            || p.arbitrator == guardian) revert InvalidConfiguration();
        address[] memory govOwners = _owners(governance);
        address[] memory complianceOwners = _owners(complianceApprover);
        address[] memory arbOwners = _owners(p.arbitrator);
        _disjoint(govOwners, complianceOwners);
        _disjoint(govOwners, arbOwners);
        _disjoint(complianceOwners, arbOwners);
    }

    function _owners(address multisig) private view returns (address[] memory owners) {
        if (multisig.code.length == 0) revert InvalidMultisig();
        owners = IMultisig(multisig).getOwners();
        uint256 threshold = IMultisig(multisig).getThreshold();
        if (owners.length < 2 || owners.length > 32 || threshold < 2 || threshold > owners.length) revert InvalidMultisig();
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == address(0)) revert InvalidMultisig();
            for (uint256 j; j < i; ++j) if (owners[i] == owners[j]) revert InvalidMultisig();
        }
    }

    function _disjoint(address[] memory a, address[] memory b) private pure {
        for (uint256 i; i < a.length; ++i) for (uint256 j; j < b.length; ++j)
            if (a[i] == b[j]) revert InvalidMultisig();
    }
}
