#!/usr/bin/env python3
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
report={}
for name,argv in {'forge':['forge','--version'],'solc':['solc','--version'],'slither':['slither','--version'],'node':['node','--version'],'npm':['npm','--version']}.items():
 result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=False,text=True);report[name]={'argv':argv,'exit':result.returncode,'output':result.stdout}
for name in ['ORAKL_V1_Codex_Strict_Prompt_All_In_One.md','ORAKL_V1_Economic_Spec_Selected.md','contracts/foundry.toml']:
 report[name]={'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()}
report['baseline']='f3b35a1fb25bc08f2e5cd6c31addb6396c238181'
report['historicalBaselineArtifactReportSha256']=hashlib.sha256((root/'docs/testing/orakl-v1-candidate/artifact-check.json').read_bytes()).hexdigest()
print(json.dumps(report,indent=2))
