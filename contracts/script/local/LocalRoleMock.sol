// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IMultisig} from "../../src/interfaces/IMultisig.sol";

/// @title LOCAL TEST MOCK — n-of-m wallet view for ORAKL P1 development only.
/// @notice This is NOT a Safe, NOT an audited multisig and NOT a production
///         control. It exists only so `ProtocolConfig._walletState` can observe
///         a real contract with `getOwners`/`getThreshold` on the isolated
///         Anvil chain. Declared owners are the only execution authorization
///         this mock implements, and it has no recovery, guard, module or
///         fallback logic. Never deploy it to a public network.
contract LocalRoleMock is IMultisig {
    error NotOwner();
    error AlreadyConfirmed();
    error ExecutionFailed(bytes reason);

    address[] private _owners;
    mapping(address => bool) public isOwner;
    uint256 private _threshold;
    /// @notice Bumped only after an n-of-m confirmation set actually executes.
    uint256 public nonce;
    mapping(bytes32 => mapping(address => bool)) public confirmed;

    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length >= 2 && owners_.length <= 32, "count");
        require(threshold_ >= 2 && threshold_ <= owners_.length, "threshold");
        for (uint256 i; i < owners_.length; ++i) {
            address owner = owners_[i];
            require(owner != address(0), "zero owner");
            for (uint256 j; j < i; ++j) {
                require(owner != owners_[j], "duplicate owner");
            }
            _owners.push(owner);
            isOwner[owner] = true;
        }
        _threshold = threshold_;
    }

    function getOwners() external view override returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view override returns (uint256) {
        return _threshold;
    }

    /// @notice Confirm and, once `threshold` distinct owners have confirmed the
    ///         same (target, data, nonce) key, execute the call.
    /// @dev    While fewer than `threshold` owners have confirmed, this returns
    ///         empty bytes and changes no state other than the confirmation bit.
    function execute(address target, bytes calldata data) external payable returns (bytes memory result) {
        if (!isOwner[msg.sender]) revert NotOwner();
        bytes32 key = keccak256(abi.encode(target, data, nonce));
        if (confirmed[key][msg.sender]) revert AlreadyConfirmed();
        confirmed[key][msg.sender] = true;

        uint256 count;
        for (uint256 i; i < _owners.length; ++i) {
            if (confirmed[key][_owners[i]]) ++count;
        }
        if (count < _threshold) return bytes("");

        for (uint256 i; i < _owners.length; ++i) {
            confirmed[key][_owners[i]] = false;
        }
        nonce += 1;

        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) revert ExecutionFailed(ret);
        return ret;
    }
}
