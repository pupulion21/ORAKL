#!/usr/bin/env node
/** Offline artifact/settings/size checks only. No deployment, signing, RPC or ABI overwrite. */
import {readFileSync,writeFileSync} from 'node:fs';
import {keccak256} from 'viem';
const get = name => JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`,'utf8'));
const assert = (condition,message) => {if(!condition)throw new Error(message);};
function staticWords(input) {
  if(input.type==='tuple')return input.components.reduce((n,x)=>n+staticWords(x),0);
  assert(!input.type.includes('[')&&!['bytes','string'].includes(input.type),'Unexpected dynamic constructor; review initcode budget');
  return 1;
}
const results=[];
for(const name of ['SelectedMarketFactory','MarketFactory','ProtocolConfig','QiePredictionMarket']) {
  const j=get(name),s=j.metadata.settings,legacy=name==='QiePredictionMarket';
  assert(j.metadata.compiler.version==='0.8.37+commit.f401782d',`${name}: compiler mismatch`);
  assert(s.evmVersion==='paris'&&!s.viaIR&&s.metadata.bytecodeHash==='none',`${name}: EVM/IR/metadata mismatch`);
  assert(s.optimizer.enabled===!legacy&&s.optimizer.runs===(legacy?200:50),`${name}: optimizer profile mismatch`);
  assert(Object.keys(j.bytecode.linkReferences??{}).length===0,`${name}: unexpected external library link`);
  const runtime=j.deployedBytecode.object,creation=j.bytecode.object;
  const runtimeBytes=(runtime.length-2)/2;
  const argsBytes=32*(j.abi.find(x=>x.type==='constructor')?.inputs??[]).reduce((n,x)=>n+staticWords(x),0);
  const initcodeBytes=(creation.length-2)/2+argsBytes;
  assert(runtimeBytes<=24576&&initcodeBytes<=49152,`${name}: standard EVM size exceeded`);
  if(!legacy)assert(runtimeBytes<=19660&&initcodeBytes<=39321,`${name}: less than 20% engineering margin`);
  if(legacy) {
    const m=JSON.parse(readFileSync('frontend/public/deployments/qie-testnet.json','utf8'));
    assert(keccak256(runtime)===m.artifact.runtimeBytecodeKeccak256,'Legacy runtime identity changed');
  }
  results.push({name,compiler:j.metadata.compiler.version,settings:s,runtimeBytes,constructorArgsBytes:argsBytes,initcodeWithArgsBytes:initcodeBytes,runtimeMarginBytes:24576-runtimeBytes,runtimeTemplateKeccak256:keccak256(runtime),hasImmutablePatches:Object.keys(j.deployedBytecode.immutableReferences??{}).length>0});
}
const report={status:'PASS',scope:'offline artifact templates; standard EVM limits, not live QIE compatibility or deployed immutable-patched runtime verification',contracts:results};
const text=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],text);else process.stdout.write(text);
console.log('Artifact profiles, standard EVM engineering margins and legacy runtime identity: PASS');
