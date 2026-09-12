#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {SKILL_ROOT,readJson,writeJson,workspacePath,mapLimit,stamp,relative} from './lib/io.mjs';
import {normalizeJobLocations,normalizeCityFilters,companyCityMatches,jobCityStatus} from './lib/locations.mjs';
import {jobFingerprint} from './lib/job-version.mjs';
import {reviewNeedsUpdate} from './lib/reports.mjs';
import {ASSESSMENT_VERSION, MATCH_MATRIX} from './lib/matching.mjs';
import {assertOwnershipDatasetComplete, ownershipDatasetProblems} from './lib/ownership.mjs';
import {profileFingerprint, profileEvidenceProblem} from './lib/evidence-model.mjs';
import {reviewRecruitment, restoreRequestRecruitmentEvidence, verificationIssues} from './lib/recruitment-policy.mjs';
import {reviewJobBody} from './lib/body-review.mjs';
import {screeningSummary, readEvaluationScope, inEvaluationScope, planAssessment} from './lib/evaluation-scope.mjs';
import {writeJdArchive} from './lib/jd-archive.mjs';
const [command,...args]=process.argv.slice(2);
const flags={};for(let i=0;i<args.length;i++){if(!args[i].startsWith('--'))throw new Error('未知参数 '+args[i]);const key=args[i].slice(2);flags[key]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;}
const sources=(await readJson(path.join(SKILL_ROOT,'assets/sources.json'))).companies;
const cityFile=path.join(SKILL_ROOT,'data/company-city-index.json');
const businessFile=path.join(SKILL_ROOT,'data/company-business-tags.json');
const ownershipFile=path.join(SKILL_ROOT,'data/company-ownership-tags.json');
function enrich(job,source) {
 job=reviewRecruitment(job);if(!job.body_complete&&!['manual_full_record_review','model_full_available_body_and_local_evidence_review'].includes(job.body_review?.method))job=reviewJobBody(job);const loc=normalizeJobLocations(job);
 return {...job,company_id:source.company_id,company_name:source.display_name,cities:loc.cities,location_special:loc.special,
  location_unresolved:loc.unresolved,location_unknown:loc.unknown,location_code_evidence:loc.code_evidence,
  location_structured_evidence:loc.structured_evidence||[],location_description_evidence:loc.description_evidence,
  location_title_evidence:loc.title_evidence||[],locations_raw:loc.raw};
}
function businessAlignment(source,tag,profile) {
 const wanted=profile.business_preferences||[],avoided=profile.avoid_business_tags||[],actual=tag?.business_tags||[];
 if (!wanted.length&&!avoided.length)return {status:'not_set',reason:'未设置公司业务倾向'};
 if (actual.some(t=>avoided.includes(t)))return {status:'mismatch',reason:'命中用户不希望优先的业务标签'};
 if (!actual.length||tag?.status==='unknown')return {status:'unknown',reason:'公司业务标签尚未确认'};
 if (!wanted.length)return {status:'aligned',reason:'未命中用户不希望优先的业务标签'};
 const matches=wanted.filter(t=>actual.includes(t));const aligned=profile.business_match==='all'?matches.length===wanted.length:matches.length>0;
 return {status:aligned?'aligned':'mismatch',reason:aligned?'业务标签符合：'+matches.join('、'):'公司业务标签与本次倾向不符'};
}
async function collect(source,options) {
 const {collectCommon}=await import('./lib/providers-common.mjs');const {collectCustom}=await import('./lib/providers-custom.mjs');
 try {const result=await collectCommon(source,options)||await collectCustom(source,options);if(!result)throw new Error('未配置该来源采集器');result.jobs=(result.jobs||[]).map(j=>enrich(j,source));return result;}
 catch(e){return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[],coverage:{status:'failed',pages:0,server_total:null,jobs_observed:0,reason:String(e.message||e)},requests:[]};}
}
function chooseSources() {const only=flags.only?String(flags.only).split(','):null;let chosen=only?sources.filter(s=>only.includes(s.company_id)||only.includes(s.display_name)):sources;if(only&&chosen.length!==only.length)throw new Error('--only 含未识别或重复公司');if(flags.providers)chosen=chosen.filter(s=>String(flags.providers).split(',').includes(s.provider));return chosen;}
function integer(name,fallback,max) {const v=Number(flags[name]??fallback);if(!Number.isInteger(v)||v<1||v>max)throw new Error('--'+name+' 超出范围');return v;}
function applyJobScope(result,filters) {
 const counts={total:result.jobs.length,nonformal:0,not_open:0,other_city:0,needs_verification:0,incomplete_body:0,to_assess:0};
 for(const j of result.jobs){
  j.jd_fingerprint=jobFingerprint(j);
  j.city_status=jobCityStatus(j,filters);
  if(['internship','social','activity','parttime'].includes(j.formal_status)){j.evaluation_status='excluded_nonformal';counts.nonformal++;}
  else if(j.open_status==='closed'){j.evaluation_status='excluded_closed';counts.not_open++;}
  else if(j.city_status==='excluded'){j.evaluation_status='excluded_city';counts.other_city++;}
  else if(j.formal_status!=='formal'||j.open_status!=='open'||j.city_status==='unknown'){j.evaluation_status='needs_verification';counts.needs_verification++;}
  else if(!j.body_complete){j.evaluation_status='missing_body';counts.incomplete_body++;}
  else {j.evaluation_status='to_assess';counts.to_assess++;}
  j.verification_issues=['needs_verification','missing_body'].includes(j.evaluation_status)?verificationIssues(j):[];
 }
 result.counts=counts;return result;
}
async function refreshCities() {
 const selected=chooseSources(),previous=await readJson(cityFile,{companies:[]}),byId=new Map(previous.companies.map(c=>[c.company_id,c]));
 const dir=workspacePath(flags.out?path.resolve(String(flags.out)):path.join(SKILL_ROOT,'artifacts/implementation/city-refresh-'+stamp()));
 const results=await mapLimit(selected,integer('concurrency',3,8),async(source)=>{
  const cache=path.join(dir,source.company_id,'result.json');let result=flags.resume?await readJson(cache,null):null;
  if(!result||result.coverage.status!=='complete') {result=await collect(source,{mode:'list',maxPages:integer('max-pages',1000,10000),pageSize:20,timeoutMs:20000,evidenceDir:path.dirname(cache)});await writeJson(cache,result);}
  const usable=result.jobs.filter(j=>j.formal_status==='formal'&&j.open_status==='open');
  const cities=[...new Set(usable.flatMap(j=>j.cities))].sort();const old=byId.get(source.company_id);
  const unknown=usable.filter(j=>j.location_unknown||j.location_special.length);const uncertain=result.jobs.filter(j=>j.formal_status==='unknown'||j.open_status==='unknown');
  let entry={company_id:source.company_id,display_name:source.display_name,cities,updated_at:result.checked_at,coverage:result.coverage,formal_jobs_observed:usable.length,unknown_location_jobs:unknown.length,uncertain_type_or_status_jobs:uncertain.length,city_coverage_complete:result.coverage.status==='complete'&&!unknown.length&&!uncertain.length,city_evidence:usable.filter(j=>j.cities.length).map(j=>({job_id:j.job_id,title:j.title,cities:j.cities,locations_raw:j.locations_raw,official_url:j.official_url,raw_file:j.raw_file})),result_file:relative(cache)};
  if(result.coverage.status==='failed'&&old)entry={...old,last_refresh_at:result.checked_at,last_refresh_status:'failed',last_refresh_reason:result.coverage.reason};
  byId.set(source.company_id,entry);console.log(JSON.stringify({company:source.display_name,status:result.coverage.status,cities:entry.cities,jobs:result.jobs.length}));return entry;
 });
 const index={schema_version:1,updated_at:new Date().toISOString(),companies:sources.map(s=>byId.get(s.company_id)||{company_id:s.company_id,display_name:s.display_name,cities:[],updated_at:null,coverage:{status:'not_initialized'},city_coverage_complete:false})};
 await writeJson(cityFile,index);console.log(JSON.stringify({city_index:cityFile,refreshed:results.length,complete:results.filter(r=>r.coverage.status==='complete').length,with_city_tags:index.companies.filter(c=>c.cities.length).length}));
}
async function prepare() {
 if(!flags.profile)throw new Error('prepare 需要 --profile（由 skill 按用户材料整理）');
 const profile=await readJson(path.resolve(String(flags.profile)));profile.city_filters=normalizeCityFilters(profile.city_filters||[]);
 const evidence=profile.evidence||[];if(!evidence.length)throw new Error('缺少可核对的简历／经历证据；请先补充材料');
 if(new Set(evidence.map(e=>e.id)).size!==evidence.length||evidence.some(e=>!e.id||!e.text))throw new Error('个人证据需要唯一 id 和具体 text');
 const profileProblem=profileEvidenceProblem(profile);if(profileProblem)throw new Error('个人画像需补齐证据分类：'+profileProblem);
 const city=await readJson(cityFile,null);if(profile.city_filters.length&&!city)throw new Error('城市索引尚未建立，请先 refresh-cities');
 const business=await readJson(businessFile,{companies:[]}),ownership=await readJson(ownershipFile,{companies:[]});assertOwnershipDatasetComplete(sources,ownership);const cities=new Map((city?.companies||[]).map(c=>[c.company_id,c]));const businesses=new Map(business.companies.map(c=>[c.company_id,c]));const ownerships=new Map(ownership.companies.map(c=>[c.company_id,c]));
 const dir=workspacePath(flags.out?path.resolve(String(flags.out)):path.join(SKILL_ROOT,'runs',stamp()));
 if(await readJson(path.join(dir,'run.json'),null))throw new Error('该运行目录已存在，请使用新目录；继续采集用 collect --run');
 const companies=sources.map(s=>{const t=cities.get(s.company_id),b=businesses.get(s.company_id),o=ownerships.get(s.company_id);return {company_id:s.company_id,display_name:s.display_name,selected:companyCityMatches(t,profile.city_filters),city_tags:t?.cities||[],city_index_updated_at:t?.updated_at||null,city_coverage_complete:t?.city_coverage_complete||false,business_tags:b?.business_tags||[],business_summary:b?.business_summary||'',business_alignment:businessAlignment(s,b,profile),ownership_tag:o.ownership_tag,ownership_status:o.status,ownership_reason:o.reason,ownership_evidence:o.evidence,ownership_checked_at:o.checked_at,selection_reason:companyCityMatches(t,profile.city_filters)?'城市标签入选':'当前公司城市标签未命中；本轮直接排除'};});
 const run={schema_version:1,created_at:new Date().toISOString(),profile,profile_fingerprint:profileFingerprint(profile),companies,city_index_updated_at:city?.updated_at||null,status:'prepared',is_test:profile.is_test===true};
 await writeJson(path.join(dir,'run.json'),run);await fs.mkdir(path.join(dir,'assessments'),{recursive:true});
 if(flags['reuse-run']){
  const previous=workspacePath(path.resolve(String(flags['reuse-run'])));
  for(const c of companies.filter(c=>c.selected)){
   const old=await readJson(path.join(previous,'companies',c.company_id+'.json'),null);
   if(old){old.jobs=old.jobs.map(job=>enrich(restoreRequestRecruitmentEvidence(job,old.requests||[]),c));await writeJson(path.join(dir,'companies',c.company_id+'.json'),applyJobScope(old,profile.city_filters));}
  }
 }
 console.log(JSON.stringify({run:dir,selected:companies.filter(c=>c.selected).length,excluded:companies.filter(c=>!c.selected).length}));
}
async function collectRun() {
 if(!flags.run)throw new Error('需要 --run');const dir=workspacePath(path.resolve(String(flags.run))),file=path.join(dir,'run.json'),run=await readJson(file);
 await fs.rm(path.join(dir,'next-batch.json'),{force:true});
 const selected=run.companies.filter(c=>c.selected).sort((a,b)=>(a.business_alignment.status==='aligned'?0:1)-(b.business_alignment.status==='aligned'?0:1));
 await mapLimit(selected,integer('concurrency',3,8),async(c)=>{
  const p=path.join(dir,'companies',c.company_id+'.json');const existing=await readJson(p,null);
  if(existing&&!flags.refresh&&existing.coverage.status==='complete'&&!existing.jobs.some(j=>j.city_status==='included'&&!j.body_complete&&!['internship','social','activity','parttime'].includes(j.formal_status)&&j.open_status!=='closed'))return;
  const source=sources.find(s=>s.company_id===c.company_id),result=await collect(source,{mode:'full',maxPages:integer('max-pages',1000,10000),pageSize:20,timeoutMs:20000,evidenceDir:path.join(dir,'raw',c.company_id),cities:run.profile.city_filters});
  applyJobScope(result,run.profile.city_filters);await writeJson(p,result);console.log(JSON.stringify({company:c.display_name,coverage:result.coverage.status,...result.counts}));
 });
 run.status=(await readEvaluationScope(dir,{required:false}))?'evaluation_scope_confirmed':'awaiting_evaluation_scope';run.collected_at=new Date().toISOString();await writeJson(file,run);
 const archive=await writeJdArchive(dir);
 const summary=await screeningSummary(dir);await writeJson(path.join(dir,'screening-summary.json'),summary);
 console.log(JSON.stringify({screening_summary:path.join(dir,'screening-summary.json'),total_to_assess:summary.total_to_assess,needs_verification:summary.needs_verification,jd_archive:archive.file,next_step:'展示筛选结果，确认用户选择实验批次、指定公司或全量评估后，再 plan-assessment 与 next-batch；已有明确范围时复用。'}));
}
async function nextBatch(dir) {
 dir=workspacePath(dir||path.resolve(String(flags.run||'')));const scope=await readEvaluationScope(dir);const run=await readJson(path.join(dir,'run.json'));const pending=[];let total=0,done=0,fullTotal=0,fullDone=0;
 for(const c of run.companies.filter(c=>c.selected)){
  const result=await readJson(path.join(dir,'companies',c.company_id+'.json'),null);if(!result)continue;
  const reviews=(await readJson(path.join(dir,'assessments',c.company_id+'.json'),{assessments:[]})).assessments;const byId=new Map(reviews.map(r=>[String(r.job_id),r]));
  for(const job of result.jobs.filter(j=>j.evaluation_status==='to_assess')){fullTotal++;job.jd_fingerprint=jobFingerprint(job);const reason=reviewNeedsUpdate(byId.get(String(job.job_id)),job,run.profile);if(!reason)fullDone++;if(!inEvaluationScope(scope,c.company_id,job.job_id))continue;total++;if(!reason){done++;continue;}if(pending.length<integer('limit',20,100))pending.push({company:c,job,assessment_reason:reason});}
 }
 const file=path.join(dir,'next-batch.json');await writeJson(file,{
  profile:run.profile,profile_fingerprint:profileFingerprint(run.profile),profile_validation_issue:profileEvidenceProblem(run.profile),
  evaluation_contract:{
   assessment_version:ASSESSMENT_VERSION,review_method:'full_jd',read_completely:['description','requirements','recruitment_evidence'],
   ability_values:['high','medium','low','unknown'],interest_values:['aligned','explore','conflict','unknown'],
   profile_binding:'每条评估必须写入本批 profile_fingerprint；画像变更后重新评估，禁止给旧结论补指纹。',
   ability_model_reference:'references/ability-model.md',reciprocal_model_reference:'references/reciprocal-model.md',
   interest_checks:'必填数组；覆盖重要偏好，每项 preference、importance(must/prefer/open)、status(met/partial/conflict/unknown)、user_basis、job_basis；无明确偏好可空数组且interest未知。业务偏好只在这里判断一次。',
   hard_condition:'eligibility 只核对届别与学历；用户画像必须有graduation和degree。任一项明确冲突即ineligible并固定low+hold；JD未写某项限制时按未发现硬性冲突处理，不能标unknown。eligibility_reason逐项写明JD要求或“未写限制”及用户实际情况。提前实习、到岗时间、专业要求和轮岗信息不混入此字段。',
   action_fields:'新评估使用next_action(apply/prepare/hold)、priority、priority_reason；high另需timing_evidence。Excel只展示可以投递／投递前准备／暂不建议投递，不展示内部优先级或核实动作。轮岗、业务占比、提前实习等不确定项写入理由，但不能阻止形成投递建议。硬性条件明确不符、意愿冲突或能力为low时必须low+hold。',
   ability_reason:'解释对口实习／项目的个人贡献、成果与核心要求覆盖；按experience_id去重，同一实习拆多条不增加经历数量。',
   comparison_fields:{requirement_type:['core','supporting','bonus','eligibility'],support:['direct','transferable','unsupported'],evidence_strength:['strong','moderate','weak','none']},
   experience_relevance:'为引用的每段客观实习／工作经历记录experience_id、industry_relation、business_relation、role_relation（均为same/adjacent/different/unknown）及explanation；同业务跨岗位、同岗位跨业务保留部分对口价值，按具体JD判定。',
   report_summary:'必填conclusion/ability/interest/gaps四个非空字符串，分别概括评估结论、能力依据、个人意愿、主要缺口；面向读者写总结，保留资格及到岗限制，不罗列E1等编号或逐项分析。',
   evidence_rule:'同等相关性和质量下：实习优先于学校／个人项目，再看其他相关经历；客观经历／成就高于自评。高质量对口项目可支撑高能力，不按头衔、数量或关键词打分。',
   interest_reason:'interest 非 unknown 时必填非空字符串，说明用户明确职能、业务及重要条件或后续说明；能力证据不能代替意愿依据。',match_matrix:MATCH_MATRIX,
   instruction:'完整阅读每个岗位及个人画像后按v4独立评估能力和意愿，匹配层级由两者共同决定；禁止按标题、关键词或模板批量生成结论，禁止从旧匹配层级反推能力。'
  },evaluation_scope:scope,pending,total_to_assess:total,already_assessed:done,remaining:total-done,
  full_total_to_assess:fullTotal,full_already_assessed:fullDone,full_remaining:fullTotal-fullDone,
  outside_scope_remaining:fullTotal-fullDone-(total-done)
 });console.log(JSON.stringify({batch:file,mode:scope.mode,items:pending.length,total,done,remaining:total-done,full_remaining:fullTotal-fullDone,outside_scope_remaining:fullTotal-fullDone-(total-done)}));
}
async function main(){
 if(command==='refresh-cities')return refreshCities();if(command==='prepare')return prepare();if(command==='collect')return collectRun();if(command==='next-batch')return nextBatch();
 if(command==='plan-assessment'){
  if(!flags.run)throw new Error('需要 --run');
  const scope=await planAssessment(path.resolve(String(flags.run)),{mode:flags.mode,only:flags.only,limit:flags.limit,jobs:flags.jobs?await readJson(path.resolve(String(flags.jobs))):undefined,userRequest:flags['user-request']});
  console.log(JSON.stringify(scope));return;
 }
 if(command==='screening-summary'){
  if(!flags.run)throw new Error('需要 --run');console.log(JSON.stringify(await screeningSummary(path.resolve(String(flags.run)))));return;
 }
 if(command==='render'){const {renderRun}=await import('./lib/reports.mjs');return renderRun(workspacePath(path.resolve(String(flags.run||''))),{allowPartial:flags['allow-partial']===true,previewDir:flags['preview-dir']?path.resolve(String(flags['preview-dir'])):undefined});}
 if(command==='status'){const tags=await readJson(cityFile,{companies:[]});const biz=await readJson(businessFile,{companies:[]}),ownership=await readJson(ownershipFile,{companies:[]});const ownershipProblems=ownershipDatasetProblems(sources,ownership);const confirmedUnresolved=ownership.companies.filter(c=>c.status==='verified_unresolved'&&c.ownership_tag==='待核实'&&!ownershipProblems.some(p=>p.company_id===c.company_id)).length;console.log(JSON.stringify({sources:sources.length,cities:tags.companies.length,with_cities:tags.companies.filter(c=>c.cities.length).length,business_labels:biz.companies.length,ownership_labels:ownership.companies.length,ownership_decided:sources.length-ownershipProblems.length-confirmedUnresolved,ownership_confirmed_unresolved:confirmedUnresolved,ownership_incomplete:ownershipProblems.length,ownership_ready:ownershipProblems.length===0}));return;}
 console.log('campus.mjs refresh-cities [--only 公司名,公司名] [--resume] [--out 路径]\ncampus.mjs prepare --profile profile.json [--out 运行目录]\ncampus.mjs collect --run 运行目录 [--refresh]\ncampus.mjs screening-summary --run 运行目录\ncampus.mjs plan-assessment --run 运行目录 --mode sample|companies|all --user-request 用户明确需求 [--limit 实验数量] [--only 公司名,公司名] [--jobs 岗位键JSON]\ncampus.mjs next-batch --run 运行目录 [--limit 20]\ncampus.mjs render --run 运行目录 [--allow-partial]\ncampus.mjs status');
}
await main();
