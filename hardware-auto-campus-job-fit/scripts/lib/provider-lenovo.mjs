import {createClient} from './http.mjs';
import {normalizeJobLocations,jobCityStatus} from './locations.mjs';
const plain=s=>String(s||'').replace(/<\/(?:p|div)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
export async function collectLenovo(source,options={}){
 const client=createClient(options),base='https://talent.lenovo.com.cn',jobs=new Map(),pages=[];let total=null,reason='',complete=false;
 const dr=await client.request({url:base+'/gateway/sysDict/all'},{purpose:'public_configuration'});if(dr.record.http_status!==200||dr.data?.code!==0)throw Error('Lenovo public dictionary unavailable');
 const dict=dr.data.result||[],cityMap=new Map((dict.find(x=>x.dictCode==='city_portal')?.children||[]).map(x=>[String(x.dictValue),x.dictName]));
 const typeMap=new Map((dict.find(x=>x.dictCode==='projectType')?.children||[]).map(x=>[String(x.dictValue),x.dictName]));
 const type=source.project_type??1;
 for(let p=1;p<=(options.maxPages||100);p++){
  const url=base+'/gateway/jobBase/list?projectType='+type+'&pageNum='+p,r=await client.request({url},{purpose:'job_list'});
  if(r.record.http_status!==200||r.data?.code!==0||!Array.isArray(r.data?.result?.rows)){reason='Invalid public list response';break;}
  const rows=r.data.result.rows;total=Number(r.data.result.total);let added=0;pages.push({page:p,rows:rows.length,response_file:r.record.response_file});
  for(const d of rows){const id=String(d.id);if(jobs.has(id))continue;added++;const description=plain(d.jobDuties),requirements=plain(d.jobRequirement),raw=String(d.workPlace||'').split(',').filter(Boolean).map(x=>cityMap.get(x)||'未识别城市编码:'+x),loc=normalizeJobLocations({locations_raw:raw}),label=typeMap.get(String(d.projectType))||'';
   jobs.set(id,{company_id:source.company_id,display_name:source.display_name,job_id:id,title:d.jobName,official_url:base+'/position/detail?id='+id,locations_raw:raw,cities:loc.cities,location_status:(loc.unknown?'unknown':'included'),description,requirements,body_complete:description.length>15&&requirements.length>15,formal_status:/实习/.test(label)?'internship':/应届/.test(label)&&!(/实习生/.test(d.jobName))?'formal':'unknown',open_status:d.publishFlag===1&&d.activateFlag===1?'open':'unknown',recruitment_evidence:{provider:'lenovo',projectType:d.projectType,projectTypeLabel:label,public_dictionary_file:dr.record.response_file,publishFlag:d.publishFlag,activateFlag:d.activateFlag},evidence_files:[r.record.response_file],raw_metadata:{educationRequired:d.educationRequired,typeName:d.typeName,firstDeptId:d.firstDeptId}});
  }
  if(Number.isFinite(total)&&jobs.size===total){complete=true;reason='Unique IDs reconcile public server total';break;}if(!added){reason='Empty/repeated page before total reconciliation';break;}
 }
 return{company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:complete?'complete':jobs.size?'partial':'failed',list_complete:complete,server_total:total,jobs_observed:jobs.size,pages:pages.length,page_evidence:pages,reason:reason||'Configured page limit reached'}};
}
