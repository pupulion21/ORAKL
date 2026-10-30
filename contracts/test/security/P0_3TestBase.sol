// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    OraklTestBase,
    T,
    ProtocolStorage,
    ProtocolConfig,
    MarketFactory,
    IProtocolConfig
} from "../helpers/OraklTestBase.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

interface EvidenceLogVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

abstract contract P0_3TestBase is OraklTestBase {
    MutableMultisig internal g;
    MutableMultisig internal c;
    MutableMultisig internal a;
    EvidenceLogVm internal constant logVm = EvidenceLogVm(address(vm));
    address internal observer = address(0xe11);
    bytes32 internal constant EVIDENCE_TOPIC = keccak256("DisputeEvidenceSubmitted(uint256,address,bytes32)");

    function _deployMutable(bool active) internal {
        g = new MutableMultisig(100, 2);
        c = new MutableMultisig(200, 2);
        a = new MutableMultisig(300, 2);
        governance = address(g);
        compliance = address(c);
        arbitrator = address(a);
        config = new ProtocolConfig(
            governance,
            compliance,
            guardian,
            T.Parameters(200, 5 ether, 2 ether, 3 ether, 1, type(uint128).max, 1 hours, 1 hours, arbitrator)
        );
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        config.bindFactory(address(factory));
        if (active) _activate();
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 3 hours;
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(carol, 1e30);
        vm.deal(observer, 1e30);
    }

    function _role(uint256 i) internal view returns (MutableMultisig) {
        return i % 3 == 0 ? g : i % 3 == 1 ? c : a;
    }

    function _submit(uint256 id, address who, bytes32 commitment) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(factory).call(abi.encodeWithSignature("submitEvidence(uint256,bytes32)", id, commitment));
    }

    function _assertEvidenceLog(EvidenceLogVm.Log memory entry, uint256 id, address who, bytes32 commitment)
        internal
        view
    {
        assertEq(entry.emitter, address(factory), "evidence facade emitter");
        assertEq(entry.topics.length, 4, "three indexed fixed-word fields");
        assertTrue(entry.topics[0] == EVIDENCE_TOPIC, "exact event signature");
        assertTrue(entry.topics[1] == bytes32(id), "immutable market association");
        assertTrue(entry.topics[2] == bytes32(uint256(uint160(who))), "contributor provenance");
        assertTrue(entry.topics[3] == commitment, "integrity commitment");
        assertEq(entry.data.length, 0, "no raw evidence payload");
    }
}
