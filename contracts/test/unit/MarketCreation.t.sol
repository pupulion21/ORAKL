// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolStorage} from "../helpers/OraklTestBase.sol";

contract MarketCreationTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testPermissionlessCreationUniqueIdsAndCommitment() public {
        uint256 first = _create();
        vm.prank(carol);
        uint256 second = factory.createMarket{value: 5 ether}(HASH, "ipfs://another", close, resolution, expiry);
        assertEq(first, 0, "first ID");
        assertEq(second, 1, "second ID");
        T.Market memory m = factory.getMarket(first);
        assertEq(m.creator, alice, "creator");
        assertTrue(m.metadataHash == HASH, "metadata commitment");
        assertEq(m.metadataURI, "ipfs://test-cid", "URI");
        assertEq(factory.bondLiability(), 10 ether, "creation bonds");
        assertEq(factory.participantLiability(), 0, "bonds not contributions");
        _assertConservation();
    }

    function testInvalidMetadata() public {
        _bad(bytes32(0), "ipfs://test", close, resolution, expiry, ProtocolStorage.InvalidMetadata.selector);
        _bad(HASH, "", close, resolution, expiry, ProtocolStorage.InvalidMetadata.selector);
        _bad(HASH, "https://mutable", close, resolution, expiry, ProtocolStorage.InvalidMetadata.selector);
        _bad(HASH, "ipfs://", close, resolution, expiry, ProtocolStorage.InvalidMetadata.selector);
        _bad(HASH, string(new bytes(257)), close, resolution, expiry, ProtocolStorage.InvalidMetadata.selector);
    }

    function testInvalidDeadlinesAndHorizon() public {
        _bad(HASH, "ipfs://test", uint64(block.timestamp), resolution, expiry, ProtocolStorage.InvalidTime.selector);
        _bad(HASH, "ipfs://test", close, close - 1, expiry, ProtocolStorage.InvalidTime.selector);
        _bad(HASH, "ipfs://test", close, resolution, resolution + 2 hours, ProtocolStorage.InvalidTime.selector);
        _bad(HASH, "ipfs://test", close, resolution, close + 366 days, ProtocolStorage.InvalidTime.selector);
        _bad(
            HASH,
            "ipfs://test",
            uint64(block.timestamp + 366 days),
            uint64(block.timestamp + 367 days),
            uint64(block.timestamp + 368 days),
            ProtocolStorage.InvalidTime.selector
        );
    }

    function testExactCreationBondAndNoArbitratorCreation() public {
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.IncorrectValue.selector);
        factory.createMarket{value: 5 ether - 1}(HASH, "ipfs://test", close, resolution, expiry);
        vm.prank(alice);
        vm.expectRevert(ProtocolStorage.IncorrectValue.selector);
        factory.createMarket{value: 5 ether + 1}(HASH, "ipfs://test", close, resolution, expiry);
        vm.deal(arbitrator, 6 ether);
        vm.prank(arbitrator);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.createMarket{value: 5 ether}(HASH, "ipfs://test", close, resolution, expiry);
    }

    function testUnknownMarketViewsRevert() public {
        vm.expectRevert(ProtocolStorage.MarketNotFound.selector);
        factory.getMarket(0);
        vm.expectRevert(ProtocolStorage.MarketNotFound.selector);
        factory.getPosition(0, alice);
        vm.expectRevert(ProtocolStorage.MarketNotFound.selector);
        factory.getBond(0, T.BondType.CREATION);
        vm.expectRevert(ProtocolStorage.MarketNotFound.selector);
        factory.getPoolTotals(0);
    }

    function _bad(bytes32 hash, string memory uri, uint64 c, uint64 r, uint64 e, bytes4 err) private {
        vm.prank(alice);
        vm.expectRevert(err);
        factory.createMarket{value: 5 ether}(hash, uri, c, r, e);
    }
}
