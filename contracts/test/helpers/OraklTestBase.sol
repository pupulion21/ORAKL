// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {TestBase} from "./TestBase.sol";
import {MarketFactory} from "../../src/MarketFactory.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {ProtocolStorage} from "../../src/ProtocolStorage.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";

/// @dev VIEW FIXTURE ONLY. Does not implement multisig execution or real security.
contract MultisigViewMock {
    address[] private owners;
    uint256 private threshold;

    constructor(uint160 seed, uint256 threshold_) {
        owners.push(address(seed));
        owners.push(address(seed + 1));
        threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}

abstract contract OraklTestBase is TestBase {
    MarketFactory internal factory;
    ProtocolConfig internal config;
    address internal governance;
    address internal compliance;
    address internal arbitrator;
    address internal guardian = address(0x9988);
    address internal alice = address(0xa11ce);
    address internal bob = address(0xb0b);
    address internal carol = address(0xca201);
    bytes32 internal constant HASH = keccak256("content-addressed test fixture");
    bytes32 internal constant RELEASE = keccak256("LOCAL TEST ONLY; no approval for any deployment");
    uint64 internal close;
    uint64 internal resolution;
    uint64 internal expiry;

    function _deploy(bool activate) internal {
        governance = address(new MultisigViewMock(100, 2));
        compliance = address(new MultisigViewMock(200, 2));
        arbitrator = address(new MultisigViewMock(300, 2));
        T.Parameters memory p =
            T.Parameters(200, 5 ether, 2 ether, 3 ether, 1, type(uint128).max, 1 hours, 1 hours, arbitrator);
        config = new ProtocolConfig(governance, compliance, guardian, p);
        factory = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        config.bindFactory(address(factory));
        if (activate) _activate();
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 3 hours;
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(carol, 1e30);
    }

    function _activate() internal {
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        vm.prank(governance);
        config.activateFinance(RELEASE);
    }

    function _create() internal returns (uint256) {
        uint256 bond = config.parameters().creationBond;
        vm.prank(alice);
        return factory.createMarket{value: bond}(HASH, "ipfs://test-cid", close, resolution, expiry);
    }

    function _predict(uint256 id, address who, T.Side side, uint256 amount) internal {
        vm.prank(who);
        factory.predict{value: amount}(id, side);
    }

    function _propose(uint256 id, T.Outcome outcome) internal {
        vm.warp(factory.getMarket(id).resolutionTime);
        uint256 bond = factory.getMarket(id).terms.proposalBond;
        vm.prank(alice);
        factory.proposeResult{value: bond}(id, outcome, HASH);
    }

    function _finalize(uint256 id, T.Outcome outcome) internal {
        _propose(id, outcome);
        vm.warp(factory.getMarket(id).challengeDeadline);
        factory.finalizeResult(id);
    }

    function _challenge(uint256 id) internal {
        uint256 bond = factory.getMarket(id).terms.challengeBond;
        vm.prank(bob);
        factory.challengeResult{value: bond}(id, HASH);
    }

    function _assertConservation() internal view {
        assertEq(
            factory.totalAccounted(),
            factory.totalContributions() + factory.totalBondsDeposited() - factory.totalParticipantPaid()
                - factory.totalBondsPaid() - factory.totalFeesWithdrawn(),
            "conservation"
        );
        assertLe(factory.totalAccounted(), address(factory).balance, "solvency");
    }
}
