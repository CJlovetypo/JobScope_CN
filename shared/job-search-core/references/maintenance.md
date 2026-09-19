# 共享来源与标签维护

产品需求见仓库根目录 `PRD.md`。日常求职不运行全库维护。

用户明确要求扩容飞书来源时，在仓库根目录运行 `internet-campus-job-fit/scripts/import-feishu-source-candidates.mjs`。脚本只读用户指定视图，分页直至结束；原始表格、链接和记录关系保存在校招 skill 的 artifacts，不能整批发布原始飞书内容。

`verify-feishu-candidates.mjs` 对识别到的 ATS、Workday 候选去重、请求列表及完整 JD，保存逐配置响应。`admit-feishu-sources.mjs` 的身份决定表是本次人工复核记录，不能把它当成通用公司名自动推断；新的来源必须补充独立身份依据。其他平台、微信及尚未恢复的接口保留候选，不能标为永久不可用。

城市刷新：`node internet-campus-job-fit/scripts/refresh-all-city-tags.mjs --mode=campus --concurrency=8`，mode 可为 internship、social。按配置指纹续跑；`--retry=true` 重试非完整结果。每家公司请求最多 180 次、60 秒，Workday/SmartRecruiters 最多补取 20 个详情用于确认岗位类型。预算未穷尽全部岗位时标部分；失败和部分采集保留旧城市。全量原始证据在 artifacts，索引只保留每城至多两条岗位例证和统计，避免日常读取数百 MB。

员工规模模型、关键词能力和修复边界分别见 [规模模型](company-size-model.md)、[定向检索](targeted-search.md)、[接口修复](source-repair.md)。资料有缺口时保留待核实，不把模型存在当作所有公司都已有足够证据。
