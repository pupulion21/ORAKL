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
out={'label':args.label,'solc':subprocess.check_output([solc,'--version'],text=True).strip(),'sourceSha256':{p:hashlib.sha256(s['content'].encode()).hexdigest() for p,s in sources.items()},'results':rows}
pathlib.Path(args.output).write_text(json.dumps(out,indent=2)+'\n')
