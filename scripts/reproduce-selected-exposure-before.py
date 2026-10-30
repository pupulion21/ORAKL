#!/usr/bin/env python3
"""Deliberately failing, isolated local baseline PoC; no branch/source mutation or chain access."""
import io,subprocess,tarfile,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
BASE='f3b35a1fb25bc08f2e5cd6c31addb6396c238181'
with tempfile.TemporaryDirectory(prefix='orakl-exposure-before-') as tmp:
 p=Path(tmp)
 archive=subprocess.check_output(['git','archive',BASE,'contracts'],cwd=ROOT)
 with tarfile.open(fileobj=io.BytesIO(archive)) as t:t.extractall(p,filter='data')
 lib=p/'contracts/lib'
 if not lib.exists():lib.symlink_to(ROOT/'contracts/lib',target_is_directory=True)
 elif not (lib/'openzeppelin-contracts').exists():(lib/'openzeppelin-contracts').symlink_to(ROOT/'contracts/lib/openzeppelin-contracts',target_is_directory=True)
 (p/'contracts/test/ExposureBefore.t.sol').write_text('''// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {OraklTestBase,T} from "./helpers/OraklTestBase.sol";
contract ExposureBefore is OraklTestBase {
function testActualAggregateAdmissionMustRejectThirdMarket() public {
_deploy(true);T.Parameters memory terms=config.parameters();terms.poolCap=100 ether;
vm.prank(governance);config.setParameters(terms);_activate();
uint256 a=_create();uint256 b=_create();uint256 c=_create();
_predict(a,bob,T.Side.YES,100 ether);_predict(b,bob,T.Side.YES,100 ether);
vm.prank(bob);(bool admitted,)=address(factory).call{value:1 ether}(abi.encodeCall(factory.predict,(c,T.Side.YES)));
assertFalse(admitted,"P0.3 admits third market beyond selected per-arbitrator budget");
}
function testUpholdMustAllocateAllChallengePrincipalToProposer() public {
_deploy(true);uint256 id=_create();_predict(id,bob,T.Side.YES,1 ether);_propose(id,T.Outcome.YES);_challenge(id);_waitForArbitration(id);
vm.prank(arbitrator);factory.settleDispute(id,T.Outcome.YES,HASH);
uint256 before_=carol.balance;vm.prank(alice);factory.claimBond(id,T.BondType.PROPOSAL,carol);
assertEq(carol.balance-before_,5 ether,"P0.3 returns only P on uphold instead of P+C");
}
function testInsufficientProposalOpportunityMustReject() public {
_deploy(true);vm.prank(alice);
(bool admitted,)=address(factory).call{value:5 ether}(abi.encodeCall(factory.createMarket,(HASH,"ipfs://short",close,resolution,expiry)));
assertFalse(admitted,"P0.3 accepts short proposal opportunity forbidden by selected policy");
}
}
''')
 print('Exact baseline',BASE,'isolated source from git archive; expecting test failure',flush=True)
 result=subprocess.run(['forge','test','--root',str(p/'contracts'),'--match-path','test/ExposureBefore.t.sol','-vvvv'],cwd=ROOT)
 raise SystemExit(result.returncode)
