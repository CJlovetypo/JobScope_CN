import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectEndpoint} from './lib/source-collector.mjs';
import {workspacePath} from './lib/io.mjs';

const [inputFile,outputArg,...flags]=process.argv.slice(2);
if(!inputFile||!outputArg)throw new Error('Usage: node verify-wps-deep-api-candidates.mjs candidates.json output-dir [--concurrency=4]');
const input=JSON.parse(await fs.readFile(inputFile,'utf8')).filter(item=>item.state==='ready');
const output=workspacePath(path.resolve(outputArg));await fs.mkdir(output,{recursive:true});
const get=(name,fallback)=>Number(flags.find(flag=>flag.startsWith(`--${name}=`))?.split('=')[1]||fallback);
const idFor=value=>'company-'+createHash('sha256').update(value).digest('hex').slice(0,12);
const groups=new Map();
for(const item of input){
  const key=item.provider_hint+':'+item.tenant_hint+(item.provider_hint==='workday'?':'+item.discovery.site:'');
  const group=groups.get(key)||{...item,observed_names:new Set(),entry_urls:new Set()};
  group.observed_names.add(item.display_name);for(const url of item.entry_urls)group.entry_urls.add(url);groups.set(key,group);
}
const items=[...groups.values()].map(item=>({...item,observed_names:[...item.observed_names],entry_urls:[...item.entry_urls]}));
function sourceFor(item){
  const source={company_id:item.company_id||idFor(item.display_name),display_name:item.display_name,provider:item.provider_hint,category:item.category,primary_entry_url:item.entry_urls[0]};
  if(item.provider_hint==='51job_coapi')source.api_config={ctmid:item.tenant_hint};
  else if(item.provider_hint==='51job_xyz')source.api_config={ehire_ctm_id:item.tenant_hint};
  else if(item.provider_hint==='workday')source.api_config={origin:item.discovery.origin,tenant:item.discovery.tenant,site:item.discovery.site};
  else if(item.provider_hint==='nowcoder_public')source.api_config={company_id:Number(item.tenant_hint)};
  else if(item.provider_hint==='zhaopin_grace')source.api_config={org_number:item.tenant_hint,job_source:/^CZ/i.test(item.tenant_hint)?1:2};
  else if(item.provider_hint==='hcmcloud_public')source.api_config={...(item.discovery?.contract_unit?{contract_unit:item.discovery.contract_unit}:{})};
  else throw new Error('Unsupported ready provider '+item.provider_hint);
  source.source_id='deep-'+createHash('sha256').update(JSON.stringify([source.provider,source.primary_entry_url,source.api_config])).digest('hex').slice(0,12);
  return source;
}
const rows=[];let cursor=0;
await Promise.all(Array.from({length:get('concurrency',4)},async()=>{while(cursor<items.length){const item=items[cursor++],source=sourceFor(item),dir=path.join(output,source.source_id);await fs.mkdir(dir,{recursive:true});let result,error='';
  try{result=await collectEndpoint(source,{mode:'full',maxPages:100,pageSize:100,timeoutMs:20000,evidenceDir:path.join(dir,'http')});}
  catch(e){error=e.message;result={jobs:[],requests:[],coverage:{status:'failed',reason:error}};}
  await fs.writeFile(path.join(dir,'source.json'),JSON.stringify(source,null,2)+'\n');await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');
  const complete=result.jobs.filter(job=>job.body_complete&&job.job_id&&job.official_url),formal=complete.filter(job=>job.formal_status==='formal'&&job.open_status==='open');
  const employerNames=[...new Set(result.jobs.flatMap(job=>[job.raw_metadata?.companyName,job.raw_metadata?.jobCompanyName,job.raw_metadata?.coname,job.raw_metadata?.company?.name]).filter(Boolean))];
  const row={...item,source_id:source.source_id,source_file:path.join(dir,'source.json'),result_file:path.join(dir,'result.json'),checked_at:new Date().toISOString(),jobs:result.jobs.length,complete_jds:complete.length,formal_jobs:formal.length,employer_names:employerNames,coverage:result.coverage,
    admitted:complete.length>0,state:complete.length?'verified_api_full_jd':result.coverage?.pages?'empty_or_incomplete_api':'unverified',reason:error||result.coverage?.reason};rows.push(row);console.log(JSON.stringify({name:item.display_name,provider:item.provider_hint,tenant:item.tenant_hint,state:row.state,jobs:row.jobs,full:row.complete_jds,formal:row.formal_jobs,employers:employerNames}));
}}));
rows.sort((a,b)=>a.provider_hint.localeCompare(b.provider_hint)||a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({candidates:items.length,verified:rows.filter(row=>row.admitted).length,complete_jds:rows.reduce((sum,row)=>sum+row.complete_jds,0)},null,2));
