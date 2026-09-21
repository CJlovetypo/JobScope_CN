import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const decode=s=>String(s||'').replace(/&quot;/gi,'"').replace(/&#x3D;|&#61;/gi,'=').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');

export function parseMoseekerList(html){
  const block=String(html||'').match(/<textarea\b[^>]*id=["']position-data["'][^>]*>([\s\S]*?)<\/textarea>/i)?.[1];
  if(!block)throw Error('Moseeker position-data payload missing');
  let data;try{data=JSON.parse(decode(block).trim());}catch{throw Error('Moseeker position-data payload is not valid JSON');}
  if(!Array.isArray(data.positions)||!Number.isSafeInteger(Number(data.total))||Number(data.total)<0)throw Error('Moseeker list schema invalid');
  const companyId=String(data.companyId||'');
  return {company_id:companyId,total:Number(data.total),positions:data.positions};
}

/** Anonymous company list collection. The embedded list JSON is read from list pages only. */
export async function collectMoseeker(source,options={}){
  if(source.provider!=='moseeker_public')return null;
  const companyId=String(source.api_config?.company_id||'');
  if(!/^\d+$/.test(companyId))throw Error('Moseeker company ID missing');
  const opts={maxPages:100,timeoutMs:20000,...options},client=options.client||createClient(opts),jobs=new Map(),pages=[],errors=[];
  let total=null,complete=false,reason='max_pages_reached';
  try{
    for(let page=1;page<=opts.maxPages;page++){
      const url='https://www.moseeker.com/positions/index/cid/'+companyId+'?pageNum='+page;
      const r=await client.request({url,method:'GET',headers:{Accept:'text/html,application/xhtml+xml'}},{purpose:'job_list'});
      if(r.record.http_status!==200)throw Error('Moseeker list HTTP '+r.record.http_status);
      const parsed=parseMoseekerList(r.text);
      if(parsed.company_id&&parsed.company_id!==companyId)throw Error('Moseeker company ID mismatch');
      if(total!==null&&total!==parsed.total)errors.push('server_total_changed');total=parsed.total;const before=jobs.size,ids=[];
      for(const row of parsed.positions){
        const href=String(row.href||''),id=href.match(/\/pid\/(\d+)/)?.[1];
        if(!id)throw Error('Moseeker row missing stable position ID');
        ids.push(id);if(jobs.has(id)){errors.push('duplicate_job_ids');continue;}
        const locations=[row.shortCities].filter(Boolean),loc=normalizeJobLocations({locations_raw:locations,title:row.name||''});
        jobs.set(id,{job_id:id,company_id:source.company_id,company_name:source.display_name,title:row.name||'',description:'',requirements:'',body_complete:false,locations_raw:locations,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,location_unresolved:loc.unresolved,official_url:new URL(href,'https://www.moseeker.com').href,job_url_kind:'official_detail',formal_status:'unknown',open_status:'open',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'moseeker_public',team:row.teamName||null,company_name:row.companyName||null}});
      }
      pages.push({page,returned:parsed.positions.length,server_total:total,response_file:r.record.response_file,job_ids:ids});
      if(jobs.size===total){complete=!errors.length;reason=complete?'unique_ids_reconcile_server_total':'list_changed_or_duplicated';break;}
      if(jobs.size===before||!parsed.positions.length){reason='empty_or_repeated_page_before_total';break;}
    }
  }catch(error){reason=error.message;errors.push(error.message);}
  const listComplete=complete&&!errors.length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:listComplete?'complete':pages.length?'partial':'failed',list_complete:listComplete,pages:pages.length,server_total:total,jobs_observed:jobs.size,scope:'Anonymous MoSeeker company list pages with embedded structured list JSON; individual job pages not requested',capability:'public_list_only',reason:[reason,...errors].join('; '),page_evidence:pages,incomplete_bodies:jobs.size}};
}
