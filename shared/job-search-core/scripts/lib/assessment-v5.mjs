// V5 records decisions, not guesses about skills from missing evidence.
export const MODEL_VERSION = 5;
export const isV5 = value => value?.assessment_model_version === MODEL_VERSION || value?.assessment_version === MODEL_VERSION;
export const modelVersion = profile => isV5(profile) ? MODEL_VERSION : 4;
export const SALARY_NOTICE = '招聘信息中的薪资可能不准确，仅供参考，不代表实际录用待遇；不按薪资硬筛岗位。';
const text = value => typeof value === 'string' && value.trim().length > 0;
export const CITY_NAMES = {met:'符合',partial:'部分符合',conflict:'不符',unknown:'不确定',unspecified:'未指定',unrestricted:'不限制'};
export const SALARY_NAMES = {aligned:'表面相符',partial:'部分重合',gap:'参考有差距',unknown:'未知／不可比',not_specified:'未指定偏好'};
export const EVIDENCE_NAMES = {sufficient:'较充分',partial:'部分充分',insufficient:'不足'};
export const V5_INSTRUCTION = '按references/assessment-v5.md逐项阅读全文判断。缺证=unknown，不是low/conflict；comparison.status区分met/partial/conflict/unknown，明确缺口须引用个人事实。城市单列，只匹配城市，不评距离/通勤；薪资单列仅参考，不用于资格/意愿否决。工作年限为经验参考，差距不自动否决，放宽依据来自真实职责/责任深度/成果，不保证雇主接受。unknown是有效已审阅结果，明确缺项并使用clarify（补资料后判断）；与真实冲突同时存在时保留冲突。';

export function v5EvidenceProblem(review,profile){
  if(!isV5(profile))return null;
  if(!review||typeof review!=='object'||!Array.isArray(review.comparisons)||review.comparisons.some(c=>!c||typeof c!=='object'))return '缺少有效的逐项证据对照';
  const byId=new Map((profile.evidence||[]).map(e=>[e.id,e]));
  const core=(review.comparisons||[]).filter(c=>c.requirement_type==='core');
  for(const c of review.comparisons||[]){
    if(!['met','partial','conflict','unknown'].includes(c.status))return 'v5每项对照需要status：met/partial/conflict/unknown';
    if(c.status==='conflict'&&(!c.profile_evidence_ids?.length||!c.profile_evidence_ids.some(id=>['objective_experience','objective_achievement'].includes(byId.get(id)?.claim_type))))return '明确不符须引用本人具体事实；未提供证据只能是不确定';
    if(['met','partial'].includes(c.status)&&(!c.profile_evidence_ids?.length||c.support==='unsupported'))return '符合或部分符合须有实际证据支持；缺证保留unknown';
  }
  if(review.ability==='low'&&!core.some(c=>c.status==='conflict'))return '能力低须有已证实的核心要求冲突，不能由缺证推断';
  if(['high','medium'].includes(review.ability)&&core.some(c=>['unknown','conflict'].includes(c.status)))return '决定性核心仍未知或明确冲突时不能判高/中能力';
  if(review.ability==='high'&&core.some(c=>c.status!=='met'))return '高能力须全部决定性核心有符合证据，部分符合不能判高';
  const s=review.evidence_sufficiency;
  if(!s||!Object.hasOwn(EVIDENCE_NAMES,s.status)||!text(s.reason)||!Array.isArray(s.missing)||s.missing.some(x=>!text(x)))return '缺少证据充分性status/reason/missing';
  if(review.ability==='unknown'&&(s.status==='sufficient'||!s.missing.length))return '能力不确定须说明具体缺项，不能声称证据充分';
  return null;
}

export function v5DimensionsProblem(review,profile,job){
  if(!isV5(profile))return null;
  const c=review.city_check,s=review.salary_check;
  if(!c||!Object.hasOwn(CITY_NAMES,c.status)||!['must','prefer','open'].includes(c.importance)||!text(c.user_basis)||!text(c.job_basis))return '缺少城市意愿独立判断';
  const pref=profile.city_preference;
  if(pref?.importance&&c.importance!==pref.importance)return '城市判断不得改变用户城市偏好的重要性';
  if(pref?.state==='unspecified'&&c.status!=='unspecified')return '用户未指定城市不能写成明确不限或匹配';
  if(['explicit','inherited'].includes(pref?.state)&&!pref.values?.length&&c.status!=='unrestricted')return '明确不限城市应为不限制，不作为加分';
  if(pref?.values?.length&&['unspecified','unrestricted'].includes(c.status))return '已给城市偏好不能忽略';
  if(c.status==='met'&&(!job.cities?.length||pref?.values?.length&&!job.cities.some(x=>pref.values.includes(x))))return '城市符合需要目标城市与岗位城市的证据';
  if(!s||!Object.hasOwn(SALARY_NAMES,s.status)||typeof s.raw!=='string'||!text(s.reason)||!text(s.user_basis)||!text(s.job_basis))return '缺少薪资参考独立判断';
  if(['aligned','partial','gap'].includes(s.status)&&!text(s.raw))return '薪资对比需保留真实原值；缺失不能判断达标';
  if(!profile.salary_preference&&s.status!=='not_specified')return '没有薪资偏好只能展示参考原值，不创建匹配目标';
  for(const item of review.interest_checks||[])if(!['role','business','industry','ownership','work_mode','growth','other'].includes(item.dimension))return 'v5意愿检查需要dimension；城市/薪资须单列，通勤不支持';
  if(review.interest==='conflict'&&!review.interest_checks?.some(c=>c.importance==='must'&&c.status==='conflict'))return '意愿否决须有明确不可接受条件的冲突，软偏好不能升级为否决';
  return null;
}

export function v5HardConflict(review){return review.eligibility==='ineligible'||review.ability==='low'||review.interest==='conflict'||review.city_check?.importance==='must'&&review.city_check.status==='conflict';}
export function v5Unknown(review){return review.ability==='unknown'||review.interest==='unknown'||review.eligibility==='unknown'||review.city_check?.importance==='must'&&review.city_check.status==='unknown';}
export function v5ActionProblem(review){
  if(!isV5(review))return null;
  if(v5HardConflict(review)&&review.next_action!=='hold')return '已证实关键冲突应暂不建议，保留其他未知';
  if(!v5HardConflict(review)&&v5Unknown(review)&&review.next_action!=='clarify')return '关键资料不足应补资料后判断，不能当作明确否决或直接投递';
  if(!v5HardConflict(review)&&!v5Unknown(review)&&['hold','clarify'].includes(review.next_action))return '没有明确否决或关键未知，不应使用hold/clarify';
  return null;
}

// Keep location uncertainty as a dimension, not a failure to read an otherwise complete JD.
export function allowLocationReview(result,profile){
  if(!isV5(profile))return result;
  for(const job of result.jobs||[]){
    if(job.evaluation_status==='needs_verification'&&job.body_complete&&job.open_status==='open'&&job.verification_issues?.length&&job.verification_issues.every(x=>x.code==='location')){
      job.evaluation_status='to_assess';job.location_review_pending=true;
    }
  }
  if(result.counts){
    for(const key of ['to_assess','needs_verification','missing_body'])result.counts[key]=(result.jobs||[]).filter(j=>j.evaluation_status===key).length;
  }
  return result;
}
