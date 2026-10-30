// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ProtocolTypes as T} from "../libraries/ProtocolTypes.sol";

interface IProtocolConfig {
    function parameters() external view returns (T.Parameters memory);
    function requireFinancialActivity(address facade) external view;
    function requireChallengeActivity(address facade) external view;
    function activityEpoch() external view returns (uint64);
    function interruptedAt(uint64 epoch) external view returns (uint64);
    function roleFingerprint(address wallet) external view returns (bytes32);
    function requireUncontestedSettlement() external view;
    function requireArbitrator(address arbitrator, bytes32 expected) external view;
    function requireGovernanceAuthority(address caller) external view;
    function governance() external view returns (address);
}
