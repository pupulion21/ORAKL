// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Vm} from "./Vm.sol";

/// @dev Minimal self-authored test base: cheatcode access, assertions and bounding.
///      Mirrors the pinned fixture's dependency-free test style.
abstract contract TestBase {
    Vm internal constant vm =
        Vm(address(uint160(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D)));

    function assertTrue(bool condition, string memory message) internal pure {
        if (!condition) revert(message);
    }

    function assertFalse(bool condition, string memory message) internal pure {
        assertTrue(!condition, message);
    }

    function assertEq(uint256 left, uint256 right, string memory message) internal pure {
        if (left != right) {
            revert(string.concat(message, " | left: ", _toString(left), ", right: ", _toString(right)));
        }
    }

    function assertEq(address left, address right, string memory message) internal pure {
        if (left != right) revert(message);
    }

    function assertEq(bool left, bool right, string memory message) internal pure {
        if (left != right) revert(message);
    }

    function assertGt(uint256 left, uint256 right, string memory message) internal pure {
        if (left <= right) {
            revert(string.concat(message, " | left: ", _toString(left), ", right: ", _toString(right)));
        }
    }

    function assertGe(uint256 left, uint256 right, string memory message) internal pure {
        if (left < right) {
            revert(string.concat(message, " | left: ", _toString(left), ", right: ", _toString(right)));
        }
    }

    function assertLt(uint256 left, uint256 right, string memory message) internal pure {
        if (left >= right) {
            revert(string.concat(message, " | left: ", _toString(left), ", right: ", _toString(right)));
        }
    }

    function assertLe(uint256 left, uint256 right, string memory message) internal pure {
        if (left > right) {
            revert(string.concat(message, " | left: ", _toString(left), ", right: ", _toString(right)));
        }
    }

    function assertEq(string memory left, string memory right, string memory message) internal pure {
        if (keccak256(bytes(left)) != keccak256(bytes(right))) revert(message);
    }

    /// @dev Deterministic labeled address, independent of forge-std.
    function makeAddr(string memory label) internal returns (address account) {
        account = address(uint160(uint256(keccak256(abi.encodePacked(label)))));
        vm.label(account, label);
    }

    /// @dev Maps any x into [lo, hi]. Callers keep hi < 2^256 - 1 so hi - lo + 1 cannot overflow.
    function bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        assertTrue(hi >= lo, "bound: hi < lo");
        if (x >= lo && x <= hi) return x;
        return lo + (x % (hi - lo + 1));
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 rest = value; rest > 0; rest /= 10) ++digits;
        bytes memory buffer = new bytes(digits);
        for (uint256 rest = value; rest > 0; ) {
            buffer[--digits] = bytes1(uint8(48 + (rest % 10)));
            rest /= 10;
        }
        return string(buffer);
    }
}
