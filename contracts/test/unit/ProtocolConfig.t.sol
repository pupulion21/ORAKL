// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    OraklTestBase,
    MultisigViewMock,
    T,
    ProtocolConfig,
    ProtocolStorage,
    MarketFactory,
    IProtocolConfig
} from "../helpers/OraklTestBase.sol";

contract ProtocolConfigTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(false);
    }

    function testInactiveByDefaultAndAllPayableSelectorsFailClosed() public {
        assertFalse(config.financialActive(), "default disabled");
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(factory.createMarket, (HASH, "ipfs://test", close, resolution, expiry));
        calls[1] = abi.encodeCall(factory.predict, (0, T.Side.YES));
        calls[2] = abi.encodeCall(factory.proposeResult, (0, T.Outcome.YES, HASH));
        calls[3] = abi.encodeCall(factory.challengeResult, (0, HASH));
        for (uint256 i; i < calls.length; ++i) {
            for (uint256 value; value < 2; ++value) {
                vm.prank(alice);
                (bool ok, bytes memory reason) = address(factory).call{value: value}(calls[i]);
                assertFalse(ok, "disabled financial entry");
                assertEq(
                    uint256(uint32(bytes4(reason))),
                    uint256(uint32(ProtocolConfig.FinancialActivityDisabled.selector)),
                    "gate first"
                );
            }
        }
        assertEq(factory.totalAccounted(), 0, "no deposits");
        assertEq(factory.marketCount(), 0, "no creation");
    }

    function testDistinctApprovalsRequiredAndBoundToRelease() public {
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.approveRelease(RELEASE);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(HASH);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.activateFinance(RELEASE);
        vm.warp(config.activationAfter());
        vm.prank(governance);
        config.activateFinance(RELEASE);
        assertTrue(config.financialActive(), "local simulated activation");
    }

    function testZeroReleaseCannotActivate() public {
        vm.prank(compliance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.approveRelease(bytes32(0));
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(bytes32(0));
    }

    function testParametersDeactivateAndRequireFreshApproval() public {
        _activate();
        uint256 id = _create();
        T.Parameters memory p = config.parameters();
        p.feeBps = 300;
        p.creationBond = 6 ether;
        vm.prank(governance);
        config.setParameters(p);
        assertFalse(config.financialActive(), "deactivated");
        assertEq(factory.getMarket(id).terms.feeBps, 200, "snapshot fee");
        assertEq(factory.getMarket(id).terms.creationBond, 5 ether, "snapshot bond");
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
        _activate();
        uint256 next = _create();
        assertEq(factory.getMarket(next).terms.feeBps, 300, "new fee");
    }

    function testGuardianCanPauseCannotUnpauseOrConfigure() public {
        _activate();
        vm.prank(guardian);
        config.pause();
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        factory.predict{value: 1}(0, T.Side.YES);
        vm.prank(guardian);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.unpause();
        T.Parameters memory p = config.parameters();
        vm.prank(guardian);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.setParameters(p);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.unpause();
        _activate();
        vm.prank(guardian);
        config.deactivateFinance();
        assertFalse(config.financialActive(), "deactivated");
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
    }

    function testConfigurationBoundsAndUnauthorizedMutation() public {
        T.Parameters memory p = config.parameters();
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.setParameters(p);
        p.feeBps = 1001;
        _bad(p);
        p = config.parameters();
        p.minContribution = 0;
        _bad(p);
        p = config.parameters();
        p.challengePeriod = 1;
        _bad(p);
        p = config.parameters();
        p.arbitrationPeriod = 31 days;
        _bad(p);
        p = config.parameters();
        p.poolCap = 0;
        _bad(p);
        p = config.parameters();
        p.creationBond = uint128(config.MAX_BOND() + 1);
        _bad(p);
    }

    function testRoleIndependenceAndMultisigThreshold() public {
        T.Parameters memory p = config.parameters();
        p.arbitrator = governance;
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.setParameters(p);
        p.arbitrator = address(new MultisigViewMock(100, 2));
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.setParameters(p);
        p.arbitrator = address(new MultisigViewMock(400, 1));
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.setParameters(p);
        p.arbitrator = bob;
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.setParameters(p);
    }

    function testFactoryBindingCannotChangeOrBypassGate() public {
        MarketFactory second = new MarketFactory(IProtocolConfig(address(config)));
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.AlreadyBound.selector);
        config.bindFactory(address(second));
        _activate();
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        second.createMarket(HASH, "ipfs://test", close, resolution, expiry);
    }

    function testDirectAndUnknownTransfersRejectedOnFacadeAndConfig() public {
        vm.deal(address(this), 4);
        (bool a,) = address(factory).call{value: 1}("");
        (bool b,) = address(factory).call{value: 1}(hex"deadbeef");
        (bool c,) = address(config).call{value: 1}("");
        (bool d,) = address(config).call{value: 1}(hex"deadbeef");
        assertFalse(a || b || c || d, "all direct paths rejected");
    }

    function testRuntimeWithinEIP170() public view {
        assertLe(address(factory).code.length, 19660, "facade >=20 percent runtime headroom");
        assertLe(address(config).code.length, 19660, "config >=20 percent runtime headroom");
        assertLe(type(MarketFactory).creationCode.length + 32, 39321, "facade initcode headroom");
        assertLe(
            type(ProtocolConfig).creationCode.length
                + abi.encode(governance, compliance, guardian, config.parameters()).length,
            39321,
            "config initcode headroom"
        );
    }

    function _bad(T.Parameters memory p) private {
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        config.setParameters(p);
    }
}
