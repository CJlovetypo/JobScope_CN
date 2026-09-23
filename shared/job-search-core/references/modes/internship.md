# 实习差异规则

新评估先读[判断模型v5](../assessment-v5.md)：缺证unknown可以交付，城市/薪资参考/证据充分性单列，关键未知无冲突用clarify。

招聘方向 internship，状态 internship。尽量了解的匹配事实（缺项按v5保留不确定，可审阅其他维度）：学历、预计毕业、在校状态、实际项目/经历、internship_availability 对象；开始日期/天数/月数尚不确定可 null，不能伪造承诺。岗位发现不要求画像完整。

每周天数、开始时间和持续月数独立记录；“应该/可能”保留情景。只有天数已明确就不再问同一天数。暑期需知道年份，不能默认最近暑期。远程为办公方式，兼职/全职为时间安排，实习身份独立；不要因实习采用兼职安排而误排除。已毕业按JD核对身份，不一概准入/否定。

校园大使、训练营、博士后不作为实习岗位；正式校招要求提前实习仍属于校招。转正机会不保证录用。实习按基础任务和学习证据评估，不要求默认资深生产规模。

正式评估时读取：[能力模型](../../../../job-search/runtime/internship/references/ability-model.md)、[评估结构](../../../../job-search/runtime/internship/references/assessment.md)、[命令与数据](../../../../job-search/runtime/internship/references/workflow.md)。统一执行入口为 `node job-search/scripts/jobs.mjs <命令> --mode internship`，运行和输出保存在 `job-search/runtime/internship` 内。
