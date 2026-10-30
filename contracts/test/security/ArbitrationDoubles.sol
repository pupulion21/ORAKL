// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev Adversarial execution mocks, NOT Safe implementations and NOT production admission evidence.
contract GuardedArbitratorMock {
    bool public blocked;
    address public immutable controller;
    error GuardBlocked();

    constructor(address controller_) {
        controller = controller_;
    }

    function getOwners() external pure returns (address[] memory owners) {
        owners = new address[](2);
        owners[0] = address(700);
        owners[1] = address(701);
    }

    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function setBlocked(bool value) external {
        require(msg.sender == controller);
        blocked = value;
    }

    function execute(address target, bytes calldata data) external {
        require(msg.sender == controller);
        if (blocked) revert GuardBlocked();
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}

/// @dev Deliberately dishonest admission: declared owners stay stable while delegate execution can be replaced.
contract MutableProxyWalletMock {
    address public implementation;
    address public admin;
    address public controller;

    constructor(address initial, address owner) {
        implementation = initial;
        admin = owner;
        controller = owner;
    }

    function getOwners() external pure returns (address[] memory owners) {
        owners = new address[](2);
        owners[0] = address(800);
        owners[1] = address(801);
    }

    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function upgrade(address next) external {
        require(msg.sender == admin);
        implementation = next;
    }

    fallback() external payable {
        address target = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

contract RestrictedWalletExecutionMock {
    // Match the proxy's test-only storage layout.
    address private implementation;
    address private admin;
    address private controller;

    function execute(address target, bytes calldata data) external {
        require(msg.sender == controller, "controller only");
        _call(target, data);
    }

    function _call(address target, bytes memory data) private {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}

contract OpenWalletExecutionMock {
    function execute(address target, bytes calldata data) external {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}

contract SharedControllerWalletMock {
    address public immutable controller;
    address[] private owners;

    constructor(uint160 first, address controller_) {
        controller = controller_;
        owners.push(address(first));
        owners.push(address(first + 1));
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function execute(address target, bytes calldata data) external {
        require(msg.sender == controller, "hidden controller");
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}
