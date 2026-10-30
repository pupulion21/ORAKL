#!/usr/bin/env python3
"""Local-only solc benchmark. No RPC, signing, broadcast or artifact mutation."""
import argparse,hashlib,json,pathlib,shutil,subprocess,time
root=pathlib.Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser();a.add_argument('--output',required=True);a.add_argument('--label',required=True);args=a.parse_args()
solc=shutil.which('solc')
sources={str(p.relative_to(root/'contracts')):{'content':p.read_text()} for p in sorted((root/'contracts/src').rglob('*.sol'))}
for p in sorted((root/'contracts/lib/openzeppelin-contracts/contracts').rglob('*.sol')):sources[str(p.relative_to(root/'contracts'))]={'content':p.read_text()}
rows=[]
for name,opt,runs,ir in [('off',False,200,False),('runs-1',True,1,False),('runs-50',True,50,False),('runs-200',True,200,False),('runs-1000',True,1000,False),('ir-200',True,200,True)]:
 settings={'optimizer':{'enabled':opt,'runs':runs},'viaIR':ir,'evmVersion':'paris','metadata':{'bytecodeHash':'none'},'remappings':['@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/'],'outputSelection':{'*':{'*':['evm.bytecode.object','evm.deployedBytecode.object']}}}
 inp={'language':'Solidity','sources':sources,'settings':settings};start=time.monotonic()
 r=subprocess.run([solc,'--standard-json'],input=json.dumps(inp),text=True,capture_output=True)
 result=json.loads(r.stdout);errors=[x for x in result.get('errors',[]) if x['severity']=='error'];sizes={}
 for path,name_ in [('src/MarketFactory.sol','MarketFactory'),('src/ProtocolConfig.sol','ProtocolConfig'),('src/QiePredictionMarket.sol','QiePredictionMarket')]:
  c=result.get('contracts',{}).get(path,{}).get(name_)
  if c:sizes[name_]={'runtimeBytes':len(c['evm']['deployedBytecode']['object'])//2,'initcodeBytes':len(c['evm']['bytecode']['object'])//2}
 rows.append({'name':name,'optimizer':opt,'runs':runs,'viaIR':ir,'evmVersion':'paris','durationSeconds':round(time.monotonic()-start,3),'errors':errors,'sizes':sizes})
 print(args.label,name,sizes,'errors',len(errors),flush=True)
# In-memory modularization candidate only. No project source/artifact is changed.
variant=json.loads(json.dumps(sources))
pred=variant['src/PredictionPool.sol']['content']
pred=pred.replace('import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";', 'import {ExternalPoolMath} from "./libraries/ExternalPoolMath.sol";')
pred=pred.replace('Math.mulDiv','ExternalPoolMath.mulDiv')
variant['src/PredictionPool.sol']['content']=pred
variant['src/libraries/ExternalPoolMath.sol']={'content': '// SPDX-License-Identifier: MIT\npragma solidity 0.8.37;\nimport {Math} from "@openzeppelin/contracts/utils/math/Math.sol";\nlibrary ExternalPoolMath { function mulDiv(uint256 x,uint256 y,uint256 d) external pure returns(uint256) {return Math.mulDiv(x,y,d);} }'}
settings={'optimizer':{'enabled':True,'runs':50},'viaIR':False,'evmVersion':'paris','metadata':{'bytecodeHash':'none'},'remappings':['@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/'],'outputSelection':{'*':{'*':['evm.bytecode.object','evm.deployedBytecode.object','evm.bytecode.linkReferences']}}}
r=subprocess.run([solc,'--standard-json'],input=json.dumps({'language':'Solidity','sources':variant,'settings':settings}),text=True,capture_output=True)
v=json.loads(r.stdout);modular={'name':'external-pure-math-library','optimizerRuns':50,'viaIR':False,'evmVersion':'paris','errors':[e for e in v.get('errors',[]) if e['severity']=='error'],'sizes':{}}
for path,name in [('src/MarketFactory.sol','MarketFactory'),('src/libraries/ExternalPoolMath.sol','ExternalPoolMath')]:
 c=v.get('contracts',{}).get(path,{}).get(name)
 if c: modular['sizes'][name]={'runtimeBytes':len(c['evm']['deployedBytecode']['object'])//2,'initcodeBytes':len(c['evm']['bytecode']['object'])//2,'linkReferences':c['evm']['bytecode'].get('linkReferences',{})}
print(args.label,'modularization candidate',modular['sizes'],flush=True)
modular['status']='COMPILATION-ONLY CANDIDATE; unlinked delegatecall library; not production source, not tested semantically, not deployed'
out={'label':args.label,'solc':subprocess.check_output([solc,'--version'],text=True).strip(),'sourceSha256':{p:hashlib.sha256(s['content'].encode()).hexdigest() for p,s in sources.items()},'results':rows,'modularizationCandidate':modular}
pathlib.Path(args.output).write_text(json.dumps(out,indent=2)+'\n')
