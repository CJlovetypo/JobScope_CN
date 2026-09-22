# 岗位判断 v5：事实、未知与独立偏好

2026-09-22，R1–R7及工作年限弹性规则已获用户确认。本规则优先于三个方向文档中旧v4的能力缺证、年限硬门槛、未知不能交付及十二列约定。旧运行保留版本4；新prepare使用profile.assessment_model_version=5，必须全文重评，不能给旧记录补版本号。

## 先看材料，不要求文件形式

没有简历文件不等于没有经历证据；具体文字自述即可。画像允许空evidence及未知学历/年限，此时只判断有依据的维度。头衔、年限概述、学校/公司名气不足以证明具体任务能力，也不足以证明不会。资料不全仍可做岗位发现、JD要求拆解、已知资格与意愿对照，不编造经历来通过程序。

已取得完整JD才能写full_jd。缺正文、类型冲突或岗位开放状态未确认仍按原资料规则处理；只有城市未知不阻断其他维度。未知城市必须保留，不靠总部地址或住址推断。搜索公司范围及明确城市过滤不自动扩大。

## 每项要求先辨事实状态

comparisons保留jd_requirement、requirement_type(core/supporting/bonus/eligibility)、support(direct/transferable/unsupported)、evidence_strength(strong/moderate/weak/none)、profile_evidence_ids、explanation、gap，新增status(met/partial/conflict/unknown)。

- met：有事实支持符合；partial：已有支持但适用范围/责任深度有明确差距或迁移条件。
- unknown：没有足够事实。未提供预算、带队、工具使用等信息不是不会，不用low或conflict。
- conflict：有具体个人事实证明某项要求不符，须引用对应客观事实证据ID。只对该项成立，不扩写为全部能力低。
- unsupported表示没有支持证据，不等于不符合。明确不会的事实也可support=unsupported、status=conflict，但必须引用真实事实；不能编造负面证据。
- JD“优先/加分”不升级为硬门槛。相近任务可能跨行业迁移，依据实际责任和成果，不因标签不同自动否定。

ability为high/medium/low/unknown。high仍需全部决定性核心获得direct+strong/moderate且至少一项strong。medium需有核心/支持任务的客观strong/moderate实践及具体迁移解释，核心可partial。决定性核心仍unknown时总体能力保留unknown，列出已有支持；已有明确核心冲突可low，但不能把未知本身当冲突。

证据不必有量化数字或外部证明。保持kind/claim_type/experience_type/experience_id及experience_relevance三维结构；同段经历拆条不增加权重。

## 资格与经验参考

eligibility_checks每项含field、status(met/conflict/not_stated/unknown/partial)、jd_requirement、candidate_fact；conflict额外给evidence_ids，引用已知事实。学历degree与专业major分开；已知硕士不能因专业未知而写学历未知。

必需字段：
- 校招：degree、graduation、major。
- 实习：degree、student_status、graduation、start_date、days_per_week、duration_months、major。
- 社招：degree、major、employment_years、related_experience、mandatory_qualifications、start_date。

JD没有相应要求用not_stated；要求明确而用户事实不足用unknown。非经验字段任一已证实conflict→ineligible；否则有unknown/partial→unknown；其余eligible。资格未知不等于不符。

工作年限是经验参考，不设统一“可少几年”。分别记录JD年限、已知总经验/相关责任和差距。年数不足不直接conflict/ineligible/hold，不从总年限、行业或岗位头衔推断某种任务一定没做过；实际职责、责任深度及成果可以支持适当放宽，缺这些信息则保持不确定。不声称雇主一定接受，不伪称达到原年限。

employment_years与related_experience不参与硬性资格汇总。它们存在要求时增加flexibility={status:not_needed/supported/uncertain,reason:具体差距及依据,evidence_ids:真实证据ID数组}。supported必须引用实际事实；不等于保证豁免。not_needed表示现有事实已满足；uncertain表示尚不能判断可否放宽。差距可写partial，资料不足写unknown，无要求not_stated。相关经历的实际任务能力仍在comparisons中判断，不借“弹性年限”夸大能力。

## 独立意愿、城市、薪资和证据充分性

interest_checks沿用preference、importance(must/prefer/open)、status(met/partial/conflict/unknown)、user_basis、job_basis，并增加dimension：role/business/industry/ownership/work_mode/growth/other。只收工作内容等实际偏好。城市与薪资单列，不能重复进入意愿评分；同城距离/通勤不支持，应告知并忽略，不追问交通、地址或时段。

没有明确意愿时interest=unknown与空数组是合法判断，不能用履历推断喜欢。已证实must冲突保留conflict；弱偏好不擅自升级否决。行业/城市明确不限表示不限制，不是加分证据。

city_check必填：status=met/partial/conflict/unknown/unspecified/unrestricted、importance=must/prefer/open、user_basis、job_basis。
- profile.city_preference记录state、values、importance，可与硬查询city_filters分开，软偏好不扩大或暗缩范围。
- 未指定=unspecified；明确不限=unrestricted；指定城市但岗位城市未知=unknown。
- 多城市岗位允许任选目标城市时met；需要异地轮转等事实限制才partial/unknown。
- 岗位工作城市不符与unknown分开；只有明确must城市冲突才否决。

salary_check必填：status=aligned/partial/gap/unknown/not_specified、raw（实际原文字符串，缺失空串）、reason、user_basis、job_basis（包括来源/日期或未知依据）。
- 明确告知：招聘信息中的薪资可能不准确，仅供参考，不代表实际录用待遇；不按薪资硬筛岗位。
- 用户未给薪资偏好用not_specified，可展示JD原值，不主动设置目标或要求补薪资；有偏好且未披露/口径不明用unknown。
- 可比时只给表面相符/部分重合/参考差距。不假设月薪、年包、薪数、奖金、币种和税前税后，不制造可比性。
- 不因薪资缺失或差距更改能力、资格、意愿、主匹配档位或投递动作。只在主要判断相当的岗位间作辅助排序，未知不扣分。

evidence_sufficiency必填：status=sufficient/partial/insufficient、reason、missing（待补具体事实字符串数组）。这是判断依据是否充分，不是个人能力分；能力unknown必须有missing，不能声称充分。已知内容和缺项分别说明。

## 提交、完成与行动

固定批次仅写review判断，不写公司/岗位ID、指纹、版本、priority/match_tier。沿用ability_reason、interest_reason、eligibility_reason、conclusion、next_step、review_method、comparisons、experience_relevance和report_summary四段。

- 已证实资格/关键意愿/核心能力/明确must城市冲突→hold，其他未知照实保留。
- 没有上述冲突，但关键能力/资格/意愿/must城市未知→clarify，显示“补资料后判断”。
- 主要条件有支持、还需准备→prepare；支持充分可apply，不承诺录用。
- 不确定是有效的已审阅结果，可以submit/merge/render；不能为让批次完成改成low。缺项未变化时不重复评估；新事实或JD变化后重评。

report_summary.conclusion/ability/interest/gaps及其他理由必须与状态/行动一致，不能一边建议准备，一边写明确不适合。资格总结说明“未见硬性冲突”与“全部已证实符合”差别，经验参考的放宽不冒充资格豁免。

新报告四页签，岗位页增加城市意愿匹配、薪资参考、证据充分性，共十五列；已审阅未知留在岗位评估结果中，未读取/资料获取失败另列。交付同时报告已审阅数量和仍不确定数量，不把范围完成说成所有适合性都已确定。

## 补问与续跑

聚合跨岗位共用的关键缺项，每轮最多3组，优先能改变判断的职责、个人行动/成果和必要资格。仅概述年限时先保留未知；不对每岗重复问，也不要求必须上传简历。用户只看机会即可交付有限判断候选。

改变画像后保存新运行并重评，原JD可按既有配置/方向契约复用，旧报告不覆盖；不只补指纹或机械换评级。旧100例首轮验收不自动证明v5正确，需针对新增判断与最终输出复测。
