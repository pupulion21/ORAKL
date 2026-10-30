// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {IProtocolConfig} from "../src/interfaces/IProtocolConfig.sol";
import {ProtocolTypes as T} from "../src/libraries/ProtocolTypes.sol";

/// @notice Local construction rehearsal only; has no broadcast or activation call.
contract DeployInactive {
    error LiveDeploymentBlocked();

    function run(address governance, address compliance, address guardian, T.Parameters calldata terms)
        external
        returns (ProtocolConfig config, MarketFactory factory)
    {
        if (block.chainid != 31337) revert LiveDeploymentBlocked();
        config = new ProtocolConfig(governance, compliance, guardian, terms);
        factory = new MarketFactory(IProtocolConfig(address(config)));
        // Deliberately unbound, unapproved, inactive. Binding requires separate governance action.
    }
}
