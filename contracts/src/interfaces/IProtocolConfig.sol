// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ProtocolTypes as T} from "../libraries/ProtocolTypes.sol";

interface IProtocolConfig {
    function parameters() external view returns (T.Parameters memory);
    function requireFinancialActivity(address facade) external view;
    function governance() external view returns (address);
}
