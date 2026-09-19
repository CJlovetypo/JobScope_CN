import concurrent.futures, datetime, json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'2026-09-19-domestic'
OUT.mkdir(parents=True,exist_ok=True)
def run(args,cwd=None,timeout=120):
    return subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
def search(q):
    r=run(['gh','search','repos',q,'--sort','stars','--limit','15','--json','fullName,description,stargazersCount,url,updatedAt'])
    return {'query':q,'time':datetime.datetime.now().astimezone().isoformat(),'items':json.loads(r.stdout) if r.returncode==0 else [],'error':r.stderr if r.returncode else ''}
def fetch(repo):
    dest=ROOT/'sources'/repo.replace('/','__')
    r=run(['gh','api','repos/'+repo]);m=json.loads(r.stdout) if r.returncode==0 else {}
    row={k:m.get(k) for k in ['full_name','stargazers_count','pushed_at','archived','license','size','default_branch']}
    row.update(repo=repo,queried_at=datetime.datetime.now().astimezone().isoformat(),local_path=str(dest))
    if not (dest/'.git').exists():
        c=run(['git','-c','core.longpaths=true','clone','--depth','1','https://github.com/'+repo+'.git',str(dest)],timeout=240)
        row['clone_exit']=c.returncode;row['error']=c.stderr[-1000:] if c.returncode else ''
    if (dest/'.git').exists():
        row['sha']=run(['git','rev-parse','HEAD'],dest).stdout.strip()
        row['commit_date']=run(['git','show','-s','--format=%cI','HEAD'],dest).stdout.strip()
        row['files']=run(['git','-c','core.quotepath=false','ls-files'],dest).stdout.splitlines()
    return row
if sys.argv[1]=='search':
    queries=['猎聘 爬虫','智联 爬虫','51job spider','实习僧 爬虫','牛客 招聘 爬虫','招聘 数据集','招聘 数据 开源','mokahr crawler','北森 爬虫','校招 爬虫','国聘 爬虫','国家大学生就业 爬虫','应届生 爬虫','拉勾 爬虫','招聘 公告 爬虫','job dataset chinese']
    data=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as p:
        for x in p.map(search,queries):
            data.append(x);print(x['query'],len(x['items']),x['error'][:100],flush=True)
    (OUT/'searches.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    merged={x['fullName']:x for q in data for x in q['items']}
    (OUT/'candidates.json').write_text(json.dumps(list(merged.values()),ensure_ascii=False,indent=2),encoding='utf-8')
else:
    target=OUT/'source_manifest.json'
    data=json.loads(target.read_text(encoding='utf-8')) if target.exists() else []
    merged={x['repo']:x for x in data}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:
        for x in p.map(fetch,sys.argv[2:]):
            merged[x['repo']]=x
            target.write_text(json.dumps(list(merged.values()),ensure_ascii=False,indent=2),encoding='utf-8')
            print(x['repo'],x['stargazers_count'],x.get('sha','')[:10],len(x.get('files',[])),x.get('error',''),flush=True)
