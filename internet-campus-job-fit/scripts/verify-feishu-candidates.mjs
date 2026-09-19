import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {sourceFromEntry} from './source-discovery.mjs';
import {readSourceRegistry} from '../../shared/job-search-core/registry.mjs';
import {collectEndpoint} from '../../shared/job-search-core/scripts/lib/source-collector.mjs';
import {reviewJobBody} from '../../shared/job-search-core/scripts/lib/body-review.mjs';
const root=path.resolve('internet-campus-job-fit/artifacts/feishu-source-expansion-20260919');
const save=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n');};
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return d;throw e;}};
export function endpointIdentity(s){const u=new URL(s.primary_entry_url),q=s.validated_api_request_examples?.find(q=>/job_list/.test(q.purpose));let b=q?.body;if(typeof b==='string')b=Object.fromEntries(new URLSearchParams(b));return JSON.stringify([s.provider,s.provider==='moka'?[u.origin,b?.orgId,b?.siteId]:s.provider==='workday'?s.api_config:s.provider==='hotjob'?[u.origin,u.pathname.match(/SU[\da-f]{24}/i)?.[0]]:[u.origin,q?.headers?.['website-path']||'']]);}
const tenantIdentity=s=>{const k=JSON.parse(endpointIdentity(s));if(s.provider==='moka')k[1]=k[1].slice(0,2);return JSON.stringify(k);};
if(!isMainThread){
 const originalFetch=globalThis.fetch;
 parentPort.on('message',async task=>{const start=Date.now(),deadline=AbortSignal.timeout(45000);let count=0;
  globalThis.fetch=(u,o={})=>{if(++count>45)throw Error('verification_request_budget');return originalFetch(u,{...o,signal:o.signal?AbortSignal.any([o.signal,deadline]):deadline});};
  try{const result=await collectEndpoint(task.source,{mode:'full',targetMode:'campus',maxPages:2,pageSize:20,maxDetails:5,timeoutMs:8000,repair:false,evidenceDir:path.join(task.folder,'http')});result.jobs=result.jobs.map(reviewJobBody);await save(path.join(task.folder,'result.json'),result);
   const full=result.jobs.filter(j=>j.body_complete&&j.job_id&&j.official_url);parentPort.postMessage({status:full.length?'api_full_jd':result.jobs.length?'incomplete_jd':'empty_or_failed',jobs:result.jobs.length,full_jds:full.length,coverage:result.coverage,requests:count,elapsed_ms:Date.now()-start});
  }catch(e){parentPort.postMessage({status:'failed',reason:e.message,requests:count,elapsed_ms:Date.now()-start});}
 });
}else{
 const input=await read(path.join(root,'candidates.json')),registry=(await readSourceRegistry()).companies,known=new Map(),tenants=new Map();
 for(const c of registry)for(const s of c.recruitment_sources?.length?c.recruitment_sources:[c]){try{known.set(endpointIdentity(s),c.company_id);const t=tenantIdentity(s);const ids=tenants.get(t)||new Set();ids.add(c.company_id);tenants.set(t,ids);}catch{}}
 const tasks=new Map(),classification=[];
 for(const item of input){const row={company:item.display_name,company_id:item.company_id,links:item.entry_urls.length,existing:[],candidates:[],unresolved_links:[]};
  for(const link of item.entry_urls){let source;try{source=sourceFromEntry(item,link,{allTypes:true});}catch{try{const u=new URL(link),parts=u.pathname.split('/').filter(Boolean).filter(x=>!/^\w{2}-\w{2}$/.test(x));if(/\.myworkdayjobs\.com$/.test(u.hostname)&&parts[0]&&parts[0]!=='job')source={company_id:item.company_id,display_name:item.display_name,provider:'workday',primary_entry_url:u.origin+'/'+parts[0],api_config:{origin:u.origin,tenant:u.hostname.split('.')[0],site:parts[0]}};}catch{}}
   if(!source){row.unresolved_links.push(link);continue;}
   const key=endpointIdentity(source),existing=known.get(key);if(existing){row.existing.push({url:link,company_id:existing});continue;}
   const ids=[...tenants.get(tenantIdentity(source))||[]],id=createHash('sha256').update(key).digest('hex').slice(0,20);let task=tasks.get(id);
   if(!task){task={id,source,known_tenant_company_ids:ids,labels:[],links:[],folder:path.join(root,'api-verification',id)};tasks.set(id,task);}task.labels.push(item.display_name);task.links.push(link);row.candidates.push(id);
  }row.candidates=[...new Set(row.candidates)];classification.push(row);
 }
 await save(path.join(root,'candidate-classification.json'),classification);await save(path.join(root,'verification-plan.json'),[...tasks.values()]);
 const queue=[...tasks.values()],rows=[],hosts=new Map();let active=0;
 const progress=()=>({total:tasks.size,completed:rows.length,active,remaining:queue.length,statuses:Object.fromEntries([...new Set(rows.map(x=>x.status))].map(s=>[s,rows.filter(x=>x.status===s).length]))});
 const timer=setInterval(()=>console.log(JSON.stringify(progress())),30000);
 async function slot(){let worker;
  while(queue.length){const i=queue.findIndex(t=>(hosts.get(new URL(t.source.primary_entry_url).host)||0)<2);if(i<0){await new Promise(r=>setTimeout(r,100));continue;}const task=queue.splice(i,1)[0],host=new URL(task.source.primary_entry_url).host;hosts.set(host,(hosts.get(host)||0)+1);active++;
   let row=await read(path.join(task.folder,'verification.json'),null);if(!row){await save(path.join(task.folder,'source.json'),task.source);worker||=new Worker(fileURLToPath(import.meta.url));row=await new Promise(resolve=>{const cleanup=()=>{clearTimeout(timer);worker?.removeAllListeners('message');worker?.removeAllListeners('error');};const fail=async e=>{cleanup();await worker?.terminate();worker=null;resolve({status:'failed',reason:String(e)});};const timer=setTimeout(()=>fail('verification_deadline'),47000);worker.once('error',fail);worker.once('message',r=>{cleanup();resolve(r);});worker.postMessage(task);});row={...row,id:task.id,provider:task.source.provider,labels:[...new Set(task.labels)],known_tenant_company_ids:task.known_tenant_company_ids,checked_at:new Date().toISOString()};await save(path.join(task.folder,'verification.json'),row);}
   rows.push(row);active--;hosts.set(host,hosts.get(host)-1);
  }await worker?.terminate();
 }
 try{await Promise.all(Array.from({length:6},slot));await save(path.join(root,'verification-summary.json'),{...progress(),rows});console.log(JSON.stringify(progress()));}finally{clearInterval(timer);}
}
