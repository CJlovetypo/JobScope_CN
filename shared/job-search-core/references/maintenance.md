# 共享来源与标签维护

三个 skill 共用 assets/sources.json、采集实现及公司业务、性质、规模资料。城市索引、招聘方向证明和个人运行分别归属对应 skill。日常匹配读取已保存资料，不自动启动全库维护。

用户要求扩容或修复时，先阅读 [来源准入与主体核验](../../../campus-job-fit/references/source-maintenance.md)。新来源须有真实 API 完整 JD、稳定岗位 ID、具体链接、主体依据、验证日期和分页范围。暂时没有目标方向岗位与来源无法访问是不同状态，不据此停用来源。

全库城市刷新：从仓库根目录运行 node campus-job-fit/scripts/refresh-all-city-tags.mjs --mode=campus --concurrency=2；mode 也可为 internship、social。按配置指纹续跑，--retry=true 重试非完整结果。不要同时对三个方向启动密集刷新；共享 ATS 平台也可能按 IP 限流，分租户并发限制不等于整个平台限速。

每家公司默认最多 180 次请求和 60 秒，Workday/SmartRecruiters 最多补取 20 个详情用于确认岗位类型。未取全时记部分覆盖；失败和部分采集保留历史城市。原始结果留在 artifacts，索引只保留摘要及少量地点例证。维护前确认 Python 等必要依赖可用。

更新共享库后，可运行 node shared/job-search-core/scripts/refresh-registry-metadata.mjs 刷新派生摘要；运行直接读取共享库，不依赖复制。node campus-job-fit/scripts/render-industry-index.mjs 更新可阅读的公司索引。

员工规模、关键词能力和修复边界分别见 [规模模型](company-size-model.md)、[定向检索](targeted-search.md)、[接口修复](source-repair.md)。资料有缺口时保留待核实。只保存公开事实和非敏感的接口配置，不将个人登录态或内部调研表作为公开依赖。
