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
if __name__=='__main__':r.main()
