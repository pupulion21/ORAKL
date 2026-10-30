import importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
root=Path('/home/pupulion/prediction-market-mvp')
spec=importlib.util.spec_from_file_location('p03',root/'scripts/verify-orakl-p0-3.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
r=p.recorder;r.EVIDENCE=root/'docs/testing/orakl-v1-candidate'
r.STEPS['evidence-vectors']=('.', ['python3','scripts/check-orakl-evidence-v1-vectors.py'],{})
r.STEPS['economic-model-v1']=('.', ['python3','scripts/model-orakl-v1-economics.py'],{})
for step in ['evidence-vectors','economic-model-v1']:
 sys.argv=['verify',step,'--record-file','extra-commands.json']
 try:r.main()
 except SystemExit as exc:print('Completed',step,'exit',exc.code,flush=True)
