# 社招运行与数据约定

Node.js 22+；PDF提取用Python+pypdf，DOCX用标准zip/xml解析。Excel使用Codex随附@oai/artifact-tool，先通过load_workspace_dependencies定位，必要时设置CODEX_NODE_MODULES。命令以本skill为工作目录；所有产物写在本skill内。

## 画像

接收学历、正式工作年限、具体工作责任与成果、相关经验、到岗安排和薪资／职级等明确偏好；无工作经验可填0。没有默认应届或毕业届别门槛，实习不自动累计为正式工作年限，带团队与预算等资深职责须有本人实践支撑。不能因标题“高级／经理”推断胜任程度。

以下仅是测试结构，真实运行必须忠实读取用户材料，不编造经历和承诺：

```json
{
  "is_test": true,
  "summary": "开发测试示例，请替换为真实材料",
  "search_mode": "social",
  "degree": "本科",
  "employment_years": 3,
  "earliest_start_date": null,
  "salary_preference": null,
  "level_preference": null,
  "industry_filters": [
    "internet"
  ],
  "company_filters": [],
  "city_filters": [
    "上海"
  ],
  "business_preferences": [],
  "role_preferences": [],
  "evidence": [
    {
      "id": "E1",
      "text": "此处填写真实行动与成果，不使用本示例作为用户事实",
      "source": "原简历位置",
      "kind": "resume",
      "claim_type": "objective_experience",
      "experience_type": "employment",
      "experience_id": "EXP1"
    }
  ]
}
```

行业必填，使用industries返回的ID或all；城市为空表示不限城市。业务偏好用已有标签词汇，职能偏好独立填写。能力事实与意愿不得混写。kind为resume/self_description/user_clarification；claim_type为objective_experience/objective_achievement/self_assessment/preference；experience_type为internship/employment/research_project/course_project/personal_project/other/none。客观经历必须有experience_id；同一经历不重复计数。

## 来源证据与启用

`../shared/job-search-core/assets/sources.json` 中全部共享配置保留并启用，当前数量见 `data/shared-registry.json`（旧 `registry-inheritance.json` 仅保留历史）。核验清单只说明确定程度：已取得当前目标岗位与完整 JD、已确认对应检索接口、方向仍待核实。明确方向的接口当前返回空列表也可以确认；没有明显方向证据、尚未测试或当次请求失败的来源仍启用。

`data/source-direction-validation.json` 保留实际测试时间、接口与证据；`source-mode-capabilities.json` 记录路由策略。启用数量与已确认数量分别展示，不把启用写成验证成功。清单缺失、配置新增或变更时仍运行，但不沿用不匹配的旧证明。

仍按用户行业和城市范围检索，每条岗位依真实返回字段和正文判断招聘性质；无法确认的岗位留待核实。城市标签和运行快照只在当前方向及来源配置指纹一致时复用，配置变化后重新采集。

## 流程命令

```bash
node scripts/jobs.mjs industries
node scripts/jobs.mjs catalog --profile runs/input/profile.json
node scripts/jobs.mjs prepare --profile runs/input/profile.json --out runs/唯一运行名
node scripts/jobs.mjs collect --run runs/唯一运行名
node scripts/jobs.mjs screening-summary --run runs/唯一运行名
node scripts/jobs.mjs plan-assessment --run runs/唯一运行名 --mode sample --limit 10 --user-request "填写用户真实选择"
# 或 --mode companies --only 公司A,公司B；或 --mode all，不替用户选全量
node scripts/jobs.mjs batch-create --run runs/唯一运行名 --limit 10
# 按 parallel-assessment.md start/submit/merge/close
node scripts/jobs.mjs render --run runs/唯一运行名
```

首次catalog/prepare会为本次候选公司初始化社招城市缓存，只初始化没有该方向记录的公司。列表分页先行，只有地点或类型缺失才按采集器支持补详情；后续collect只补目标城市、目标类型所需正文。城市索引独立于校招；不以校园站城市代替目标方向城市。初始化仍可能需要较多请求，不承诺全库首跑与缓存续跑一样快。缓存失败/部分覆盖保留状态和证据，不能称为没有岗位。

公司城市标签未命中硬排除；入选公司内的其他城市岗位保留为excluded_city，地点未知待核实。行业限定公司，业务仅影响优先处理顺序，不减少已入选公司。公司性质缺资料时只核实入选公司；不能为了通过prepare伪造verified。用户主动刷新时使用collect --refresh或refresh-cities --only 公司A,公司B。

collect默认并发3，公司内串行分页、有限详情并发；可用--concurrency 1至8调整。每次请求有超时，触达--max-pages必须partial。只复用相同来源与招聘方向指纹且采集已完整结束的快照（仅方向覆盖有限的partial也可复用，但仍如实显示部分覆盖）；变更方向使用另一skill，变更画像使用新run。用户变更偏好可prepare --reuse-run 本skill旧run复用JD，但旧评估不能补指纹继续使用。

范围确认在采集之后；已有用户明确范围沿用。sample固定整个样本，--limit批次不等于实验总量；“前N个”必须按已展示顺序固定岗位键，不能改称轮流抽样。固定批次每岗仍阅读全文，未覆盖岗位保留“未纳入本次评估”。selected scope全部完成才能正常render，只有用户要求提前交付才--allow-partial。大范围可用多agent不重叠批次，执行者终止后才关闭批次。

精确选样时两个命令的JSON格式不同：`plan-assessment --jobs`读取对象数组，例如`[{"company_id":"公司ID","job_id":"岗位ID"}]`；`batch-create --jobs`读取字符串key数组，例如`["[\"公司ID\",\"岗位ID\"]"]`。后者直接使用前一个命令确认后返回的岗位构造，不手写转义；可用`JSON.stringify([company_id,job_id])`生成每个key。

## 交付与过程

最终仅交付outputs/<运行名>/社招岗位匹配.xlsx。四页签为岗位匹配、待核实与未评估、公司简介、来源覆盖。前两张固定十二列：公司、公司业务标签、公司性质标签、岗位、投递建议、匹配层级、岗位城市、意愿匹配度、能力匹配度、硬性条件匹配度、详细评估理由、JD链接。

字体微软雅黑11，表头34磅，岗位行36磅，冻结、筛选、换行与链接统一。四个评级表头有简短备注，硬性条件解释依据社招规则。理由只显示评估结论、能力、意愿、缺口四段；完整事实限制不能省略。投递建议为可以投递/投递前准备/暂不建议投递，不显示内部优先级或百分比分数。

公司简介按公司ID去重，覆盖任一页出现的全部公司；业务、人数、资本信息各一行，保留时点与来源。缺资料明确写未知，不在渲染时联网。来源覆盖用读者可理解的事实表达失败或限制，API异常留日志，不塞进单岗理由。

runs/<运行名>/保存run.json、companies快照、raw匿名API响应、screening-summary、evaluation-scope、固定批次与assessments。archive/jd-originals.jsonl完整保留全部岗位正文和原始招聘证据，包括被排除岗位；source-coverage.json单独保存公司级分页证据，JD引用该文件。archive-index用于未变化时复用。logs/render-时间.json保留每次导出的配置及内部审计，report-audit.json记录范围完成度。Excel不保存JD全文、隐藏原文页、过程配置或冗长证据编号，不生成Markdown交付。

同名岗位按company_id+job_id识别，正文、招聘证据或画像变化后评估失效。新run不得复用另一画像评估，模拟画像必须is_test。来源继承证明在data/registry-inheritance.json；目标方向的实际可用性见本次coverage，不能将继承的校园核验当成社招/实习已核验。

JD指纹忽略重新抓取产生的证据文件路径和抓取时间，保留职责、条件、类型与招聘项目语义；不会仅因换了原始响应文件就让同一JD重复评估。旧快照未变化的已有指纹仍兼容，内容真正变化仍需重评。`partial`公司简介线索保留在快照审计中，人读表显示资料尚未核实，不当成事实。
