// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, MultisigViewMock} from "../helpers/OraklTestBase.sol";
import {MutableMultisig} from "../doubles/MutableMultisig.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";

abstract contract SelectedBase is OraklTestBase {
    SelectedMarketFactory internal selected;

    function _deploySelected() internal {
        governance = address(new MutableMultisig(100, 2));
        compliance = address(new MutableMultisig(200, 2));
        arbitrator = address(new MutableMultisig(300, 5));
        // 1 ether here means 10^18 SYNTHETIC integer units, not verified Mainnet decimals.
        T.Parameters memory p =
            T.Parameters(200, 1 ether, 10 ether, 1 ether, 0.01 ether, 100 ether, 48 hours, 96 hours, arbitrator);
        MutableMultisig(arbitrator).setThreshold(3);
        config = new ProtocolConfig(governance, compliance, guardian, p);
        selected = new SelectedMarketFactory(IProtocolConfig(address(config)));
        factory = selected;
        vm.prank(governance);
        config.bindFactory(address(selected));
        _activate();
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 10 days;
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(carol, 1e30);
    }

    function _new() internal returns (uint256) {
        close = uint64(block.timestamp + 100);
        resolution = close + 100;
        expiry = resolution + 10 days;
        return _create();
    }

    function _stake(uint256 id, address who, uint256 value) internal {
        vm.deal(who, 1e30);
        vm.prank(who);
        selected.challengeResult{value: value}(id, HASH);
    }

    function _decision(uint256 id, T.Outcome outcome) internal {
        _waitForArbitration(id);
        vm.prank(arbitrator);
        selected.settleDispute(id, outcome, HASH);
    }

    function _bond(uint256 id, T.BondType kind, address who) internal returns (uint256 amount) {
        amount = selected.getBondEntitlement(id, kind, who);
        vm.prank(who);
        selected.claimBond(id, kind, carol);
    }
}
