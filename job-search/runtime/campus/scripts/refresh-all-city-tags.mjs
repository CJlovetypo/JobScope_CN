import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import {PACK_ROOT,MODE_ROOTS} from '../../../../shared/job-search-core/runtime-context.mjs';
import {readSourceRegistry} from '../../../../shared/job-search-core/registry.mjs';
import {randomUUID} from 'node:crypto';
const filename=fileURLToPath(import.meta.url);
const save=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(v,null,2)+'\n');for(let n=0;;n++){try{await fs.rename(tmp,p);return;}catch(e){if(n>=8)throw e;await new Promise(r=>setTimeout(r,150*(n+1)));}}};
const read=async(p,fallback)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
if(!isMainThread){
 const {mode}=workerData;
 const {collectCompanySources}=await import('../../../../shared/job-search-core/scripts/lib/source-collector.mjs');
 const {reviewRecruitment}=await import('../../../../shared/job-search-core/scripts/lib/recruitment-policy.mjs');
 const {normalizeJobLocations}=await import('../../../../shared/job-search-core/scripts/lib/locations.mjs');
 const fetchNative=globalThis.fetch;
 parentPort.on('message',async task=>{
  const start=Date.now(),deadline=AbortSignal.timeout(task.timeout);let requests=0;
  globalThis.fetch=async(url,options={})=>{if(++requests>180)throw Error('city_refresh_request_budget');return fetchNative(url,{...options,signal:options.signal?AbortSignal.any([options.signal,deadline]):deadline});};
  try{
   const international=(task.company.recruitment_sources||[task.company]).some(s=>['workday','smartrecruiters'].includes(s.provider));
   const result=await collectCompanySources(task.company,{targetMode:mode,mode:'list',maxPages:100,pageSize:100,maxDetails:international?20:0,timeoutMs:12000,evidenceDir:path.join(task.folder,'http'),refresh:true,repair:false});
   result.jobs=(result.jobs||[]).map(j=>{j=reviewRecruitment(j,mode);const loc=normalizeJobLocations(j);return {...j,cities:loc.cities,location_unknown:loc.unknown,location_special:loc.special,locations_raw:loc.raw};});
   await save(path.join(task.folder,'result.json'),result);parentPort.postMessage({result,requests,elapsed_ms:Date.now()-start});
  }catch(e){parentPort.postMessage({result:{jobs:[],checked_at:new Date().toISOString(),coverage:{status:'failed',reason:e.message}},requests,elapsed_ms:Date.now()-start});}
 });
}else{
 const flags=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('='))),mode=flags.mode||'campus';if(!MODE_ROOTS[mode])throw Error('Unknown mode');
 const root=path.join(PACK_ROOT,MODE_ROOTS[mode]),out=path.join(root,'artifacts/city-refresh-20260919'),cityFile=path.join(root,'data/company-city-index.json');
 const {sourceConfigFingerprint}=await import('../../../../shared/job-search-core/scripts/lib/source-collector.mjs');
 const {refreshedCityTag}=await import('../../../../shared/job-search-core/scripts/lib/city-index.mjs');
 const sources=(await readSourceRegistry()).companies,old=await read(cityFile,{companies:[]}),tags=new Map(old.companies.map(c=>[c.company_id,c]));
 const queue=[...sources],hosts=new Map(),rows=[],workers=Number(flags.concurrency||8),timeout=Number(flags.timeout||60000);let active=0;
 const hostFor=c=>{try{return new URL(c.primary_entry_url).hostname;}catch{return c.provider;}};
 if(!await read(path.join(out,'before-index.json'),null))await save(path.join(out,'before-index.json'),old);
 const persist=()=>save(cityFile,{...old,schema_version:1,updated_at:new Date().toISOString(),search_mode:mode,companies:sources.map(c=>tags.get(c.company_id)||{company_id:c.company_id,display_name:c.display_name,cities:[],city_coverage_complete:false})});
 let writeChain=Promise.resolve();
 const progress=()=>({mode,companies:sources.length,completed:rows.length,active,remaining:queue.length,statuses:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length]))});
 const timer=setInterval(()=>console.log(JSON.stringify(progress())),30000);
 async function slot(){let worker;
  const fresh=()=>new Worker(filename,{workerData:{mode},env:{...process.env,JOB_FIT_SKILL_ROOT:root}});
  while(queue.length){
   const i=queue.findIndex(c=>(hosts.get(hostFor(c))||0)<2);if(i<0){await new Promise(r=>setTimeout(r,100));continue;}
   const company=queue.splice(i,1)[0],host=hostFor(company),folder=path.join(out,company.company_id),key=sourceConfigFingerprint(company,mode);active++;hosts.set(host,(hosts.get(host)||0)+1);
   let response=await read(path.join(folder,'summary.json'),null);
   if(!response||response.source_config_fingerprint!==key||flags.retry==='true'&&response.result.coverage.status!=='complete'){
    worker||=fresh();response=await new Promise(resolve=>{
     const cleanup=()=>{clearTimeout(deadline);worker?.removeAllListeners('message');worker?.removeAllListeners('error');};
     const fail=async error=>{cleanup();await worker?.terminate();worker=null;resolve({result:{jobs:[],checked_at:new Date().toISOString(),coverage:{status:'failed',reason:String(error)}},elapsed_ms:timeout});};
     const deadline=setTimeout(()=>fail('city_refresh_deadline'),timeout+2000);worker.once('error',fail);worker.once('message',message=>{cleanup();resolve(message);});worker.postMessage({company,folder,timeout});
    });response.source_config_fingerprint=key;await save(path.join(folder,'summary.json'),response);
   }
   const entry=refreshedCityTag(company,response.result,tags.get(company.company_id),{mode,fingerprint:key,resultFile:path.relative(root,path.join(folder,'result.json')).replaceAll('\\','/')});tags.set(company.company_id,entry);
   rows.push({company_id:company.company_id,company:company.display_name,status:response.result.coverage.status,city_freshness:entry.city_freshness,cities:entry.cities,observed_target_jobs:entry.target_jobs_observed,requests:response.requests||0,elapsed_ms:response.elapsed_ms});active--;hosts.set(host,hosts.get(host)-1);
   if(rows.length%25===0){writeChain=writeChain.then(persist);await writeChain;await save(path.join(out,'progress.json'),{...progress(),rows});}
  }
  await worker?.terminate();
 }
 try{await Promise.all(Array.from({length:workers},slot));await writeChain;await persist();await save(path.join(out,'summary.json'),{...progress(),checked_at:new Date().toISOString(),rows});console.log(JSON.stringify(progress()));}finally{clearInterval(timer);}
}
