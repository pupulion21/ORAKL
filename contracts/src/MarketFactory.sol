// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {MarketResolver} from "./MarketResolver.sol";
import {ProtocolStorage} from "./ProtocolStorage.sol";
import {ProtocolTypes as T} from "./libraries/ProtocolTypes.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";

/// @title ORAKL v1 native-QIE binary pari-mutuel facade; inactive until separately approved.
contract MarketFactory is MarketResolver {
    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        bytes32 indexed metadataHash,
        string metadataURI,
        uint64 closeTime,
        uint64 resolutionTime,
        uint64 maxResolutionTime,
        T.Parameters terms
    );

    constructor(IProtocolConfig config) ProtocolStorage(config) {
        if (address(config).code.length == 0) revert InvalidMetadata();
    }

    function createMarket(
        bytes32 metadataHash,
        string calldata metadataURI,
        uint64 closeTime,
        uint64 resolutionTime,
        uint64 maxResolutionTime
    ) public payable virtual nonReentrant financialEntry returns (uint256 id) {
        bytes memory uri = bytes(metadataURI);
        if (metadataHash == bytes32(0) || uri.length < 8 || uri.length > 256 || bytes7(uri) != bytes7("ipfs://")) {
            revert InvalidMetadata();
        }
        T.Parameters memory terms = protocolConfig.parameters();
        _validateCreation(terms, resolutionTime, maxResolutionTime);
        if (msg.sender == terms.arbitrator) revert Unauthorized();
        if (
            closeTime <= block.timestamp || closeTime > block.timestamp + 365 days || resolutionTime < closeTime
                || uint256(maxResolutionTime)
                    <= uint256(resolutionTime) + terms.challengePeriod + terms.arbitrationPeriod
                || uint256(maxResolutionTime) > uint256(closeTime) + 365 days
        ) revert InvalidTime();
        if (msg.value != terms.creationBond) revert IncorrectValue();
        id = marketCount++;
        T.Market storage m = _markets[id];
        m.creator = msg.sender;
        m.metadataHash = metadataHash;
        m.metadataURI = metadataURI;
        m.closeTime = closeTime;
        m.resolutionTime = resolutionTime;
        m.maxResolutionTime = maxResolutionTime;
        m.terms = terms;
        m.creationActivityEpoch = protocolConfig.activityEpoch();
        m.arbitratorFingerprint = protocolConfig.roleFingerprint(terms.arbitrator);
        _depositBond(id, T.BondType.CREATION, terms.creationBond);
        emit MarketCreated(
            id, msg.sender, metadataHash, metadataURI, closeTime, resolutionTime, maxResolutionTime, terms
        );
    }
    function _validateCreation(T.Parameters memory, uint64, uint64) internal view virtual {}
}
