import json, subprocess, time, concurrent.futures, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / '2026-09-17'
QUERIES = [
 'job scraper', '招聘 爬虫', 'boss 直聘', 'resume matcher', 'resume analyzer',
 'resume review', 'ATS resume', 'job application automation', 'job application tracker',
 'job search agent', 'career coach agent', 'interview AI',
 'job search skill', 'resume skill', 'career SKILL.md', '求职 skill', '简历 skill',
 'job hunting claude', 'job search mcp', 'resume mcp', 'hiring radar',
 '校招 爬虫', '简历 评估', '简历 优化', 'job seeker', 'resume builder'
]
def run(q):
    cmd=['gh','search','repos',q,'--sort','stars','--limit','20','--json','fullName,description,stargazersCount,url,updatedAt,language']
    r=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8',errors='replace')
    result={'query':q,'time':datetime.datetime.now().astimezone().isoformat(),'command':cmd,'exit_code':r.returncode}
    if r.returncode==0: result['items']=json.loads(r.stdout)
    else: result['error']=r.stderr
    return result
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for result in pool.map(run,QUERIES):
        results.append(result)
        print(result['query'],len(result.get('items',[])),result.get('error','')[:120],flush=True)
        (OUT/'searches.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
repos={}
for result in results:
    for row in result.get('items',[]):
        name=row['fullName']
        if name not in repos: repos[name]={**row,'queries':[]}
        repos[name]['queries'].append(result['query'])
rows=sorted(repos.values(),key=lambda x:-x['stargazersCount'])
(OUT/'candidates.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
print('UNIQUE',len(rows))
