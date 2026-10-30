// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @dev Compatible with Safe owner/threshold views; deployment must verify actual code and control.
interface IMultisig {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}
