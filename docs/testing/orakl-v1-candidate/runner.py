import importlib.util, sys
from pathlib import Path
root=Path('/home/pupulion/prediction-market-mvp')
spec=importlib.util.spec_from_file_location('p03',root/'scripts/verify-orakl-p0-3.py')
p03=importlib.util.module_from_spec(spec); spec.loader.exec_module(p03)
r=p03.recorder
r.EVIDENCE=root/'docs/testing/orakl-v1-candidate'
r.STEPS={n:(cwd,[a.replace('p0-3/','orakl-v1-candidate/') for a in argv],env) for n,(cwd,argv,env) in r.STEPS.items()}
r.STEPS['network-offline']=('.', ['node','/home/pupulion/.agents/skills/qie-networks/scripts/inspect-network.mjs','qie-mainnet'],{})
steps=['network-offline','build','forge-test','security','economics','remediation','invariant','coverage','fmt','sizes','slither','slither-factory','slither-config','slither-legacy','build-final','artifact-check','interface-check','interface-tests','frontend-test','frontend-typecheck','frontend-build','invariant-intensive']
for step in steps:
 sys.argv=['verify',step]
 try: r.main()
 except SystemExit as exc: print('Completed',step,'exit',exc.code,flush=True)
