"""Build reviewable live acceptance report and Feishu payloads from retained evidence."""
import json,pathlib
R=pathlib.Path(__file__).resolve().parents[1];O=R/'artifacts/live-platform-validation-20260919'
def read(p):return json.loads((O/p).read_text(encoding='utf-8'))
def save(p,d):(O/p).write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
manifest=json.loads((R/'artifacts/2026-09-19-domestic/source_manifest.json').read_text(encoding='utf-8'))
def repos(*names):
    found=[x for x in manifest if any(n.lower() in (x.get('full_name') or '').lower() for n in names)]
    return '\n'.join(f"{x['full_name']} | ★{x['stargazers_count']} | {x.get('queried_at','2026-09-19')} | https://github.com/{x['full_name']}" for x in found)
rows=[
['猎聘｜HTTP','通过小样本','无需本次用户授权','网页 JSON + HTML详情','上海／产品经理；2页×5，第二页新增5','2条详情392/1005字，标题对应','正文门禁2/10；其余8条未取详情','api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job；按原始job URL取详情，内部ID≠URL数字','scripts/validate_liepin_live.py --out <新目录>','liepin/result.json','低频只读候选；未测全量、跨日或批量限额',repos('ai-job-search-cn')],
['猎聘｜远端MCP','受阻：授权','缺少用户Token；授权页跳首页','Streamable HTTP MCP','initialize与tools/list成功，14工具','user-search-job 实际返回 isError=true，内层401；外层HTTP200','不能纳入已验收来源','https://open-agent.liepin.com/mcp/user；只调用搜索，未投递/联系','scripts/probe_liepin_mcp.py --out <新目录>','liepin/mcp-result.json；liepin/mcp-search.json','需用户授权后重验搜索、分页、JD；本次只测共同远端服务，未宣称三个包装器分别跑通',repos('ai-job-search-cn','jobfindsme','MCP2skill')],
['前程无忧｜51job','通过小样本','本机Chrome页面上下文','同源JSON + HTML详情','上海／产品经理；2页×20，新增14，唯一34','列表jobDescribe含正文；2独立详情全文匹配，1293/4455字','正文门禁20/34；14条特殊行文或要求不足待复核','浏览器实际观察/api/job/search-pc请求，再同源fetch翻页；HTML实体解码后比对','commercial/run.py --source 51job --city 上海 --query 产品经理 --output <新目录>','commercial/51job/result.json','不是脱离浏览器的纯HTTP；分页重叠6条，必须按来源ID去重',repos('jobfindsme','lastsunday')],
['智联','部分可用：登录墙','需用户完成登录','浏览器DOM','可见20张卡片；分页未通过','2条部分正文，明确提示登录查看完整内容','full_jd为空，2条样本隔离；另18张卡片仅留原始证据','zhaopin.com jobs / jobdetail；列表与完整详情均存在登录提示','commercial/run.py --source zhilian --city 上海 --query 产品经理 --output <新目录>','commercial/zhilian/result.json','不能把部分JD当完整；登录后需重新验收',repos('jobfindsme','lastsunday')],
['拉勾','受阻：安全验证','需用户自行完成验证','浏览器DOM','首页出现滑动验证，未到搜索列表','0条，未验证','关闭自动接入','https://www.lagou.com/；遇验证停止','commercial/run.py --source lagou --city 上海 --query 产品经理 --output <新目录>','commercial/lagou/result.json','脚本当前只检测阻断；验证解除后还需实现并验收搜索、翻页和详情',repos('jobfindsme','lastsunday')],
['牛客','通过小样本','无需本次用户授权','日程发现公司 + 企业岗位JSON','动态发现小红书715；2页×5，第二页新增5','10条API已返回 ext.infos + ext.requirements','正文门禁10/10','POST www.nowcoder.com/np-api/u/school-schedule/list-card → POST nowpick.nowcoder.com/u/company/job/list/v2','campus/validate_campus.py --only nowcoder --out <新目录>','campus/result.json；campus/evidence.json','有日程公告≠有岗位；首5家公司筛选可分页者，只证明路径而非覆盖率',repos('JobResearchHub')],
['实习僧','通过小样本','本机Chrome页面；未进行登录','DOM + 当前页字体映射 + 详情','上海／产品经理／实习；2页×20，唯一40','2条完整页面正文493/85字；薪资列表详情一致；PUA残留0','正文门禁1/40；38未取详情，1仅职责待补要求','shixiseng.com/interns → /intern/ID；逐页CSS字体，fontTools cmap还原','shixiseng/probe.py --query 产品经理 --city 上海 --out <新目录>','shixiseng/result.json','85字是原页面全部三条职责，不是采集截断；已抓全与匹配要求充足分别判断',repos('Bynlk/JobHunter')],
['NCSS','链路通过；正文质量混合','无需本次用户授权','岗位列表JSON + HTML详情','软件工程师；2页×5，新增5；另1补充岗位+1公告','基础10条逐条详情：2实质正文、8薄正文；补充岗位也薄','正文门禁1/12；公告与薄正文隔离，另1仅职责待补要求','www.ncss.cn/student/jobs/jobslist/ajax/ → /student/jobs/ID/detail.html；精确.mainContent，无3000字截断','campus/validate_campus.py --only ncss --out <新目录>','campus/result.json；campus/evidence.json','NCSS含智联等上游转载，不能算独立岗位覆盖；公告不是职位；不得推断仍在招',repos('Bynlk/JobHunter')]
]
headers=['来源路线','本次结论','运行前提','技术路径','列表与分页实测','详情实测','现有Skill门禁结果','API或页面入口','复跑入口','本地证据','接入边界','参考项目与Stars']
jobs=read('normalized_jobs.json');summary=read('intake_summary.json')
specs=[{'name':'11 国内平台实测验收','fields':[{'name':h,'type':'text'} for h in headers],'rows':rows}]
jh=['样本ID','平台','职位','公司','采集状态','正文门禁','隔离原因','原始URL','原始JD','部分JD','在招状态','证据文件']
jrows=[[j['job_id'],j['source'],j['title'],j['company_name'],j['detail_status'],j['intake_status'],j['quarantine_reason'] or '',j['source_url'],j['full_jd'],j['partial_jd'],j['open_status'],j['evidence_file']] for j in jobs]
specs.append({'name':'12 平台实测岗位样本','fields':[{'name':h,'type':'text'} for h in jh],'rows':jrows});save('table_specs.json',specs)
save('capability_registry.json',[dict(zip(headers,row)) for row in rows])
text='''# 国内招聘平台实际验收（2026-09-19）

本次验证的是实际采集链路，不是 README 宣称。共7个平台、8条路线（猎聘HTTP与MCP分别计）：猎聘HTTP、51job、牛客、实习僧通过小样本列表/分页/JD验收；NCSS链路通过但内容混合；智联部分可读，拉勾与猎聘MCP受阻。不能宣称“全部跑通”。

## 逐来源结果

| 来源 | 结论 | 列表分页 | 详情 | 接入边界 |
|---|---|---|---|---|
'''
for r in rows:text+='| '+' | '.join(r[i].replace('|','／').replace('\n','；') for i in [0,1,4,5,10])+' |\n'
text+='''
## 与现有 Skills 的实际衔接

已新增独立验收脚本、统一字段归一化与离线接入检查，调用现有 `shared/job-search-core/scripts/lib/body-review.mjs`，不是另造一套只按字数放行的标准。保留完整原文、来源ID、URL、证据文件和SHA256；来源URL标为platform_detail，不冒充企业官网。实习僧“岗位基本要求”按原文映射到requirements，保留原文不改写。

'''
text+=f"统一保留 **{summary['records']} 条记录**（含1条公告），**{summary['body_ready']} 条通过现有正文门禁**，其余 **{summary['records']-summary['body_ready']} 条待补全/复核/隔离**。智联20卡片中只有2条建立有稳定ID的样本，其余卡片在原始证据，未伪造ID。通过正文门禁≠确认招聘有效≠已完成候选人匹配。所有记录open_status=unknown、production_eligible=false。\n\n"
text+='''当前没有修改生产ATS注册表或默认采集流程。这是可回放的扩源验收与接入预检；正式接入还需招聘状态核验、公司实体关联、跨源去重、增量更新和连续运行验收。纯HTTP优先候选为猎聘、牛客；NCSS适合补充发现并强过滤；51job/实习僧作为浏览器适配器。登录受阻来源保留禁用。

`normalized_jobs.json`全部记录；`body_ready_jobs.json`正文通过；`quarantine.json`保留隔离原因。机器门禁可能无法识别特殊行文，pending不等于源站没有JD。实习僧第二条85字原文已抓全，但只有职责；51job有14条需要逐岗全文复核。NCSS原脚本宽泛“实质正文”2条，经现有要求更严格的正文门禁仅1条。

## 复跑方式

从项目根目录执行；Python 3.12、Node当前运行时。浏览器路线先使用web-access的check-deps.mjs确认Chrome与localhost:3456；实习僧依赖脚本旁deps/fontTools。每次使用新的输出目录，失败/登录墙不视作零岗位。

```
python job-search-landscape/scripts/run_platform_validation.py --source liepin
python job-search-landscape/scripts/run_platform_validation.py --source nowcoder
python job-search-landscape/scripts/run_platform_validation.py --source ncss
python job-search-landscape/scripts/run_platform_validation.py --source 51job
python job-search-landscape/scripts/run_platform_validation.py --source shixiseng
node job-search-landscape/scripts/integrate_platform_evidence.mjs
```

统一入口也支持zhilian/lagou/liepin_mcp；后三者会重现当前阻断或返回待验收，不会自动登录、解验证码或投递。猎聘MCP复跑入口为匿名只读探针，不含授权配置读取。拉勾解除验证后仍需补搜索实现，不能仅登录就算通过。

整合脚本默认重建本次证据的离线结果；不是所有新复跑目录的自动汇总服务。复跑记录独立存档，避免把旧证据当新结果。原研究的项目Stars与源码版本仍在08表，本次11表引用同日GitHub快照。

## 验证范围与下一步

实际执行了低频搜索、分页、详情取数和字段对齐；未测试申请流程、全量覆盖、持续运行或跨日稳定性。没有执行投递、消息或简历上传。智联登录、拉勾验证、猎聘MCP授权是已观察到的剩余阻断；用户完成后可续验。招聘平台与MCP包装器不等同：本次未宣称jobfindsme、MCP2skill整个产品都运行成功。
'''
(O/'report.md').write_text(text,encoding='utf-8')
print('Built',len(rows),'routes;',len(jobs),'records')
