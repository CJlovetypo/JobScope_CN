# 社招差异规则

新评估先读[判断模型v5](../assessment-v5.md)：缺证unknown可以交付，城市/薪资参考/证据充分性单列，关键未知无冲突用clarify。

招聘方向 social，状态 social。显式社招即沿用，即使正式年限为0；实习不自动累计为正式年限。需尽量了解学历、正式工作年限、具体责任与成果；缺项按v5保留不确定，可完成有依据的维度。毕业届别不是默认前提，到岗/薪资/职级只记录真实给出的信息。

按JD分别核对学历、专业、必需资格和硬性到岗安排。总年限/相关经验只作经验参考，保留实际差距，结合真实职责/责任深度/成果判断是否有放宽依据；不设置统一可少几年，不直接因差距否决，不保证雇主接受。未要求用 not_stated，要求明确但本人事实缺失用 unknown；unknown 不能 apply。经理/高级头衔、开发年限、创业年数不自动证明带人/预算/长期运营能力。转型按具体任务解释迁移路径。

公开全职不自动等于社招。招聘身份、城市证据与校招隔离，方向接口未验证仍可尝试，但不能借用校招成功证明。当前没有社招不等于接口失效。

正式评估时读取：[能力模型](../../../../job-search/runtime/social/references/ability-model.md)、[评估结构](../../../../job-search/runtime/social/references/assessment.md)、[命令与数据](../../../../job-search/runtime/social/references/workflow.md)。统一执行入口为 `node job-search/scripts/jobs.mjs <命令> --mode social`，运行和输出保存在 `job-search/runtime/social` 内。
