// Main agent is the only ledger/assessment writer. Workers only publish immutable submissions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readJson, writeJson, workspacePath} from './io.mjs';
import {readEvaluationScope, inEvaluationScope} from './evaluation-scope.mjs';
import {jobFingerprint} from './job-version.mjs';
import {profileFingerprint, profileEvidenceProblem, abilityEvidenceProblem} from './evidence-model.mjs';
import {reviewNeedsUpdate} from './reports.mjs';
import {actionProblem, interestProblem} from './matching.mjs';
import {isV5,modelVersion,v5HardConflict,v5Unknown,V5_INSTRUCTION} from './assessment-v5.mjs';

export const jobKey = (company, job) => JSON.stringify([company, String(job)]);
const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const now = () => new Date().toISOString();
const root = dir => path.join(workspacePath(dir), 'parallel', 'batches');
const ledgerFile = dir => path.join(root(dir), 'state.json');
const batchDir = (dir, id) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id || '')) throw new Error('无效批次 ID');
  return path.join(root(dir), id);
};
const active = batch => !batch.closed_at;
function toolDuration(start,end) {
  if(start===undefined&&end===undefined)return null;
  const ms=Date.parse(end)-Date.parse(start);
  if(!Number.isFinite(ms)||ms<0)throw new Error('工具调用起止时间无效');
  return {started_at:start,finished_at:end,duration_ms:ms};
}
const evidenceFields = ['ability', 'ability_reason', 'experience_relevance', 'interest', 'interest_checks', 'interest_reason', 'eligibility', 'eligibility_reason', 'eligibility_checks', 'conclusion', 'comparisons', 'transferable_evidence', 'gaps', 'early_internship', 'employment_conditions', 'next_step', 'next_action', 'report_summary', 'review_method','city_check','salary_check','evidence_sufficiency'];

// Only deterministic identity/action fields are supplied here. No ability or interest inference.
export function bindReview(item, profile, judgment) {
  const review = Object.fromEntries(evidenceFields.filter(k => Object.hasOwn(judgment, k)).map(k => [k, judgment[k]]));
  Object.assign(review, {job_id:String(item.job.job_id), assessment_version:modelVersion(profile),
    jd_fingerprint:jobFingerprint(item.job), profile_fingerprint:profileFingerprint(profile)});
  if (review.ability === 'low' || review.interest === 'conflict' || review.eligibility === 'ineligible') review.next_action = 'hold';
  if(isV5(profile)&&v5HardConflict(review))review.next_action='hold';
  review.priority = review.next_action === 'hold' ? 'low' : 'normal';
  review.priority_reason = review.next_step;
  review.timing_evidence = '';
  return review;
}

export function submissionProblems(review, job, profile) {
  const errors = [];
  const required = ['ability_reason','interest_reason','eligibility_reason','conclusion','next_step'];
  for (const field of required) if (typeof review[field] !== 'string' || !review[field].trim()) errors.push('缺少 '+field);
  for (const field of ['conclusion','ability','interest','gaps']) if (!review.report_summary?.[field]?.trim?.()) errors.push('缺少 report_summary.'+field);
  for (const [i,c] of (Array.isArray(review.comparisons) ? review.comparisons : []).entries()) {
    if (!c?.jd_requirement || !c?.explanation) errors.push('对照 '+i+' 缺少要求或解释');
    for (const id of Array.isArray(c?.profile_evidence_ids) ? c.profile_evidence_ids : []) if (!profile.evidence.some(e=>e.id===id)) errors.push('引用了不存在的个人证据 '+id);
  }
  for (const check of [() => reviewNeedsUpdate(review,job,profile), () => abilityEvidenceProblem(review,profile), () => actionProblem(review), () => interestProblem(review)]) {
    try { const problem=check(); if(problem) errors.push(problem); } catch { errors.push('评估结构不完整'); }
  }
  return [...new Set(errors)];
}

async function context(dir) {
  const run=await readJson(path.join(dir,'run.json')), scope=await readEvaluationScope(dir);
  const issue=profileEvidenceProblem(run.profile);
  if(issue) throw new Error(issue);
  return {run,scope,version:hash([profileFingerprint(run.profile),scope])};
}

async function scan(dir, ctx) {
  const jobs={};
  for (const company of ctx.run.companies.filter(c=>c.selected)) {
    const data=await readJson(path.join(dir,'companies',company.company_id+'.json'),{jobs:[]});
    const reviews=(await readJson(path.join(dir,'assessments',company.company_id+'.json'),{assessments:[]})).assessments;
    const byId=new Map();
    for (const review of reviews) {
      if(byId.has(String(review.job_id))) throw new Error('正式记录重复岗位 '+company.company_id+'/'+review.job_id);
      byId.set(String(review.job_id),review);
    }
    for(const job of data.jobs) {
      if(job.evaluation_status!=='to_assess'||!inEvaluationScope(ctx.scope,company.company_id,job.job_id)) continue;
      const review=byId.get(String(job.job_id)),problem=reviewNeedsUpdate(review,job,ctx.run.profile);
      jobs[jobKey(company.company_id,job.job_id)]={company_id:company.company_id,job_id:String(job.job_id),status:problem?(review?'repair':'pending'):'done',reason:problem,baseline:hash(review)};
    }
  }
  // Preserve an explicitly saved sample order; never reinterpret the user's scope.
  const keys=ctx.scope.jobs?.map(j=>jobKey(j.company_id,j.job_id))||Object.keys(jobs);
  return Object.fromEntries(keys.filter(k=>jobs[k]).map(k=>[k,jobs[k]]));
}

async function stateFor(dir, {refresh=false}={}) {
  const ctx=await context(dir);
  let state=await readJson(ledgerFile(dir),null);
  if(state?.needs_refresh)refresh=true;
  if(state && state.version!==ctx.version) {
    if(state.batches.some(active))throw new Error('仍有未关闭批次，不能改变画像或范围');
    if(state.profile_fingerprint!==profileFingerprint(ctx.run.profile))throw new Error('画像已变更，请使用新运行目录');
    refresh=true; // An explicitly confirmed scope expansion can reuse completed assessments.
  }
  if(refresh && state?.batches.some(active)) throw new Error('仍有未关闭批次；先回收并关闭执行者再恢复核对');
  if(!state || refresh) {
    state={schema_version:1,version:ctx.version,profile_fingerprint:profileFingerprint(ctx.run.profile),created_at:state?.created_at||now(),jobs:await scan(dir,ctx),batches:state?.batches||[]};
    state.reconciled_at=now();
    await writeJson(ledgerFile(dir),state);
  }
  return {ctx,state};
}

export async function createBatch(dir, {limit=50,maxChars=160000,concurrency=4,keys}={}) {
  const begin=performance.now();
  dir=workspacePath(dir);
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(maxChars)||maxChars<1000||!Number.isInteger(concurrency)||concurrency<1||concurrency>8) throw new Error('批次参数超出范围');
  const {ctx,state}=await stateFor(dir);
  if(keys!==undefined&&(!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length||keys.some(k=>!Object.hasOwn(state.jobs,k)))) throw new Error('指定岗位键必须唯一且属于本次范围');
  if(state.batches.filter(active).length>=concurrency) throw new Error('并发槽位已满，请先回收关闭已完成批次');
  const reserved=new Set(state.batches.filter(active).flatMap(b=>b.keys));
  const items=[],companies={},baselines={},cache=new Map();
  let chars=JSON.stringify(ctx.run.profile).length;
  for(const [key,entry] of Object.entries(state.jobs)) {
    if(keys&&!keys.includes(key)) continue;
    if(entry.status==='done'||reserved.has(key)) continue;
    if(!cache.has(entry.company_id)) cache.set(entry.company_id,await readJson(path.join(dir,'companies',entry.company_id+'.json')));
    const job=cache.get(entry.company_id).jobs.find(j=>String(j.job_id)===entry.job_id);
    if(!job) throw new Error('岗位快照已变更，请关闭批次后 batch-status --refresh');
    const size=JSON.stringify(job).length;
    if(items.length && (items.length>=limit||chars+size>maxChars)) break;
    const company=ctx.run.companies.find(c=>c.company_id===entry.company_id);
    companies[entry.company_id]={company_id:company.company_id,display_name:company.display_name,business_tags:company.business_tags,business_summary:company.business_summary,ownership_tag:company.ownership_tag};
    items.push({key,job}); baselines[key]=entry.baseline; chars+=size;
  }
  if(!items.length) return {batch_id:null,items:0};
  const id='batch-'+randomUUID(),created=now(),folder=batchDir(dir,id);
  const input={batch_id:id,profile:ctx.run.profile,companies,items,...(isV5(ctx.run.profile)?{assessment_instruction:V5_INSTRUCTION,assessment_reference:'shared/job-search-core/references/assessment-v5.md'}:{})};
  await writeJson(path.join(folder,'input.json'),input);
  await writeJson(path.join(folder,'result-template.json'),{items:items.map(i=>({key:i.key,title:i.job.title,review:null}))});
  state.batches.push({id,keys:items.map(x=>x.key),baselines,input_hash:hash(input),created_at:created,prepare_ms:Math.round(performance.now()-begin),agent_id:null,events:[{type:'prepared',at:created}],merged:[],errors:{}});
  await writeJson(ledgerFile(dir),state);
  return {batch_id:id,input:path.join(folder,'input.json'),items:items.length,input_chars:chars,oversize:chars>maxChars};
}

async function loadBatch(dir,id) {
  const state=await readJson(ledgerFile(dir)),batch=state.batches.find(b=>b.id===id);
  if(!batch) throw new Error('批次不存在');
  const input=await readJson(path.join(batchDir(dir,id),'input.json'));
  if(hash(input)!==batch.input_hash) throw new Error('固定输入被修改，请停止该批次');
  return {state,batch,input};
}

export async function startBatch(dir,id,agentId,{toolStartedAt,toolFinishedAt}={}) {
  if(typeof agentId!=='string'||!agentId.trim()) throw new Error('需要执行者 ID');
  const {state,batch}=await loadBatch(dir,id);
  if(!active(batch)) throw new Error('批次已经关闭');
  if(batch.agent_id && batch.agent_id!==agentId) throw new Error('该批次已有其他执行者');
  const timing=toolDuration(toolStartedAt,toolFinishedAt);
  if(timing&&!batch.dispatch)batch.dispatch=timing;
  if(!batch.agent_id){batch.agent_id=agentId;batch.started_at=now();batch.events.push({type:'started',at:batch.started_at,agent_id:agentId});}
  await writeJson(ledgerFile(dir),state);
  return {batch_id:id,agent_id:agentId,started_at:batch.started_at};
}

export async function submitBatch(dir,id,agentId,items) {
  const {batch,input}=await loadBatch(dir,id);
  if(!active(batch)||!batch.agent_id||batch.agent_id!==agentId) throw new Error('批次已关闭或执行者不匹配');
  if(!Array.isArray(items)||!items.length) throw new Error('提交必须包含完整岗位记录');
  const byKey=new Map(input.items.map(x=>[x.key,x])),seen=new Set(),accepted=[],errors={};
  for(const item of items) {
    if(!byKey.has(item.key)||seen.has(item.key)) throw new Error('岗位不属于本批次或提交包含重复岗位键');
    seen.add(item.key);
    if(!item.review || typeof item.review!=='object') {errors[item.key]=['缺少 review'];continue;}
    // Workers fill judgments only, so pasted identities cannot silently rebind a record.
    if(['company_id','job_id','jd_fingerprint','profile_fingerprint','assessment_version','match_tier','priority'].some(k=>Object.hasOwn(item.review,k))) {errors[item.key]=['仅填写判断字段；岗位身份、指纹、版本和内部排序由程序绑定'];continue;}
    const review=bindReview(byKey.get(item.key),input.profile,item.review);
    const problems=submissionProblems(review,byKey.get(item.key).job,input.profile);
    if(problems.length) errors[item.key]=problems; else accepted.push({key:item.key,review});
  }
  // One immutable file per submission; partial/in-progress files never enter the merge scan.
  const file=path.join(batchDir(dir,id),'submissions',randomUUID()+'.json');
  await writeJson(file,{batch_id:id,agent_id:agentId,submitted_at:now(),items:accepted,errors});
  return {submission:file,accepted:accepted.length,errors};
}

export async function mergeBatch(dir,id) {
  const begin=performance.now(),{state,batch,input}=await loadBatch(dir,id);
  if(!active(batch)) throw new Error('批次已经关闭，拒绝迟到结果');
  const ctx=await context(dir);
  if(ctx.version!==state.version) throw new Error('画像或范围已变化');
  const folder=path.join(batchDir(dir,id),'submissions');
  const names=await fs.readdir(folder).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const candidates=new Map(),errors={},inputMap=new Map(input.items.map(i=>[i.key,i])),cache=new Map();
  let returned=0;
  for(const name of names.filter(n=>n.endsWith('.json'))) {
    const submission=await readJson(path.join(folder,name));
    if(submission.batch_id!==id||submission.agent_id!==batch.agent_id) throw new Error('提交执行者不匹配');
    Object.assign(errors,submission.errors);
    for(const item of submission.items) {
      if(!inputMap.has(item.key)) throw new Error('提交岗位超出固定批次');
      if(candidates.has(item.key)&&!isDeepStrictEqual(candidates.get(item.key),item.review)) throw new Error('同岗位存在不同提交，保留结果并停止合并 '+item.key);
      candidates.set(item.key,item.review);
    }
    returned+=submission.items.length;
  }
  // Preflight every company before writing. Atomic company writes + idempotency recover interruption.
  for(const [key,review] of candidates) {
    const item=inputMap.get(key),entry=state.jobs[key],cid=entry.company_id;
    if(!cache.has(cid)) cache.set(cid,{data:await readJson(path.join(dir,'assessments',cid+'.json'),{assessments:[]}),source:await readJson(path.join(dir,'companies',cid+'.json')),dirty:false});
    const cached=cache.get(cid),currentJob=cached.source.jobs.find(j=>String(j.job_id)===entry.job_id);
    if(!currentJob||currentJob.evaluation_status!=='to_assess'||jobFingerprint(currentJob)!==jobFingerprint(item.job)) throw new Error('JD 快照已变化 '+key);
    const problems=submissionProblems(review,item.job,input.profile);
    if(problems.length) throw new Error('提交内容未通过检查 '+key+': '+problems.join('；'));
    const old=cached.data.assessments.filter(a=>String(a.job_id)===entry.job_id);
    if(old.length>1) throw new Error('正式记录有重复岗位 '+key);
    const expected= batch.merged.includes(key) ? entry.baseline : batch.baselines[key];
    if(!isDeepStrictEqual(old[0],review)&&hash(old[0])!==expected) throw new Error('正式记录已被其他执行者修改，拒绝覆盖 '+key);
    if(!isDeepStrictEqual(old[0],review)) {
      if(old[0]) await writeJson(path.join(batchDir(dir,id),'previous',hash(key)+'.json'),{key,review:old[0]});
      cached.data.assessments=cached.data.assessments.filter(a=>String(a.job_id)!==entry.job_id);
      cached.data.assessments.push(review);cached.dirty=true;
    }
    delete errors[key];
  }
  for(const [cid,cached] of cache) if(cached.dirty) await writeJson(path.join(dir,'assessments',cid+'.json'),cached.data);
  const added=[...candidates.keys()].filter(k=>!batch.merged.includes(k));
  for(const [key,review] of candidates){state.jobs[key].status='done';state.jobs[key].reason=null;state.jobs[key].baseline=hash(review);}
  for(const [key,problems] of Object.entries(errors)) if(state.jobs[key]?.status!=='done'){state.jobs[key].status='repair';state.jobs[key].reason=problems.join('；');}
  batch.merged=[...new Set([...batch.merged,...candidates.keys()])];batch.errors=errors;
  batch.returned_valid=candidates.size;
  batch.events.push({type:'merged',at:now(),returned_records:returned,new_items:added.length,duration_ms:Math.round(performance.now()-begin)});
  if(batch.merged.length===batch.keys.length&&!batch.completed_at) batch.completed_at=now();
  await writeJson(ledgerFile(dir),state);
  return {batch_id:id,added:added.length,merged:batch.merged.length,total:batch.keys.length,errors};
}

// Call only AFTER the tool confirms the old agent has stopped, including incomplete batches.
export async function closeBatch(dir,id,{agentId,stopped=false,usageLog,toolStartedAt,toolFinishedAt}={}) {
  const {state,batch}=await loadBatch(dir,id);
  if(batch.agent_id && (!stopped||agentId!==batch.agent_id)) throw new Error('请先关闭原执行者，再提供相同 agent ID 与 --stopped');
  const timing=toolDuration(toolStartedAt,toolFinishedAt);if(timing&&!batch.shutdown)batch.shutdown=timing;
  const folder=path.join(batchDir(dir,id),'submissions');
  const files=await fs.readdir(folder).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const returnedKeys=new Set();
  for(const name of files.filter(n=>n.endsWith('.json'))){
    const submission=await readJson(path.join(folder,name));
    for(const item of submission.items)returnedKeys.add(item.key);
  }
  batch.returned_valid=returnedKeys.size;
  if(!batch.closed_at){batch.closed_at=now();batch.events.push({type:'closed',at:batch.closed_at});}
  if(usageLog) batch.tokens=await readTokenUsage(usageLog);
  await writeJson(ledgerFile(dir),state);
  return {batch_id:id,closed_at:batch.closed_at,returned_valid:batch.returned_valid,merged:batch.merged.length,released:batch.keys.length-batch.merged.length,tokens:batch.tokens??null};
}

export async function readTokenUsage(file) {
  const lines=(await fs.readFile(file,'utf8')).split('\n');
  let first,last;
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim())continue;
    let event;try{event=JSON.parse(lines[i]);}catch(e){if(i===lines.length-1)break;throw e;}
    if(event.payload?.type==='token_count'&&event.payload.info?.total_token_usage){first??=event;last=event;}
  }
  if(!last)return {available:false,source:file};
  // Initial cumulative history may have been inherited: subtract the initial baseline.
  const a=first.payload.info,b=last.payload.info.total_token_usage,usage={};
  for(const field of ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens']) {
    usage[field]=a.last_token_usage?.[field]==null||b[field]==null?null:b[field]-((a.total_token_usage[field]??0)-a.last_token_usage[field]);
  }
  return {available:true,source:file,first_at:first.timestamp,last_at:last.timestamp,...usage,note:'日志记录的执行区间；缓存属于输入，推理属于输出，不重复相加；不是费用'};
}

export async function batchStatus(dir,{refresh=false}={}) {
  let state=await readJson(ledgerFile(dir),null);
  if(!state||refresh||state.needs_refresh) ({state}=await stateFor(dir,{refresh}));
  const reserved=new Set(state.batches.filter(active).flatMap(b=>b.keys)),counts={total:0,done:0,pending:0,repair:0,in_flight:0};
  for(const [key,entry] of Object.entries(state.jobs)){counts.total++;counts[entry.status]++;if(entry.status!=='done'&&reserved.has(key))counts.in_flight++;}
  return {...counts,remaining:counts.total-counts.done,reconciled_at:state.reconciled_at,batches:state.batches.map(b=>({id:b.id,agent_id:b.agent_id,total:b.keys.length,returned_valid:b.returned_valid??null,merged:b.merged.length,errors:b.errors,created_at:b.created_at,started_at:b.started_at??null,completed_at:b.completed_at??null,closed_at:b.closed_at??null,execution_ms:b.started_at&&(b.completed_at||b.closed_at)?Date.parse(b.completed_at||b.closed_at)-Date.parse(b.started_at):null,prepare_ms:b.prepare_ms??null,dispatch_ms:b.dispatch?.duration_ms??null,shutdown_ms:b.shutdown?.duration_ms??null,merge_ms:b.events.filter(e=>e.type==='merged').reduce((s,e)=>s+e.duration_ms,0),tokens:b.tokens??null}))};
}
