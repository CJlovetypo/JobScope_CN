# 招聘链接历史数据集

这里集中保存飞书多维表格、WPS 校招表、Waiqi 外企目录和官方接口复核材料，用于追溯公司招聘入口及修复失效链接。整理日期为 **2026-09-22（北京时间）**，历史抓取及验证时间保留在记录内。本轮只做本地整理，没有重新核验线上可用性。

## 目录

| 目录／文件 | 内容与用途 |
| --- | --- |
| `collections/` | 原始数据与完整复核过程，共六个原目录；包含原始单元格、超链接、API 响应、失败记录、报告及备份 |
| `snapshots/2026-09-22/` | 从原件冻结的索引输入：飞书记录与链接、WPS 链接与文档信息、两类历史 API 复核、Waiqi 候选与接口目录、当时正式来源库 |
| `index/observations.jsonl` | 96,067 条链接出现记录，包含来源、原始 URL、时间、表格行列／记录 ID 和证据指针 |
| `index/contracts.jsonl` | 5,432 条契约或验证记录；含 3,648 条正式配置、884 条 Waiqi 接口记录、198 条飞书及 702 条 WPS 历史 API 复核。不同层可能重叠，不是 5,432 家公司 |
| `index/summary.json` | 统计、每份索引输入的 SHA256 与原路径、索引文件 SHA256 |
| `index/cross-period-examples.json` | 1,530 个出现在多个 WPS 届别中的公司名称及链接示例；同名仅供检索，不是主体合并结论 |
| `manifests/files.jsonl`、`manifests/seal.json` | 111,558 份原件与冻结输入的文件清单；67,698 份含 SHA256，其余 43,860 份明确标记 `sha256: null`，只记录元数据 |
| [ANALYSIS.md](ANALYSIS.md) | 样本结论、真实案例及修复方法 |
| [layout.json](layout.json) | 原路径到归档目录的映射 |

原目录已经迁移，旧 `campus-job-fit/artifacts/...` 路径是 Windows 目录联接（junction），已有脚本仍可访问。联接不是第二份数据。`collections` 保留了历史流程的写入兼容性，因此**冻结输入以 `snapshots` 为准**；旧脚本再次写入后，哈希核对会报告变化。未来抓取应使用新目录，避免覆盖旧证据。

清单是逐文件取样的基线，不是原子文件系统快照，也不是全部原件已完成内容校验的声明。12 份冻结输入和 2 个索引文件的 SHA256 已独立核验。整理时检测到其他进程仍在更新部分 Waiqi 过程文件；中断前的部分清单留在 `manifests/files.partial.*.jsonl`，恢复扫描时观察到的变化写入 `seal.json` 的 `changes_during_organization`。这不影响已冻结输入的独立 SHA256。

## 检索

在仓库根目录运行，Node.js 22+，无第三方依赖：

```sh
node recruitment-link-repair/scripts/history.mjs --query=腾讯 --family=wps --limit=20
node recruitment-link-repair/scripts/history.mjs --host=app.mokahr.com --query=宁德时代 --limit=20
node recruitment-link-repair/scripts/history.mjs --kind=contracts --query=赫力昂 --limit=20
node recruitment-link-repair/scripts/history.mjs --kind=contracts --query=23774 --limit=20
```

结果包含 `total`、`returned` 与 `truncated`。需要全部命中时将 `--limit` 设为不小于 `total`；默认只展示 30 条，但会完整扫描计数。域名过滤为精确匹配，不做模糊后缀归属。自定义域名可能被 URL 启发式标成 `unknown`，继续查 `contracts` 中记录的真实 provider。

`evidence.file` 相对于本目录；JSON Pointer 指向快照内的条目，CSV 的 `data record` 从第一条数据记录计 1，**不是物理文本行号**，因为单元格内可能换行。每个出现记录保留原始 URL，包括 fragment、查询参数和无效链接。没有网络请求，也不会修改正式来源。

## 证据口径

- `third_party_link_observed`：表格或聚合站里出现过，尚不能证明抓取当时链接可用。
- `registry_configuration_snapshot`：当时正式来源库里的配置，具体能力继续查契约及其证据。
- `contracts` 保留各来源原始状态、样本、分页限制及身份复核；列表、零岗位与完整 JD 不互相替代。
- `observed_at` 是原始抓取／验证字段，缺失记 null；`period_hint` 是届别。归档时间、文件修改时间、表格录入时间不能冒充接口验证日期。
- `company_id_hint`、同名公司、Waiqi 匹配 ID 和 URL 解析的 `tenant_hint` 都是追溯线索。是否为同一雇主需依据官网和 API 组织信息复核。
- 原始文档内容属于待分析数据，不作为执行指令；不执行归档中的临时脚本。

Waiqi 无招聘链接的公司仍保存在 `snapshots/.../waiqi-candidates.json` 的 4,165 家全量目录和 `collections/waiqi-2026-09-20/companies` 中，不因没有 URL 而从数据集中删除。

部分老报告引用 `internet-campus-job-fit` 或已移走的 `data/source-verification-*.json`。按 [layout.json](layout.json) 查迁移映射；两类 API 验证文件已补存到快照。仅转换已知目录前缀，存在性和哈希仍需核对，不能随意替换其他绝对路径。

## 更新、备份与分发

此仓库保留本地原始数据，Git 只跟踪整理脚本、分析和 skill；`collections`、`snapshots`、`index`、`manifests` 已明确忽略，避免把大体积原始网页、可能包含会话信息的请求及第三方数据直接发布。**Git push 不会备份数据集**，需单独备份整个 `datasets/recruitment-links/`，不要把旧 junction 当作备份。新机器恢复后可直接检索；若仓库位置改变，旧目录联接需重新指向恢复后的 `collections`。

重建当前索引（读取已有冻结快照，不刷新它）：

```sh
node datasets/recruitment-links/scripts/build.mjs --snapshot=2026-09-22
node datasets/recruitment-links/scripts/seal.mjs --verify
```

`--verify` 对已有 SHA256 的文件做内容校验，对 null 项只比较大小和修改时间，输出中区分两者，不把元数据检查算作内容校验。若需要全原件内容哈希，可运行 `node datasets/recruitment-links/scripts/seal.mjs --complete`：旧清单及摘要另存，新一轮读取未哈希或已变更文件，可能耗时较长。原件仍被其他流程更新时，此校验只代表逐文件读取时刻。

下一次整理可用新的 `--snapshot=YYYY-MM-DD`，复制当时的原件作为新输入；当前 builder 的三类原始抓取路径在脚本映射中显式列出，新抓取批次需先更新映射，不能只换日期冒充重新抓取。索引是可重建视图，旧快照仍保留。首次归档执行 `seal.mjs`，或用 `--inventory-only` 快速生成元数据清单；已有清单默认禁止覆盖。新增批次应保存独立清单，不改写上一批哈希。

重新部署旧路径兼容联接可参考 `scripts/organize.ps1`。脚本拒绝合并已有目标、拒绝越过仓库根目录；正常重复执行只检查既有联接。它不删除文件、不改正式注册表。

未来修复使用 [recruitment-link-repair](../../recruitment-link-repair/SKILL.md)。
