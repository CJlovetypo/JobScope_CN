# 逐岗位评估与推荐

新prepare使用[判断模型v5](../../shared/job-search-core/references/assessment-v5.md)，评估前必须读取。下文旧v4状态、例子和十二列仅用于旧运行追溯；新运行以v5为准：缺证unknown有效完成，不因年限差距否决，学历/专业/经验分开，新增城市/薪资参考/证据充分性，十五列及clarify动作。

模型必须逐个完整读完当次 JD 的 `description`、`requirements`、`recruitment_evidence` 及个人画像、`profile.evidence`，再逐项对照后独立评估硬性条件、能力、意愿和投递建议；工具显示被截断时，继续分段读取直至全部读完。禁止凭标题、关键词、正则或模板分类生成这些判断。脚本可以序列化已经完成的证据判断，并按下方双向汇总原则计算匹配层级；组合计算不能代替全文阅读，也不能反过来推断能力或意愿。

当前为 v4，评估前必须阅读 [能力证据模型](ability-model.md)：先区分客观经历、客观成就、主观自评，再按对口程度、经历层级、个人贡献和成果判断证据强度。同等相关性和质量下实习优先于学校／个人项目，再看其他相关经历；多段独立对口实习增强判断，高质量项目也可支撑高能力。禁止仅按实习次数、公司品牌、主观描述或数字大小提档。

岗位标题只能帮助定位或选取样本。全量运行时每个可评估岗位都要有记录；用户指定每家公司最多 10 个等抽样范围时，只缩小数量，每个样本仍遵守同样的全文阅读标准，完成约定数量并明确剩余范围。业务不符的公司照常评估，不能只选高优先候选。

## 五个字段的边界

评估前阅读 [双向匹配心智模型](reciprocal-model.md)，这是 v4 的判定依据。

| 字段 | 唯一职责 | 不承担 |
| --- | --- | --- |
| 硬性条件匹配度 | JD与用户实际届别、学历是否符合 | 不评专业、能力、意愿、到岗安排或行动紧迫性 |
| 能力匹配度 | 企业要求与候选人客观实践的适配 | 不评意愿、资格、吸引力或行动紧迫性 |
| 意愿匹配度 | 岗位供给与候选人明确需求的适配 | 不从经历推断喜欢，不依赖能力 |
| 匹配层级 | 汇总上述两个独立判断 | 不额外打分、不重复检查偏好、不表达行动 |
| 投递建议 | 当前是否值得投递、是否需要先准备 | 不代表录取概率，不重复显示内部排序字段 |

能力 high/medium/low/unknown 的证据锚点见能力模型。意愿 aligned/explore/conflict/unknown 表示已知需求整体满足／明确可接受的探索或取舍／明确冲突／关键信息不足。业务与公司性质偏好仅在用户明确表达时纳入意愿一次，不在优先级重复扣分。公司 business_alignment 只是线索，模型核对岗位实际部门与任务，不让集团标签替代具体 JD。

匹配层级由两维生成：已有任一低 → 当前匹配不足；无低但有未知 → 信息待确认；双高 → 双向高匹配；其余已知非低 → 双向有条件匹配。内部值为 low/unknown/high/conditional。已知不足优先于未知只表示已有一侧短板，另一侧仍保留未知，不能推断其高低。意愿 unknown 可为已完成评估，能力 unknown 仍待补材料。

硬性条件 `eligibility` 只核对届次与学历，正式评估记录为 eligible／ineligible，`eligibility_reason` 必须逐项写明 JD 要求（或“未写限制”）与用户实际情况。用户画像必须提供毕业时间和学历；任一项存在明确冲突即 ineligible，其余为 eligible，包括 JD 未写某项限制的情况。ineligible 时报告综合展示为“硬性条件不符”，不论能力与意愿多高都只能 low + hold。历史 unknown 记录不能进入正式评估，须按当前规则复核。专业要求仍按岗位要求记录，提前实习与到岗可行性继续写入 `early_internship`、缺口和行动依据，不混入硬性条件列。多城市不保证最终分配；“先实习，优秀可转正”标录用安排待核实，不宣称无条件正式录用。

新评估的 `next_action` 使用 apply／prepare／hold，Excel 映射为可以投递／投递前准备／暂不建议投递。轮岗范围、业务占比、提前实习等信息不足时写入理由并给出最合理的投递建议，不使用“核实”作为主表动作。内部 `priority`、`priority_reason`、`timing_evidence` 仅用于稳定排序和审计，不在 Excel 展示；high 仍须有真实时间窗口或阻塞事实。硬性条件 ineligible、意愿 conflict 或能力 low 都必须 low + hold；hold 只能 low。用户再次推进时核实窗口与岗位状态，不把历史排序当长期结论。

## 固定批次提交（新运行默认）

使用 `batch-create` 的独立 input.json 和 result-template.json，按固定岗位键填写判断，见 [批次操作](parallel-assessment.md)。模型只填写判断字段及 `review_method: "full_jd"`，不填写公司/岗位身份、指纹、版本、match_tier、priority、priority_reason 或 timing_evidence。提交器绑定固定输入身份，执行确定性的否决与排序规则；其余语义检查规则不变。正式 assessments 仍保存下面的完整 v4 格式，以兼容报告和旧记录。以下手工写入示例仅说明存储结构，不再作为并行执行方式。

## 写入评估文件

逐岗位评估可以由多个 agent 并行完成，所有执行者使用相同画像与本评估标准。大量岗位优先按 [多 agent 评估操作](parallel-assessment.md) 分批委派；全文阅读、证据对照和有效性要求不因并行而放宽。

每家公司 `assessments/公司ID.json`：

```json
{
  "assessments": [
    {
      "job_id": "来自当次列表的真实岗位ID",
      "assessment_version": 4,
      "review_method": "full_jd",
      "jd_fingerprint": "原样复制 next-batch 中该岗位的 jd_fingerprint",
      "profile_fingerprint": "原样复制 next-batch 顶层当前画像指纹；只用于基于该画像的新评估",
      "ability": "high",
      "ability_reason": "说明最强对口实习或高质量项目、个人贡献与成果、独立经历增量，以及核心要求覆盖和剩余缺口为何支持该等级",
      "experience_relevance": [
        {
          "experience_id": "EXP1",
          "industry_relation": "adjacent",
          "business_relation": "different",
          "role_relation": "same",
          "explanation": "基于经历内容说明岗位职能相同、部门业务不同：哪些实际任务可直接迁移，哪些领域知识尚未覆盖"
        }
      ],
      "priority": "normal",
      "next_action": "prepare",
      "priority_reason": "投递前先整理对应案例，暂无已知临近窗口",
      "timing_evidence": "",
      "interest": "aligned",
      "interest_checks": [{"preference":"招聘职能","importance":"prefer","status":"met","user_basis":"用户明确希望从事招聘","job_basis":"JD主要交付为招聘协调"}],
      "interest_reason": "用户明确希望从事该职能；说明对应的用户原始倾向或后续说明，不用能力经历代替意愿",
      "eligibility": "eligible",
      "eligibility_reason": "逐项写明JD届别、学历要求或未写限制，以及用户实际毕业时间、学历，并说明为何匹配／不匹配",
      "conclusion": "一句话解释为何值得关注、以及主要限制",
      "comparisons": [
        {
          "jd_requirement": "该JD的一项具体要求",
          "requirement_type": "core",
          "support": "direct",
          "evidence_strength": "strong",
          "profile_evidence_ids": ["E1"],
          "explanation": "这条经历能证明什么，不能证明什么",
          "gap": "尚需补充的部分；无明确缺口可留空"
        }
      ],
      "transferable_evidence": "能力评为 medium 时必须写；其他能力等级可省略",
      "gaps": ["具体缺口"],
      "early_internship": "是否要求提前实习、时长/天数/开始时间及与用户安排的关系；未写就标未知",
      "next_step": "针对该岗位的一项具体行动",
      "report_summary": {
        "conclusion": "一句话说明岗位是否值得关注，以及影响投递的主要限制；不堆叠分析过程",
        "ability": "概括最有分量的实习或项目依据、业务与职能的迁移，以及为何支持该能力等级",
        "interest": "概括与用户明确倾向的关系；未说明就如实写待确认，不用经历推测喜欢",
        "gaps": "概括最关键能力缺口及需要核实的资格或到岗条件；无明显能力缺口也要如实说明"
      }
    }
  ]
}
```

枚举：ability 为 high/medium/low/unknown；priority 为 high/normal/low；interest 为 aligned/explore/conflict/unknown；新评估的 eligibility 为 eligible/ineligible，且仅代表届别、学历硬性条件，历史 unknown 需复核。正式评估的 next_action 只允许 apply/prepare/hold；旧 verify 记录须复核后明确改为 prepare 或 hold，不能继续作为有效正式评估。资料本身不完整的岗位留在“待核实与未评估”，不通过 next_action 表达。比较项的 requirement_type 为 core/supporting/bonus/eligibility，support 为 direct/transferable/unsupported，evidence_strength 为 strong/moderate/weak/none，定义见能力证据模型。引用的个人证据 ID 必须存在；没有证据时使用空数组并写 unsupported + none。high/medium 需有核心或一般能力要求的中／强客观证据，主观自评、资格事实或无关加分项不能独撑；medium 还须有可迁移经历说明。high 至少一项核心为 direct + strong，其他决定性核心均须 direct + strong/moderate。不能将核心缺口改标 bonus 来通过检查。

所引用的每段客观实习／工作经历须在 `experience_relevance` 中恰有一项；三个关系字段的枚举都是 same/adjacent/different/unknown。分别判断行业、部门业务和实际岗位职能，不能把“同业务跨岗位”或“同岗位跨业务”一律视为不对口。explanation 说明已知事实、迁移和差异，分层不自动决定能力等级。只引用项目／其他经历时可省略该数组。

`assessment_version: 4`、`ability_reason`、四项 `report_summary` 与独立的 `ability` 必填。`match_tier` 可以省略，由程序计算；如写入，必须与上述汇总原则一致。v1/v2/v3 未采用当前双向匹配与行动排序模型，必须重新阅读当前 JD 和画像后评估，不允许仅迁移字段恢复有效。没有全文记录的旧结论也不能通过补标记恢复。

每条评估必填 `review_method: "full_jd"`，仅在模型确已完整读过上述 JD 字段并完成画像证据对照后写入。缺少该标记或值不是 full_jd 的历史结论一律待全文重评；不能仅批量补标记或改写措辞后继续使用。该字段是过程声明，程序只能检查声明是否存在，不能据此证明真实阅读；实际全文阅读和证据对照由模型完成。`review_method`、模型版本、当前 `jd_fingerprint` 与 `profile_fingerprint` 共同决定记录能否被当作有效评估。画像即使仍使用 E1/E2，内容不同也须重评，禁止从另一人的评估复制解释再替换证据 ID。

`interest` 依据用户明确的职能、业务和重要条件或后续说明判断：aligned 表示已知重要需求整体满足，explore 表示仅探索／有条件接受、尚有取舍，conflict 表示明确冲突，unknown 表示关键意愿或供给未明。明确选择转行且岗位满足已知需求可判 aligned，不因“转行”自动降为 explore；只有“可探索但尚未决定／有条件接受”才判 explore。非 unknown 必须填写非空字符串 `interest_reason`，注明用户实际表达；unknown 可说明待确认事项。相邻职能、技能可迁移或能力匹配不能证明愿意，不编写理由补齐字段。

`interest_checks` 必填数组，逐项写 preference、importance（must/prefer/open）、status（met/partial/conflict/unknown）、user_basis 和 job_basis，覆盖全部已知重要偏好。没有明确偏好使用空数组，仅可 unknown；非 unknown 必须有对照。用户来源及岗位供给须可核对。关键硬偏好冲突不能被平均抵消；关键条件未知不能评高。仅上海地点入选而未说明方向，不足以宣称愿意所有上海岗位；明确“不限职能，只要上海”则按这项已声明需求判断。

`next-batch` 与 `render` 使用同一有效性检查：正文与评估版本有效之外，证据对照结构、实际证据 ID、必要的可迁移经历说明及意愿依据均须完整。缺失或无效记录仍属于待评估，并附具体原因；`render --allow-partial` 将其保留在待核实与未评估表，不计为已完成。

比较项覆盖主要职责与决定性要求，不必机械拆每个形容词。低匹配岗位可以简写输出理由，但也必须先全文阅读，并保留真正影响结论的要求。模型生成的解释不得包含无依据的公司事实、薪资、内推承诺或录取概率。

阅读时保留并区分必需条件、加分项、多个可选细分方向和提交材料要求。采集正文必须保留原字段的分段语义；发现分段丢失时回读已保存的原始 API 字段并修复归一化后再评估。不能把加分项缺证当成硬性不合格，也不能因某条放在附加字段里就忽略其中明确的“必须／requires”。简历未记载的实践写“未提供相应证据”，不要改写成确定没有该经验。

先取得用户明确的实验批次／指定公司／全量选择，保存 `evaluation-scope.json` 后才开始评估。每一批写完继续 next-batch，直到所选范围的 remaining=0；实验或指定公司完成后正常 `render` 并注明全量未评估数量，不自动扩大范围。只有用户要求提前交付所选范围内尚未完成的结果时才使用 `render --allow-partial`。保留 jd_fingerprint，使同一岗位更新正文、条件或地点后旧评估自动失效；重评同一 job_id 时替换该条，不追加重复记录。render 会检查全文阅读标记、重复岗位、虚构个人证据 ID、未采集公司及缺失/过期评估，并拒绝缺失行动依据或与资格／意愿明显矛盾的投递动作，不按匹配等级静默调整优先级。这个程序检查不代替模型对真实证据的判断。已作废的标题规则评估可留在运行内 `superseded-title-rule-assessments/`，不得混入主表；未重新全文评估的岗位按未评估保留。

## Excel 中的评级与理由

评估 JSON 保持上述字段，Excel 展示使用固定的定性映射，不另外生成数值分数：

| 评估字段 | 原值 | Excel 展示 |
| --- | --- | --- |
| next_action → 投递建议 | apply / prepare / hold | 可以投递 / 投递前准备 / 暂不建议投递 |
| ability + interest → 匹配层级 | 按上述汇总原则计算 | 双向高匹配 / 双向有条件匹配 / 当前匹配不足 / 信息待确认 |
| interest → 意愿匹配度 | aligned / explore / conflict / unknown | 高 / 中 / 低 / 待确认 |
| ability → 能力匹配度 | high / medium / low / unknown | 高 / 中 / 低 / 待评估 |
| eligibility → 硬性条件匹配度 | eligible / ineligible | 匹配 / 不匹配 |

意愿匹配度和能力匹配度相互独立，每列有单独含义；届别与学历硬性条件先执行否决闸门，通过后匹配层级才按能力与意愿汇总。业务或性质只有在用户明确在意时纳入意愿，不能影响能力。用户画像缺少毕业时间或学历时停止正式评估；JD 未写对应限制不等于信息待核实，而是没有发现该项硬性冲突。

`详细评估理由` 使用模型完成评估后写出的 `report_summary`，只展示四段，标签与顺序固定：

```text
评估结论：是否值得关注，列出届别与学历硬性条件依据、综合匹配与影响投递的主要限制。

能力匹配度结论：等级，以及最重要的实习／项目依据与迁移关系。

个人意愿匹配度结论：等级，以及与明确倾向的关系；未知如实说明。

主要缺口：最关键的能力差距、资格与到岗待核实事项。
```

每项摘要通常一至两句，整格建议约 150–300 个汉字，按岗位复杂度调整而非机械凑字。可用“已有银行数据分析实习，方法能迁移到电商，但缺少优惠券业务经验”等直接总结；不要输出 E1/E2、对照1/2、字段名、逐条要求复述或思考过程，也不解释模型如何防错或如何应用规则。能力与意愿的等级由程序添加，摘要字段直接写依据即可。摘要必须忠于内部结论，不能抹去毕业窗口不符、意愿冲突、提前实习约束或实质缺口；程序另保留确定的资格、下一步行动和来源覆盖状态。无证据不编造，无明显缺口如实写明。

完整 `comparisons`、`ability_reason`、`experience_relevance`、原始证据和资格理由继续保存在评估 JSON 中，不在这一列展开。程序不使用裁剪内部长文或拼接证据列表来冒充总结。缺少四段摘要的记录会进入待评估，须由模型补写忠于已核对事实的摘要；如果画像、JD或模型也变了，则须完整重评。未评估行也使用这四段，解释缺失信息，不给出猜测等级。

JD 链接优先使用公开官方单岗位详情 URL；只有招聘入口、没有独立详情页时，链接该官方入口并标明岗位 ID。无可用链接时保留岗位 ID 和独立归档提示。全文、招聘证据和采集时间保存在运行目录的 `archive/jd-originals.jsonl`，最终 Excel 不包含 `JD原文` 页签或全文隐藏页。不要把公司入口伪装成单岗位详情，也不生成 Markdown 快照作为交付链接。
