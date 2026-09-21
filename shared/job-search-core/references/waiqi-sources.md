# Waiqi 公司与招聘来源

入口：https://waiqi.com/company 。目录默认是北京；采集使用全国筛选，不把首页当作全部公司。

`assets/waiqi-source-candidates.json` 保存公司原名、别名、网站简介、官网、行业／性质／规模／城市线索及招聘原站链接。公司详情明确标注“外企”时，按本项目维护规则作为外企性质依据；“合资”不映射为外企，规模和城市字段仍只作线索。`matched_company_ids` 中只有精确标准名可直接参与性质关联；普通招聘租户关联可能涉及不同子公司，不能单独构成主体合并或性质打标依据。

## 外企性质打标

`data/waiqi-foreign-company-index.json` 保存当前完整 4,165 家目录快照的性质索引，明确区分“外企”和“合资”。一键打标只接受精确标准名、正式招聘来源中记录的具体 Waiqi 公司 ID，以及已清洗的严格招聘上下文。先预览，再应用：

```sh
node shared/job-search-core/scripts/tag-waiqi-ownership.mjs
node shared/job-search-core/scripts/tag-waiqi-ownership.mjs --apply
```

执行结果、命中清单、被覆盖的旧结论和备份保存在 `campus-job-fit/artifacts/waiqi-2026-09-20/waiqi-ownership-tagging/`。旧结论写入 `prior_classification`，不丢失原理由和证据。脚本同时重算命中主体的公司规模派生标签，避免性质与规模数据不一致。

旧库供应商结构化性质字段的优先级高于 Waiqi。先运行 `tag-supplier-ownership.mjs --apply` 刷新供应商结论；后续重复运行 Waiqi 打标时，已有 `supplier_company_nature_classification` 结论会被跳过，不会被 Waiqi 覆盖。

正式 `assets/sources.json` 区分完整 JD、零岗位 API、公开列表三类核验状态。零岗位 API 必须另有官方主体证据、JSON 列表结构、实际列表请求、响应 SHA256 和零岗位状态，不能用 Waiqi 的 `positionCount`、HTML 页面或门户能打开来替代。公开列表使用 `verified_public_list_only`，不能冒充完整 JD；列表适配器的 full 模式仍报告正文不完整。原站实际存在公司错译和招聘链接错配；原站名称留在 provenance，不自动成为官方主体别名。没有外部招聘链接的公司仍保留在候选库。

## 公司接口资产与扩源

`assets/waiqi-interface-catalog.json` 保存招聘入口、公司引用 ID、接口参数、公司根租户、响应摘要、核验范围及阻塞原因，不保存岗位正文或原始响应。查询时同时展示已接入和未接入接口，避免只看正式库而丢失线索：

```sh
node shared/job-search-core/scripts/lookup-waiqi-interfaces.mjs --query=汇丰
node shared/job-search-core/scripts/lookup-waiqi-interfaces.mjs --query=23774
```

Waiqi 引用关系不等于雇主归属。AJINGA 先读取 `/django_rest/company/info/{id}/`，再枚举 `/django_rest/job-list/`，逐行核对根公司 ID；子频道 ID 可与根公司不同。赫力昂指向艾伯维的错误引用已单独标记，不按该引用合并。地点不明确时保留接口但不宣称中国大陆范围完整。

Jobs2Web 支持传统分页及页面实际声明的 `/tile-search-results/` 加载更多请求，始终保留 CN 筛选并核对唯一 ID 与总量。康宁的 CN 筛选中仍返回主地点为台湾、另含其他地点的记录，不能在不读取详情的前提下强行认定其大陆岗位完整。

Workday 的 `wdN.myworkdaysite.com/recruiting/{tenant}/{site}` 使用该入口实际主机调用 CXS 列表接口。23 个候选入口已通过列表结构探测，但这不代表全部中国岗位已遍历或雇主归属已审核。与现有租户相同的入口保留为替代路径线索，不重复统计公司。

Oracle 多站点可能共用岗位库存。目录中的 `inventory_equivalence` 来自完整列表 ID 集合比较，仅代表所标注时间的库存一致，未来更新必须重新核对。图谱、仟寻的入口、二维码、404 等结果与 API 能力分开保存；入口可打开不代表公司列表可调用。

维护时运行 `build-waiqi-interface-catalog.mjs` 将本地复核结果导出为此资产。网页、响应正文、调查记录和过程报告继续留在忽略提交的 `campus-job-fit/artifacts/`。

## 抓取及查询

机器可读的 Waiqi 接口契约保存在 `assets/waiqi-api-contracts.json`。当前完整性链路只依赖三个已实测接口：全国公司目录、公司详情、公司全部职位列表；职位列表只保留岗位元数据和外部招聘链接，不继续请求单岗位详情。

从仓库根目录运行：

```sh
node shared/job-search-core/scripts/crawl-waiqi.mjs campus-job-fit/artifacts/waiqi-2026-09-20
node shared/job-search-core/scripts/export-waiqi.mjs campus-job-fit/artifacts/waiqi-2026-09-20
node shared/job-search-core/scripts/audit-waiqi-archive.mjs campus-job-fit/artifacts/waiqi-2026-09-20
node shared/job-search-core/scripts/source-candidates.mjs query --query=西门子
node shared/job-search-core/scripts/source-candidates.mjs query --industry=金融 --has-recruitment
node shared/job-search-core/scripts/audit-waiqi-routing.mjs --output=campus-job-fit/artifacts/waiqi-routing-audit.json
```

同一抓取目录会复用成功响应并重试失败项；新一轮更新请使用新目录，避免把缓存日期写成重新核验时间。默认最多 3 个请求在途、请求起点至少间隔 750ms；429 会全局冷却并遵守 Retry-After。不要并行启动多个 Waiqi 抓取进程。WAIQI_CONCURRENCY 与 WAIQI_INTERVAL_MS 可降低采集负载。默认只固化公司目录、公司详情、公司职位列表与招聘链接，不请求单个岗位详情。只有明确需要站内 JD 时才设置 `WAIQI_JOB_DETAILS=missing-links` 或 `all`；完整官网 JD 样本仍由官方来源核验流程保存。

需要在同一归档中校验线上增量时，设置 `WAIQI_REFRESH_CATALOG=1` 强制刷新全部目录页，设置 `WAIQI_REFRESH_POSITIONS=1` 强制刷新每家公司的职位列表；公司资料本身需要重新取证时再设置 `WAIQI_REFRESH_COMPANIES=1`。刷新目录时会自动发现新增公司并补抓其公司资料与职位列表。未设置的层继续复用成功响应，避免把旧缓存误记成当次刷新。

本次观察到目录响应的 `page.size/current/pages` 与实际返回不符。以请求 page/size、实际返回 ID、去重数量及 total 核对完整性。另已证实公司详情的 `positionCount=0` 可能过期，而公司页面仍展示岗位；因此每家公司都必须实际请求 `company/position-all`，不能再用详情计数推断空列表。旧的 `company_info_reports_zero_positions` 缓存必须强制重抓后才能作为岗位覆盖统计。

公司页的“在招职位”也不是开放状态真值。实测同一页面可能同时包含重复外部岗位 ID、已经不在官方当前列表中的旧岗位、非中国岗位、通用门户链接和错配到其他雇主租户的链接。`audit-waiqi-routing.mjs` 只回答招聘链接是否能解析为 skill 已知 ATS，以及相同租户配置是否已经注册；它不会把 Waiqi 页面行数当成当前开放岗位数。是否可交付仍以官方实时列表、稳定岗位 ID、主体归属和目标地区为准。

Oracle Recruiting 链接经常不带中国区 `locationId`。这类来源由运行时按官方服务实测的 200 行窗口遍历整个站点，再只保留 `PrimaryLocationCountry=CN` 的记录；如果官方 `TotalJobsCount` 与实际唯一岗位数无法收敛，覆盖状态必须保持 `partial`，但已经明确返回的中国岗位和完整 JD 仍会保留。

导出产物：

- `companies.csv`：公司资料、官网、原站链接和抓取状态。
- `recruitment-links.csv`：岗位、公司、城市线索与完整招聘原站 URL。
- `jobs.jsonl`：岗位列表的结构化记录。`description=null` 表示未抓该岗位详情，不能称作完整 JD。
- `job-details/`：历史上按需抓取的少量站内岗位详情，不属于公司资产完整性门槛；当前默认不再扩抓。
- `summary.json`、`failures.json`、`position-count-discrepancies.json`：覆盖量、失败记录及前后接口数量差异。
- `lists/`、`companies/`、`positions/`：带抓取时间、请求和响应摘要的原始证据，留在本地 artifacts。
- `asset-manifest.json`：核心原始响应与导出文件的逐文件 SHA256、大小和总聚合哈希，用于证明本地快照未被静默改写。
- `traversal-audit.json`：目录页、公司详情和职位列表之间的 ID 闭环、字段结构及异常清单。只有 `verdict=complete` 才能称公司目录与职位列表已经完整遍历；历史职位详情只作观察项，不参与完整性判定。

## 官方来源准入

公司及接口维护允许独立的 `verified_public_list_only` 状态：当前已为 Jobs2Web 和 AJINGA 提供匿名公开列表采集器，并独立核对大陆地点。准入须核实招聘主体，并保存全部列表请求、响应哈希及分页收敛证据。该状态的完整 JD 样本数必须为 0，岗位招聘方向保持未知；普通完整采集会显示 `partial`，只有显式列表模式可以报告列表完成。不能把公开 HTML 列表描述成 JSON API，也不能借此绕过已有完整 JD 或零岗位 API 的验收规则。

`assets/public-career-hosts.json` 保存已观察到的公共招聘站点模板；`enrich-waiqi-interface-candidates.mjs` 可对历史“已发现招聘入口但未识别 ATS”的队列继续跟进最多五个公司/招聘页面，支持断点复用，结果留在本地 artifacts。平台线索仍需接口及主体复核。

国际 ATS 与国内 ATS 的人工归属、正文语义及行业复核记录保存在本地 artifacts，不随分发仓库提交。完整 API JD 的样本验证不等于全部岗位或全部招聘方向已取全；精确地点枚举配置也可能漏掉未来新增地点。

零岗位来源先由 `source-discovery.mjs` 标记为 `verified_api_zero_jobs_pending_identity`，此状态只说明实际官方列表 API 在新匿名会话中返回了结构正确的空列表，不能直接入库。人工核对官方门户名称、API 组织字段和集团归属后，准备审查清单，再运行：

```sh
node shared/job-search-core/scripts/prepare-waiqi-zero-api.mjs reviews.json campus-job-fit/artifacts/waiqi-2026-09-20/official-zero-api-verification
```

`reviews.json` 每项需给出 `source_file`、`result_file`、`official_name`、`company_id`、`industry_tags`、`identity_verified: true`、`identity_basis` 和已存在的 `identity_evidence_file`；未知平台还需人工给出已核对的 `list_items_path`。打包器会重新读取 API 原始证据，只让完整收敛、岗位数为 0、带稳定 JSON 列表路径的匿名请求进入 `admitted.json`。正式合并仍需单独运行集成脚本。零岗位状态不构成招聘方向或城市证据，因此不向城市索引播种。

官网批量发现完成后，先运行能力审计：

```sh
node shared/job-search-core/scripts/audit-waiqi-official-discovery.mjs campus-job-fit/artifacts/waiqi-2026-09-20/zero-position-official-discovery
```

审计按正式合并器的 `sourceKey` 去重，并生成 `capability-review/identity-review-template.json`。列表返回正数岗位但没有明确完整 JD 样本的来源进入 `positive-list-only-pending.json`，不能借用“列表 API 可用”身份入库；真实空列表进入 `zero-api-identity-review.json`。自动发现的官网链和名称命中永远只是身份线索。若 API 返回的雇主与 Waiqi 公司不同，例如 Andreessen Horowitz 的投资组合招聘页跳到 Carta，则标记主体冲突并阻止以原 Waiqi 公司身份准入。

复核产物确认后，按 `sourceKey`、人工指定的已有 `company_id`、主体分组和已存在的同一 API 配置做增量合并。不得使用模糊名称自动合并，也不得把未经复核的候选直接复制到正式来源库。合并时保留现有公司 ID 与配置，并在本地 artifacts 备份合并前来源库；重复执行不能加入重复配置。

合并后先运行 `seed-waiqi-city-index.mjs --apply`，让三个方向的城市索引包含全部新增主体，并从官方岗位样本补充城市证据；再运行 `seed-missing-company-tags.mjs --apply`，只给新增主体补齐规模、性质、业务和简介的待核实占位，已有事实逐项保留。随后运行 `tag-waiqi-ownership.mjs --apply`，再刷新 `refresh-registry-metadata.mjs` 和 `campus-job-fit/scripts/render-industry-index.mjs`。这些命令均从仓库根目录执行，共享脚本位于 `shared/job-search-core/scripts/`。

Oracle Recruiting 同一租户常同时暴露 `CX`、`CX_1`、`CX_1001` 等多个站点路径。若匿名列表的总量、岗位 ID 和样本正文证明这些路径返回同一库存，只保留一个已核验的代表配置，避免重复抓取和重复展示；审计中的其他路径记为同库存入口别名。只有列表集合或招聘方向确实不同的站点才分别注册。Waiqi 把旧主体、错误主体或同一租户下的无关公司指向同一链接时，必须保留为主体冲突，不能为了提高覆盖数字强行合并。

抓取完成后再次导出，在本地生成抓取报告、正式接入来源 CSV 与招聘域名汇总。检查 `failures.json` 和岗位数量差异，并运行 `node --test campus-job-fit/scripts/tests/*.test.mjs` 验证正式库和各索引的一致性。
