# Waiqi 公司与招聘来源

入口：https://waiqi.com/company 。目录默认是北京；采集使用全国筛选，不把首页当作全部公司。

`assets/waiqi-source-candidates.json` 保存公司原名、别名、网站简介、官网、行业／性质／规模／城市线索及招聘原站链接。公司详情明确标注“外企”时，按本项目维护规则作为外企性质依据；“合资”不映射为外企，规模和城市字段仍只作线索。`matched_company_ids` 中只有精确标准名可直接参与性质关联；普通招聘租户关联可能涉及不同子公司，不能单独构成主体合并或性质打标依据。

## 外企性质打标

`data/waiqi-foreign-company-index.json` 保存完整 4,155 家目录快照的性质索引，明确区分“外企”和“合资”。一键打标只接受精确标准名、正式招聘来源中记录的具体 Waiqi 公司 ID，以及已清洗的严格招聘上下文。先预览，再应用：

```sh
node shared/job-search-core/scripts/tag-waiqi-ownership.mjs
node shared/job-search-core/scripts/tag-waiqi-ownership.mjs --apply
```

执行结果、命中清单、被覆盖的旧结论和备份保存在 `campus-job-fit/artifacts/waiqi-2026-09-20/waiqi-ownership-tagging/`。旧结论写入 `prior_classification`，不丢失原理由和证据。脚本同时重算命中主体的公司规模派生标签，避免性质与规模数据不一致。

旧库供应商结构化性质字段的优先级高于 Waiqi。先运行 `tag-supplier-ownership.mjs --apply` 刷新供应商结论；后续重复运行 Waiqi 打标时，已有 `supplier_company_nature_classification` 结论会被跳过，不会被 Waiqi 覆盖。

正式 `assets/sources.json` 接收两类彼此独立的核验结果：一类是通过官方匿名 API 取得完整 JD；另一类是当前确实零岗位、但官方匿名列表 API 已返回可解析的空数组并完整收敛的来源。后者必须另有官方主体证据、JSON 列表结构、实际列表请求、响应 SHA256 和零岗位状态，不能用 Waiqi 的 `positionCount`、HTML 页面或门户能打开来替代。原站实际存在公司错译和招聘链接错配；原站名称留在 provenance，不自动成为官方主体别名。没有外部招聘链接的公司仍保留在候选库。

## 抓取及查询

从仓库根目录运行：

```sh
node shared/job-search-core/scripts/crawl-waiqi.mjs campus-job-fit/artifacts/waiqi-2026-09-20
node shared/job-search-core/scripts/export-waiqi.mjs campus-job-fit/artifacts/waiqi-2026-09-20
node shared/job-search-core/scripts/source-candidates.mjs query --query=西门子
node shared/job-search-core/scripts/source-candidates.mjs query --industry=金融 --has-recruitment
node shared/job-search-core/scripts/audit-waiqi-routing.mjs --output=campus-job-fit/artifacts/waiqi-routing-audit.json
```

同一抓取目录会复用成功响应并重试失败项；新一轮更新请使用新目录，避免把缓存日期写成重新核验时间。默认最多 3 个请求在途、请求起点至少间隔 750ms；429 会全局冷却并遵守 Retry-After。不要并行启动多个 Waiqi 抓取进程。WAIQI_CONCURRENCY 与 WAIQI_INTERVAL_MS 可降低采集负载。默认另取没有可用外部链接的站内岗位详情；WAIQI_JOB_DETAILS=all 可续抓所有岗位详情，none 跳过详情。含外部链接的岗位默认仅保存列表资料和链接，完整官网 JD 样本另存于官方核验档案。

本次观察到目录响应的 `page.size/current/pages` 与实际返回不符。以请求 page/size、实际返回 ID、去重数量及 total 核对完整性。另已证实公司详情的 `positionCount=0` 可能过期，而公司页面仍展示岗位；因此每家公司都必须实际请求 `company/position-all`，不能再用详情计数推断空列表。旧的 `company_info_reports_zero_positions` 缓存必须强制重抓后才能作为岗位覆盖统计。

公司页的“在招职位”也不是开放状态真值。实测同一页面可能同时包含重复外部岗位 ID、已经不在官方当前列表中的旧岗位、非中国岗位、通用门户链接和错配到其他雇主租户的链接。`audit-waiqi-routing.mjs` 只回答招聘链接是否能解析为 skill 已知 ATS，以及相同租户配置是否已经注册；它不会把 Waiqi 页面行数当成当前开放岗位数。是否可交付仍以官方实时列表、稳定岗位 ID、主体归属和目标地区为准。

Oracle Recruiting 链接经常不带中国区 `locationId`。这类来源由运行时按官方服务实测的 200 行窗口遍历整个站点，再只保留 `PrimaryLocationCountry=CN` 的记录；如果官方 `TotalJobsCount` 与实际唯一岗位数无法收敛，覆盖状态必须保持 `partial`，但已经明确返回的中国岗位和完整 JD 仍会保留。

导出产物：

- `companies.csv`：公司资料、官网、原站链接和抓取状态。
- `recruitment-links.csv`：岗位、公司、城市线索与完整招聘原站 URL。
- `jobs.jsonl`：岗位列表的结构化记录。`description=null` 表示未抓该岗位详情，不能称作完整 JD。
- `job-details/`：已抓取的站内岗位详情；带“请在微信打开”等前缀的链接会提取 URL 并保留原文，邮箱及其他非 URL 投递说明也会归档。
- `summary.json`、`failures.json`、`position-count-discrepancies.json`：覆盖量、失败记录及前后接口数量差异。
- `lists/`、`companies/`、`positions/`：带抓取时间、请求和响应摘要的原始证据，留在本地 artifacts。

## 官方来源准入

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
