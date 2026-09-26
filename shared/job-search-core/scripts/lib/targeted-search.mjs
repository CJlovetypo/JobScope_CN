import {createHash} from 'node:crypto';

const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function validateSearchPlan(plan,companies){
 if(!plan||plan.mode!=='targeted')throw Error('定向检索需要 mode=targeted 的明确检索计划');
 if(typeof plan.target!=='string'||!plan.target.trim())throw Error('检索计划缺少岗位目标');
 if(!Array.isArray(plan.keywords)||!plan.keywords.length||plan.keywords.length>30||plan.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>80))throw Error('keywords 需要 1–30 个明确的岗位标题词');
 if(!Array.isArray(plan.company_ids)||!plan.company_ids.length)throw Error('检索计划需要明确候选公司');
 const known=new Set(companies.map(c=>c.company_id));if(new Set(plan.company_ids).size!==plan.company_ids.length||plan.company_ids.some(id=>!known.has(id)))throw Error('定向候选包含未知或重复公司');
 if(!Array.isArray(plan.company_reasons)||plan.company_ids.some(id=>!plan.company_reasons.some(r=>r.company_id===id&&typeof r.reason==='string'&&r.reason.trim()&&r.business_basis)))throw Error('每家候选公司需要业务依据和入选理由');
 if(!Array.isArray(plan.keyword_reasons)||plan.keywords.some(word=>!plan.keyword_reasons.some(r=>r.keyword===word&&typeof r.reason==='string'&&r.reason.trim())))throw Error('每个标题词需要语义扩展理由');
 if(plan.exclude_keywords!=null&&(!Array.isArray(plan.exclude_keywords)||plan.exclude_keywords.some(k=>typeof k!=='string'||!k.trim())))throw Error('exclude_keywords 必须为非空字符串数组');
 return {...plan,keywords:[...new Set(plan.keywords.map(k=>k.trim()))],exclude_keywords:plan.exclude_keywords||[],coverage_notice:'定向检索只覆盖候选公司和命中标题的岗位，可能漏掉标题未体现的机会。'};
}
export function matchesSearchTitle(title,plan){
 const text=norm(title);return plan.keywords.some(k=>text.includes(norm(k)))&&!(plan.exclude_keywords||[]).some(k=>text.includes(norm(k)));
}
export function searchPlanFingerprint(plan){return createHash('sha256').update(JSON.stringify({retrieval_policy:'verified_native_else_title_filter_v1',mode:plan.mode,target:plan.target,company_ids:[...plan.company_ids].sort(),keywords:[...plan.keywords].sort(),exclude_keywords:[...plan.exclude_keywords||[]].sort()})).digest('hex');}
export function nativeKeywordParameter(provider){return ({huatie_public:'keywords',beisen:'KeyWords',moka:'keyword',feishu:'keyword',workday:'searchText','51job_xyz':'keyWord'})[provider]||null;}
export function applyTargetedResult(result,plan,capability){
 const jobs=(result.jobs||[]).filter(j=>matchesSearchTitle(j.title,plan));
 return {...result,jobs,search_mode:'targeted',search_plan_fingerprint:searchPlanFingerprint(plan),coverage:{...result.coverage,search_scope:'targeted_titles',market_complete:false,search_plan:{target:plan.target,keywords:plan.keywords,exclude_keywords:plan.exclude_keywords},search_strategy:capability,unfiltered_observed_rows:result.jobs?.length||0,title_matches:jobs.length,search_limitation:plan.coverage_notice||'定向标题检索可能遗漏隐含岗位信息。'}};
}
