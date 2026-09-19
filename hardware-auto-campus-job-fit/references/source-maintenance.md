# 来源维护

## 文件与状态

- `assets/sources.json`：可用公司及其一个或多个公开接口配置。每家公司按 `company_id` 去重；`recruitment_sources` 保存多个入口，不能将不同公司的 JD 混入同一主体。
- `data/candidate-ledger.json`：全部本轮候选、别名映射及实际核验结论。`verified_api_full_jd` 表示至少一条完整 JD 的接口能力已实测；其他状态不进入运行名单。
- `data/公司范围与接口核验.md`：供人检查的分类清单，包含官方入口、API、示例 JD、数量、覆盖限制。
- `artifacts/source-validation/`：当次开发证据，不是运行依赖；旧入口、失败响应及修复前结果保留。

不同招聘主体可能属于同一集团，因此清单数量不能表述为独立企业集团数量。固定名单也不代表全市场穷尽。

## 使用固定来源名单

从项目根目录运行以下命令。也可直接用自然语言指定公司，由 skill 执行者代为运行。

```powershell
node hardware-auto-campus-job-fit/scripts/sources.mjs list
node hardware-auto-campus-job-fit/scripts/sources.mjs collect --company=美的集团
```

`collect` 会顺序访问该主体保存的全部 API 配置，按公司、平台和岗位 ID 合并结果。默认写入本 skill 的 `artifacts/runs/时间/公司ID/`。`--out=目录` 可指定本 skill 内的目录；`--max-pages=1` 可做受限烟测，但不能把受限结果当成全量。采集保留完整正文、原始接口响应、正式／实习／社招／待核实分类及每个来源的覆盖状态。某个来源失败不阻止继续查询其他来源。

首次验证的结果在 `data/verification-index.json` 指向的证据目录；它是建库快照，运行时仍应刷新所选公司，不把历史快照宣称为实时招聘。`formal_cities` 和 `all_observed_cities` 尚属城市索引原料，未实现用户画像硬筛选。

## 通用平台发现与验证

Node.js 22+，使用原生模块。候选文件是数组，每项至少包含 `display_name`、`category`、`entry_urls`。可选 `company_id` 和已核实的 `provider`。自然语言用户不需要自己编辑 JSON，由执行者整理。

```powershell
node hardware-auto-campus-job-fit/scripts/discover-and-verify.mjs <候选JSON> <本skill内证据目录> --concurrency=3 --max-pages=100
```

默认续跑已存在的单公司 `verification.json`，强制重测使用 `--refresh`。达到 `max-pages` 而未核对总数时必须为部分覆盖。公开校园接口暂无完整 JD 时，可单独探测公开全类型接口以证明能力，并保存 `capability_result_file`，不得混入校园岗位数量。

只从已观察入口与当前官方页面发现租户。北森自定义域应保留原域，静态资源域 `portal-oss.zhiye.com` 不是招聘租户；大易可通过官网公开 `getSLD` 配置取得 SU；飞书应区分租户与当前 `website-path`，校园查询 `201` 与全类型空数组不能互相冒充。Moka 公开初始化配置可能包含响应解码参数，旧页面关闭不等于整个公司的 API 不可用。

旧链接携带 `queryId`、`c2` 等组织筛选时，必须验证这些条件实际作用于接口。子公司链接返回全集团时，先核对接口 `Org`、`OrgId`、`ClassificationTwo`；不能将全集团岗位挂在子公司名下。没有证明正确筛选时暂不准入。当前待核实的实例见公司审查清单。

## 国际平台

Workday 使用当前匿名列表响应中的国家 facet 发现中国筛选 ID，不能把任何公司的固定国家 ID 套到另一公司。详情也要核对国家。SmartRecruiters 使用列表返回的详情 API `ref` 和官方职位页 `postingUrl`。只读取在华范围，不把全球结果数量标成在华岗位数。

## 原始证据与内容完整性

原始 API 响应中的职责和要求可以是 HTML 字符串；这是结构化 API 正文字段，与从页面 HTML 抓取 JD 不同。规范化结果要保留 `raw_file` 与对应请求，公开解码的响应同时保留原始文件。个人鉴权信息不得写入配置。

程序识别不了职责与要求的分段时，保留全文并标待核实。确需修正时，完整阅读当次正文，保存独立的重新解析结果与依据；不能仅把 `body_complete` 改成 `true`。缺失正文与完整正文尚未完成分段应分别解释。

## 下一阶段边界

来源确认之后再接入简历画像、已保存城市硬筛选、业务偏好软排序和个人岗位评估。个人匹配沿用当前互联网版的 Excel 交付规范；本阶段 Markdown 是来源审查清单，不是对旧版匹配输出格式的回退。
