// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev Minimal cheatcode interface pointing at the standard Foundry VM precompile
///      address. Self-authored replacement for forge-std so the project stays
///      dependency-free and offline-replayable, following the pinned fixture's
///      no-forge-std style.
interface Vm {
    function warp(uint256 newTimestamp) external;

    function roll(uint256 newHeight) external;

    function prank(address msgSender) external;

    function startPrank(address msgSender) external;

    function stopPrank() external;

    function expectRevert() external;

    function expectRevert(bytes4 revertData) external;

    function expectRevert(bytes calldata revertData) external;

    function expectEmit() external;

    function deal(address account, uint256 newBalance) external;

    function label(address account, string calldata newLabel) external;

    function addr(uint256 privateKey) external returns (address keyAddr);

    function snapshot() external returns (uint256 stateSnapshot);

    function revertTo(uint256 stateSnapshot) external returns (bool supported);

    function toString(uint256 value) external returns (string memory stringified);

    function toString(address value) external returns (string memory stringified);
}
