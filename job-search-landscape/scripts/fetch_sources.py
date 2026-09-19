import json, subprocess, pathlib, concurrent.futures, datetime, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'2026-09-17'
REPOS='''speedyapply/JobSpy
eatmoreduck/boss-zhipin-scraper
jackwener/boss-cli
spinlud/py-linkedin-jobs-scraper
simonlin1212/Hiring-Radar
tomxin7/jiandan_job
Frank-qlu/recruit
srbhr/Resume-Matcher
deepakpadhi986/AI-Resume-Analyzer
adrianhajdin/ai-resume-analyzer
seehiong/ats-buddy
tonykipkemboi/resume-optimization-crew
rebecha1227-a11y/CareerForge
reactive-resume/reactive-resume
xitanggg/open-resume
rendercv/rendercv
Magic-Resume/Magic-Resume
Paramchoudhary/ResumeSkills
Hisn00w/ASu-skills
wyh0626/resume-optimizer
GresonKwan/JobOK
andrew-shwetzer/career-ops-plugin-do-not-fork-currently-updating-v2-
sameergdogg/job-search-skills
YIKUAIBANZI/job-hunter
jwine1/boss-geek-agent-toolkit
mubix/cyber-resume-reviewer-skill
Joshua-Guo/resume-plantation
yicLionel/Easy-Job-Tutor
Viy1204/recruiting-copilot
Gsync/jobsync
he-yufeng/FindJobs-Agent
TadMSTR/jobsearch-mcp
anatolykoptev/go-job
Servation/job-search-mcp
HireBridge/jobops
NewWorkFoundation/jobclaw
mshen1019/Argus
Ocyss/boss-helper
zoepan0109-coder/job-application-tracker-extension
workopia/workopia-mcp
fourleafai/clover-public
jlifeng/JobPilot
aarangop/resume-mcp'''.splitlines()
def call(args,cwd=None,timeout=180):
    return subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
def fetch(repo):
    dest=ROOT/'sources'/repo.replace('/','__')
    row={'repo':repo,'requested_url':'https://github.com/'+repo,'local_path':str(dest),'fetched_at':datetime.datetime.now().astimezone().isoformat()}
    try:
        m=call(['gh','api','repos/'+repo],timeout=45)
        if m.returncode==0:
            data=json.loads(m.stdout)
            row.update({k:data.get(k) for k in ['full_name','html_url','description','stargazers_count','fork','archived','default_branch','pushed_at','license','size','language']})
        if not (dest/'.git').exists():
            r=call(['git','-c','core.longpaths=true','clone','--depth','1','https://github.com/'+repo+'.git',str(dest)],timeout=240)
            row['clone_exit']=r.returncode
            row['clone_log']=r.stderr[-2500:]
        else: row['clone_exit']=0
        if row['clone_exit']==0:
            row['sha']=call(['git','rev-parse','HEAD'],dest).stdout.strip()
            row['commit_date']=call(['git','show','-s','--format=%cI','HEAD'],dest).stdout.strip()
            paths=call(['git','ls-files'],dest).stdout.splitlines()
            row['file_count']=len(paths)
            row['files']=paths
    except Exception as e: row['error']=str(e)
    return row
existing=json.loads((OUT/'source_manifest.json').read_text('utf-8')) if (OUT/'source_manifest.json').exists() else []
by_repo={r['repo']:r for r in existing}
targets=sys.argv[1:] or REPOS
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for row in pool.map(fetch,targets):
        by_repo[row['repo']]=row
        (OUT/'source_manifest.json').write_text(json.dumps(list(by_repo.values()),ensure_ascii=False,indent=2),encoding='utf-8')
        print(row['repo'],row.get('clone_exit'),row.get('sha','')[:10],row.get('file_count'),row.get('error',''),flush=True)
