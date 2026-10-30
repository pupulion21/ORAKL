// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T, ProtocolConfig, MarketFactory, IProtocolConfig} from "../helpers/OraklTestBase.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";

/// @dev Local EVM budgets only; not QIE Mainnet cold-wallet or deployment compatibility evidence.
contract P0_2GasBoundsTest is OraklTestBase {
    event log_named_uint(string name, uint256 value);

    function testMaximumDeclaredOwnerSetsAndMetadataFitLocalAdmissionBudget() public {
        vm.warp(1_800_000_000);
        governance = address(new MutableMultisig(100, 32));
        compliance = address(new MutableMultisig(200, 32));
        arbitrator = address(new MutableMultisig(300, 32));
        T.Parameters memory p = T.Parameters(200, 5 ether, 2 ether, 3 ether, 1, 100 ether, 1 hours, 1 hours, arbitrator);
        config = new ProtocolConfig(governance, compliance, guardian, p);
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        config.bindFactory(address(factory));
        _activate();
        bytes memory uri = new bytes(256);
        bytes memory prefix = bytes("ipfs://");
        for (uint256 i; i < 256; ++i) {
            uri[i] = i < 7 ? prefix[i] : bytes1(uint8(0x61));
        }
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 3 hours;
        vm.deal(alice, 100 ether);
        uint256 start = gasleft();
        vm.prank(alice);
        uint256 id = factory.createMarket{value: 5 ether, gas: 3_000_000}(HASH, string(uri), close, resolution, expiry);
        emit log_named_uint("local max-owners max-metadata create gas", start - gasleft());
        assertEq(factory.getMarket(id).metadataURI, string(uri), "maximum URI retained");
        start = gasleft();
        vm.prank(alice);
        factory.predict{value: 1 ether, gas: 3_000_000}(id, T.Side.YES);
        emit log_named_uint("local max-owners predict gas", start - gasleft());
        vm.expectRevert(ProtocolConfig.ControlUnchanged.selector);
        config.reportRoleDrift{gas: 2_500_000}();
        MutableMultisig(arbitrator).setOwner(0, address(9999));
        config.reportRoleDrift{gas: 2_500_000}();
        assertTrue(config.paused(), "bounded full check can record actual drift");
        _assertConservation();
    }

    function testClaimGasDoesNotGrowWithUnrelatedMarketCount() public {
        vm.warp(1_800_000_000);
        _deploy(true);
        uint256 first = _create();
        uint256 second = _create();
        _predict(first, bob, T.Side.YES, 10 ether);
        _predict(second, bob, T.Side.YES, 10 ether);
        _propose(first, T.Outcome.YES);
        _propose(second, T.Outcome.YES);
        vm.warp(factory.getMarket(first).challengeDeadline);
        factory.finalizeResult(first);
        factory.finalizeResult(second);
        vm.prank(bob);
        factory.claim{gas: 150_000}(first);
        for (uint256 i; i < 40; ++i) {
            _create();
        }
        // Identical explicit budget after forty unrelated entries; no participant/market scan in the withdrawal.
        vm.prank(bob);
        factory.claim{gas: 150_000}(second);
        assertEq(factory.getMarket(second).paidOut, 9.8 ether, "bounded claim succeeds");
        _assertConservation();
    }
}
