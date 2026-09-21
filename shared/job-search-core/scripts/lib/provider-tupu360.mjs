import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const TYPES=['SOCIALRECRUITMENT','CAMPUSRECRUITMENT','INTERNSHIPRECRUITMENT'];
const formalStatus=type=>type==='INTERNSHIPRECRUITMENT'?'internship':type==='CAMPUSRECRUITMENT'?'formal':type==='SOCIALRECRUITMENT'?'social':'unknown';

/** Anonymous Tupu360 list collection. Individual position pages are never requested. */
export async function collectTupu360(source,options={}){
  if(source.provider!=='tupu360')return null;
  const origin=new URL(source.api_config?.origin||source.primary_entry_url).origin;
  const opts={pageSize:200,maxPages:100,timeoutMs:20000,...options};
  const client=options.client||createClient(opts),jobs=new Map(),contexts=[],errors=[];
  for(const type of TYPES){
    const ids=new Set(),pages=[];let total=null,complete=false,reason='max_pages_reached';
    try{
      for(let page=0;page<opts.maxPages;page++){
        const offset=page*opts.pageSize,u=new URL('/positionData/listInfo',origin);
        u.searchParams.set('type',type);u.searchParams.set('offset',String(offset));u.searchParams.set('max',String(opts.pageSize));u.searchParams.set('lang','zh_CN');
        const r=await client.request({url:u.href,method:'GET'},{purpose:'job_list'}),payload=r.data,result=payload?.result,nextTotal=Number(result?.total),rows=result?.positions;
        if(r.record.http_status!==200||String(payload?.code)!=='0'||!Array.isArray(rows)||!Number.isSafeInteger(nextTotal)||nextTotal<0)throw Error('Tupu360 list schema or HTTP error');
        if(total!==null&&total!==nextTotal)errors.push(type+':server_total_changed');total=nextTotal;const before=ids.size;
        for(const row of rows){const id=String(row.pid||row.id||'');if(!id)throw Error('Tupu360 row missing ID');ids.add(id);const locations=[row.pCity||row.city,row.workAddress].filter(Boolean),loc=normalizeJobLocations({locations_raw:locations,title:row.pName||row.name||''});jobs.set(type+':'+id,{job_id:id,company_id:source.company_id,company_name:source.display_name,title:row.pName||row.name||'',description:'',requirements:'',body_complete:false,locations_raw:locations,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,location_unresolved:loc.unresolved,official_url:origin+'/position/detail/'+encodeURIComponent(id)+'?type='+encodeURIComponent(type),job_url_kind:'official_detail',formal_status:formalStatus(type),open_status:row.bStop===false?'open':'unknown',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'tupu360',recruitmentType:type,department:row.pDepartment||row.department,function:row.pFunction||row.function}});}
        pages.push({offset,returned:rows.length,server_total:total,response_file:r.record.response_file,job_ids:rows.map(x=>String(x.pid||x.id||''))});
        if(ids.size===total){complete=true;reason='unique_ids_reconcile_server_total';break;}
        if(ids.size===before||!rows.length){reason='empty_or_repeated_page_before_total';break;}
      }
    }catch(error){reason=error.message;errors.push(type+':'+error.message);}
    contexts.push({type,server_total:total,jobs_observed:ids.size,pages:pages.length,list_complete:complete,reason,page_evidence:pages});
  }
  const listComplete=contexts.every(x=>x.list_complete)&&!errors.length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,coverage:{status:listComplete?'complete':client.records.length?'partial':'failed',list_complete:listComplete,pages:contexts.reduce((n,x)=>n+x.pages,0),server_total:contexts.reduce((n,x)=>n+(x.server_total||0),0),jobs_observed:jobs.size,scope:'Anonymous employer Tupu360 social, campus and internship lists; job details not requested',capability:'public_list_only',reason:[...contexts.map(x=>x.type+':'+x.reason),...errors].join('; '),contexts,incomplete_bodies:jobs.size}};
}
