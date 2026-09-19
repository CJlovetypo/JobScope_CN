import csv,json,pathlib
R=pathlib.Path(__file__).resolve().parents[1];O=R/'artifacts/2026-09-19-domestic'
projects=[json.loads(s) for s in (O/'projects.jsonl').read_text(encoding='utf-8').splitlines() if s.strip()]
manifest={x['repo']:x for x in json.loads((O/'source_manifest.json').read_text(encoding='utf-8'))}
evidence=[]
for i,p in enumerate(projects,1):
    m=manifest[p['repo']];p.update(id=f'CN{i:02}',stars=m['stargazers_count'],queried_at=m['queried_at'],sha=m['sha'],commit_date=m['commit_date'],license=(m.get('license') or {}).get('spdx_id','未声明'))
    p['links']=[]
    for f,a,b in p['evidence']:
        path=pathlib.Path(m['local_path'])/f;n=len(path.read_text(encoding='utf-8').splitlines())
        assert 1<=a<=b<=n,(p['repo'],f,a,b,n)
        url=f"https://github.com/{p['repo']}/blob/{m['sha']}/{f}#L{a}-L{b}"
        p['links'].append(url);evidence.append([f"E{len(evidence)+1:03} · {p['id']}",p['repo'],f,a,b,url,'本地源码已读；固定commit行号校验'])

channels=[
 ['BOSS直聘','商业招聘平台','CLI／浏览器页面／页面响应','jobfindsme；job-hunter；前次boss-cli','通常依赖用户浏览器会话；列表与JD分层','本次复核代码，未登录实测','不是国内唯一来源；CLI只是包装形态'],
 ['猎聘','商业招聘平台','Web JSON列表＋HTML详情；另有远端MCP路线','ai-job-search-cn；jobfindsme；MCP2skill','HTTP列表与完整详情不是同一能力；MCP需授权','新拉源码核验；本次未调用猎聘服务','需要区分网页内部接口与正式开放服务'],
 ['智联招聘','商业招聘平台','浏览器DOM；旧HTTP接口仅参考','jobfindsme；job-hunting','页面卡片不一定带完整JD；旧接口可能假空','CDP采集与错误检测代码已读','不要把HTTP200＋空结果解释为没有岗位'],
 ['前程无忧51job','商业招聘平台','浏览器上下文JSON／页面响应','jobfindsme；job-hunting','浏览器环境依赖；分页与详情需独立测试','源码核验，未跑真实浏览器','旧search.51job/cupid路径与当前适配分开'],
 ['拉勾','商业招聘平台','浏览器响应采集／旧Scrapy与Selenium','job-hunting；JobSpiders','依赖当前站点DOM与会话','拉勾响应解析和saveBrowseJob已读','有开源实现，但不等于今天可稳定无人值守'],
 ['牛客','校招社区','校招日程API→companyId→企业岗位API','JobResearchHub','列表分页、数量校验、完整JD快照','9月19日单次无登录POST返回2条；爬虫主流程已读','公司日程／校招公告与职位详情分开存'],
 ['实习僧','实习平台','Playwright页面解析＋字体映射','Bynlk/JobHunter','搜索固定intern；详情最多补50条','源码核验，未在线运行','不要把支持实习写成校招/社招都已完整覆盖'],
 ['国家大学生就业服务平台NCSS','公共就业／校招','jobslist/ajax列表＋详情页面','Bynlk/JobHunter','混有招聘公告和具体岗位；代码分页20条','9月19日单次无登录GET返回2条','实际样例含银行全球校招公告，粒度不是单个职位'],
 ['广东公共招聘网','地方公共就业','页面列表响应＋详情JSON','lastsunday/job-hunting','基于用户实际浏览的列表，含地区公共岗位','独立适配代码已读，未在线实测','与NCSS和商业招聘平台是不同来源'],
 ['就业在线 jobonline.cn','公共就业服务平台','页面列表响应＋POST详情','lastsunday/job-hunting','浏览时采集；非全站主动扫描','独立适配代码已读，未在线实测','不是中国公共招聘网job.mohrss.gov.cn，名称要分清'],
 ['企业自建招聘官网','企业直接来源','每家公司独立JSON接口或HTML解析','Hiring-Radar；FindJobs-Agent；ai-jobs-finder','社招/校招可能不同系统；列表未必完整JD','腾讯官网9月19日单次GET返回2条；其他公司仅代码核验','腾讯、百度等不能都归入第三方ATS'],
 ['国内ATS门户','企业直接来源','飞书招聘／Moka／北森租户适配','Hiring-Radar；openhire；JobResearchHub','租户参数、社校招分类、分页、详情因平台而异','代码核验，未验证所有租户在线可用性','网页前端接口不等于官方开发者API与长期服务承诺'],
 ['公众号／共享文档／校招公告','非标准化线索来源','外部抓取服务＋文档读取／导入','xiaozhao-radar；recruit-hub','经常是招聘活动／批次入口，需再到原站找岗位','抓取调度、导入和样本已读','入口数不是岗位数；原文/附件/截止日期需保留'],
 ['高校就业网／国聘／事业单位公告','待补充验证的来源族','本次未核实专用成熟采集器','不以宣传覆盖数计入可用项目','可能需要逐站HTML/PDF/Excel适配','有检索线索，未完成源码级有效适配验证','留在待验证清单，不推断不存在，也不冒称已有稳定接口'],
]
datasets=[
 ['JobResearchHub','zeitvex/JobResearchHub',74655,'逐条JD快照','15个JSONL.gz；full_jd、公司、标题、地点、薪资、来源URL等','2026-08-25生成；采集时间按source.collected_at','全文件遍历，74,655个唯一record_id、2,333个公司名称、全部full_jd非空、15个哈希匹配','算法/硬件等样本分布可能有偏；不代表当前在招；字段语义还需抽样','优先用于解析、去重、匹配实验；之后原站刷新','数据内容不自动适用源码MIT'],
 ['recruit-hub真实标记样本','kknee-dev/recruit-hub',8000,'校招公告／岗位概要','2026-09-03 CSV/JSON；source_url，无完整JD列','2026-09-03','实际读取8,000条；核对导出字段和生成脚本，未逐条追溯来源页','不是仓库提到的57,461条全量；不能把其他60条演示文件一起当真','用于校招入口、公司、批次、日期与来源字段设计','第三方公告内容权利另看来源'],
 ['recruit-hub演示文件','kknee-dev/recruit-hub',60,'合成/演示数据','8月若干文件及9月demo目录，每个文件60条','文件日期会随CI生成而变化','source明确写脱敏演示数据，gen_dataset会回退seed.sqlite','最新文件时间不代表真实岗位更新','仅UI与管道测试，不进真实岗位池','不当作市场样本'],
 ['Job-SDF','Job-SDF/benchmark',None,'月度技能需求聚合数据','Parquet需求／占比矩阵、共现图、断点索引','研究历史样本；不提供实时职位状态','已读加载代码与文件目录；当前环境缺Parquet引擎，未读取矩阵值','不是原始千万JD下载；不含可直接投递岗位URL集合','技能需求预测研究，不用于实时求职检索','论文注明数据CC BY-NC-SA 4.0；实体映射需另联系作者'],
 ['历史智联／51job样本','blackyau/zhaopin；tammy0825/51job',None,'历史归档／教学分析','data.7z；CSV与职位要求文本','代码快照分别2019／2017','已读采集代码、确认文件存在；归档数量未核验','时效不足，不支持当前在招判断','仅旧字段与分析方法参考','不要把源码许可证推导为第三方数据授权'],
 ['AICareerMap','buildwithamy/AICareerMap',None,'检索线索，未能核验','搜索引擎仍有摘要','9月19日拉取失败','GitHub仓库接口／git clone返回未找到','可能迁移、私有或删除，原因未证实','不纳入已验证数据集，不引用摘要规模作为事实','未知'],
]
def spec(name,cols,rows):
    fields=[]
    for c in cols:
        fields.append({'name':c,'type':'number' if c in ['GitHub Stars','条数','起始行','结束行'] else 'text'})
    return {'name':name,'fields':fields,'rows':rows}
specs=[spec('07 国内采集渠道',['渠道','来源类型','接入方式','开源实现','粒度与前提','核验程度','关键边界'],channels),
 spec('08 国内采集项目',['项目','GitHub Stars','Star查询时间','形态','来源覆盖','用户输入','使用流程','技术实现','交付物','完整性','限制','研究建议','源码日期','许可证','Commit','源码证据'],[[p['id']+' · '+p['repo'],p['stars'],p['queried_at'],p['type'],p['sources'],p['input'],p['flow'],p['how'],p['output'],p['completeness'],p['limits'],p['priority'],p['commit_date'],p['license'],p['sha'],'\n'.join(p['links'])] for p in projects]),
 spec('09 国内岗位数据集',['数据集','仓库','条数','数据粒度','文件与字段','时效','实际核验','局限','适用场景','内容许可说明'],datasets),
 spec('10 国内采集源码证据',['证据','仓库','文件','起始行','结束行','固定源码链接','核验方式'],evidence)]
(O/'table_specs.json').write_text(json.dumps(specs,ensure_ascii=False,indent=2),encoding='utf-8')
(O/'analysis_full.json').write_text(json.dumps(projects,ensure_ascii=False,indent=2),encoding='utf-8')
for t in specs:
    with (O/(t['name']+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f);w.writerow([x['name'] for x in t['fields']]);w.writerows(t['rows'])
intro='''# 国内岗位采集：来源、开源实现与现成数据

2026-09-19。本轮围绕国内来源补充，复核17个源码仓库（其中3个复用9月17日固定快照），所有Stars为9月19日查询值。未声称穷尽所有开源项目。

结论：不只有BOSS CLI和ATS。还包括猎聘/智联/51job/拉勾、牛客/实习僧、NCSS/地方公共就业、企业自建招聘系统，以及公告/共享文档入口。CLI、Skill、MCP是调用形态，不是数据来源分类。

原飞书库：https://moonton.feishu.cn/base/PT8GbWiHgaHKHrse27Jc8BcgnHK 。补充表07至10。

## 证据分级与检索范围

- 本轮16组GitHub关键词检索，另用公开网页补查；关键词AND匹配会漏项目，所以不将检索数量作为市场规模。
- 17个仓库有本地源码与固定SHA；新发现的AICareerMap无法拉取，仅列未核验线索。未运行第三方项目的完整外部流程。
- 对腾讯、NCSS、牛客各做一次无登录小样本端点请求，均HTTP200且返回2条。只能证明当前网络下该请求有数据，不证明全量、长期稳定或产品端到端可用。
- JobResearchHub全分片计数/非空/ID/哈希校验；recruit-hub读实际JSON与导出脚本。Job-SDF只核对文件与加载代码，未读取Parquet矩阵值。
- 本地原始记录：source_manifest.json、searches.json、data_audit.json、public_endpoint_probes.json。

## 先把五个概念分开

1. 数据来源：BOSS、猎聘、牛客、NCSS、某公司官网。
2. 接入方式：正式授权API/MCP、网页内部JSON、浏览器DOM/响应、HTML/PDF/Excel、人工导入。
3. 产品包装：Python库、CLI、Skill、MCP、浏览器扩展；换包装不会自动增加数据覆盖。
4. 数据粒度：招聘入口、校招公告、岗位卡片、完整JD、可确认仍在招的职位。
5. 交付形态：一次搜索结果、本地持续岗位库、历史数据集、统计聚合数据。

“公开网页用的API”不等于有正式开放协议或稳定性承诺；“代码存在”“本次成功取到”“持续稳定采集”也应分别标记。

## 本次最有价值的发现

- 牛客不是只有面经：本次看到了校招日程→companyId→企业岗位列表的完整采集流程，含页码与数量校验，并有现成JD快照。
- NCSS不是ATS：本次直接返回了记录；一条样例是“中国银行股份有限公司2027年全球校园招聘公告”，说明必须区分公告和具体岗位。
- lastSunday/job-hunting的源码包含广东公共招聘网和就业在线适配。更正名称：jobonline.cn是“就业在线”，不是job.mohrss.gov.cn“中国公共招聘网”。
- JobResearchHub本地实数74,655条，包含官网33,140、牛客19,852、猎聘17,177、BOSS4,486；2,333个公司名称。full_jd非空仅为结构校验，不代表语义无误、无重复岗位或今日仍有效。
- recruit-hub的8,000条样本与每份60条演示数据必须分离；文件日期自动变新不等于岗位真实刷新。
- 企业官网也有专用接口：腾讯已单次取到数据；不应把企业自建招聘系统统称为第三方ATS。

## 对国内岗位采集产品的设计建议（基于本次代码审查的判断）

社招路线：企业官网/国内ATS＋猎聘形成可追溯来源；BOSS/智联/51job通过用户浏览器补充。校招路线：优先NCSS＋牛客＋企业校招官网，实习僧补实习；公众号/高校公告/共享表格用于发现线索，最终尽量回到原始招聘页。

架构分成discover发现、list列表、detail全文、normalize标准化、refresh状态检查五层。单个source实现相同接口，但单独记录各层成功率；没有详情就明确是卡片，抓取失败不可写成零岗位或全部下架。

最小数据合同应有source、source_job_id、source_url、company、title、locations、recruitment_type、record_kind、published_at、first_seen_at、last_seen_at、last_verified_at、full_jd、jd_completeness、status、raw_response_hash、evidence。跨源去重保留所有来源；公告不能与单职位按同一键粗暴合并。

下一步验证应挑相同城市/关键词，为每个源各取小样本，比较列表成功率、详情完整率、重复率、过期率和字段缺失率，再决定接入顺序。Stars仅表示仓库关注度，不是采集可用性评分。

'''
parts=[intro,'## 渠道地图\n','| 渠道 | 接入方式 | 开源实现 | 核验程度 |\n|---|---|---|---|']
parts += ['| '+' | '.join([r[0],r[2],r[3],r[5]])+' |' for r in channels]
parts += ['\n## 逐项目源码分析\n']
labels={'type':'定位','sources':'来源','input':'输入','flow':'使用流程','how':'技术实现','output':'交付物','completeness':'数据完整性','limits':'限制','priority':'研究建议'}
for p in projects:
    parts += [f"### {p['id']} · {p['repo']} · ★ {p['stars']}\n",f"Stars查询：{p['queried_at']}；源码：{p['sha']}；提交：{p['commit_date']}；仓库许可：{p['license']}。\n",'| 维度 | 内容 |\n|---|---|']
    parts += ['| '+v+' | '+p[k].replace('|','／')+' |' for k,v in labels.items()]
    parts += ['\n源码证据：'+'；'.join(f'[{f}:{a}–{b}]({u})' for (f,a,b),u in zip(p['evidence'],p['links']))+'\n']
parts+=['\n## 数据集核验\n']
for r in datasets:parts += [f'### {r[0]}\n', '\n\n'.join(str(x) for x in r[3:])+'\n']
parts+=['\n## 公开来源补充\n','- [Job-SDF作者论文](https://arxiv.org/abs/2406.11920)：中国招聘广告来源与技能需求聚合定位。','- [人社部相关公告](https://chinajob.mohrss.gov.cn/c/2021-07-19/315525.shtml)：就业在线与中国公共招聘网为不同入口。','- [Job-SDF数据论文许可说明](https://papers.neurips.cc/paper_files/paper/2024/file/e997325c6f4045aa646c81e674076297-Paper-Datasets_and_Benchmarks_Track.pdf)。']
(O/'report.md').write_text('\n'.join(parts),encoding='utf-8')
print(json.dumps({'projects':len(projects),'evidence':len(evidence),'channels':len(channels),'tables':[(t['name'],len(t['rows'])) for t in specs]},ensure_ascii=False))
