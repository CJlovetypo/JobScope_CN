# Job Search Skill Pack

求职相关 skill 的开发与管理仓库。每个 skill 在项目根目录下独立存放说明、脚本、配置和参考资料，目录约定见 [AGENTS.md](AGENTS.md)。

## 当前实现

### campus-job-fit：校招岗位匹配

根据用户提供的简历、经历和求职倾向，采集固定公司名单中的正式校招岗位，完整阅读 JD 后分别评估能力与意愿，输出包含详细理由和 JD 链接的 Excel 工作簿。

- 通过公司城市标签筛选范围，保留业务标签、公司性质及核查依据。
- 通过公开 API 采集岗位，记录分页、失败、部分覆盖及待核实范围。
- 使用双向匹配模型与能力证据模型，支持分批评估和断点续跑。
- 输出岗位匹配、待核实与未评估、来源覆盖、JD 原文及说明工作表。

入口：[SKILL.md](campus-job-fit/SKILL.md)。命令与数据格式：[运行与数据约定](campus-job-fit/references/workflow.md)。

## 目录

```text
campus-job-fit/
  SKILL.md       # 工作流与使用规则
  agents/        # Agent 展示配置
  assets/        # 固定来源、采集配置和第三方许可
  data/          # 已维护的公司城市、业务和性质标签
  references/    # 评估模型与操作约定
  scripts/       # 采集、校验、简历提取与 Excel 导出
    tests/       # 自动化测试
```

## 开发环境与验证

- Node.js 22+；采集与校验使用原生模块，无需额外 npm 安装。
- Python 3 用于简历文本提取及部分公开 API 采集；PDF 文本提取需要 `pypdf`。
- Excel 导出依赖 Codex 附带的 `@oai/artifact-tool`。通过 `load_workspace_dependencies` 定位依赖，必要时将 `CODEX_NODE_MODULES` 指向返回的 Node.js packages 目录。

在仓库根目录执行：

```sh
node --test campus-job-fit/scripts/tests/*.test.mjs
node campus-job-fit/scripts/campus.mjs status
```

实际匹配由 agent 按 skill 说明执行，用户只需提供材料与自然语言要求。模型负责完整阅读 JD 和逐项判断，脚本负责采集、校验与报告生成。

## 本地文件与数据

Git 跟踪源码、配置、参考文档及已维护的公司标签。个人简历、画像、匹配结果、抓取原始证据、日志和临时文件保留在对应 skill 的 `runs/`、`artifacts/`、`tmp/` 等目录，由 `.gitignore` 排除。

公司标签保留原有快照日期；需要更新时按 skill 维护流程执行。历史维护脚本 `backfill-ownership-from-registry.mjs` 依赖本地 `artifacts/api-expansion-2/` 中的调查数据；这些历史产物不随仓库分发，日常匹配使用 `data/` 中已保存的标签。

第三方来源许可保留于 [job-pro-LICENSE.txt](campus-job-fit/assets/job-pro-LICENSE.txt)。
