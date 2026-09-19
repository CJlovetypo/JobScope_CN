import csv, json, subprocess
from pathlib import Path
from datetime import datetime
from urllib.parse import quote
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'2026-09-17'
manifest=json.loads((OUT/'source_manifest.json').read_text(encoding='utf-8'))
meta={x['repo']:x for x in manifest}
analyses=[json.loads(l) for p in sorted(OUT.glob('analysis*.jsonl')) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]
assert len(analyses)==len(meta)==len({x['repo'] for x in analyses})
fix_categories={'岗位抓取':'岗位采集','自动投递':'投递自动化','简历制作/优化':'简历制作与编辑'}
priority=set('speedyapply/JobSpy eatmoreduck/boss-zhipin-scraper srbhr/Resume-Matcher reactive-resume/reactive-resume xitanggg/open-resume Hisn00w/ASu-skills GresonKwan/JobOK Gsync/jobsync HireBridge/jobops yanliudesign/offer-toolkit-skill shangsitongshizaitiantang/industry-resume-toolkit strelov1/freehire jennifer88huang/interview-skills'.split())
caution=set('jlifeng/JobPilot Joshua-Guo/resume-plantation NathanDuma/LinkedIn-Easy-Apply-Bot slothsheepking/jobclaw'.split())
partial={'Magic-Resume/Magic-Resume':'公开部分源码；外部后端未核验','fourleafai/clover-public':'Skill/安装器源码；托管后端未核验','workopia/workopia-mcp':'仅连接器源码；远端业务未知'}
for x in analyses:
    m=meta[x['repo']]
    x['id']=f'P{list(meta).index(x["repo"])+1:03d}'
    x['project']=x['id']+' · '+x['repo']
    x['category']=fix_categories.get(x['category'],x['category'])
    x['verification']=partial.get(x['repo'],'静态源码核验；未运行外部流程')
    x['priority']='优先研究' if x['repo'] in priority else ('谨慎参考' if x['repo'] in caution else ('边界对照' if x['repo'] in partial or x['category']=='历史相关/现已转向' else '按需参考'))
    assert isinstance(m.get('stargazers_count'),int),x['repo']
    for e in x['evidence']:
        # Correct an off-by-one citation: this complete file contains 42 lines.
        if x['repo']=='Frank-qlu/recruit' and e[0]=='招聘爬虫/zlzp/pipelines.py':e[2]=42
        fp=Path(m['local_path'])/e[0]
        assert fp.is_file(),str(fp)
        n=len(fp.read_text(encoding='utf-8',errors='replace').splitlines())
        assert 1<=e[1]<=e[2]<=n,(x['repo'],e,n)
    m['files']=subprocess.run(['git','-c','core.quotepath=false','ls-files'],cwd=m['local_path'],capture_output=True,text=True,encoding='utf-8').stdout.splitlines()
(OUT/'source_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'analysis_full.json').write_text(json.dumps(analyses,ensure_ascii=False,indent=2),encoding='utf-8')

def field(name,kind='text',**extra):return dict(name=name,type=kind,**extra)
def num(name):return field(name,'number',style={'type':'plain','precision':0,'thousands_separator':True})
def url(name):return field(name,style={'type':'url'})
def select(name,values):
    hues=['Blue','Green','Purple','Orange','Carmine','Turquoise','Gray']
    return field(name,'select',options=[{'name':v,'hue':hues[i%len(hues)]} for i,v in enumerate(values)])
def dt(value):return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone().strftime('%Y-%m-%d %H:%M:%S')
def specs(name,fields,rows,keys=None):
    result={'name':name,'fields':fields,'rows':rows}
    if keys:result['keys']=keys
    return result
tables=[]
guide=[]
guide.append(['先读这里','这是面向产品与实现拆解的源码研究库，覆盖 52 个 GitHub 仓库。不是安装清单，也不是所有仓库都值得直接使用。','先看 01 的「快速浏览」或「优先研究」，再点关联的产品设计、能力实现和源码证据。'])
guide.append(['研究范围与“所有”的边界','公开 GitHub 项目与可获取源码的 Skill，覆盖岗位采集、履历评估/编辑、职业定位、投递自动化、申请跟踪、模拟面试及招聘侧对照。GitHub 搜索和网页补查无法证明覆盖市面上所有项目；闭源商业产品不做伪源码分析。','05 保留全部检索候选，未深审项目没有伪造逐项分析。'])
guide.append(['检索方法','26 组中英文 GitHub queries，每组按 Stars 取前 20；另以公开网页/相关仓库补充低 Star 但实现不同的项目。52 个入选仓库均 git clone --depth 1，锁定 SHA。关键词和时间在 06；这不是随机抽样，偏向高关注度和中文/英文项目。','选样依据：用户链路覆盖＋实现差异＋关注度；教程、题库、仿 UI 和无关 resume/session 命中留在候选池说明。'])
guide.append(['核验层级','结论来自实际拉取的代码、数据结构、提示词和交付模板。源码切片审查不等于完整安全审计；未安装运行 52 个项目，未登录招聘站投递，也未调用付费模型。UX 是组件/工作流设计分析，并非现场用户测试。','04 每条证据有固定 commit 的文件和行号；“未见/未知”限定在此次审查范围。'])
guide.append(['Star 的含义','Stars 是查询当刻 GitHub stargazers_count，数字字段可排序；查询时间与 commit 时间各自记录。Stars 属于整个仓库，可能包括历史版本、其它模块或商业连接器，不是效果/安全/成熟度评分。','AIHawk 当前默认分支已是通用浏览器代理，不能将累计 Stars 当当前求职功能的证据。'])
guide.append(['推荐阅读顺序','采集底座：JobSpy / boss-zhipin-scraper / freehire；评估方法：ASu-skills / Resume-Matcher / JobOK；产品闭环：jobsync / jobops / offer-toolkit-skill；编辑交付：Reactive Resume / OpenResume；面试训练：interview-skills。','优先研究是本次的产品学习建议，不是已实测的使用效果排名。'])
guide.append(['拆分 What 与 How','01 看定位与全流程；02 看用户输入、准备成本、操作顺序、成品形态、交互与人工控制；03 看抓取/解析/评分/模型/知识框架/存储/容错；04 回查证据。','模型调用、关键词规则、提示词 rubric、真实 ATS parser 测试是四件不同的事。'])
guide.append(['最重要的实现差异','不少“ATS 分数”只是 LLM 按提示词打分；deepak 的分析器偏 section/skill 规则；JobOK 是可执行关键词规则；Servation 当前用模型整体评分，旧公式仅保留；Reactive Resume 当前将格式分与 LLM 建议分开。','阅读 03 的「评分与模型」列，避免仅比较百分制数字。'])
guide.append(['证据与真实能力','优先区分表达缺口、材料证据不足、真实能力差距。简历里没写不等于人不会；补写内容必须得到真实素材支持。ASu 的 claim ledger、cyber reviewer 的多读者视角和行业 toolkit 的经历追问具有参考价值。','框架是可借鉴的设计思想，并不自动保证宿主模型逐条执行。'])
guide.append(['完成状态不要混淆','NewWorkFoundation/jobclaw 搜索 runner 仍 planned；slothsheepking/jobclaw 的 LinkedIn applier 为 DRAFT 占位；浏览器 tracker 默认“已投递”并未核验成功。attempt、draft、submitted 必须分开。','对应 03 的限制与 04 的代码证据。'])
guide.append(['需要谨慎借鉴的路径','JobPilot 的生成入口主动要求编造可信公司/学校/指标；resume-plantation 的攻击性话术不适合默认体验；自动填表的未知答案默认值可能误填。分析其设计不代表建议原样用于真实求职。','逐项限制列解释具体依据，而不是对整个项目作未经验证的好坏结论。'])
guide.append(['开源边界','workopia 公开源是远程 MCP 包装器；fourleafai 公开 Skill/安装器，后端未公开；Magic Resume 的聊天代理依赖外部后端。已拉代码但只能分析公开部分。','模型供应商、搜索来源和云端数据库未知处保持未知。'])
guide.append(['本地可复核备份','job-search-landscape/artifacts/2026-09-17/ 中有完整 JSON、各表 UTF-8 CSV、report.md、manifest 与检索记录；sources/ 保留拉取源码。','固定 SHA 的 GitHub 链接可跨设备查看；本地备份用于后续增量研究。'])
tables.append(specs('00 阅读指南',[field('主题'),field('内容'),field('阅读建议')],guide))

overview_fields=[field('项目'),select('类别',sorted({x['category'] for x in analyses})),field('产品形态'),num('GitHub Stars'),select('阅读优先级',['优先研究','按需参考','谨慎参考','边界对照']),field('一句话定义 What'),field('适合谁'),field('使用流程速览'),field('交付物速览'),field('值得借鉴'),field('主要限制'),field('核验层级'),url('GitHub'),field('Star 查询时间','datetime'),field('源码 Commit 时间','datetime'),field('已归档','checkbox'),field('许可证'),field('源码 SHA'),num('证据条数')]
overview_rows=[]
for x in analyses:
    m=meta[x['repo']];lic=(m.get('license') or {}).get('spdx_id') or '未识别/未声明（需读 LICENSE）'
    overview_rows.append([x['project'],x['category'],x['form'],m['stargazers_count'],x['priority'],x['what'],x['audience'],x['flow'],x['output'],x['takeaways'],x['limits'],x['verification'],m['html_url'],dt(m['fetched_at']),dt(m['commit_date']),m['archived'],lic,m['sha'],len(x['evidence'])])
tables.append(specs('01 项目总览',overview_fields,overview_rows,[x['repo'] for x in analyses]))

product_dims=[('audience','目标用户与场景'),('input','用户输入'),('setup','启动与使用成本'),('flow','逐步使用流程'),('output','交付格式与设计'),('ux','交互与体验设计'),('control','人工控制与确认')]
technical_dims=[('stack','技术栈'),('ingest','岗位与材料获取'),('process','处理链路 How'),('model','评分与模型'),('mindset','心智模型与知识方法'),('storage','数据库与记忆'),('failures','失败与恢复'),('limits','限制与未验证项'),('takeaways','可复用设计')]
for name,dims in [('02 产品设计',product_dims),('03 能力实现',technical_dims)]:
    fields=[field('项目'),field('关联项目','link',link_table='__OVERVIEW__',bidirectional=True,bidirectional_link_field_name=name[3:]),num('GitHub Stars')]+[field(label) for _,label in dims]
    rows=[[x['project'],{'project_ref':x['repo']},meta[x['repo']]['stargazers_count']]+[x[key] for key,_ in dims] for x in analyses]
    tables.append(specs(name,fields,rows))
evidence_rows=[]
for x in analyses:
    m=meta[x['repo']]
    for i,(path,start,end,claim) in enumerate(x['evidence'],1):
        link=m['html_url']+'/blob/'+m['sha']+'/'+quote(path,safe='/')+f'#L{start}-L{end}'
        evidence_rows.append([x['id']+f'-E{i:02d} · '+claim,{'project_ref':x['repo']},path,start,end,claim,link,m['sha'],'已拉取文件并静态阅读',str(Path(m['local_path'])/path)])
tables.append(specs('04 源码证据',[field('证据'),field('关联项目','link',link_table='__OVERVIEW__',bidirectional=True,bidirectional_link_field_name='源码证据'),field('文件路径'),num('起始行'),num('结束行'),field('支撑结论'),url('固定 Commit 源码链接'),field('SHA'),field('核验方式'),field('本地源码路径')],evidence_rows))

searches=json.loads((OUT/'searches.json').read_text(encoding='utf-8'))
candidates={x['fullName']:x for x in json.loads((OUT/'candidates.json').read_text(encoding='utf-8'))}
query_map={}
for s in searches:
    for item in s.get('items',[]):query_map.setdefault(item['fullName'],[]).append(s)
for repo,m in meta.items():
    if repo not in candidates:candidates[repo]={'fullName':repo,'url':m['html_url'],'description':m['description'],'stargazersCount':m['stargazers_count']}
exclusions={
'huihut/interview':'知识题库/资料，非本次重点的求职产品或可执行 Skill；仅元数据判断。',
'liyupi/codefather':'编程学习资源集合；仅元数据判断。',
'BoltzmannEntropy/interviews.ai':'面试书籍资料，非交互产品实现；仅元数据判断。',
'LoseNine/Crack-JS-Spider':'通用逆向案例，招聘只是其中小项；仅元数据判断。',
'0xAllenChen/spider_reverse':'通用逆向案例，非完整求职流程；仅元数据判断。',
'heruijun/flutter_boss':'招聘 App 仿 UI，非求职者自动化/评估；仅元数据判断。',
'wwmz/WMZDropDownMenu':'通用筛选菜单控件，招聘关键词误命中；仅元数据判断。',
'whoiszxl/tt-zhipin':'招聘平台仿制全栈，偏招聘市场平台；本次未深审。',
'hacktivist123/agent-session-resume':'resume 指恢复 Agent 会话，与简历无关；词义误命中。'}
candidate_rows=[]
for repo,c in sorted(candidates.items(),key=lambda v:-v[1].get('stargazersCount',0)):
    selected=repo in meta
    ss=query_map.get(repo,[])
    stamp=meta[repo]['fetched_at'] if selected else ss[0]['time'] if ss else searches[0]['time']
    status='已拉源码并分析' if selected else ('元数据排除' if repo in exclusions else '候选；未深审')
    reason='见 01–04；按链路覆盖、实现差异和关注度选入。' if selected else exclusions.get(repo,'已发现但未逐文件审查；不能据此判断质量或功能真假。与已选项目可能同类，保留供继续扩展。')
    candidate_rows.append([repo,c.get('url') or 'https://github.com/'+repo,meta[repo]['stargazers_count'] if selected else c.get('stargazersCount',0),dt(stamp),status,reason,c.get('description') or '', '；'.join(s['query'] for s in ss) or '公开网页/补充 GitHub 线索', [{'project_ref':repo}] if selected else None])
tables.append(specs('05 候选池与排除',[field('仓库'),url('GitHub'),num('GitHub Stars'),field('查询时间','datetime'),select('研究状态',['已拉源码并分析','候选；未深审','元数据排除']),field('纳入或暂缓理由'),field('仓库自述（未核验）'),field('命中检索词'),field('已分析项目','link',link_table='__OVERVIEW__')],candidate_rows))
log_rows=[[f'S{i+1:02d} · '+s['query'],s['query'],dt(s['time']),len(s.get('items',[])),'GitHub gh search repos；stars 降序；每组 limit=20','已完成' if s['exit_code']==0 else '失败',json.dumps(s['command'],ensure_ascii=False)] for i,s in enumerate(searches)]
tables.append(specs('06 检索日志',[field('检索'),field('关键词'),field('检索时间','datetime'),num('返回数量'),field('方法与截断'),field('状态'),field('可复现命令')],log_rows))
stats={'analyzed':len(analyses),'cloned':len(meta),'evidence':len(evidence_rows),'github_queries':len(searches),'github_search_unique':len(query_map),'candidate_union':len(candidates),'verification':'静态源码审查；未运行各产品外部流程'}
(OUT/'validation.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'table_specs.json').write_text(json.dumps(tables,ensure_ascii=False,indent=2),encoding='utf-8')
for t in tables:
    with (OUT/(t['name']+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f);w.writerow([f['name'] for f in t['fields']])
        for row in t['rows']:
            values=[]
            for v in row:
                if isinstance(v,(list,dict)):v=json.dumps(v,ensure_ascii=False)
                if isinstance(v,str) and v.startswith(('=','+','-','@')):v="'"+v
                values.append(v)
            w.writerow(values)

report=['# 求职 Skill 与 GitHub 项目源码拆解','',f'2026-09-17｜{stats["analyzed"]} 个仓库｜{stats["evidence"]} 条源码证据｜{stats["candidate_union"]} 个候选（含网页补充）','']
state_path=OUT/'feishu_state.json'
if state_path.exists():report+=['[打开飞书多维表格]('+json.loads(state_path.read_text(encoding='utf-8'))['created']['data']['base']['url']+')','']
for title,content,suggestion in guide:report+=['## '+title,'',content,'',suggestion,'']
report+=['## 项目索引','','| 项目 | 类别 | Stars | 阅读建议 |','|---|---|---:|---|']
for x in sorted(analyses,key=lambda x:-meta[x['repo']]['stargazers_count']):report.append(f'| [{x["project"]}](#{x["id"].lower()}) | {x["category"]} | {meta[x["repo"]]["stargazers_count"]:,} | {x["priority"]} |')
for x in analyses:
    m=meta[x['repo']]
    report+=['',f'<a id="{x["id"].lower()}"></a>',f'## {x["project"]}','',f'[GitHub]({m["html_url"]}) · **{m["stargazers_count"]:,} Stars** · 查询 {dt(m["fetched_at"])}（Asia/Shanghai）','',f'源码 `{m["sha"]}` · {x["verification"]}','',x['what'],'','| 产品设计维度 | 分析 |','|---|---|']
    for key,label in product_dims:report.append('| '+label+' | '+x[key].replace('|','\\|')+' |')
    report+=['','| 能力实现维度 | 分析 |','|---|---|']
    for key,label in technical_dims:report.append('| '+label+' | '+x[key].replace('|','\\|')+' |')
    report+=['','源码证据：','']
    for path,start,end,claim in x['evidence']:
        link=m['html_url']+'/blob/'+m['sha']+'/'+quote(path,safe='/')+f'#L{start}-L{end}'
        report.append(f'- [{path}:{start}–{end}]({link})：{claim}')
(OUT/'report.md').write_text('\n'.join(report)+'\n',encoding='utf-8')
print(json.dumps(stats,ensure_ascii=False))
