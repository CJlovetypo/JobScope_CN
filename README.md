# Job Search Skill Pack

根据简历、经历和求职倾向，从已收录公司的公开招聘接口查找岗位，逐岗阅读完整 JD，给出匹配理由、主要缺口、投递建议和具体岗位链接。

## 三个入口，一套来源

| 招聘方向 | Skill | 需要补充的信息 |
| --- | --- | --- |
| 应届正式校招 | [campus-job-fit](campus-job-fit/SKILL.md) | 学历、毕业时间 |
| 实习 | [internship-job-fit](internship-job-fit/SKILL.md) | 在校状态、可开始日期、每周天数、持续月数 |
| 社招 | [social-job-fit](social-job-fit/SKILL.md) | 工作年限、责任与成果，以及明确的到岗和薪资偏好 |

三个 skill 共用 [API 来源库](shared/job-search-core/assets/sources.json)、采集器和公司事实资料；各自保存方向规则、城市缓存、画像与报告。请保留整个仓库的相对目录，单独复制一个 skill 不能运行。

截至 2026-09-19，共收录 **2,413 个招聘主体、3,069 个 API 配置**，覆盖科技、制造、金融、医疗、消费、服务业等 19 个行业宽类。跨行业公司只处理一次。查看 [行业公司索引](campus-job-fit/data/行业公司索引.md)。

## 使用方式

向支持本仓库 skill 的 Agent 提供材料，用自然语言说明目标：

> 使用 campus-job-fit。这是我的简历，我是 2027 届硕士，选择互联网和智能硬件，偏好上海的项目管理岗位。请先展示岗位覆盖情况，再确认评估范围。

> 使用 internship-job-fit，找上海的产品运营实习。我每周能到岗四天，可以持续六个月。

> 使用 social-job-fit。我有三年销售经验，想找房地产销售相关工作，请使用快速定向模式，先说明候选公司和岗位标题关键词。

流程为：整理个人材料 → 选择行业和城市 → 采集并展示范围 → 确认评估范围 → 逐岗全文评估 → 交付 Excel。用户已经明确的条件和范围直接沿用，不重复确认。

默认遍历入选来源的全部可访问岗位。明确选择定向模式时，先判断相关业务与公司，扩展标题近义词，再评估命中的完整 JD；速度可能更快，也可能漏掉标题没有体现的机会。未证明原生关键词能力的接口使用本地标题筛选，具体策略与限制保留在报告中。

城市按用户明确的条件筛选；业务倾向用于优先级和岗位意愿判断。研发、产品、设计、销售、HR、财务等职能均可纳入，能力匹配和求职意愿分别评价。公司规模是有证据的组织事实，不替代个人匹配判断。

## 输出

一份含四个工作表的 Excel：

| 工作表 | 内容 |
| --- | --- |
| 岗位匹配 | 投递建议、能力与意愿、硬性条件、详细理由和 JD 链接 |
| 待核实与未评估 | 正文、类型、地点待确认，或尚未完成评估的岗位 |
| 公司简介 | 公司业务、规模与资本资料，保留资料日期和来源 |
| 来源覆盖 | 采集及评估范围、失败原因、分页限制和资料缺口 |

“完整评估”指用户确认范围内、当次能取得完整资料的目标岗位，不代表全市场覆盖。工具不会自动投递，也不承诺面试或录用。

## 时效与失败

来源曾经通过验证，表示在记录日期成功取得过完整 API JD，不代表接口持续在线，也不代表所有招聘方向此刻都有岗位。批量运行可能遇到限流、超时、连接失败、响应结构变化或本地依赖问题；这些是本轮采集状态，不能解释为公司没有招聘。

正常空列表、部分分页、待核实与采集失败分别记录。来源保持启用；部分结果和失败不删除已有城市。自修复只在身份、招聘方向及完整 JD 都通过验证后采用新配置，并保存历史；具体 [修复范围](shared/job-search-core/references/source-repair.md) 有明确限制。

## 安装与验证

目录布局：

```text
job-search-skill-pack/
  campus-job-fit/
  internship-job-fit/
  social-job-fit/
  shared/job-search-core/
  README.md
```

- Node.js 22+：采集和校验使用原生模块。
- Python 3：简历提取和少量公开 API；PDF 提取需要 pypdf。必要时用 CAMPUS_JOB_FIT_PYTHON 指定实际 Python 可执行文件。
- Excel 导出：需要 Codex 提供的 @oai/artifact-tool；通过 load_workspace_dependencies 定位依赖，或设置 CODEX_NODE_MODULES。

在仓库根目录执行：

```sh
node --test campus-job-fit/scripts/tests/*.test.mjs
node campus-job-fit/scripts/campus.mjs industries
node internship-job-fit/scripts/jobs.mjs industries
node social-job-fit/scripts/jobs.mjs industries
```

详细 [运行与数据约定](campus-job-fit/references/workflow.md)、[维护说明](shared/job-search-core/references/maintenance.md)、[定向检索](shared/job-search-core/references/targeted-search.md) 和 [规模模型](shared/job-search-core/references/company-size-model.md)。第三方来源许可见 [job-pro-LICENSE.txt](shared/job-search-core/assets/job-pro-LICENSE.txt)。

## 数据与隐私

仓库只分发三个 skill、共享运行代码、必要的公司与接口数据、使用文档及回归测试。简历、个人画像、报告、原始抓取记录、历史调研和内部过程文档留在本地。运行产物存放在对应 skill 的 runs、outputs、artifacts 等目录；这些目录由 .gitignore 排除。
