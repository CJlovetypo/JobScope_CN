# 业务决策行为验收

输入来自仓库 `docs/用户提示词模拟100例.md`。人物和经历为合成材料；任何运行测试均为 is_test。该集主要检验首轮意图理解和下一步计划，不含真实附件、实时JD、实际简历、调度成功结果或外部发送权限。

## 本轮证据

- inputs：首轮独立执行者收到的原始批次。只含提示词、场景标题和给定上下文，没有观察点。标题不属于用户原话；交叉复核和定向复测明确忽略标题。
- results：三位独立执行者的100条实际模拟首答、已知条件、问题和可推进动作。它们不是生产 task.json，未解析的公司名/行业可保留自然语言。
- reviews：不同执行者按原文、上下文及观察点交叉验收，区分实现/执行错误和规则缺失。既有规则优先，不把观察点理解成要求一轮问全。
- retests：缺陷及歧义场景按更新后的规则重新执行；原结果不覆盖。
- final-cases.json / 100例验收明细.md：合并结果与复核证据的派生报告。

程序只能检查证据完整性和汇总已记录的评审，不会用关键词匹配或预设答案自动给语义判断打“通过”。模型交叉评审仍可能遗漏问题；100例通过不代表所有自然语言输入或全部线上流程均通过。

```sh
# 汇总已经实际执行并独立评审的行为结果；不会重新执行Agent
node shared/job-search-core/evals/report.mjs

# 导出下轮纯原话输入到新目录，不含标题或观察点，已有文件不覆盖
node shared/job-search-core/evals/report.mjs extract --out job-search/artifacts/next-eval-inputs

# 确定性执行回归（Excel需 CODEX_NODE_MODULES 指向可用依赖）
node --test campus-job-fit/scripts/tests/*.test.mjs job-radar/scripts/tests/radar.test.mjs recruitment-link-repair/scripts/history.test.mjs
```

后续复跑需让独立执行者读取新输入和Skill，保存真实结果后再交叉评审；仅执行 report.mjs 不是重新测试。要增加业务规则，先取得用户审核；按既有规则修正代码/执行错误可继续进行。
