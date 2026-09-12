import path from 'node:path';
import {readJson, writeJson, workspacePath} from './io.mjs';
import {jobFingerprint} from './job-version.mjs';
import {writeExcelReport} from './excel-report.mjs';
import {ASSESSMENT_VERSION, ABILITY_LEVELS, INTEREST_LEVELS, MATCH_TIER_NAMES, ACTION_NAMES, deriveMatchTier, actionProblem, interestProblem} from './matching.mjs';
import {assertRunOwnershipComplete} from './ownership.mjs';
import {profileFingerprint, profileEvidenceProblem, abilityEvidenceProblem} from './evidence-model.mjs';

export const REPORT_HEADERS = ['公司', '公司业务标签', '公司性质标签', '岗位', '关注优先级', '匹配层级', '岗位城市', '意愿匹配度', '能力匹配度', '详细评估理由', 'JD链接'];
const tierNames = MATCH_TIER_NAMES;
const priorityNames = {high: '高优先', normal: '常规关注', low: '低优先'};
const eligibilityNames = {eligible: '已知条件符合', ineligible: '明确不符合', unknown: '待核实'};
const interestLevels = INTEREST_LEVELS;
const abilityLevels = ABILITY_LEVELS;
const visibleStatuses = new Set(['to_assess', 'needs_verification', 'missing_body']);
// Source bodies have already been normalized. Treat them as literal text here;
// stripping apparent tags again could delete requirements such as List<T>.
const clean = value => String(value ?? '').replace(/\r/g, '').trim();
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const list = value => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(clean).filter(Boolean))].join('、');
const officialLink = job => {
  try { const url = new URL(job.official_url); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};
const rank = review => ({high: 0, normal: 1, low: 2}[review.priority] ?? 3);
const jobKey = job => JSON.stringify([job.company_id, String(job.job_id)]);
const ownershipTag = company => company.ownership_tag;

// A process declaration is not proof of reading: the model must actually read
// the complete JD and produce the evidence comparisons before setting it.
export function reviewNeedsUpdate(review, job, profile) {
  if (job.body_complete !== true) return '完整 JD 正文未取得，不能形成全文评估';
  if (!review) return '尚未评估';
  if (review.review_method !== 'full_jd') return '缺少全文阅读评估记录，需完整阅读 JD 后重新评估';
  if (review.jd_fingerprint !== jobFingerprint(job)) return 'JD更新，旧评估已失效';
  if (review.assessment_version !== ASSESSMENT_VERSION) return '评估模型已更新至 v4，需独立重评双向适配与行动排序；不可由旧匹配层级反推能力或仅补版本字段';
  const profileProblem = profileEvidenceProblem(profile);
  if (profileProblem) return '个人画像需补齐证据分类：' + profileProblem;
  if (review.profile_fingerprint !== profileFingerprint(profile)) return '个人画像缺少匹配指纹或已更新，需对当前画像重新评估，不能复用其他画像的证据 ID';
  if (!Object.hasOwn(abilityLevels, review.ability)) return '缺少有效的独立能力评估';
  if (!Object.hasOwn(interestLevels, review.interest)) return '缺少有效的独立意愿评估';
  if (review.ability === 'unknown') return '资料不足，尚未形成完整能力评估';
  const derived = deriveMatchTier(review.ability, review.interest);
  if (review.match_tier != null && review.match_tier !== derived) return '匹配层级与独立能力、意愿判断不一致，需复核评估';
  if (!Object.hasOwn(eligibilityNames, review.eligibility) || !Object.hasOwn(priorityNames, review.priority)) return '资格或优先级字段无效';
  if (review.interest !== 'unknown' && !hasText(review.interest_reason)) return '缺少独立意愿依据 interest_reason；需说明用户明确倾向，不能用能力证据代替';
  if (!hasText(review.conclusion) || !hasText(review.next_step)) return '缺少具体结论或行动建议';
  if (review.eligibility !== 'unknown' && !hasText(review.eligibility_reason)) return '资格结论缺少具体依据';
  const comparisons = review.comparisons;
  if (!Array.isArray(comparisons) || !comparisons.length) return '缺少 JD 与个人证据对照';
  const ids = profile ? new Set((profile.evidence || []).map(item => item.id)) : null;
  for (const comparison of comparisons) {
    if (!comparison || !hasText(comparison.jd_requirement) || !hasText(comparison.explanation)) return '对照缺少要求或解释';
    if (!Array.isArray(comparison.profile_evidence_ids)) return '个人证据 ID 必须为数组；没有证据时使用空数组';
    for (const id of comparison.profile_evidence_ids) if (!hasText(id) || (ids && !ids.has(id))) return '引用了不存在的个人证据 ' + String(id);
  }
  if (['high', 'medium'].includes(review.ability) && !comparisons.some(item => item.profile_evidence_ids.length)) return '高或中能力判断必须有个人经历证据';
  if (review.ability === 'medium' && !hasText(review.transferable_evidence)) return '中能力判断缺少可迁移经历说明';
  const abilityProblem = abilityEvidenceProblem(review, profile);
  if (abilityProblem) return abilityProblem;
  for (const field of ['conclusion', 'ability', 'interest', 'gaps']) {
    if (!hasText(review.report_summary?.[field])) return '缺少易读报告摘要 report_summary.' + field + '；须由模型概括结论，不用逐项证据列表代替';
  }
  const actionIssue = actionProblem(review);
  if (actionIssue) return actionIssue;
  const interestIssue = interestProblem(review);
  if (interestIssue) return interestIssue;
  return null;
}

function validateReview(review) {
  return {...review, match_tier: deriveMatchTier(review.ability, review.interest)};
}

function detailedReason(review, bundle) {
  // Reader-facing synthesis is written by the model after the full comparison.
  // Evidence IDs and raw comparisons remain in assessment JSON, not this cell.
  const summary = review.report_summary;
  const conclusion = [clean(summary.conclusion), '综合为' + tierNames[review.match_tier] + '。'];
  if (review.eligibility !== 'eligible') conclusion.push('校招资格' + eligibilityNames[review.eligibility] + '。');
  conclusion.push('下一步：' + ACTION_NAMES[review.next_action] + '。');
  const gaps = [clean(summary.gaps)];
  if (bundle.data?.coverage?.status !== 'complete') gaps.push('来源覆盖尚不完整，具体限制见“来源覆盖”。');
  return [
    '评估结论：' + conclusion.join(' '),
    '能力匹配度结论：' + abilityLevels[review.ability] + '。' + clean(summary.ability),
    '个人意愿匹配度结论：' + interestLevels[review.interest] + '。' + clean(summary.interest),
    '主要缺口：' + gaps.join(' '),
  ].join('\n\n');
}

function textParts(value, maxLength = 1600) {
  const text = clean(value);
  if (!text) return ['暂无正文'];
  const parts = [];
  let rest = text;
  while (rest.length) {
    let size = Math.min(maxLength, rest.length);
    if (size < rest.length && /[\uD800-\uDBFF]/.test(rest[size - 1])) size--;
    parts.push(rest.slice(0, size)); rest = rest.slice(size);
  }
  return parts;
}

export async function buildReportData(dir, {allowPartial = false} = {}) {
  dir = workspacePath(dir);
  const run = await readJson(path.join(dir, 'run.json'));
  assertRunOwnershipComplete(run.companies);
  const bundles = [], assessed = [], missing = [], unattempted = [];
  for (const company of run.companies) {
    if (!company.selected) { bundles.push({company, status: '城市标签排除', jobs: [], reviews: []}); continue; }
    const data = await readJson(path.join(dir, 'companies', company.company_id + '.json'), null);
    if (!data) { unattempted.push(company.display_name); bundles.push({company, status: '尚未获取', jobs: [], reviews: []}); continue; }
    const submitted = (await readJson(path.join(dir, 'assessments', company.company_id + '.json'), {assessments: []})).assessments;
    const jobIds = new Set(data.jobs.map(job => String(job.job_id)));
    const seen = new Set();
    for (const review of submitted) {
      if (seen.has(String(review.job_id)) || !jobIds.has(String(review.job_id))) throw new Error(company.display_name + ' 重复或未知评估岗位 ' + review.job_id);
      seen.add(String(review.job_id));
    }
    const byId = new Map(submitted.map(review => [String(review.job_id), review]));
    const bundle = {company, data, jobs: data.jobs, reviews: [], status: data.coverage.status === 'failed' ? '获取失败' : data.coverage.status === 'partial' ? '部分获取' : '已获取'};
    for (const job of data.jobs.filter(value => value.evaluation_status === 'to_assess')) {
      const review = byId.get(String(job.job_id));
      const reason = reviewNeedsUpdate(review, job, run.profile);
      if (reason) { missing.push({company: company.display_name, company_id: company.company_id, job_id: job.job_id, reason}); continue; }
      const item = {...validateReview(review), job, company, bundle};
      bundle.reviews.push(item); assessed.push(item);
    }
    bundles.push(bundle);
  }
  if (missing.length && !allowPartial) throw new Error('还有 ' + missing.length + ' 个岗位尚未评估（含需全文重评），不能输出完整报告；用 next-batch 继续。首项：' + missing[0].company + '／' + missing[0].job_id + '：' + missing[0].reason);
  if (unattempted.length && !allowPartial) throw new Error('还有 ' + unattempted.length + ' 家入选公司尚未获取，不能输出完整报告；请先 collect。');
  assessed.sort((a, b) => rank(a) - rank(b) || a.company.display_name.localeCompare(b.company.display_name, 'zh') || a.job.title.localeCompare(b.job.title, 'zh'));
  const pending = bundles.flatMap(bundle => bundle.jobs.filter(job => ['needs_verification', 'missing_body'].includes(job.evaluation_status)).map(job => ({bundle, job})));
  const audit = {
    generated_at: new Date().toISOString(), assessment_version: ASSESSMENT_VERSION, profile_fingerprint: profileFingerprint(run.profile), companies_total: bundles.length,
    companies_selected: bundles.filter(bundle => bundle.company.selected).length,
    assessed_jobs: assessed.length, missing_assessments: missing, unattempted_companies: unattempted,
    source_failures: bundles.filter(bundle => ['获取失败', '尚未获取'].includes(bundle.status)).map(bundle => bundle.company.display_name),
    partial_sources: bundles.filter(bundle => bundle.status === '部分获取').map(bundle => bundle.company.display_name),
    needs_verification: pending.length,
    complete_assessment: missing.length === 0 && unattempted.length === 0,
    complete_collection: bundles.every(bundle => !bundle.company.selected || bundle.data?.coverage.status === 'complete'),
  };
  const main = {name: '岗位匹配', headers: [...REPORT_HEADERS], rows: [], links: []};
  const unchecked = {name: '待核实与未评估', headers: [...REPORT_HEADERS], rows: [], links: []};
  const coverage = {name: '来源覆盖', headers: ['公司', '公司业务标签', '本轮状态', '列表岗位数', '可评估数', '已评估数', '待评估数', '待核实数', '正文缺失数', '其他城市数', '实际页数', '覆盖说明', '采集时间', '城市标签时间', '公司性质标签', '性质核实说明', '性质来源证据', '性质核实时间'], rows: [], links: []};
  const snapshots = {name: 'JD原文', headers: ['公司', '岗位', '岗位ID', '岗位城市', '正文分段', 'JD原文', '官方入口'], rows: [], links: []};
  const notes = {name: '说明', headers: ['项目', '内容'], rows: [], links: []};
  const snapshotRows = new Map();
  for (const bundle of bundles) {
    for (const job of bundle.jobs.filter(value => visibleStatuses.has(value.evaluation_status))) {
      if (officialLink(job) && job.job_url_kind === 'official_detail') continue;
      const content = clean(job.description) === clean(job.requirements) || !job.requirements ? clean(job.description) : '岗位职责\n' + clean(job.description) + '\n\n任职要求\n' + clean(job.requirements);
      const recruitment = job.recruitment_evidence == null ? '' : clean(typeof job.recruitment_evidence === 'string' ? job.recruitment_evidence : JSON.stringify(job.recruitment_evidence));
      const body = content + (recruitment ? '\n\n招聘性质与资格证据（采集原字段）\n' + recruitment : '');
      const parts = textParts(body);
      snapshotRows.set(jobKey(job), snapshots.rows.length + 2);
      parts.forEach((part, index) => {
        const url = officialLink(job);
        snapshots.rows.push([bundle.company.display_name, clean(job.title), String(job.job_id), list(job.cities) || list(job.locations_raw) || '待核实', `${job.body_complete ? '完整JD' : '正文未完整'} ${index + 1}/${parts.length}`, part, url || '来源未提供']);
        if (url) snapshots.links.push({row: snapshots.rows.length + 1, column: 7, url, label: url});
      });
    }
    const count = state => bundle.jobs.filter(job => job.evaluation_status === state).length;
    const total = bundle.jobs.length;
    coverage.rows.push([bundle.company.display_name, list(bundle.company.business_tags) || '待确认', bundle.status, total,
      count('to_assess'), bundle.reviews.length, count('to_assess') - bundle.reviews.length,
      count('needs_verification'), count('missing_body'), count('excluded_city'), Array.isArray(bundle.data?.coverage?.pages) ? bundle.data.coverage.pages.length : bundle.data?.coverage?.pages ?? '未记录',
      clean(bundle.company.selected ? bundle.data?.coverage?.reason || (total ? '' : '本轮未取得范围内岗位，参见本轮状态') : bundle.company.selection_reason),
      clean(bundle.data?.checked_at) || '未采集', clean(bundle.company.city_index_updated_at) || '未知', ownershipTag(bundle.company),
      clean(bundle.company.ownership_reason) || '未提供核实说明',
      (bundle.company.ownership_evidence || []).map(item => [clean(item.title), clean(item.url), clean(item.note), clean(item.checked_at)].filter(Boolean).join('｜')).join('\n') || '尚无可核对来源',
      clean(bundle.company.ownership_checked_at) || '未核实']);
  }
  function appendRow(sheet, bundle, job, review, reason) {
    const official = officialLink(job);
    const direct = official && job.job_url_kind === 'official_detail';
    const url = direct ? official : `#'JD原文'!A${snapshotRows.get(jobKey(job))}`;
    const label = direct ? official : (job.body_complete ? '完整 JD 快照' : '已获取 JD 片段') + ' · 岗位ID：' + job.job_id;
    const detail = review ? detailedReason(review, bundle) : [
      '评估结论：当前尚未形成可用的岗位匹配结论。',
      '能力匹配度结论：待评估，暂不评级。',
      '个人意愿匹配度结论：待确认，尚未形成有效结论。',
      '主要缺口：' + clean(reason) + (bundle.data?.coverage?.status !== 'complete' ? '；来源覆盖尚不完整，限制见“来源覆盖”。' : ''),
    ].join('\n\n');
    sheet.rows.push([bundle.company.display_name, list(bundle.company.business_tags) || '待确认', ownershipTag(bundle.company), clean(job.title),
      review ? priorityNames[review.priority] + '·' + ACTION_NAMES[review.next_action] : '待评估', review ? tierNames[review.match_tier] : '待评估',
      list(job.cities) || list(job.locations_raw) || '待核实', review ? interestLevels[review.interest] : '待确认',
      review ? abilityLevels[review.ability] : '待评估', detail, label]);
    sheet.links.push({row: sheet.rows.length + 1, column: 11, url, label});
  }
  for (const review of assessed) appendRow(main, review.bundle, review.job, review);
  const missingMap = new Map(missing.map(item => [JSON.stringify([item.company_id, String(item.job_id)]), item.reason]));
  for (const bundle of bundles) {
    const completeIds = new Set(bundle.reviews.map(review => String(review.job_id)));
    for (const job of bundle.jobs.filter(value => visibleStatuses.has(value.evaluation_status) && !completeIds.has(String(value.job_id)))) {
      const reason = job.evaluation_status === 'missing_body' ? '完整正文未取得' : job.evaluation_status === 'needs_verification' ? '招聘性质、状态或地点待核实' : missingMap.get(jobKey(job)) || '尚未评估';
      appendRow(unchecked, bundle, job, null, reason);
    }
  }
  notes.rows = [
    ['报告范围', audit.complete_assessment && audit.complete_collection ? '本轮范围内评估与采集均完整' : '部分报告：未评估及资料待核实岗位单独保留，来源覆盖限制见对应工作表。'],
    ['生成时间（UTC）', audit.generated_at], ['城市筛选', list(run.profile.city_filters) || '不限'],
    ['公司业务偏好', list(run.profile.business_preferences) || '未设置'], ['岗位职能偏好', list(run.profile.role_preferences) || '未设置'],
    ['入选公司数', audit.companies_selected], ['全文评估岗位数', audit.assessed_jobs],
    ['未评估岗位数', missing.length], ['资料待核实岗位数', pending.length], ['来源部分覆盖数', audit.partial_sources.length],
    ['来源失败或未采集数', audit.source_failures.length],
    ['匹配层级', 'v4双向汇总，不另评分：已有能力低或意愿低＝当前匹配不足；无低但有未知＝信息待确认；双高＝双向高匹配；其余已知非低＝双向有条件匹配。资格独立呈现，双向高匹配不保证可投递。'],
    ['意愿匹配度', '用户明确需求与岗位供给的关系：高＝已知重要需求整体满足；中＝明确可接受的探索或取舍；低＝明确冲突；待确认＝重要意愿或供给未明。业务/性质仅在用户明确在意时计入一次；经历和地点入选不等于喜欢岗位。'],
    ['能力匹配度', 'v4：完整阅读JD后，以对口程度、经历层级、个人贡献和成果质量判断。相近条件下实习优先于学校／个人项目，再看其他相关经历；正式工作按真实工作责任判断，优质对口项目也可支撑高能力。客观经历和成就高于主观自评。高＝决定性核心要求均有中／强直接证据且至少一项强证据；中＝存在客观实践基础但核心覆盖或证据强度尚有缺口；低＝主要要求证据缺口较大；未知＝资料不足。多段独立对口实习增强判断，同一经历拆条不重复增益，不生成分数或录取概率。'],
    ['证据与经历', '客观经历／成就是材料中的具体事实陈述，不代表已完成外部核验；自称熟练、擅长等单独标为主观自评。核对个人行动、责任深度、成果和归属，不凭实习数量、公司名气、学校名气或数字大小直接评级。'],
    ['实习对口分层', '分别判断行业、部门业务和实际岗位职能。同业务跨岗位、同岗位跨业务均有部分对口价值，按JD具体任务判断迁移与缺口；单一维度不同不自动判低。信息不足标待核实。'],
    ['详细评估理由', '每岗只展示四段总结：评估结论、能力匹配度结论、个人意愿匹配度结论、主要缺口。概括最重要的实习／项目依据与影响投递的限制；逐项证据对照保留在评估记录中，不堆叠到单元格。'],
    ['关注优先级', '下一步行动紧迫性，非岗位适合程度。高优先／常规关注／低优先，附投递／核实／准备／暂缓。高优先需真实时间窗口或当前阻塞事项；未知资格/意愿可优先核实，不可直接投递。同级按公司和岗位排序。时间依据为评估当时快照，再次推进须核实时效。'],
    ['公司性质标签', '国企／私企／外企独立于公司业务标签。按可核对的企业性质或控制关系资料记录；资料不足显示待核实。核实说明、来源和时间保留在来源覆盖，不能根据名称、上市地或业务猜测。'],
    ['阅读与评估要求', '每项结论须在完整阅读岗位职责、任职要求及招聘证据后产生。v4同时绑定JD与完整个人画像指纹。程序检查证据分类和结构一致性，不能证明真实阅读、事实真实性或语义判断正确；旧模型结论需重评。'],
    ['JD链接', '优先显示可点击官方单岗位URL。无独立详情页时跳转本工作簿JD原文，并保留入口和岗位ID；工作簿可独立使用。'],
    ['多城市岗位', '一行一个岗位，岗位城市保留全部选项，不保证最终分配到其中某城。'],
    ['城市标签快照', clean(run.city_index_updated_at) || '未记录'],
  ];
  if (run.is_test) notes.rows.unshift(['测试说明', '本工作簿使用测试画像，不代表真实用户或投递建议。']);
  if (run.report_note) notes.rows.unshift(['本轮说明', clean(run.report_note)]);
  return {sheets: [main, unchecked, coverage, snapshots, notes], audit, run};
}

export async function renderRun(dir, {allowPartial = false, previewDir} = {}) {
  dir = workspacePath(dir);
  const report = await buildReportData(dir, {allowPartial});
  const workbookFile = path.join(dir, 'outputs', path.basename(dir), '校招岗位匹配.xlsx');
  await writeExcelReport(workbookFile, report.sheets, {previewDir: previewDir ? workspacePath(previewDir) : undefined});
  const audit = {...report.audit, workbook_file: workbookFile, output_format: 'xlsx'};
  await writeJson(path.join(dir, 'report-audit.json'), audit);
  console.log(JSON.stringify({workbook: workbookFile, companies: audit.companies_selected, assessed: audit.assessed_jobs, remaining: audit.missing_assessments.length, needs_verification: audit.needs_verification, partial_sources: audit.partial_sources.length, complete_assessment: audit.complete_assessment, complete_collection: audit.complete_collection}));
  return audit;
}
