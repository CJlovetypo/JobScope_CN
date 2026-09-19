import {runtimeContext} from '../../runtime-context.mjs';

export const SEARCH_MODES = Object.freeze({
  campus: {id:'campus', status:'formal', label:'校招', report:'校招岗位匹配.xlsx'},
  internship: {id:'internship', status:'internship', label:'实习', report:'实习岗位匹配.xlsx'},
  social: {id:'social', status:'social', label:'社招', report:'社招岗位匹配.xlsx'},
});
const configured=runtimeContext().mode;
export function searchMode(value=configured) {
  if(!Object.hasOwn(SEARCH_MODES,value))throw Error('未知招聘方向：'+value);
  return SEARCH_MODES[value];
}
export const SEARCH_MODE=searchMode();
export const TARGET_STATUS=SEARCH_MODE.status;
export const MODE_POLICY_VERSION='2026-09-19-direction-v2-target-api-proof';
export function isTargetJob(job,mode=SEARCH_MODE.id) { return job.formal_status===searchMode(mode).status; }
export function knownOtherType(job,mode=SEARCH_MODE.id) {
  return ['formal','internship','social','activity','parttime'].includes(job.formal_status)&&!isTargetJob(job,mode);
}
export function modeProfileProblem(profile,mode=SEARCH_MODE.id) {
  if(mode==='campus')return null;
  if(profile.search_mode&&profile.search_mode!==mode)return '画像招聘方向与当前 Skill 不一致，请创建独立运行';
  if(typeof profile.degree!=='string'||!profile.degree.trim())return '请补充学历';
  if(mode==='social')return typeof profile.employment_years!=='number'||!Number.isFinite(profile.employment_years)||profile.employment_years<0
    ?'社招请提供正式工作年限 employment_years（无正式工作可填0，不把实习自动折算为工作年限）':null;
  if(typeof profile.graduation!=='string'||!profile.graduation.trim())return '实习请提供预计毕业时间';
  if(!['enrolled','graduated','other'].includes(profile.student_status))return '实习请确认 student_status：enrolled／graduated／other';
  const a=profile.internship_availability;
  if(!a||typeof a!=='object')return '实习请记录 internship_availability：start_date、days_per_week、duration_months；尚未确定的项填null';
  if(a.days_per_week!=null&&(!Number.isFinite(a.days_per_week)||a.days_per_week<=0||a.days_per_week>7))return '每周实习天数须在0到7之间';
  if(a.duration_months!=null&&(!Number.isFinite(a.duration_months)||a.duration_months<=0))return '实习月数必须为正数或null';
  return null;
}
export function eligibilityFields(mode=SEARCH_MODE.id) {
  return mode==='internship'?['degree','student_status','graduation','start_date','days_per_week','duration_months']
    :mode==='social'?['degree','employment_years','mandatory_qualifications','start_date']:['degree','graduation'];
}
export function eligibilityPolicy(mode=SEARCH_MODE.id) {
  if(mode==='campus')return '只核对届别与学历；用户画像必须有graduation和degree。任一项明确冲突即ineligible；JD未写某项限制按未发现冲突处理。';
  return (mode==='internship'?'核对学历、在校身份、明确届别窗口、开始时间、每周天数和持续月数。转正机会不是正式录用承诺。'
    :'核对学历、JD明确要求的正式/相关工作年限、必须的职业资格及硬性到岗时间；毕业届别不是社招默认门槛，实习不能自动折算正式工作年限。')
    +' 每项填写eligibility_checks（field、status:met/conflict/not_stated/unknown、jd_requirement、candidate_fact）。未要求的条件用not_stated；有明确要求但用户资料缺失用unknown，不能假定符合。任一conflict则ineligible，否则任一unknown则unknown，否则eligible；unknown不使用apply。';
}
export function modeEligibilityProblem(review,profile,mode=SEARCH_MODE.id) {
  if(mode==='campus')return null;
  const problem=modeProfileProblem(profile,mode);if(problem)return problem;
  if(!Array.isArray(review.eligibility_checks))return '缺少当前方向的逐项eligibility_checks';
  const seen=new Set();
  for(const item of review.eligibility_checks) {
    if(!eligibilityFields(mode).includes(item.field)||seen.has(item.field))return '硬性条件字段无效或重复';
    seen.add(item.field);
    if(!['met','conflict','not_stated','unknown'].includes(item.status)||![item.jd_requirement,item.candidate_fact].every(x=>typeof x==='string'&&x.trim()))return '每项硬性条件须保存JD要求、用户事实和有效状态';
  }
  if(eligibilityFields(mode).some(k=>!seen.has(k)))return '实习／社招硬性条件检查未覆盖全部必需维度';
  const expected=review.eligibility_checks.some(x=>x.status==='conflict')?'ineligible':review.eligibility_checks.some(x=>x.status==='unknown')?'unknown':'eligible';
  if(review.eligibility!==expected)return '硬性条件总判断与逐项证据矛盾';
  if(expected==='unknown'&&review.next_action==='apply')return '明确要求的个人条件未确认，不能建议直接投递；先准备或暂缓';
  return null;
}
