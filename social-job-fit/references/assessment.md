# 社招逐岗位评估

完整阅读每岗description、requirements、recruitment_evidence和完整画像；截断时分段读完。禁止按标题、关键词、分数公式或模板代替语义判断。先确定岗位标准，再对照本人实践，不为迁就简历降低核心要求。标签与输出沿用v4双向匹配，细节见 [能力证据模型](ability-model.md)。

## 本方向硬性条件

核对学历、JD明确要求的正式/相关工作年限、必须的职业资格及硬性到岗时间；毕业届别不是社招默认门槛，实习不能自动折算正式工作年限。 每项填写eligibility_checks（field、status:met/conflict/not_stated/unknown、jd_requirement、candidate_fact）。未要求的条件用not_stated；有明确要求但用户资料缺失用unknown，不能假定符合。任一conflict则ineligible，否则任一unknown则unknown，否则eligible；unknown不使用apply。

必查field：degree、employment_years、mandatory_qualifications、start_date。只记录JD明确要求，优先项不是硬性要求，薪资期望和个人偏好单独归入意愿。每项保留原文条件与用户事实；证据不够时不凭空补承诺。学历或年限不符不等于能力低，资格与能力分别解释。

eligibility_checks中每项须有field、status、jd_requirement、candidate_fact。status是met/conflict/not_stated/unknown。不写限制可以not_stated，不代表雇主未来不会有要求；JD写了限制而用户没提供条件必须unknown。最后eligibility按冲突优先、未知其次确定ineligible/unknown/eligible。ineligible必须hold；unknown只能prepare/hold，并保留需要补确认的具体条件。

## 能力、意愿和行动

ability为high/medium/low/unknown；核心要求必须全部提取，资格不能代替能力证据。high须全部核心direct+strong/moderate且至少一项strong；medium须核心或支持要求有strong/moderate客观实践及具体迁移路径；low表示材料可比较但核心缺证，不写成确定不会；unknown资料不足，不进入正式已评估记录。

interest为aligned/explore/conflict/unknown。只依据用户明确需求和岗位真实供给；跨行但用户明确愿意且条件满足可aligned，可尝试但尚有取舍为explore，不由经历推断喜欢。interest_checks每项含preference、importance(must/prefer/open)、status(met/partial/conflict/unknown)、user_basis、job_basis。无明确偏好用空数组和unknown；硬偏好冲突不可平均抵消，关键供给未知不可评高。

任一能力或意愿低→当前匹配不足；无低但有未知→信息待确认；双高→双向高匹配；其余→双向有条件匹配。资格冲突在报告覆盖为硬性条件不符；资格未知覆盖为信息待确认。next_action为apply/prepare/hold；能力low、意愿conflict或资格ineligible必须hold。资格或意愿未知不能apply。

## 固定批次判断结构

运行batch-create取得input.json与result-template.json，再batch-start绑定执行者。只填固定key和review判断，不填写job_id、company_id、指纹、版本、match_tier、priority，程序负责绑定。review必填：

- review_method="full_jd"：只有实际读完才写；程序不能证明真实阅读。
- ability、ability_reason：解释本人做过的核心工作、责任深度、产物、覆盖和缺口。
- interest、interest_reason、interest_checks：独立的明确意愿依据。
- eligibility、eligibility_reason、eligibility_checks：本方向全部硬条件的事实对照。
- conclusion、next_action、next_step：具体结论和可行动建议。
- comparisons：每项jd_requirement、requirement_type(core/supporting/bonus/eligibility)、support(direct/transferable/unsupported)、evidence_strength(strong/moderate/weak/none)、profile_evidence_ids、explanation、gap。
- ability=medium时transferable_evidence必填，说明具体迁移路径。
- experience_relevance：每个被引用的客观实习/工作experience_id恰一项，分别industry_relation、business_relation、role_relation(same/adjacent/different/unknown)及explanation。项目不冒充正式工作。
- report_summary：conclusion、ability、interest、gaps四个非空字符串，面向人写四段简洁总结，约150–300字按复杂度调整，保留资格与到岗限制、不堆证据ID。

可补gaps数组、employment_conditions记录到岗/薪资/转正约束；实习不承诺转正，社招不编薪酬级别，未提供薪资写未知。未涉及的条件不是零或不限制。

comparisons强/中证据须引用客观实践或成果，主观自评只能weak；unsupported必须none，direct/transferable必须有有效个人证据ID。不同证据来自同一experience_id不重复加权。不要把核心缺口改写bonus通过检查。

batch-submit提交后检查errors，batch-merge统一写入；执行者真实停止后batch-close。选定范围remaining=0才render。全量范围外仍有未评估时如实展示，不自动扩围。版本4、JD指纹和完整画像指纹绑定结论，资料变化须重新阅读评估，不给旧结论只补字段。
