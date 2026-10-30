import importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
root=Path('/home/pupulion/prediction-market-mvp')
spec=importlib.util.spec_from_file_location('p03',root/'scripts/verify-orakl-p0-3.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
r=p.recorder;r.EVIDENCE=root/'docs/testing/orakl-v1-candidate'
r.STEPS['preservation-v1']=('.', ['python3','scripts/check-orakl-v1-preservation.py'],{})
sys.argv=['verify','preservation-v1','--record-file','preservation-command.json'];r.main()
