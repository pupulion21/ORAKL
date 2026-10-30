#!/usr/bin/env python3
import importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
p=Path(__file__).with_name('verify-orakl-p0-3.py')
s=importlib.util.spec_from_file_location('p03',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=m.recorder
r.EVIDENCE=r.ROOT/'docs/testing/selected-economics'
r.STEPS={n:(cwd,[a.replace('p0-3/','selected-economics/') for a in argv],env) for n,(cwd,argv,env) in r.STEPS.items()}
r.STEPS['selected']=('contracts',['forge','test','--match-path','test/selected/*','-vvv'],{})
r.STEPS['before']=('contracts',['forge','test','--match-path','test/selected/Before.t.sol','-vvv'],{})
r.STEPS['baseline']=('contracts',['forge','test','-vvv'],{})
r.STEPS['artifact-check']=('.', ['node','scripts/check-orakl-selected-artifacts.mjs','docs/testing/selected-economics/artifact-check.json'],{})
r.STEPS['interface-export']=('.', ['node','scripts/export-orakl-selected-interface.mjs','--write'],{})
r.STEPS['interface-check']=('.', ['node','scripts/export-orakl-selected-interface.mjs','--check'],{})
r.STEPS['interface-tests']=('.', ['node','--test','scripts/test/orakl-selected-interface.test.mjs'],{})
r.STEPS['slither-selected']=('contracts',['slither','src/SelectedMarketFactory.sol','--compile-force-framework','solc','--solc-remaps','@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/','--filter-paths','lib/','--solc-args',r.SOLC_ARGS+' --optimize --optimize-runs 50','--json','../docs/testing/selected-economics/slither-selected.json'],{})
r.STEPS['preservation']=('.', ['python3','scripts/check-selected-preservation.py'],{})
r.STEPS['skill-integrity']=('.', ['python3','docs/testing/orakl-v1-candidate/skill-integrity.py'],{})
r.STEPS['exposure-before']=('.', ['python3','scripts/reproduce-selected-exposure-before.py'],{})
r.STEPS['tool-identity']=('.', ['python3','scripts/selected-tool-identity.py'],{})
r.STEPS['interface-tests-v2']=r.STEPS['interface-tests']
r.STEPS['gas-selected']=('contracts',['forge','test','--gas-report','--match-path','test/selected/*'],{})
r.STEPS['rounding-model']=('.', ['python3','scripts/model-selected-rounding.py'],{})
r.STEPS['selected-export-final']=r.STEPS['interface-export']
r.STEPS['selected-interface-final']=r.STEPS['interface-check']
if __name__=='__main__':r.main()
