import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const decode=s=>String(s||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
export function parseAvatureList(html,base){
  const rows=new Map();
  for(const m of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']*\/JobDetail\/[^"']*\/(\d+)(?:[?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const url=new URL(decode(m[1]),base);if(url.origin!==new URL(base).origin)continue;rows.set(m[2],{id:m[2],url:url.href,title:decode(m[3])});
  }
  const nextMatch=String(html||'').match(/<a\b[^>]*class=["'][^"']*paginationNextLink[^"']*["'][^>]*href=["']([^"']+)["']/i),next=nextMatch?new URL(decode(nextMatch[1]),base).href:null;
  return {rows:[...rows.values()],next};
}

/** Anonymous Avature SearchJobs HTML list collection. No JobDetail page is requested. */
export async function collectAvature(source,options={}){
  if(source.provider!=='avature_public')return null;
  const client=options.client||createClient(options),cfg=source.api_config||{},origin=new URL(cfg.origin||source.primary_entry_url).origin,jobs=new Map(),pages=[],seen=new Set(),errors=[];
  let next=source.primary_entry_url,complete=false,reason='max_pages_reached';
  try{for(let page=0;next&&page<(options.maxPages??1000);page++){
    if(seen.has(next))throw Error('Avature repeated page URL');seen.add(next);
    const r=await client.request({url:next,method:'GET',headers:{Accept:'text/html,application/xhtml+xml'}},{purpose:'job_list'});if(r.record.http_status!==200)throw Error('Avature list HTTP '+r.record.http_status);
    const parsed=parseAvatureList(r.text,next),before=jobs.size,ids=[];
    for(const row of parsed.rows){ids.push(row.id);if(jobs.has(row.id)){errors.push('duplicate_job_ids');continue;}const loc=normalizeJobLocations({locations_raw:[],title:row.title});jobs.set(row.id,{job_id:row.id,company_id:source.company_id,company_name:source.display_name,title:row.title,description:'',requirements:'',body_complete:false,locations_raw:[],cities:loc.cities,location_special:loc.special,location_unknown:true,location_unresolved:[],official_url:row.url,job_url_kind:'official_detail',formal_status:/intern/i.test(row.title)?'internship':'unknown',open_status:'open',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'avature_public'}});}
    pages.push({page:page+1,returned:parsed.rows.length,response_file:r.record.response_file,job_ids:ids,url:next});
    if(!parsed.next){complete=!errors.length;reason=complete?'pagination_terminated_after_unique_list_pages':'duplicate_ids_seen';break;}
    if(jobs.size===before)throw Error('Avature empty or repeated page before final page');
    if(new URL(parsed.next).origin!==origin)throw Error('Avature pagination changed origin');next=parsed.next;
  }}catch(error){reason=error.message;errors.push(error.message);}
  const listComplete=complete&&!errors.length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:listComplete?'complete':pages.length?'partial':'failed',list_complete:listComplete,pages:pages.length,server_total:listComplete?jobs.size:null,jobs_observed:jobs.size,scope:'Anonymous Avature SearchJobs list pages; individual job pages not requested',capability:'public_list_only',reason:[reason,...errors].join('; '),page_evidence:pages,incomplete_bodies:jobs.size}};
}
