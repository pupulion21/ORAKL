// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {
    OraklTestBase,
    MultisigViewMock,
    T,
    ProtocolStorage,
    ProtocolConfig,
    MarketFactory,
    IProtocolConfig
} from "../helpers/OraklTestBase.sol";
import {DeployInactive} from "../../script/DeployInactive.s.sol";

interface AdditionalVm {
    function chainId(uint256 id) external;
    function etch(address target, bytes calldata code) external;
}

contract OwnersMock {
    address[] private owners;
    uint256 private threshold;

    constructor(address[] memory o, uint256 t) {
        owners = o;
        threshold = t;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}

contract ConfigurationBoundariesTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testInvalidInitialRolesAndConfigurationContract() public {
        T.Parameters memory p = config.parameters();
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        new ProtocolConfig(address(0), compliance, guardian, p);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        new ProtocolConfig(governance, address(0), guardian, p);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        new ProtocolConfig(governance, compliance, address(0), p);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        new ProtocolConfig(governance, compliance, governance, p);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        new ProtocolConfig(governance, compliance, compliance, p);
        p.arbitrator = guardian;
        _invalidParameter(p);
        vm.expectRevert(ProtocolStorage.InvalidMetadata.selector);
        new MarketFactory(IProtocolConfig(address(0)));
    }

    function testRemainingEconomicBounds() public {
        T.Parameters memory p = config.parameters();
        p.proposalBond = uint128(config.MAX_BOND() + 1);
        _invalidParameter(p);
        p = config.parameters();
        p.challengeBond = uint128(config.MAX_BOND() + 1);
        _invalidParameter(p);
        p = config.parameters();
        p.challengePeriod = 8 days;
        _invalidParameter(p);
        p = config.parameters();
        p.arbitrationPeriod = 1;
        _invalidParameter(p);
        p = config.parameters();
        p.minContribution = 2;
        p.poolCap = 1;
        _invalidParameter(p);
        p = config.parameters();
        p.challengePeriod = 7 days;
        p.arbitrationPeriod = 30 days;
        vm.prank(governance);
        config.setParameters(p);
        assertEq(config.parameters().challengePeriod, 7 days, "upper challenge accepted");
    }

    function testRejectMalformedMultisigOwnerSets() public {
        T.Parameters memory p = config.parameters();
        address[] memory owners = new address[](1);
        owners[0] = address(400);
        p.arbitrator = address(new OwnersMock(owners, 2));
        _invalidMultisig(p);
        owners = new address[](33);
        for (uint256 i; i < 33; ++i) {
            owners[i] = address(uint160(400 + i));
        }
        p.arbitrator = address(new OwnersMock(owners, 2));
        _invalidMultisig(p);
        owners = new address[](2);
        owners[0] = address(400);
        owners[1] = address(0);
        p.arbitrator = address(new OwnersMock(owners, 2));
        _invalidMultisig(p);
        owners[1] = address(400);
        p.arbitrator = address(new OwnersMock(owners, 2));
        _invalidMultisig(p);
        owners[1] = address(401);
        p.arbitrator = address(new OwnersMock(owners, 3));
        _invalidMultisig(p);
        owners[0] = address(200);
        p.arbitrator = address(new OwnersMock(owners, 2));
        _invalidMultisig(p);
    }

    function testUnboundFactoryAndBindingVerification() public {
        T.Parameters memory p = config.parameters();
        ProtocolConfig fresh = new ProtocolConfig(governance, compliance, guardian, p);
        vm.prank(compliance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        fresh.approveRelease(RELEASE);
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        fresh.bindFactory(address(factory));
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        fresh.bindFactory(bob);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        fresh.bindFactory(arbitrator);
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        fresh.bindFactory(address(factory));
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        fresh.requireFinancialActivity(address(factory));
    }

    function testUnauthorizedEmergencyControlsAndRepeatedPauseEpoch() public {
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.pause();
        vm.prank(alice);
        vm.expectRevert(ProtocolConfig.Unauthorized.selector);
        config.deactivateFinance();
        vm.prank(governance);
        config.pause();
        uint256 epoch = config.activityEpoch();
        vm.prank(governance);
        config.pause();
        assertEq(config.activityEpoch(), epoch + 1, "new intervention invalidates pending approvals");
        vm.prank(compliance);
        config.deactivateFinance();
        assertFalse(config.financialActive(), "compliance can revoke");
        vm.prank(governance);
        config.deactivateFinance();
        assertFalse(config.financialActive(), "governance can revoke");
    }

    function testReleaseBoundToRuntimeAndChainIdentity() public {
        vm.prank(guardian);
        config.deactivateFinance();
        vm.prank(compliance);
        config.approveRelease(RELEASE);
        AdditionalVm(address(vm)).etch(address(factory), hex"00");
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.activateFinance(RELEASE);
        AdditionalVm(address(vm)).chainId(block.chainid + 1);
        vm.prank(compliance);
        vm.expectRevert(ProtocolConfig.NotApproved.selector);
        config.approveRelease(RELEASE);
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        config.requireFinancialActivity(address(factory));
    }

    function testFutureArbitratorDoesNotReplaceExistingMarketAuthority() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        T.Parameters memory p = config.parameters();
        address next = address(new MultisigViewMock(400, 2));
        p.arbitrator = next;
        vm.prank(governance);
        config.setParameters(p);
        vm.prank(next);
        vm.expectRevert(ProtocolStorage.Unauthorized.selector);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        vm.prank(arbitrator);
        factory.settleDispute(id, T.Outcome.YES, HASH);
        _activate();
        uint256 other = _create();
        assertEq(factory.getMarket(id).terms.arbitrator, arbitrator, "old authority fixed");
        assertEq(factory.getMarket(other).terms.arbitrator, next, "new authority");
    }

    function testLocalDeploymentRehearsalLeavesFinanceDisabledAndUnbound() public {
        DeployInactive helper = new DeployInactive();
        T.Parameters memory p = config.parameters();
        (ProtocolConfig c, MarketFactory f) = helper.run(governance, compliance, guardian, p);
        assertFalse(c.financialActive(), "no activation");
        assertEq(c.factory(), address(0), "no binding");
        vm.expectRevert(ProtocolConfig.FinancialActivityDisabled.selector);
        f.createMarket(HASH, "ipfs://test", close, resolution, expiry);
        // Change only the local test VM identity; this makes no network request.
        AdditionalVm(address(vm)).chainId(1990);
        vm.expectRevert(DeployInactive.LiveDeploymentBlocked.selector);
        helper.run(governance, compliance, guardian, p);
    }

    function _invalidParameter(T.Parameters memory p) private {
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidConfiguration.selector);
        config.setParameters(p);
    }

    function _invalidMultisig(T.Parameters memory p) private {
        vm.prank(governance);
        vm.expectRevert(ProtocolConfig.InvalidMultisig.selector);
        config.setParameters(p);
    }
}
