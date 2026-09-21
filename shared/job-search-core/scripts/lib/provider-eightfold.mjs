import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const decode=s=>String(s||'').replace(/&#34;|&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
export function parseEightfoldDomain(html){
  const block=String(html||'').match(/<code\b[^>]*id=["']pcsx-data["'][^>]*>([\s\S]*?)<\/code>/i)?.[1];
  if(block)try{const value=JSON.parse(decode(block));if(value.domain)return String(value.domain);}catch{}
  return decode(html).match(/["']domain["']\s*:\s*["']([^"']+)["']/i)?.[1]||null;
}

/** Anonymous Eightfold PCSX list collection for a single employer domain. */
export async function collectEightfold(source,options={}){
  if(source.provider!=='eightfold_public')return null;
  const opts={maxPages:1000,timeoutMs:20000,...options},client=options.client||createClient(opts),origin=new URL(source.api_config?.origin||source.primary_entry_url).origin;
  const boot=await client.request({url:source.primary_entry_url,method:'GET',headers:{Accept:'text/html,application/xhtml+xml'}},{purpose:'public_configuration_bootstrap'});
  if(boot.record.http_status!==200)throw Error('Eightfold bootstrap HTTP '+boot.record.http_status);
  const domain=source.api_config?.domain||parseEightfoldDomain(boot.text);if(!domain)throw Error('Eightfold employer domain missing');
  const jobs=new Map(),pages=[],errors=[];let total=null,complete=false,reason='max_pages_reached',start=0;
  try{for(let page=0;page<opts.maxPages;page++){
    const u=new URL('/api/pcsx/search',origin);u.searchParams.set('domain',domain);u.searchParams.set('query','');u.searchParams.set('location','China');u.searchParams.set('start',String(start));
    const r=await client.request({url:u.href,method:'GET',headers:{Accept:'application/json',Referer:source.primary_entry_url,Origin:origin,'X-Requested-With':'XMLHttpRequest'}},{purpose:'job_list'}),payload=r.data,data=payload?.data,rows=data?.positions,nextTotal=Number(data?.count);
    if(r.record.http_status!==200||Number(payload?.status)!==200||!Array.isArray(rows)||!Number.isSafeInteger(nextTotal)||nextTotal<0)throw Error('Eightfold list schema or HTTP error');
    if(total!==null&&total!==nextTotal)errors.push('server_total_changed');total=nextTotal;const before=jobs.size,ids=[];
    for(const row of rows){const id=String(row.id||'');if(!id)throw Error('Eightfold row missing stable ID');ids.push(id);if(jobs.has(id)){errors.push('duplicate_job_ids');continue;}const locations=Array.isArray(row.locations)?row.locations:[row.location].filter(Boolean),loc=normalizeJobLocations({locations_raw:locations,title:row.name||''});jobs.set(id,{job_id:id,company_id:source.company_id,company_name:source.display_name,title:row.name||'',description:'',requirements:'',body_complete:false,locations_raw:locations,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,location_unresolved:loc.unresolved,official_url:new URL(row.positionUrl||'/careers/job/'+id,origin).href,job_url_kind:'official_detail',formal_status:/intern/i.test((row.efcustomTextEmploymentType||[]).join(' ')+' '+(row.name||''))?'internship':'unknown',open_status:'open',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'eightfold_public',domain,employment_type:row.efcustomTextEmploymentType||[]}});}
    pages.push({start,returned:rows.length,server_total:total,response_file:r.record.response_file,job_ids:ids});
    if(jobs.size===total){complete=!errors.length;reason=complete?'unique_ids_reconcile_server_total':'list_changed_or_duplicated';break;}
    if(jobs.size===before||!rows.length){reason='empty_or_repeated_page_before_total';break;}start+=rows.length;
  }}catch(error){reason=error.message;errors.push(error.message);}
  const listComplete=complete&&!errors.length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:listComplete?'complete':pages.length?'partial':'failed',list_complete:listComplete,pages:pages.length,server_total:total,jobs_observed:jobs.size,scope:'Anonymous Eightfold China-filtered PCSX list; individual job pages not requested',capability:'public_list_only',reason:[reason,...errors].join('; '),page_evidence:pages,incomplete_bodies:jobs.size}};
}
