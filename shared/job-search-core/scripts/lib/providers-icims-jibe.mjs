import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const clean=value=>String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/\s*(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\n{3,}/g,'\n\n').trim();
const sectioned=value=>clean(value).replace(/([.!?])\s+(?=[A-Z])/g,'$1\n').replace(/\s+(?=(?:PREFERRED|REQUIRED|SPECIALIZED)[^:\n]{0,80}:)/g,'\n');
const intern=/实习|\bintern(?:ship)?\b/i,graduate=/校招|校园招聘|应届|new (?:college )?grad|graduate (?:program|engineer|trainee)/i;

export function normalizeIcimsJibe(row,source,record){
  const d=row?.data||row||{},title=String(d.title||''),description=sectioned(d.description),requirements=sectioned(d.qualifications),employment=String(d.employment_type||'');
  const requiredExperience=requirements.match(/(?:Experience level|经验要求)\s*[:：]\s*([^\n]+?)(?=\n|PREFERRED|SPECIALIZED|$)/i)?.[1]?.trim()||null;
  const raw=[d.full_location,d.location_name,[d.city,d.state,d.country].filter(Boolean).join(', ')].filter(Boolean);
  const location=normalizeJobLocations({locations_raw:raw,title,description,requirements});
  const formal=intern.test(title)?'internship':graduate.test(title+'\n'+description+'\n'+requirements)?'formal':employment==='FULL_TIME'?'social':'unknown';
  const origin=new URL(source.api_config?.origin||source.primary_entry_url).origin;
  return {job_id:String(d.slug||d.req_id||''),company_id:source.company_id,company_name:source.display_name,title,description,requirements,body_complete:description.length>30&&requirements.length>25,locations_raw:raw,cities:location.cities,location_special:location.special,location_unknown:location.unknown,location_unresolved:location.unresolved,official_url:d.meta_data?.canonical_url||`${origin}/jobs/${encodeURIComponent(d.slug||d.req_id||'')}`,job_url_kind:'official_detail',formal_status:formal,open_status:'open',raw_file:record.response_file,recruitment_evidence:{provider:'icims_jibe',ats_code:d.ats_code||(d.meta_data?.icims?'icims':null),employment_type:d.employment_type||null,commitment:employment==='FULL_TIME'?'Full-time':employment||null,required_experience:requiredExperience,published_list_returned:true,language:d.language||null},raw_metadata:{country:d.country,country_code:d.country_code,city:d.city,state:d.state,req_id:d.req_id,categories:d.categories||[],apply_url:d.apply_url||null,hiring_organization:d.hiring_organization||null}};
}

export async function collectIcimsJibe(source,options={}){
  if(source.provider!=='icims_jibe')return null;
  const opts={maxPages:1000,pageSize:100,timeoutMs:20000,...options},client=options.client||createClient(opts),origin=new URL(source.api_config?.origin||source.primary_entry_url).origin;
  const jobs=new Map(),pages=[],errors=[],excluded=[];let total=null,complete=false,reason='max_pages_reached',offset=0;
  try{
    for(let page=1;page<=opts.maxPages;page++){
      const url=new URL('/api/jobs',origin);url.searchParams.set('limit',String(Math.max(1,Math.min(100,opts.pageSize))));url.searchParams.set('offset',String(offset));url.searchParams.set('lang',source.api_config?.language||'en-US');
      const response=await client.request({url:url.href},{purpose:'job_list'});
      if(response.record.http_status!==200||!response.data)throw Error('Expected public iCIMS Jibe JSON; HTTP '+response.record.http_status);
      const rows=response.data.jobs;total=Number(response.data.totalCount);
      if(!Array.isArray(rows)||!Number.isFinite(total))throw Error('Missing iCIMS Jibe jobs/totalCount');
      const ids=rows.map(row=>String(row?.data?.slug||row?.data?.req_id||'')),before=jobs.size;
      if(ids.some(id=>!id))throw Error('Missing iCIMS Jibe job ID');
      if(new Set(ids).size!==ids.length||ids.some(id=>jobs.has(id)))errors.push('duplicate_job_ids_across_pages');
      for(const row of rows){
        const d=row.data||{};
        if(!/^(?:CN|China|中国|中国大陆)$/i.test(String(d.country_code||d.country||'').trim())){excluded.push({job_id:String(d.slug||d.req_id),country:d.country||null,country_code:d.country_code||null});continue;}
        const job=normalizeIcimsJibe(row,source,response.record);jobs.set(job.job_id,job);
      }
      pages.push({page,offset,response_file:response.record.response_file,returned:rows.length,server_total:total,job_ids:ids});
      offset+=rows.length;
      if(offset===total){complete=!errors.length;reason='returned_rows_reconcile_server_total';break;}
      if(!rows.length||offset>total||jobs.size===before&&rows.every(row=>/^(?:CN|China|中国|中国大陆)$/i.test(String(row.data?.country_code||row.data?.country||'').trim()))){reason='empty_or_repeated_page_before_total';break;}
    }
  }catch(error){errors.push(error.message);reason=error.message;}
  const incomplete=[...jobs.values()].filter(job=>!job.body_complete).length;if(incomplete)errors.push(incomplete+' jobs have unresolved JD sections');
  const status=complete&&!errors.length?'complete':jobs.size||pages.length?'partial':'failed';
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status,collection_complete:status==='complete',pages:pages.length,server_total:total,jobs_observed:jobs.size,list_complete:complete,reason:[reason,...errors].join('; '),page_evidence:pages,country_filter:{country_code:'CN'},scope:'Mainland China positions in this public iCIMS Jibe portal',excluded_country_rows:excluded,incomplete_bodies:incomplete}};
}
