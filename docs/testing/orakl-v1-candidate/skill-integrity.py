import hashlib,json,pathlib,sys
root=pathlib.Path('/home/pupulion/.agents/skills')
ids=set();bad=[]
for name in ['qie','qie-smart-contracts','qie-networks','qie-deployment','qie-transactions','qie-debug','qie-wallets']:
 p=root/name;m=json.loads((p/'MANIFEST.json').read_text());ids.add(m['release_id'])
 for f in m['files']:
  target=p/f['path']; digest=hashlib.sha256(target.read_bytes()).hexdigest()
  if digest!=f['sha256']: bad.append(str(target))
 print(name, m['release_version'], m['release_id'], len(m['files']))
print('PASS' if len(ids)==1 and not bad else 'FAIL',bad)
sys.exit(0 if len(ids)==1 and not bad else 1)
