import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {readSourceRegistry,SEARCH_CAPABILITIES_FILE} from '../../shared/job-search-core/registry.mjs';
import {directionSourceKey} from '../../shared/job-search-core/scripts/lib/direction-validation.mjs';
import {nativeKeywordParameter} from '../../shared/job-search-core/scripts/lib/targeted-search.mjs';
import {collectEndpoint} from '../../shared/job-search-core/scripts/lib/source-collector.mjs';
const out=path.resolve('internet-campus-job-fit/artifacts/search-capabilities-20260919');
const save=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n');};
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return d;throw e;}};
if(!isMainThread){
 const originalFetch=globalThis.fetch;parentPort.on('message',async task=>{
  const signal=AbortSignal.timeout(45000);let requests=0;globalThis.fetch=(u,o={})=>{if(++requests>45)throw Error('keyword_audit_budget');return originalFetch(u,{...o,signal:o.signal?AbortSignal.any([signal,o.signal]):signal});};
  try{const query=async(keyword,name)=>{const r=await collectEndpoint(task.source,{targetMode:task.mode,mode:'list',maxPages:1,maxDetails:0,pageSize:20,timeoutMs:8000,keyword,repair:false,evidenceDir:path.join(task.folder,name,'http')});await save(path.join(task.folder,name+'.json'),r);return r;};
   const baseline=await query('','baseline');if(!baseline.jobs.length){parentPort.postMessage({status:'parameter_candidate',reason:'baseline_empty_or_unavailable',requests});return;}
   const sample=baseline.jobs.find(j=>j.title?.trim());if(!sample)throw Error('no_sample_title');
   const keyword=sample.title.trim().slice(0,60),negative='zzNoRecruitmentMatch_'+task.key.slice(0,16),positive=await query(keyword,'positive'),absent=await query(negative,'negative');
   const positiveMatch=positive.jobs.some(j=>String(j.job_id)===String(sample.job_id)),negativeEmpty=!absent.jobs.length&&absent.coverage.status==='complete';
   const proof={baseline_job_id:sample.job_id,positive_keyword:keyword,positive_match:positiveMatch,positive_count:positive.jobs.length,negative_keyword:negative,negative_count:absent.jobs.length,negative_complete:absent.coverage.status==='complete'};
   parentPort.postMessage({status:positiveMatch&&negativeEmpty?'verified_native_keyword':'parameter_candidate',reason:positiveMatch&&negativeEmpty?'positive_id_retained_and_unique_negative_returns_empty':'filter_not_proven',proof,requests});
  }catch(e){parentPort.postMessage({status:'parameter_candidate',reason:e.message,requests});}
 });
}else{
 const companies=(await readSourceRegistry()).companies,rows=[],tasks=[],counts=new Map(),perProvider=Number(process.argv.find(a=>a.startsWith('--per-provider='))?.split('=')[1]||10);
 const previous=await read(SEARCH_CAPABILITIES_FILE,{configurations:[]}),byKey=new Map(previous.configurations.map(r=>[r.key+'|'+r.mode,r]));
 for(const c of companies)for(const [index,s] of (c.recruitment_sources?.length?c.recruitment_sources:[c]).entries())for(const mode of ['campus','internship','social']){
  const key=directionSourceKey(c,s,index),parameter=nativeKeywordParameter(s.provider),row=byKey.get(key+'|'+mode)||{key,company_id:c.company_id,provider:s.provider,source_id:s.source_id||String(index),mode,status:parameter?'parameter_candidate':'local_title_filter',parameter,reason:parameter?'awaiting_per_configuration_live_proof':'no_confirmed_native_keyword_adapter',fallback:'list_and_local_title_filter'};rows.push(row);
  const group=s.provider+'|'+mode;if(parameter&&(counts.get(group)||0)<perProvider){counts.set(group,(counts.get(group)||0)+1);tasks.push({key,mode,source:{...s,company_id:c.company_id,display_name:c.display_name},folder:path.join(out,key,mode),row});}
 }
 let next=0,completed=0;const stats=()=>({planned:tasks.length,completed,total_direction_configurations:rows.length,verified:rows.filter(r=>r.status==='verified_native_keyword').length});const timer=setInterval(()=>console.log(JSON.stringify(stats())),30000);
 async function slot(){let worker;while(next<tasks.length){const task=tasks[next++];let proof=await read(path.join(task.folder,'proof.json'),null);if(!proof){worker||=new Worker(fileURLToPath(import.meta.url));proof=await new Promise(resolve=>{const cleanup=()=>{clearTimeout(deadline);worker?.removeAllListeners('message');worker?.removeAllListeners('error');};const fail=async e=>{cleanup();await worker?.terminate();worker=null;resolve({status:'parameter_candidate',reason:String(e)});};const deadline=setTimeout(()=>fail('audit_deadline'),47000);worker.once('error',fail);worker.once('message',r=>{cleanup();resolve(r);});worker.postMessage(task);});proof.checked_at=new Date().toISOString();await save(path.join(task.folder,'proof.json'),proof);}Object.assign(task.row,proof,{evidence_file:path.relative(path.resolve('internet-campus-job-fit'),path.join(task.folder,'proof.json')).replaceAll('\\','/')});completed++;}await worker?.terminate();}
 try{await Promise.all(Array.from({length:4},slot));await save(SEARCH_CAPABILITIES_FILE,{schema_version:1,policy:'native_only_after_positive_and_negative_controls; all_other_sources_use_local_title_filter',checked_at:new Date().toISOString(),configurations:rows});await save(path.join(out,'summary.json'),stats());console.log(JSON.stringify(stats()));}finally{clearInterval(timer);}
}
