import json,pathlib,sys,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
rows=json.loads((ROOT/'artifacts/2026-09-17/source_manifest.json').read_text('utf-8'))
key=sys.argv[1]
repo=next(r for r in rows if key.lower()==r['repo'].lower() or key.lower()==r['repo'].split('/')[-1].lower())
base=pathlib.Path(repo['local_path'])
if len(sys.argv)==2:
    print(repo['repo'],repo.get('sha'))
    print('\n'.join(repo.get('files',[])))
else:
    for spec in sys.argv[2:]:
        parts=spec.rsplit(':',2)
        path=parts[0]
        if len(parts)==3:
            start,end=int(parts[1]),int(parts[2])
        else: start,end=1,500
        lines=(base/path).read_text('utf-8',errors='replace').splitlines()
        print('\nFILE',repo['repo'],path,'TOTAL',len(lines))
        for i in range(start-1,min(end,len(lines))):print(f'{i+1:4}: {lines[i]}')
