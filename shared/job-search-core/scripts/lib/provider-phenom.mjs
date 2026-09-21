import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

export function parsePhenomBootstrap(html){
  const raw=String(html||'').match(/var\s+phApp\s*=\s*phApp\s*\|\|\s*(\{[^;]+\});\s*phApp\.ddo/i)?.[1];
  if(!raw)throw Error('Phenom public configuration missing');
  let cfg;try{cfg=JSON.parse(raw);}catch{throw Error('Phenom public configuration invalid');}
  if(!/^https:\/\//.test(cfg.widgetApiEndpoint||'')||!cfg.locale||!cfg.country)throw Error('Phenom public configuration incomplete');
  return cfg;
}

/** Anonymous Phenom refineSearch list collection. Individual job pages are never requested. */
export async function collectPhenom(source,options={}){
  if(source.provider!=='phenom_public')return null;
  const opts={pageSize:100,maxPages:100,timeoutMs:20000,...options},client=options.client||createClient(opts),cfg0=source.api_config||{},bootstrapUrl=source.primary_entry_url||cfg0.search_url;
  const bootstrap=await client.request({url:bootstrapUrl,method:'GET',headers:{Accept:'text/html,application/xhtml+xml'}},{purpose:'public_configuration_bootstrap'});
  if(bootstrap.record.http_status!==200)throw Error('Phenom bootstrap HTTP '+bootstrap.record.http_status);
  const cfg=parsePhenomBootstrap(bootstrap.text),jobs=new Map(),pages=[],errors=[];let total=null,complete=false,reason='max_pages_reached';
  try{
    for(let page=0;page<opts.maxPages;page++){
      const from=page*opts.pageSize,body={lang:cfg.locale,deviceType:'desktop',country:cfg.country,pageName:'search-results',ddoKey:'refineSearch',sortBy:'',subsearch:'',from,jobs:true,counts:true,all_fields:[],size:opts.pageSize,clearAll:false,jdsource:'facets',isSliderEnable:false,pageId:cfg.pageId};
      const r=await client.request({url:cfg.widgetApiEndpoint,method:'POST',headers:{'Content-Type':'application/json'},body},{purpose:'job_list'}),payload=r.data?.refineSearch,nextTotal=Number(payload?.totalHits),rows=payload?.data?.jobs;
      if(r.record.http_status!==200||payload?.status!==200||!Array.isArray(rows)||!Number.isSafeInteger(nextTotal)||nextTotal<0)throw Error('Phenom list schema or HTTP error');
      if(total!==null&&total!==nextTotal)errors.push('server_total_changed');total=nextTotal;const before=jobs.size,ids=[];
      for(const row of rows){
        const id=String(row.jobSeqNo||row.jobId||row.reqId||'');if(!id)throw Error('Phenom row missing stable ID');ids.push(id);if(jobs.has(id)){errors.push('duplicate_job_ids');continue;}
        const multi=Array.isArray(row.multi_location)?row.multi_location:[row.multi_location].filter(Boolean),locations=[...multi,row.location,row.cityStateCountry,row.cityState,row.city,row.state,row.country].filter(Boolean),loc=normalizeJobLocations({locations_raw:locations,title:row.title||''}),url=row.jobUrl||row.applyUrl||null;
        jobs.set(id,{job_id:id,company_id:source.company_id,company_name:source.display_name,title:row.title||'',description:'',requirements:'',body_complete:false,locations_raw:locations,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,location_unresolved:loc.unresolved,official_url:url,job_url_kind:url?'official_detail':'unavailable',formal_status:/intern/i.test(row.type||row.title||'')?'internship':'unknown',open_status:'open',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'phenom_public',type:row.type||row.timeType||null,category:row.category||row.multi_category||null,country:row.country||null}});
      }
      pages.push({from,returned:rows.length,server_total:total,response_file:r.record.response_file,job_ids:ids});
      if(jobs.size===total){complete=!errors.length;reason=complete?'unique_ids_reconcile_server_total':'list_changed_or_duplicated';break;}
      if(jobs.size===before||!rows.length){reason='empty_or_repeated_page_before_total';break;}
    }
  }catch(error){reason=error.message;errors.push(error.message);}
  const listComplete=complete&&!errors.length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:listComplete?'complete':pages.length?'partial':'failed',list_complete:listComplete,pages:pages.length,server_total:total,jobs_observed:jobs.size,scope:'Anonymous Phenom refineSearch list; individual job pages not requested',capability:'public_list_only',reason:[reason,...errors].join('; '),page_evidence:pages,incomplete_bodies:jobs.size}};
}
