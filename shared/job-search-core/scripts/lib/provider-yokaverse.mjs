import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const clean=value=>String(value??'').replace(/\r/g,'').trim();

export function normalizeYokaverseJob(row,source,rawFile){
  const text=clean(row.description);
  const marker=/(?:^|\n)\s*(?:【)?(?:岗位要求|任职要求|任职资格)(?:】)?\s*[:：]?/m.exec(text);
  const description=marker?text.slice(0,marker.index).trim():text;
  const requirements=marker?text.slice(marker.index).trim():'';
  const locationsRaw=Array.isArray(row.location)?row.location.map(String):[];
  const locations=normalizeJobLocations({locations_raw:locationsRaw});
  const employment=Number(row.employment_type);
  return {
    job_id:`${String(row.company||'unknown')}-${String(row.position_id)}`,company_id:source.company_id,company_name:source.display_name,
    title:String(row.position_name??'').trim(),locations_raw:locationsRaw,cities:locations.cities,
    location_special:locations.special,location_unknown:locations.unknown,description,requirements,
    body_complete:description.length>0&&requirements.length>0,
    formal_status:employment===1?'formal':employment===2?'internship':'unknown',open_status:'open',
    official_url:`https://campus.yokaverse.com/jobs/${encodeURIComponent(String(row.position_id))}`,
    job_url_kind:'official_detail',raw_file:rawFile,
    recruitment_evidence:{provider:'yokaverse',source_position_id:row.position_id,employment_type:row.employment_type,start_date:row.start_date,position_type:row.position_type,company:row.company,formal_basis:employment===1?'Public API employment_type=1':employment===2?'Public API employment_type=2':'Unrecognized public employment_type'},
    raw_metadata:{education:row.education,position_type:row.position_type,company:row.company}
  };
}

export async function collectYokaverse(source,options={}){
  if(source.provider!=='yokaverse')return null;
  const opts={pageSize:100,maxPages:1000,...options};
  const pageSize=Math.max(1,Math.min(100,Math.floor(Number(opts.pageSize)||100)));
  const client=options.client||createClient(opts),jobs=new Map(),pages=[],failures=[];
  let serverTotal=null,listComplete=false;
  try{
    for(let page=1;page<=opts.maxPages;page++){
      const url=new URL('https://campus-recruitment-api.yokaverse.com/api/v1/campus/portal/positions');
      url.searchParams.set('page',String(page));url.searchParams.set('page_size',String(pageSize));
      const response=await client.request({url:url.href,method:'GET',headers:{Accept:'application/json',Origin:'https://campus.yokaverse.com',Referer:'https://campus.yokaverse.com/'}},{purpose:'job_list_with_inline_jd'});
      if(response.record.http_status!==200||Number(response.data?.code)!==0)throw new Error(`Yokaverse API HTTP ${response.record.http_status} / code ${response.data?.code}`);
      const rows=response.data?.data?.list,total=Number(response.data?.data?.total);
      if(!Array.isArray(rows)||!Number.isFinite(total))throw new Error('Changed Yokaverse public list schema');
      if(serverTotal===null)serverTotal=total;else if(serverTotal!==total)failures.push('server_total_changed');
      const before=jobs.size,ids=[];
      for(const row of rows){
        const job=normalizeYokaverseJob(row,source,response.record.response_file);
        if(!job.job_id||!job.title)throw new Error('Published row missing stable ID/title');
        ids.push(job.job_id);jobs.set(job.job_id,job);
      }
      pages.push({page,response_file:response.record.response_file,job_ids:ids,new_ids:jobs.size-before,server_total:total});
      if(jobs.size===total){pages.at(-1).end_evidence='unique_count_equals_server_total';listComplete=true;break;}
      if(!rows.length||jobs.size===before){failures.push(`Page ${page} ended or repeated before ${jobs.size}/${total}`);break;}
    }
    const incomplete=[...jobs.values()].filter(j=>j.open_status==='open'&&!j.body_complete).length;
    if(incomplete)failures.push(`${incomplete} published jobs lack separate duties/requirements`);
    if(!listComplete&&!failures.length)failures.push('maxPages reached before server total');
  }catch(error){failures.push(error.message);}
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,
    coverage:{status:listComplete&&!failures.length?'complete':pages.length?'partial':'failed',pages:pages.length,server_total:serverTotal,jobs_observed:jobs.size,list_complete:listComplete,reason:failures.join('; ')||'All public positions enumerated to the server total with inline JD bodies',page_evidence:pages,scope:'Current Yokaverse campus portal'}};
}
