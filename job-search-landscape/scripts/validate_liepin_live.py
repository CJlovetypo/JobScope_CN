"""Read-only, bounded Liepin search/detail acceptance test. No apply tools."""
import argparse,datetime,json,pathlib,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
CLI=ROOT/'sources/rockbenben__ai-job-search-cn/.agents/skills/liepin-search/cli/src/cli.ts'
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--query',default='产品经理');ap.add_argument('--city',default='上海');ap.add_argument('--out',default=str(ROOT/'artifacts/liepin-runs'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')));a=ap.parse_args()
    out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):raise SystemExit('Refusing to overwrite existing evidence')
    runs=[];pages=[];details=[]
    def invoke(name,args):
        cmd=['node',str(CLI),*args];start=datetime.datetime.now().astimezone().isoformat()
        try:r=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)
        except (OSError,subprocess.TimeoutExpired) as e:
            runs.append({'name':name,'at':start,'args':args,'exit_code':1,'error':str(e)});return {'error':str(e)}
        (out/(name+'.json')).write_text(r.stdout,encoding='utf-8');(out/(name+'.stderr.txt')).write_text(r.stderr,encoding='utf-8')
        runs.append({'name':name,'at':start,'args':args,'exit_code':r.returncode})
        try:return json.loads(r.stdout) if r.returncode==0 else {'error':r.stderr}
        except ValueError:return {'error':'invalid JSON','exit_code':r.returncode}
    for page in [1,2]:
        d=invoke(f'list-page{page}',['search','-q',a.query,'-l',a.city,'--page',str(page),'--limit','5']);pages.append(d);time.sleep(1.6)
    jobs=[]
    for card in pages[0].get('results',[])[:2]:
        d=invoke('detail-'+card['id'],['detail',card['url'],'--format','json']);details.append(d)
        jobs.append({'source':'liepin','source_job_id':card['id'],'source_url':card['url'],'title':card['title'],'company':card['company'],'location':card['location'],'salary':card['salary'],'published_at':card['date'],'full_jd':d.get('description',''),'detail_title':d.get('title'),'detail_company':d.get('company'),'record_kind':'job','fetched_at':runs[-1]['at'],'detail_status':'ok' if d.get('description') else 'failed'})
        time.sleep(1.6)
    ids=[{j['url'] for j in p.get('results',[])} for p in pages]
    checks={'page_counts':[len(x) for x in ids],'new_on_page2':len(ids[1]-ids[0]),'detail_lengths':[len(d.get('description','')) for d in details],'identity_matches':[d.get('title')==c.get('title') for c,d in zip(pages[0].get('results',[]),details)]}
    passed=all(checks['page_counts']) and checks['new_on_page2']>0 and len(details)==2 and all(n>=100 for n in checks['detail_lengths']) and all(checks['identity_matches'])
    report={'source':'liepin','status':'passed' if passed else 'partial_or_blocked','query':a.query,'city':a.city,'checks':checks,'runs':runs,'limits':['仅两页各5条与两条详情验收，非全量或长期稳定性证明','列表内部id与详情URL数字并非相同，详情必须使用原始URL','MCP授权路线另行核验；本脚本不调用投递/消息工具']}
    (out/'jobs.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf-8');(out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if passed else 2
if __name__=='__main__':raise SystemExit(main())
