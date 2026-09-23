# 校招差异规则

新评估先读[判断模型v5](../assessment-v5.md)：缺证unknown可以交付，城市/薪资参考/证据充分性单列，关键未知无冲突用clarify。

招聘方向 campus，正式状态 formal；已明确校招不再问方向。有依据的判断需学历、毕业时间及实际项目/经历，缺项按v5保留不确定而非不符；文字材料足够时不再索要简历文件。仅岗位发现不要求这些画像字段。

单岗校招类型/项目关联证据可确认正式校招，不额外强求全职字段。校招中的提前实习仍属校招，保留起始时间、天数、时长、地点及用户可用性；正文出现实习不自动排除。普通实习、社招、兼职、校园大使、训练营和博士后不作为普通正式校招。全职/公司校园门户本身不足以确认单岗类型；冲突留待核实。

v5资格分别核对届别、学历与专业；项目能力不能抵消明确门槛。其他影响投递的提前实习、专业和轮岗限制完整解释，不因未进入资格列而遗漏。无社保不是统一应届资格证明；海外毕业和相对时间以具体JD窗口判断。

正式评估时读取：[能力模型](../../../../job-search/runtime/campus/references/ability-model.md)、[评估结构](../../../../job-search/runtime/campus/references/assessment.md)、[命令与数据](../../../../job-search/runtime/campus/references/workflow.md)。统一执行入口为 `node job-search/scripts/jobs.mjs <命令> --mode campus`，运行和输出保存在 `job-search/runtime/campus` 内。
