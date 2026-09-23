# 多 agent 全文评估

以下命令以 `job-search/runtime/campus` 为工作目录，通过统一入口执行；prepare 前先按[任务契约](../../../../shared/job-search-core/references/task-contract.md)保存真实任务修订，并替换示例任务路径。

采用固定批次、单执行者、分段提交、主流程统一合并。默认最多 4 个智能体，每批最多 50 岗；以实际槽位和输入容量为准。每约 10 岗提交一次。用户要求暂停时只回收当前已派发批次，不补位。

模型仍须全文阅读每个岗位，不按标题或模板生成判断；结构通过不等于语义正确。保留代表性抽查，重点看高匹配、资格冲突及异常改判，不默认增加第二轮全量评审。

## 主流程

主 agent 是状态清单和正式 assessments 的唯一写入者；以下管理命令串行执行，不让多个智能体管理共享状态。它们不是后台服务，也不会自动启动或停止工具智能体。

1. 确认并保存用户已选范围，再运行 `batch-create`。首次领取扫描已选范围，后续使用增量状态；恢复运行先在所有旧执行者停止后运行 `batch-status --refresh`。
2. 每次领取保存独立的 `parallel/batches/<批次ID>/input.json`，含完整画像、去重的公司信息及完整 JD。返回的批次和岗位键固定不变；岗位键是 `JSON.stringify([company_id, String(job_id)])`。执行者不得读取共享 next-batch 或用数组位置关联判断。
3. 用工具启动一个智能体，把固定输入路径和独占目录交给它；随后主 agent 用 `batch-start --agent <真实ID>` 记录归属，并告知执行者提交时使用该 ID。派发失败时直接关闭尚无执行者的空批次。
4. 执行者完整读取本批画像及统一入口 `../../SKILL.md`、本方向 assessment.md、ability-model.md；只填写自己的 `result-template.json` 中判断内容。可拆为多份草稿，每份包含完整岗位，按岗位键提交，不能改变模板身份。每约 10 岗调用一次 `batch-submit`。
5. 主 agent 收到分段提交或完成通知后调用 `batch-merge`。程序统一校验并按公司合并；主流程只读取简短统计和需要抽查的结果，不反复打印整批 JSON。
6. 完成时先合并，再用工具关闭智能体；工具确认停止后调用 `batch-close --agent <ID> --stopped`。正常续跑可立即领取下一批，无需等其他批次一起结束。

命令示例（运行目录和 ID 使用实际返回值）：

```bash
node ../../scripts/jobs.mjs batch-create --mode campus --run runs/本轮 --limit 50
node ../../scripts/jobs.mjs batch-start --mode campus --run runs/本轮 --batch 批次ID --agent 执行者ID
# 执行者提交自己写好的草稿，成功项独立保存，错误项一次返回问题列表
node ../../scripts/jobs.mjs batch-submit --mode campus --run runs/本轮 --batch 批次ID --agent 执行者ID --file runs/本轮/parallel/batches/批次ID/draft-01.json
# 主 agent 串行合并
node ../../scripts/jobs.mjs batch-merge --mode campus --run runs/本轮 --batch 批次ID
# 先通过工具关闭执行者，再登记关闭；可附其本地会话日志
node ../../scripts/jobs.mjs batch-close --mode campus --run runs/本轮 --batch 批次ID --agent 执行者ID --stopped --usage-log 本地会话.jsonl
node ../../scripts/jobs.mjs batch-status --mode campus --run runs/本轮
```

## 提交内容与职责

草稿为 `{"items":[{"key":"从模板原样保留的岗位键","review":{...判断字段...}}]}`。模板附岗位标题便于人读，合并只用固定岗位键。调用 submit 前必须真实完成相应岗位全文阅读。

模型填写：`review_method: "full_jd"`、ability、ability_reason、experience_relevance、interest、interest_checks、interest_reason、eligibility、eligibility_reason、next_action、conclusion、comparisons、transferable_evidence（中能力必需）、gaps、early_internship、next_step、四项 report_summary。

不填写公司 ID、岗位 ID、指纹、assessment_version、match_tier、priority。程序从固定输入绑定身份和版本，以固定矩阵组合等级；low 能力、conflict 意愿或 ineligible 资格固定 hold，hold 排序 low，其余 normal。排序理由复用 next_step；不再由模型补写“开放所以紧急”等时间理由。不推断能力、意愿，也不自动生成经历对口解释。

每份提交生成独立、原子写入的结果文件。主流程只读取提交目录中已完成的 .json，不读草稿或 .tmp。相同岗位的相同结果可安全重放，不重复计数；不同有效结果或正式记录被外部修改时拒绝覆盖。保留原文件，主 agent 回读对应 JD 裁定，不能修改已接受的提交来隐藏冲突。

## 中断和返修

- 返回错误项时只修这些岗位；已接受岗位不重写。身份与原文始终来自原 input.json。
- 单执行者优先在同一批次内完成缺项。不允许为了“覆盖25–49”重新读取正在变化的 next-batch。
- 必须换执行者时，先停止旧执行者，回收可用提交并合并，然后关闭旧批次；未合并岗位自动回到可领取集合，重新领取产生新批次和独占目录。旧批次的迟到结果不能再提交或合并。
- 若语义冲突阻止合并，保留原提交和已完成正式记录，关闭旧批次并单独调查，不用最后写入覆盖解决。
- 单写者在公司文件写入后意外中断：恢复后对未关闭批次重复 merge 即可；幂等合并补齐状态，不增加重复记录。
- 固定输入的画像或当前 JD 已变更时停止旧批次，不自动更新指纹使旧判断重新有效。运行期间不采集刷新、不改范围。
- 不扩大用户已选清单。原 next-batch 保留供兼容诊断，不能再作为并行任务输入。

## 批量和统计

`batch-create --limit` 默认 50、上限 100；`--max-chars` 默认 160000 字符，是简单容量边界，不冒充精确 token。长 JD 缩小岗位数但不截断；单岗已经超出边界会独占一批并返回 oversize，执行者分段完整阅读。并发默认 4，可按实际槽位用 --concurrency 调整。后续只在同组 JD 的实测支持下调整至 75/100。

定向返修可用 `batch-create --jobs 岗位键清单.json`，文件为已有范围内唯一岗位键的数组；只领取其中未完成项，不借此扩大范围。没有活跃批次时，用户明确扩大的范围可复用已有结果；修改画像仍另建运行。采集更新会将清单标为待刷新，下一次领取或查看状态时重建一次。

唯一状态来源为 `parallel/batches/state.json`：保存岗位状态、批次归属及准备、启动、合并、关闭事件。input.json 固定后不修改；submissions 保存不可变结果；previous 保留被新全文评估替换的原无效记录。旧 manifest 和手工 timing 不参与新调度。

`batch-status` 直接返回增量统计：done 为结构有效且已合并；pending 尚未评估，repair 待返修，in_flight 是尚未完成且已领取的子集，不能再次相加。首次扫描的历史有效记录不冒称已经语义复核。最终仍用 next-batch/render 的全量核对交付。

时间使用命令观察到的实际 ISO 时间。started_at 是工具派发后登记时间，completed_at 是全部结果合并完成时间；未完成就关闭的批次以 closed_at 为观测终点，execution_ms 包含等待与合并，不宣称纯模型计算时间。工具派发/关闭调用耗时缺少原始数据时保持未知，不事后倒推。准备输入与合并耗时单独记录。returned_valid 是已通过结构检查的唯一返回岗位数，不等于已合并或语义正确，关闭时也记录未采用的返回结果。

主 agent 在派发、关闭工具调用前后各记录实际时间，分别传给 `batch-start`、`batch-close` 的 `--tool-started-at`、`--tool-finished-at`，状态即持续保存 dispatch_ms、shutdown_ms。每次合并更新返回数量、错误与合并耗时；每次导出在 render 日志保存准备、导出、总耗时。并行批次墙钟时间有重叠，不能相加冒充端到端时长。

可在关闭时提供执行者本地会话日志：读取累计 token 的区间差值，扣除首事件继承基线；缓存属于输入、推理属于输出，不重复相加。缺失字段为 null，未提供日志为未知，不用账户额度百分比代替任务 token，也不将日志 token 直接当费用。历史记录追溯另存，不改写旧计时事实。

最终全部所选范围完成后正常 render；用户要求提前交付时才 --allow-partial。暂停时不启动下一批，不自行增加调度自动化。
