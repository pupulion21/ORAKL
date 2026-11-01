// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IMultisig} from "../../src/interfaces/IMultisig.sol";

/// @title Safe3Of5 — Faithful Safe v1.3.0/v1.4.1 Execution Architecture for ORAKL P2
/// @notice Implements canonical GnosisSafe EIP-712 domain separation, ascending signature sorting,
///         threshold verification (3 of 5), and nonce replay protection.
///         Used for local Anvil and Foundry integration testing of production governance.
contract Safe3Of5 is IMultisig {
    enum Operation {
        Call,
        DelegateCall
    }

    error SetupFailed();
    error InvalidOwner();
    error DuplicateOrUnorderedOwner();
    error InvalidThreshold();
    error InvalidSignatures();
    error Unauthorized();
    error ExecutionFailed(bytes returnData);

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 private constant SAFE_TX_TYPEHASH =
        keccak256(
            "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
        );

    uint256 public constant THRESHOLD = 3;
    uint256 public constant OWNER_COUNT = 5;

    address[] internal _owners;
    mapping(address => bool) internal _isOwner;
    uint256 public nonce;

    event SafeSetup(address[] owners, uint256 threshold);
    event ExecutionSuccess(bytes32 txHash, uint256 payment);
    event ExecutionFailure(bytes32 txHash, uint256 payment);

    constructor(address[] memory owners_) {
        if (owners_.length != OWNER_COUNT) revert SetupFailed();

        address lastOwner = address(0);
        for (uint256 i = 0; i < OWNER_COUNT; ++i) {
            address owner = owners_[i];
            if (owner == address(0)) revert InvalidOwner();
            // Strict ascending order prevents duplicate owners and enforces canonical ordering
            if (owner <= lastOwner) revert DuplicateOrUnorderedOwner();
            _owners.push(owner);
            _isOwner[owner] = true;
            lastOwner = owner;
        }

        emit SafeSetup(_owners, THRESHOLD);
    }

    receive() external payable {}

    function getOwners() external view override returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external pure override returns (uint256) {
        return THRESHOLD;
    }

    function isOwner(address owner) external view returns (bool) {
        return _isOwner[owner];
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, address(this)));
    }

    function encodeTransactionData(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash = keccak256(
            abi.encode(
                SAFE_TX_TYPEHASH,
                to,
                value,
                keccak256(data),
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                _nonce
            )
        );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(
            encodeTransactionData(
                to,
                value,
                data,
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                _nonce
            )
        );
    }

    /// @notice Helper for zero-value calls avoiding 10-argument stack pressure
    function getSimpleTransactionHash(address to, bytes memory data, uint256 _nonce) public view returns (bytes32) {
        return getTransactionHash(
            to,
            0,
            data,
            Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            _nonce
        );
    }

    /// @notice Validates that signatures contains at least THRESHOLD valid, unique ECDSA signatures
    ///         from registered owners sorted in strictly ascending order by address.
    function checkSignatures(bytes32 dataHash, bytes memory signatures) public view {
        uint256 sigCount = signatures.length / 65;
        if (sigCount < THRESHOLD) revert InvalidSignatures();

        address lastSigner = address(0);
        for (uint256 i = 0; i < sigCount; ++i) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                let offset := add(signatures, add(0x20, mul(i, 65)))
                r := mload(offset)
                s := mload(add(offset, 0x20))
                v := byte(0, mload(add(offset, 0x40)))
            }

            // Normalise v
            if (v < 27) {
                v += 27;
            }
            if (v != 27 && v != 28) revert InvalidSignatures();

            address signer = ecrecover(dataHash, v, r, s);
            if (signer == address(0)) revert InvalidSignatures();
            if (!_isOwner[signer]) revert Unauthorized();
            // Strict ascending check prevents signature reuse / duplicate signers
            if (signer <= lastSigner) revert DuplicateOrUnorderedOwner();
            lastSigner = signer;
        }
    }

    /// @notice Executes a multi-signed transaction once threshold signatures are verified.
    function execTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        bytes memory signatures
    ) public payable returns (bool success) {
        bytes32 txHash = getTransactionHash(
            to,
            value,
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver,
            nonce
        );

        // Replay defense: verify against current nonce before incrementing
        checkSignatures(txHash, signatures);

        // Increment nonce before external execution (reentrancy defense)
        nonce++;

        if (operation == Operation.Call) {
            (success, ) = to.call{value: value}(data);
        } else {
            revert("Operation not supported");
        }

        if (success) {
            emit ExecutionSuccess(txHash, 0);
        } else {
            emit ExecutionFailure(txHash, 0);
            revert ExecutionFailed("");
        }
    }

    /// @notice Convenience wrapper for zero-value calls avoiding caller stack-too-deep
    function execSimple(address to, bytes memory data, bytes memory signatures) external returns (bool) {
        return execTransaction(
            to,
            0,
            data,
            Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            signatures
        );
    }
}
