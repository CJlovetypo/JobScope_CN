# 扩充行业与核验来源

仅在用户要求扩充、修复或复核来源时使用。本流程不改变日常岗位评估与 Excel 输出。

## 准入依据

- 从用户指定资料、公司官网或公开招聘入口取得候选。原始来源只读；公司名称、行业宽类和城市提示是线索，不直接作为已核实事实。
- 默认准入仍要求本轮匿名公开 API 返回至少一份可读完整 JD：稳定岗位 ID、职责、任职要求及官方岗位链接。HTTP 200、门户可打开或仅有岗位标题不能证明此能力。
- Waiqi 零岗位扩容使用独立的 `verified_api_zero_jobs` 状态：必须是实际官方岗位列表请求返回 JSON 空数组并完成分页收敛，同时保留匿名会话、列表路径、响应 SHA256、原始文件和官方主体人工复核证据。聚合站 `positionCount=0`、HTML 空页面和需要登录的接口一律不属于该状态；它也不提供招聘方向或城市证据。
- 用户只维护公司与接口时，可使用独立的 `verified_public_list_only` 状态。Jobs2Web、AJINGA 必须分别通过其列表适配器、分页总数收敛、主体与地区核验，并保存匿名请求摘要；`complete_jd_samples` 必须为 0。该来源可用于发现，缺少正文的岗位不得进入完整匹配评估。具体契约和公司接口查询见 [Waiqi 接口资产](../../../../shared/job-search-core/references/waiqi-sources.md#公司接口资产与扩源)。
- 记录请求方法、URL、非敏感参数、验证时间、响应 SHA256、正文样本与覆盖范围。只收录经过实测的配置；不能把相同 ATS 平台其他公司的成功推及未测公司。
- 可读取完整社招或实习 JD、当前没有正式校招的来源仍可保留。招聘类型独立判断，不能为扩大来源数将实习改为校招。
- 样本查询、分页上限、变动总数、详情失败均如实保留。部分覆盖不代表全量；API 核验时间也不是持续可用承诺。

## 从候选中发现公开接口

### Waiqi 候选查询

`../../../shared/job-search-core/assets/waiqi-source-candidates.json` 独立保存第三方公司介绍与招聘入口。`industry_hint`、`ownership_hint` 是原网站线索，`matched_company_ids` 仅表示与现有库的可能关联；均不等于已核实行业、性质或用人主体。招聘链接的可访问性、API 能力和当前岗位开放状态仍需实测。缺招聘链接的公司仍保留，便于后续补缺。

从仓库根目录运行：

```sh
node shared/job-search-core/scripts/source-candidates.mjs query --query=微软
node shared/job-search-core/scripts/source-candidates.mjs query --industry=制造 --has-recruitment
node shared/job-search-core/scripts/source-candidates.mjs query --company-id=microsoft
node shared/job-search-core/scripts/source-candidates.mjs export-discovery --query=微软 --output=job-search/runtime/campus/artifacts/waiqi/candidates.json
```

查询支持名称、别名、原始行业／性质、Waiqi ID 与关联公司 ID；另有 `--ownership=`、`--status=` 精确状态过滤以及 `--input=` 指定快照。默认不截断结果，可用 `--output=` 保存完整查询。`export-discovery` 仅导出具有 HTTP(S) 招聘链接的公司，原样保留路由 fragment；无入口公司不作为空核验任务导出。导出数组可交给下方 `source-discovery.mjs`，其支持范围之外的平台继续定向发现。

导出使用独立 `waiqi-{原站ID}` 作为核验目录 ID，避免仅凭名称匹配就合并到已收录主体。原始关联、来源 URL、状态与分类线索留在 `provenance`，不会作为已核实标签。核验成功后还需检查真实主体；确认已有主体时沿用正式库 ID，新主体才分配稳定 ID。此工具不修改候选库和正式 `sources.json`。

`scripts/source-discovery.mjs` 支持根据已观察到的 Moka、北森、飞书及 Hotjob 入口生成请求配置，也可读取官网公开配置和真实招聘链接。不使用个人登录 cookies，不把 HTML 职位正文当 API 返回。

```sh
node scripts/source-discovery.mjs artifacts/本轮/candidates.json artifacts/本轮/verification --max-pages=2 --page-size=10 --timeout-ms=10000 --concurrency=2
```

候选为数组，每项包含 `company_id`、`display_name`、`industry_tags`、`entry_urls`；可附 `endpoints` 记录旧库 provider 提示。脚本保存每次尝试、原始响应和 `verification.json`，默认复用本轮已完成记录。重新验证需新目录或 `--refresh`。脚本的 `admitted` 只表示已取得完整 API JD，**不自动写入正式来源表，也不代表公司归属审查已完成**。

北森移动域等失效入口可以尝试修正到已知租户的公开桌面入口，但修正后必须重新实测。没有经过验证的猜测地址不得入库。

当旧入口失效、为空或正文不完整时，可以用“公司准确名称／简称 + ATS 名称或公开域名 + 校园招聘”反向搜索新的企业页。按恢复概率先处理已有 ATS 痕迹、当前空接口和正文不完整记录，再处理完全没有平台线索的公司。搜索结果仅生成候选：公司拼音、英文名、企业页 ID、同集团名称和搜索摘要都不能单独证明归属；必须重新调用该候选的公开列表与详情 API，并核对返回公司名、完整 JD、分页及具体岗位链接。新年份专题、职位详情页、转载页和同一租户的不同展示路径不得重复计为新来源。

旧北森还可能使用公开前端的 `LightBoltAPI`。现有运行时也支持已逐租户验证的前程无忧 CoAPI／XYZ、智联 Grace、牛客、Greenhouse、Oracle 和顺丰校园接口。顺丰按公开响应的 `seasonType` 判断类型，接口未确认投递开放字段时保留待核实。Workday 缺少国家筛选项时，可以枚举响应中明确的大陆城市筛选，并逐详情复核国家；这类结果仍标部分覆盖，不固定本次城市 ID。公开签名按官方前端契约生成，不使用个人登录态。

招聘公告可能给出无协议域名或带 `#/index?id=...` 的移动入口。保留实际观察到的完整路由，不能统一删除 fragment，避免丢失招聘企业标识。只有图片或二维码的公告标明未解析范围，不得写成“公司无 API”。

## 公司归属与去重

公开门户标题、匿名配置中的租户／站点名称、API 招聘组织字段、JD 中明确的公司介绍可以用于交叉核对。不能仅依据旧库公司名给整站岗位贴标签。

- `queryId`、`orgCode`、部门／子公司筛选参数没有进入实际 API 请求时，返回的可能是集团全站。应核对并验证过滤条件，或将来源归到真实集团；不能冒充子公司的专属来源。
- 同一集团的专项、补录、夏令营或地区入口不重复计算成多家公司。子公司名称不是集团的同义词，保存为原始来源线索，不塞进集团 `aliases`。
- 同一 Moka `orgId` 不保证相同招聘主体。不同 `siteId`、站点品牌或业务主体要核对，不能自动合并。不同 API 主机／租户的相同岗位 ID 也不能仅凭数字相同合并。
- 错连到第三方平台、其他公司、主体仍不清的配置留在待核实记录，不写入启用名单。
- 规则误判正文缺失时，可人工完整阅读 API 原文后单独保存语义复核记录；保留原始响应和自动判断，不能仅把布尔值改成 true。

## 入库与标签

只将通过能力与归属检查的配置写入 `../../../shared/job-search-core/assets/sources.json`。新增主体使用稳定 ID，已存在公司保留 ID，多个已验证入口放入 `recruitment_sources`。行业多选去重仍由统一流程处理。

城市标签来自本轮 API 的正式开放岗位地点，尽可能补采分页；索引不完整时保留部分覆盖，不能用旧库历史地点或公司总部补齐。行业标签用于宽类分流，细分业务、性质、人数和资本资料仍按原有规则分别维护；没有调查的字段保留缺口，在主动维护任务中定向补核，不嵌入求职流程。

公司查询见 [行业公司索引](../data/行业公司索引.md)。历史候选记录可能包含品牌、部门、活动与集团重复名；逐条有结论不等于每条都对应独立可用 API。维护以当次接口响应及验证日期为准。
