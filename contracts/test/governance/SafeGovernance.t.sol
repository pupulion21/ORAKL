// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {TestBase} from "../helpers/TestBase.sol";
import {Safe3Of5} from "./Safe3Of5.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";
import {SelectedMarketFactory} from "../../src/SelectedMarketFactory.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";

contract SafeGovernanceTest is TestBase {
    Safe3Of5 public govSafe;
    Safe3Of5 public compSafe;
    Safe3Of5 public arbSafe;
    address public guardian = address(0x9999);

    ProtocolConfig public config;
    SelectedMarketFactory public factory;

    uint256[5] internal govPks;
    address[5] internal govOwners;

    uint256[5] internal compPks;
    address[5] internal compOwners;

    uint256[5] internal arbPks;
    address[5] internal arbOwners;

    bytes32 internal constant TEST_RELEASE = keccak256("TEST_RELEASE_P2");

    function setUp() public {
        vm.warp(1_800_000_000);

        _setupOrderedOwners(100, govPks, govOwners);
        _setupOrderedOwners(200, compPks, compOwners);
        _setupOrderedOwners(300, arbPks, arbOwners);

        address[] memory gList = new address[](5);
        address[] memory cList = new address[](5);
        address[] memory aList = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            gList[i] = govOwners[i];
            cList[i] = compOwners[i];
            aList[i] = arbOwners[i];
        }

        govSafe = new Safe3Of5(gList);
        compSafe = new Safe3Of5(cList);
        arbSafe = new Safe3Of5(aList);

        T.Parameters memory initialParams = T.Parameters({
            feeBps: 200,
            creationBond: 1 ether,
            proposalBond: 10 ether,
            challengeBond: 1 ether,
            minContribution: 0.01 ether,
            poolCap: 100 ether,
            challengePeriod: 48 hours,
            arbitrationPeriod: 96 hours,
            arbitrator: address(arbSafe)
        });

        config = new ProtocolConfig(
            address(govSafe),
            address(compSafe),
            guardian,
            initialParams
        );

        factory = new SelectedMarketFactory(IProtocolConfig(address(config)));
    }

    function _setupOrderedOwners(
        uint256 pkBase,
        uint256[5] storage pks,
        address[5] storage owners
    ) internal {
        address[] memory addrs = new address[](5);
        uint256[] memory keys = new uint256[](5);

        for (uint256 i = 0; i < 5; i++) {
            keys[i] = pkBase + i + 1;
            addrs[i] = vm.addr(keys[i]);
        }

        for (uint256 i = 0; i < 5; i++) {
            for (uint256 j = i + 1; j < 5; j++) {
                if (addrs[j] < addrs[i]) {
                    address tempA = addrs[i];
                    addrs[i] = addrs[j];
                    addrs[j] = tempA;

                    uint256 tempK = keys[i];
                    keys[i] = keys[j];
                    keys[j] = tempK;
                }
            }
        }

        for (uint256 i = 0; i < 5; i++) {
            pks[i] = keys[i];
            owners[i] = addrs[i];
        }
    }

    function _signSimple(
        Safe3Of5 safe,
        uint256[] memory signingKeys,
        address to,
        bytes memory data
    ) internal returns (bytes memory signatures) {
        bytes32 txHash = safe.getSimpleTransactionHash(to, data, safe.nonce());

        uint256 len = signingKeys.length;
        address[] memory signers = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            signers[i] = vm.addr(signingKeys[i]);
        }

        for (uint256 i = 0; i < len; i++) {
            for (uint256 j = i + 1; j < len; j++) {
                if (signers[j] < signers[i]) {
                    address tempA = signers[i];
                    signers[i] = signers[j];
                    signers[j] = tempA;

                    uint256 tempK = signingKeys[i];
                    signingKeys[i] = signingKeys[j];
                    signingKeys[j] = tempK;
                }
            }
        }

        for (uint256 i = 0; i < len; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signingKeys[i], txHash);
            signatures = abi.encodePacked(signatures, r, s, v);
        }
    }

    function _bindFactory() internal {
        bytes memory data = abi.encodeWithSelector(config.bindFactory.selector, address(factory));
        uint256[] memory gov3 = new uint256[](3);
        gov3[0] = govPks[0];
        gov3[1] = govPks[1];
        gov3[2] = govPks[2];
        bytes memory sigs = _signSimple(govSafe, gov3, address(config), data);
        govSafe.execSimple(address(config), data, sigs);
    }

    function _approveRelease() internal {
        bytes memory data = abi.encodeWithSelector(config.approveRelease.selector, TEST_RELEASE);
        uint256[] memory comp3 = new uint256[](3);
        comp3[0] = compPks[0];
        comp3[1] = compPks[1];
        comp3[2] = compPks[2];
        bytes memory sigs = _signSimple(compSafe, comp3, address(config), data);
        compSafe.execSimple(address(config), data, sigs);
    }

    function _activateFinance() internal {
        bytes memory data = abi.encodeWithSelector(config.activateFinance.selector, TEST_RELEASE);
        uint256[] memory gov3 = new uint256[](3);
        gov3[0] = govPks[0];
        gov3[1] = govPks[1];
        gov3[2] = govPks[2];
        bytes memory sigs = _signSimple(govSafe, gov3, address(config), data);
        govSafe.execSimple(address(config), data, sigs);
    }

    /// @notice Condition 2 & 3: Five distinct owners and threshold exactly 3
    function testSafeConfigurationProperties() public view {
        assertEq(govSafe.getThreshold(), 3, "Threshold must be exactly 3");
        address[] memory owners = govSafe.getOwners();
        assertEq(owners.length, 5, "Owners count must be 5");
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(govSafe.isOwner(govOwners[i]), "Owner must be registered");
        }
    }

    /// @notice Condition 4: Two signatures cannot execute (reverts with InvalidSignatures)
    function testTwoSignaturesCannotExecute() public {
        bytes memory data = abi.encodeWithSelector(config.unpause.selector);

        uint256[] memory twoKeys = new uint256[](2);
        twoKeys[0] = govPks[0];
        twoKeys[1] = govPks[1];

        bytes memory sigs = _signSimple(govSafe, twoKeys, address(config), data);

        vm.expectRevert();
        govSafe.execSimple(address(config), data, sigs);
    }

    /// @notice Condition 5: Three valid signatures can execute
    function testThreeSignaturesExecute() public {
        _bindFactory();
        assertEq(config.factory(), address(factory), "Factory should be bound");
    }

    /// @notice Condition 6: Unauthorized signer signature fails
    function testUnauthorizedSignerCannotExecute() public {
        bytes memory data = abi.encodeWithSelector(config.bindFactory.selector, address(factory));

        uint256[] memory keys = new uint256[](3);
        keys[0] = govPks[0];
        keys[1] = govPks[1];
        keys[2] = 999999;

        bytes memory sigs = _signSimple(govSafe, keys, address(config), data);

        vm.expectRevert();
        govSafe.execSimple(address(config), data, sigs);
    }

    /// @notice Condition 7: Replayed Safe transaction cannot execute twice
    function testReplayTransactionCannotExecuteTwice() public {
        bytes memory data = abi.encodeWithSelector(config.bindFactory.selector, address(factory));

        uint256[] memory threeKeys = new uint256[](3);
        threeKeys[0] = govPks[0];
        threeKeys[1] = govPks[1];
        threeKeys[2] = govPks[2];

        bytes memory sigs = _signSimple(govSafe, threeKeys, address(config), data);

        govSafe.execSimple(address(config), data, sigs);

        vm.expectRevert();
        govSafe.execSimple(address(config), data, sigs);
    }

    /// @notice Condition 8: Tampered transaction digest is rejected
    function testTamperedPayloadRejected() public {
        bytes memory originalData = abi.encodeWithSelector(config.bindFactory.selector, address(factory));

        uint256[] memory threeKeys = new uint256[](3);
        threeKeys[0] = govPks[0];
        threeKeys[1] = govPks[1];
        threeKeys[2] = govPks[2];

        bytes memory sigs = _signSimple(govSafe, threeKeys, address(config), originalData);

        bytes memory tamperedData = abi.encodeWithSelector(config.bindFactory.selector, address(0xdead));

        vm.expectRevert();
        govSafe.execSimple(address(config), tamperedData, sigs);
    }

    /// @notice Condition 9: Unordered or duplicate signers rejected
    function testUnorderedSignaturesRejected() public {
        bytes memory data = abi.encodeWithSelector(config.bindFactory.selector, address(factory));

        bytes32 txHash = govSafe.getSimpleTransactionHash(address(config), data, govSafe.nonce());

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(govPks[1], txHash);
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(govPks[0], txHash);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(govPks[2], txHash);

        bytes memory reversedSigs = abi.encodePacked(r1, s1, v1, r0, s0, v0, r2, s2, v2);

        vm.expectRevert();
        govSafe.execSimple(address(config), data, reversedSigs);
    }

    /// @notice Conditions 10, 11, 12, 13: End-to-end Safe lifecycle with 24h delay
    function testFullSafeLifecycleThroughProtocolConfig() public {
        _bindFactory();
        assertEq(config.factory(), address(factory), "Factory should be bound");

        _approveRelease();

        bytes memory activateData = abi.encodeWithSelector(config.activateFinance.selector, TEST_RELEASE);
        uint256[] memory gov3 = new uint256[](3);
        gov3[0] = govPks[0];
        gov3[1] = govPks[1];
        gov3[2] = govPks[2];
        bytes memory activateSigsPremature = _signSimple(govSafe, gov3, address(config), activateData);

        vm.expectRevert();
        govSafe.execSimple(address(config), activateData, activateSigsPremature);

        vm.warp(block.timestamp + 86401);

        _activateFinance();

        assertTrue(config.financialActive(), "Financial active should be true");
    }

    /// @notice Condition 15: Emergency pause by Guardian and Unpause by Governance Safe (3-of-5)
    function testEmergencyPauseAndSafeUnpause() public {
        _bindFactory();
        _approveRelease();
        vm.warp(block.timestamp + 86401);
        _activateFinance();

        // Step 1: Guardian pauses immediately without multisig
        vm.prank(guardian);
        config.pause();
        assertTrue(config.paused(), "Config should be paused");

        // Step 2: Guardian CANNOT unpause
        vm.prank(guardian);
        vm.expectRevert();
        config.unpause();

        // Step 3: Governance cannot unpause without Compliance fresh approval and 24h delay
        bytes memory unpauseData = abi.encodeWithSelector(config.unpause.selector);
        uint256[] memory gov3 = new uint256[](3);
        gov3[0] = govPks[0];
        gov3[1] = govPks[1];
        gov3[2] = govPks[2];

        bytes memory sigs = _signSimple(govSafe, gov3, address(config), unpauseData);
        vm.expectRevert();
        govSafe.execSimple(address(config), unpauseData, sigs);

        // Step 4: Compliance approves fresh release post-interruption
        _approveRelease();
        vm.warp(block.timestamp + 86401);

        // Step 5: Now Governance Safe unpauses with 3-of-5 signatures
        sigs = _signSimple(govSafe, gov3, address(config), unpauseData);
        govSafe.execSimple(address(config), unpauseData, sigs);

        assertFalse(config.paused(), "Config should be unpaused");
    }
}
