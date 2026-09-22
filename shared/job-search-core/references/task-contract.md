# 任务记录与统一命令

新匹配prepare自动使用assessment_model_version=5，evidence允许空数组，未知学历/年限不伪填；task-check的can_assess代表完整画像就绪，can_review_partial表示除画像外无阻塞时可按v5做有限判断。最终未知仍可审阅完成。城市偏好在profile.city_preference记录state/values/importance（must/prefer/open），与硬查询city_filters分开；salary_preference仅参考，不能转查询条件；同城距离需求告知不支持并忽略。

conditions.cities可附importance：must保持明确城市过滤，prefer/open仅保留偏好且city_filters为空；省略时明确城市列表按既有范围语义处理。profile.city_preference须与任务一致。conditions.salary只作为参考记录，conditions.commute/office_distance记录不支持的原需求；它们及同名issues不阻塞采集/评估，task-check返回required_notices，Agent须向用户说明后继续支持的任务，不能把它们变成后续目标。

命令在仓库根目录运行。记录由Agent理解用户原话后整理；task-check 只检查声明和阶段闸门，不自动理解原话、不证明语义正确。字段缺省表示未指定；有值的条件必须有明确/继承状态和依据。保留原话以便回看。

```json
{
  "schema_version": 1,
  "task_id": "campus-pm",
  "revision": 1,
  "is_test": true,
  "user_request": "演示：找互联网行业校招项目管理岗位，先看机会",
  "goal": "discover",
  "conditions": {
    "recruitment": {"state":"explicit","value":"campus","basis":"用户说校招"},
    "industries": {"state":"explicit","value":["internet"],"basis":"用户说互联网行业"},
    "cities": {"state":"unspecified","value":null},
    "roles": {"state":"explicit","value":["项目管理"],"basis":"用户岗位目标"}
  },
  "retrieval": {"mode":"exhaustive","selection":"default","basis":"普通职能目标不默认启用标题预筛"},
  "materials": {"profile":"not_needed","jd":"missing"},
  "evaluation_scope": {"state":"unspecified","value":null},
  "issues": [],
  "changes": []
}
```

这只是演示，不当作真实用户输入。生产画像/任务 is_test 为 false。goal 见 decision-policy；招聘方向 value 是单个 campus/social/internship。industry 使用 industries 返回 ID；companies 使用已解析的公司 ID；cities/roles 使用字符串数组。明确不限是 explicit + []，未指定是 unspecified + null；程序内部使用 all 不代表用户主动选择了全行业。

评估范围 explicit/inherited 时含 basis 和 value：`{"mode":"sample","limit":20,"selection":"sample"}`、`{"mode":"companies","companies":["公司ID"]}`、或 `{"mode":"all"}`。前N个用 display_order，评估后选最适合用 rank_after_assessment，均需遵守 search-strategy 的清单约定。范围未明确不会阻止采集。

materials 的 profile/jd/history 可为 available/missing/partial/unreadable/conflict/not_needed。availability 的不确定信息放 conditions 或画像原事实，不用假的确切日期。额外问题放 issues：`{"field":"role_meaning","reason":"PM有歧义","question":"这里PM指产品还是项目管理？","blocks":["collect","assess"]}`。程序派生的问题还需根据已读材料去重、合并和自然表达，不能把内部字段名当问卷交给用户。

radar 额外记录 radar_action=create/update/pause/mute/resume/history、已有订阅的 subscription_id、conditions.schedule={state,value:{time,timezone},basis}。repair 可记录 conditions.repair_target、repair_access=read_only/apply；具体执行遵守独立Skill，任务记录本身不授权外部操作。

```sh
node job-search/scripts/jobs.mjs industries
node job-search/scripts/jobs.mjs task-check --file job-search/runs/input/task.json
node job-search/scripts/jobs.mjs task-save --file job-search/runs/input/task.json --out job-search/runs/campus-pm/r1.json
node job-search/scripts/jobs.mjs task-save --file job-search/runs/input/patch.json --previous job-search/runs/campus-pm/r1.json --out job-search/runs/campus-pm/r2.json
```

修订 patch 提供同task_id、连续revision、当前user_request和修改字段；其余已明确条件继承，来源记录到上版。清空条件显式写 unspecified/null。changes 指明 cities/industries/companies/recruitment/evidence/preference/availability/refresh/presentation/scope。输出不可覆盖，supersedes 绑定旧版本指纹。

准备岗位发现时，查询文件不是个人画像，只含实际查询参数及 is_test；不造证据数组：

```json
{"is_test":true,"industry_filters":["internet"],"city_filters":[],"company_filters":[]}
```

```sh
node job-search/scripts/jobs.mjs prepare --mode campus --discovery --task job-search/runs/campus-pm/r1.json --profile job-search/runs/input/query.json --out campus-job-fit/runs/campus-pm-discovery
node job-search/scripts/jobs.mjs collect --mode campus --run campus-job-fit/runs/campus-pm-discovery
node job-search/scripts/jobs.mjs render-discovery --mode campus --run campus-job-fit/runs/campus-pm-discovery
```

匹配使用同样入口但去掉 --discovery，--profile 提供真实方向画像。之后 screening-summary → plan-assessment → batch-create/start/submit/merge/close → render 沿用现有方向 workflow。已有范围直接保存，不另问；示例：

```sh
node job-search/scripts/jobs.mjs prepare --mode social --task job-search/runs/my-task/r1.json --profile social-job-fit/runs/input/profile.json --out social-job-fit/runs/my-run
node job-search/scripts/jobs.mjs collect --mode social --run social-job-fit/runs/my-run
node job-search/scripts/jobs.mjs plan-assessment --mode social --run social-job-fit/runs/my-run --scope-mode sample --limit 20 --user-request "用户已经明确的真实范围"
```

统一CLI用 --mode 表示招聘方向；plan-assessment 的原 --mode 改写为 --scope-mode 避免冲突。旧方向CLI仍用 --mode sample/companies/all。除 industries、task-check、task-save 外必须有明确方向或可读任务/运行方向，不默认校招。所有输出路径继续属于对应方向目录，避免同进程换方向或跨目录写入。

绑定任务的 plan-assessment 会校验数量/公司/模式是否与任务承诺一致，也可省略这些参数直接采用已记录范围。采集后才确定范围时，先 task-save 创建连续修订，再 plan-assessment --task 新修订路径；仅变范围可更新原运行并保留任务历史。改画像/条件仍须 prepare 新运行。前N个必须传 --jobs 固定展示顺序清单；不能用普通sample替代。最适合N个应记录比较母集的范围（如all），输出数量另记，不以抽样N个冒充。

样本范围内若限定公司，记录在 evaluation_scope.value.companies，不能仅通过 --only 改变已承诺母集。传 --jobs 时会核对当前母集数量：应为 min(承诺样本数, 当前范围可评估数)，防止有足够岗位却静默少传；真实母集不足时记录实际数量。

任务快照保存在 run.json 内并有指纹。task-check/show 的阶段输出不是自动调度器；实际执行前仍检查材料、原范围和当前状态。纯发现运行不能创建评估批次或渲染匹配Excel；改为匹配需新运行、真实画像和新任务修订，可复用合规JD。
