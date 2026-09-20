# 共享来源与标签维护

三个 skill 共用 assets/sources.json、采集实现及公司业务、性质、规模资料。城市索引、招聘方向证明和个人运行分别归属对应 skill。日常匹配读取已保存资料，不自动启动全库维护。

用户要求扩容或修复时，先阅读 [来源准入与主体核验](../../../campus-job-fit/references/source-maintenance.md)。新来源须有真实 API 完整 JD、稳定岗位 ID、具体链接、主体依据、验证日期和分页范围。暂时没有目标方向岗位与来源无法访问是不同状态，不据此停用来源。

公司性质优先采用旧库供应商的结构化性质字段。运行 `scripts/tag-supplier-ownership.mjs` 预览，确认后用 `--apply` 全量刷新；“民营企业”“央国企”“外企”分别映射为私企、国企、外企，互相冲突的多选保留待核实，无法映射的事业单位或混合性质保持原记录。该脚本同步重算公司规模派生数据，并保留被覆盖结论的历史。

外企候选入口另存于 `assets/waiqi-source-candidates.json`，由 Waiqi 公开公司页及招聘链接形成线索库。维护时用 `scripts/source-candidates.mjs` 查询与导出，具体命令见 [Waiqi 候选查询](../../../campus-job-fit/references/source-maintenance.md#waiqi-候选查询)，采集与证据说明见 [Waiqi 来源维护](waiqi-sources.md)。没有供应商明确结论时，Waiqi 公司详情明确标注“外企”可用 `scripts/tag-waiqi-ownership.mjs --apply` 更新已可靠关联的维护主体；脚本会跳过已有供应商权威结论。“合资”、仅目录收录和待审核的同租户提示不参与 Waiqi 打标。招聘来源仍须完成接口能力与主体核验后再纳入正式来源。

新增 Waiqi 发现并经官网核验的来源后，可离线补种三个招聘方向的城市索引：从仓库根目录运行 `node shared/job-search-core/scripts/seed-waiqi-city-index.mjs`。默认仅在本轮 `city-seed/` 生成计划、三方向补丁及官方 JD 证据汇总，不改现有索引；可用 `--input=` 指定该轮存有官方 admitted 清单的归档目录。来源正式合并后加 `--apply` 才将最小增量写入索引，并保留旧索引备份。补种复用日常招聘类型审查、目标 API 证据核对、城市规范化和跨入口冲突规则，仅使用官方开放岗位，不采用第三方城市提示。此为历史样本补充，覆盖始终标为 partial，保留旧城市；没有已证实招聘类型或地点的方向保持空或 unknown，不能宣称已完成全量城市刷新。

全库城市刷新：从仓库根目录运行 node campus-job-fit/scripts/refresh-all-city-tags.mjs --mode=campus --concurrency=2；mode 也可为 internship、social。按配置指纹续跑，--retry=true 重试非完整结果。不要同时对三个方向启动密集刷新；共享 ATS 平台也可能按 IP 限流，分租户并发限制不等于整个平台限速。

每家公司默认最多 180 次请求和 60 秒，Workday/SmartRecruiters 最多补取 20 个详情用于确认岗位类型。未取全时记部分覆盖；失败和部分采集保留历史城市。原始结果留在 artifacts，索引只保留摘要及少量地点例证。维护前确认 Python 等必要依赖可用。

更新共享库后，可运行 node shared/job-search-core/scripts/refresh-registry-metadata.mjs 刷新派生摘要；运行直接读取共享库，不依赖复制。node campus-job-fit/scripts/render-industry-index.mjs 更新可阅读的公司索引。

员工规模、关键词能力和修复边界分别见 [规模模型](company-size-model.md)、[定向检索](targeted-search.md)、[接口修复](source-repair.md)。资料有缺口时保留待核实。只保存公开事实和非敏感的接口配置，不将个人登录态或内部调研表作为公开依赖。
