import {datasetPath} from '../../shared/job-search-core/registry.mjs';
// Every registry configuration is exercised independently in its target skill.
// Positive witnesses prove current target jobs, never exhaustive market coverage.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {targetApiProof} from './lib/target-api-proof.mjs';
const filename=fileURLToPath(import.meta.url),pack=path.resolve(path.dirname(filename),'../..');
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const write=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');};

if(!isMainThread){
 const {skill,mode}=workerData;
 const {collectEndpoint}=await import(pathToFileURL(path.join(skill,'scripts/lib/source-collector.mjs')));
 const {reviewRecruitment}=await import(pathToFileURL(path.join(skill,'scripts/lib/recruitment-policy.mjs')));
 const {reviewJobBody}=await import(pathToFileURL(path.join(skill,'scripts/lib/body-review.mjs')));
 const fetchNative=globalThis.fetch;
 parentPort.on('message',async task=>{
  let requests=0;const started=Date.now(),deadline=AbortSignal.timeout(task.timeoutMs);
  globalThis.fetch=async(url,options={})=>{
   if(++requests>task.maxRequests)throw Error('validation_request_budget_reached');
   return fetchNative(url,{...options,signal:options.signal?AbortSignal.any([options.signal,deadline]):deadline});
  };
  try {
   const result=await collectEndpoint(task.source,{mode:'full',targetMode:mode,maxPages:task.maxPages,pageSize:30,maxDetails:6,detailConcurrency:2,timeoutMs:12000,evidenceDir:path.join(task.dir,'http'),refresh:true,preferTargetTypes:task.phase!=='phase1'});
   const jobs=(result.jobs||[]).map(j=>reviewRecruitment(reviewJobBody(j),mode));
   const targets=jobs.filter(j=>j.formal_status===mode),open=targets.filter(j=>j.open_status==='open');
   const valid=job=>job.body_complete&&job.job_id&&/^https?:\/\//i.test(job.official_url||'')&&job.raw_file;
   const full=jobs.filter(j=>j.open_status==='open').filter(valid).filter(j=>targetApiProof(j,task.source,mode).accepted),counts={};for(const job of jobs)counts[job.formal_status||'unknown']=(counts[job.formal_status||'unknown']||0)+1;
   const state=full.length?'verified_current_target':open.length?'target_detail_unverified':targets.length?'target_not_open':jobs.length?'no_target_in_observed_rows':result.coverage?.status==='failed'?'request_failed':'empty_or_unresolved';
   const row={key:task.key,company_id:task.source.company_id,company:task.source.display_name,source_id:task.source.source_id,provider:task.source.provider,entry_url:task.source.primary_entry_url,mode,phase:task.phase,source_hash:hash(task.source),checked_at:new Date().toISOString(),elapsed_ms:Date.now()-started,status:state,verified:full.length>0,jobs_observed:jobs.length,type_counts:counts,target_observed:targets.length,target_open:open.length,target_full:full.length,fetch_requests:Math.min(requests,task.maxRequests),request_budget_reached:requests>task.maxRequests,coverage:result.coverage,limits:{pages:task.maxPages,requests:task.maxRequests,timeout_ms:task.timeoutMs},witnesses:full.slice(0,2),target_examples:full.length?[]:targets.slice(0,2),other_examples:full.length?[]:jobs.slice(0,2),requests:result.requests||[],result_file:path.join(task.dir,'result.json')};
   await write(row.result_file,row);parentPort.postMessage({row});
  }catch(error){const row={key:task.key,company_id:task.source.company_id,company:task.source.display_name,source_id:task.source.source_id,provider:task.source.provider,entry_url:task.source.primary_entry_url,mode,phase:task.phase,source_hash:hash(task.source),checked_at:new Date().toISOString(),elapsed_ms:Date.now()-started,status:'request_failed',verified:false,error:error.message,fetch_requests:requests,result_file:path.join(task.dir,'result.json')};await write(row.result_file,row);parentPort.postMessage({row});}
 });
}else{
 const flags=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
 const phase=flags.phase||'phase1',concurrency=Number(flags.concurrency||12),hostConcurrency=Number(flags['per-host']||2),maxPages=Number(flags.pages||2),maxRequests=Number(flags.requests||32),timeoutMs=Number(flags.timeout||75000);
 const skillNames=flags.skill?[flags.skill]:['internship-job-fit','social-job-fit'];
 const all=[],rows=[],byHost=new Map();
 for(const name of skillNames){
  const skill=path.join(pack,name),mode=name.startsWith('internship')?'internship':'social',base=path.join(skill,'artifacts/direction-api-audit-20260919');
  const registry=JSON.parse(await fs.readFile(datasetPath(skill,'assets/sources.json'),'utf8'));
  const snapshot=path.join(base,'registry-snapshot.json');try{await fs.access(snapshot);}catch{await write(snapshot,registry);}
  for(const c of registry.companies)for(const [index,s] of (c.recruitment_sources?.length?c.recruitment_sources:[c]).entries()){
   const source={...s,company_id:c.company_id,display_name:c.display_name},key=hash([c.company_id,s.source_id||index,source]).slice(0,24),dir=path.join(base,phase,key);
   if(flags.providers&&!flags.providers.split(',').includes(s.provider))continue;
   if(flags['exclude-providers']&&flags['exclude-providers'].split(',').includes(s.provider))continue;
   if(flags.keys&&!flags.keys.split(',').includes(key))continue;
   if(phase!=='phase1'&&flags.force!=='true'){
    try{const previous=JSON.parse(await fs.readFile(path.join(base,'phase1',key,'result.json'),'utf8'));if(previous.witnesses?.some(j=>targetApiProof(j,source,mode).accepted))continue;}catch{}
   }
   try{const done=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));if(done.source_hash===hash(source)){rows.push(done);continue;}}catch{}
   let host;try{host=new URL((source.validated_api_request_examples||[]).find(q=>/list|search/i.test(q.purpose||''))?.url||source.primary_entry_url).hostname;}catch{host=source.provider;}
   all.push({key,source,skill,mode,base,dir,phase,maxPages,maxRequests,timeoutMs,host});
  }
 }
 const total=all.length+rows.length,started=Date.now();let completed=rows.length,active=0;
 const compact=r=>{const {witnesses,target_examples,other_examples,requests,...small}=r;return {...small,witnesses:(witnesses||[]).map(j=>({job_id:j.job_id,title:j.title,url:j.official_url,raw_file:j.raw_file,formal_status:j.formal_status,open_status:j.open_status})),coverage:r.coverage?{status:r.coverage.status,reason:r.coverage.reason,server_total:r.coverage.server_total,pages:typeof r.coverage.pages==='number'?r.coverage.pages:r.coverage.pages?.length}:undefined};};
 const summary=()=>{const modes={};for(const r of rows){const m=modes[r.mode]||={tested:0,verified:0,statuses:{}};m.tested++;m.verified+=r.verified?1:0;m.statuses[r.status]=(m.statuses[r.status]||0)+1;}return {phase,total,completed,active,pending:all.length,elapsed_seconds:Math.round((Date.now()-started)/1000),modes};};
 console.log(JSON.stringify(summary()));
 const interval=setInterval(()=>console.log(JSON.stringify(summary())),30000);
 async function slot(name){
  const skill=path.join(pack,name),mode=name.startsWith('internship')?'internship':'social';let worker;
  const fresh=()=>new Worker(filename,{workerData:{skill,mode},env:{...process.env,JOB_FIT_SKILL_ROOT:skill}});
  while(true){
   const index=all.findIndex(t=>t.mode===mode&&(byHost.get(t.host)||0)<hostConcurrency);
   if(index<0){if(!all.some(t=>t.mode===mode))break;await new Promise(r=>setTimeout(r,150));continue;}
   const task=all.splice(index,1)[0];active++;byHost.set(task.host,(byHost.get(task.host)||0)+1);
   await write(path.join(task.dir,'source.json'),task.source);worker||=fresh();
   const row=await new Promise(resolve=>{
    const cleanup=()=>{clearTimeout(timer);worker?.removeAllListeners('message');worker?.removeAllListeners('error');};
    const fail=async error=>{cleanup();await worker?.terminate();worker=null;const row={key:task.key,company_id:task.source.company_id,company:task.source.display_name,source_id:task.source.source_id,provider:task.source.provider,entry_url:task.source.primary_entry_url,mode,phase,source_hash:hash(task.source),checked_at:new Date().toISOString(),status:'worker_timeout_or_error',verified:false,error:String(error),result_file:path.join(task.dir,'result.json')};await write(row.result_file,row);resolve(row);};
    const timer=setTimeout(()=>fail('per-configuration deadline exceeded'),timeoutMs+5000);
    worker.once('error',fail);worker.once('message',({row})=>{cleanup();resolve(row);});worker.postMessage(task);
   });
   rows.push(row);completed++;active--;byHost.set(task.host,byHost.get(task.host)-1);
   await fs.appendFile(path.join(task.base,phase+'-events.jsonl'),JSON.stringify(compact(row))+'\n');
  }
  await worker?.terminate();
 }
 await Promise.all(skillNames.flatMap(name=>Array.from({length:Math.ceil(concurrency/skillNames.length)},()=>slot(name))));
 clearInterval(interval);
 for(const name of skillNames){const mode=name.startsWith('internship')?'internship':'social',base=path.join(pack,name,'artifacts/direction-api-audit-20260919');await write(path.join(base,phase+'-manifest.json'),rows.filter(r=>r.mode===mode).map(compact));}
 console.log(JSON.stringify(summary()));
}
