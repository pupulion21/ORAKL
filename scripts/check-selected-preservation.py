#!/usr/bin/env python3
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
base='f3b35a1fb25bc08f2e5cd6c31addb6396c238181'
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
refs={'main':'b555a87e82d40560e50c8ce102239b10eb3bd365','refactor/orakl-protocol-v1':'7b8ac4e3f009c46631d88f5094e632972885aaaa','remediation/orakl-p0-1':'d46452479b9ce08dea77dd45730276c26fa50894','feature/orakl-p0-2':'8d850ae42ebc77acaf2323cd50f63f08e57f1b66','security/orakl-p0-3':'9e256c1451d666889f9f248edee3e2e2d61f6d48','release/orakl-v1-freeze-candidate':base}
for ref,sha in refs.items():assert git('rev-parse',ref).decode().strip()==sha,ref
paths=git('ls-tree','-r','--name-only',base,'--','frontend','contracts/abi','contracts/src/QiePredictionMarket.sol','contracts/src/ProtocolConfig.sol','contracts/src/interfaces','contracts/src/libraries','package.json','package-lock.json','contracts/lib','contracts/test','docs/testing','docs/archive').decode().splitlines()
records=[]
for path in paths:
 before=git('show',f'{base}:{path}');after=(root/path).read_bytes();assert before==after,path
 records.append({'path':path,'sha256':hashlib.sha256(after).hexdigest()})
old=git('show',f'{base}:contracts/foundry.toml').decode();new=(root/'contracts/foundry.toml').read_text();assert new.replace('    { paths = "src/SelectedMarketFactory.sol", optimizer_runs = 50 },\n','')==old
old_manifest=json.loads(git('show',f'{base}:contracts/abi/orakl-v1-candidate/interface-manifest.json'))
for path,sha in old_manifest['sourceSha256'].items():
 if path.startswith('contracts/lib/'):
  assert hashlib.sha256((root/path).read_bytes()).hexdigest()==sha,path
out={'baseline':base,'refs':refs,'protectedCount':len(records),'files':records,'foundryChange':'only additional selected-root restriction using existing optimizer50 profile'}
(root/'docs/testing/selected-economics/preservation.json').write_text(json.dumps(out,indent=2)+'\n')
print(f'PASS: {len(records)} legacy/historical/test files and six refs unchanged; original A-P retained; compiler/dependencies preserved')
