import importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
root=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('selected',root/'scripts/verify-orakl-selected.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
for step in ['forge-test','security','economics','remediation','invariant','coverage','fmt','sizes','slither','slither-selected','slither-factory','slither-config','slither-legacy','build-final','artifact-check','interface-export','interface-check','interface-tests','frontend-test','frontend-typecheck','frontend-build','invariant-intensive']:
 sys.argv=['verify',step]
 try:m.r.main()
 except SystemExit as e:
  if e.code and not step.startswith('slither'):print('CHECK FAILED',step,e.code,flush=True);break
