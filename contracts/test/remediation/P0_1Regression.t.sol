// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase, T} from "../helpers/OraklTestBase.sol";
import {AdditionalVm} from "../unit/ConfigurationBoundaries.t.sol";

/// @dev These regressions were executed against unmodified P0 before remediation.
contract P0_1RegressionTest is OraklTestBase {
    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(true);
    }

    function testGuardianPauseNeedsFreshIndependentApproval() public {
        vm.prank(guardian);
        config.pause();
        vm.prank(governance);
        (bool ok,) = address(config).call(abi.encodeCall(config.unpause, ()));
        assertFalse(ok, "governance must not override independent emergency alone");
    }

    function testInterruptedProposalHasBoundedRefundBeforeDistantMax() public {
        expiry = close + 300 days;
        uint256 id = _create();
        _predict(id, bob, T.Side.YES, 1 ether);
        _propose(id, T.Outcome.YES);
        vm.prank(guardian);
        config.pause();
        vm.warp(block.timestamp + 1 hours);
        (bool ok,) = address(factory).call(abi.encodeWithSignature("cancelInterruptedMarket(uint256)", id));
        assertTrue(ok, "early emergency refund must be permissionless after full grace");
        vm.prank(bob);
        factory.claimRefund(id);
        _assertConservation();
    }

    function testMutatedGovernanceCodeBlocksNewDeposits() public {
        uint256 id = _create();
        AdditionalVm(address(vm)).etch(governance, hex"00");
        vm.prank(bob);
        (bool ok,) = address(factory).call{value: 1 ether}(abi.encodeCall(factory.predict, (id, T.Side.YES)));
        assertFalse(ok, "role mutation must fail closed");
    }

    function testMutatedArbitratorCodeCannotSettleExistingDispute() public {
        uint256 id = _create();
        _propose(id, T.Outcome.YES);
        _challenge(id);
        _waitForArbitration(id);
        AdditionalVm(address(vm)).etch(arbitrator, hex"00");
        vm.prank(arbitrator);
        (bool ok,) = address(factory).call(abi.encodeCall(factory.settleDispute, (id, T.Outcome.YES, HASH)));
        assertFalse(ok, "changed arbitration control requires rejection and timeout fallback");
    }
}
