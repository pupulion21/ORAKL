// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase} from "../helpers/OraklTestBase.sol";
import {ProtocolTypes as T} from "../../src/libraries/ProtocolTypes.sol";
contract SelectedBeforeTest is OraklTestBase {
 function setUp() public {_deploy(true);}
 function testSecondChallengerMustBeAccepted() public {
  uint256 id=_create(); _propose(id,T.Outcome.YES); _challenge(id);
  vm.prank(carol);
  (bool ok,)=address(factory).call{value:3 ether}(abi.encodeCall(factory.challengeResult,(id,HASH)));
  assertTrue(ok,"independent second tranche must enter");
 }
 function testReversalMustTransferProposalBondToChallenger() public {
  uint256 id=_create(); _predict(id,bob,T.Side.NO,1 ether); _propose(id,T.Outcome.YES); _challenge(id);
  _waitForArbitration(id); vm.prank(arbitrator);factory.settleDispute(id,T.Outcome.NO,HASH);
  uint256 before_=carol.balance;vm.prank(bob);factory.claimBond(id,T.BondType.CHALLENGE,carol);
  assertEq(carol.balance-before_,5 ether,"P+C on reversal");
 }
 function testExposureBudgetMustExist() public view {
  (bool ok,bytes memory data)=address(factory).staticcall(abi.encodeWithSignature("globalUnresolvedCap()"));
  assertTrue(ok && data.length==32,"hard exposure budget absent");
 }
}
