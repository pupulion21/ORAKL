// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {IMultisig} from "../../src/interfaces/IMultisig.sol";

/// @dev ADVERSARIAL TEST DOUBLE. Declared owners are not execution authorization.
contract MutableMultisig is IMultisig {
    address[] private _owners;
    uint256 private _threshold = 2;
    uint8 public fault;
    address public hiddenModule;
    address public implementationMarker;
    address public guardMarker;

    constructor(uint160 first, uint256 count) {
        for (uint256 i; i < count; ++i) {
            _owners.push(address(first + uint160(i)));
        }
    }

    function setThreshold(uint256 value) external {
        _threshold = value;
    }

    function setOwner(uint256 index, address owner) external {
        _owners[index] = owner;
    }

    function setFault(uint8 value) external {
        fault = value;
    }

    function installHiddenModule(address module) external {
        hiddenModule = module;
    }

    function setImplementationMarker(address marker) external {
        implementationMarker = marker;
    }

    function setGuardMarker(address marker) external {
        guardMarker = marker;
    }

    function getOwners() external view override returns (address[] memory) {
        if (fault == 1) revert("getter unavailable");
        if (fault == 2) {
            assembly { for {} 1 {} {} }
        }
        if (fault == 3) {
            assembly { return(0, 0x10000) }
        }
        if (fault == 4) {
            assembly { return(0, 31) }
        }
        if (fault == 5) {
            assembly {
                mstore(0, 32)
                mstore(32, not(0))
                return(0, 96)
            }
        }
        return _owners;
    }

    function getThreshold() external view override returns (uint256) {
        return _threshold;
    }

    /// @dev Models a module/single-controller bypass despite plausible n-of-m views.
    function executeFromHiddenModule(address target, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == hiddenModule, "module only");
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}
