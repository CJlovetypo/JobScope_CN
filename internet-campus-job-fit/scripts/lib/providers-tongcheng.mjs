// Public Tongcheng portal API; the official JD is displayed in a dialog.
import {createClient} from './http.mjs';
import {normalizeJobLocations,jobCityStatus} from './locations.mjs';
const clean=v=>String(v??'').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').trim();
export function normalizeTongchengJob(row,detail,source,queryType,rawFile){
 const description=clean(detail?.duty),requirements=clean(detail?.qualifications),title=detail?.jobName||row.jobName||'';
 const kind=detail?.recruitmentTypeName||'',employment=row.employmentType||'';
 let formal='unknown';
 if(queryType===5||/实习/.test(kind+employment)||/实习生|实习岗|校园大使|\bintern(?:ship)?\b/i.test(title))formal='internship';
 else if(queryType===4||/社会招聘/.test(kind))formal='social';
 else if(queryType===3&&/校园招聘|校招|应届/.test(kind+title)&&(employment==='REGULAR'||/毕业|应届/.test(requirements)))formal='formal';
 const job={job_id:String(detail?.id||row.jobId),company_id:source.company_id,company_name:source.display_name,title,
  locations_raw:[detail?.addressName||row.workPlace].filter(Boolean),description,requirements,body_complete:description.length>0&&requirements.length>0,
  formal_status:formal,open_status:detail?.jobStatus===1?'open':detail?.jobStatus!=null?'closed':'unknown',
  recruitment_evidence:{provider:'tongcheng',queryType,recruitmentTypeName:kind,employmentType:employment,jobStatus:detail?.jobStatus??null},
  official_url:source.primary_entry_url,job_url_kind:'official_listing',raw_file:rawFile,
  raw_metadata:{published_at:row.createTime,salary:detail?.salary||row.salaryRange,detail_display:'Official portal renders a JD dialog; no standalone detail-page URL has been verified. Match by job_id/title.'}};
 const loc=normalizeJobLocations(job);return {...job,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,location_unresolved:loc.unresolved};
}
export async function collectTongcheng(source,options={}){
 const client=createClient(options),jobs=new Map(),seen=new Set(),pages=[],errors=[];let total=null,complete=false,reason='max_pages_reached',detailSkipped=0;
 const q=source.validated_api_request_examples.find(x=>x.purpose==='job_list')||source.validated_api_request_examples[0];const body=structuredClone(q.body||{}),queryType=Number(body.queryType??3),size=Number(options.pageSize||body.pageSize||20);
 try{for(let page=1;page<=Number(options.maxPages||1000);page++){
  const r=await client.request({...q,body:{...body,queryType,pageNo:page,pageSize:size}},{purpose:'job_list'}),data=r.data?.data;
  if(r.record.http_status!==200||r.data?.code!==0||!Array.isArray(data?.content)||!Number.isInteger(data?.totalSize))throw Error('Tongcheng list must return code=0, content array and totalSize');
  if(total!==null&&total!==data.totalSize)errors.push('server_total_changed');total=data.totalSize;
  const before=seen.size,ids=[];
  for(const row of data.content){if(!row.jobId)throw Error('Tongcheng list row missing jobId');const id=String(row.jobId);ids.push(id);if(seen.has(id))continue;seen.add(id);
   let job=normalizeTongchengJob(row,null,source,queryType,r.record.response_file);
   if(options.mode==='locations'||(options.mode==='full'&&jobCityStatus(job,options.cities||[])==='excluded')){detailSkipped++;jobs.set(id,job);continue;}
   try{const detail=await client.request({url:new URL('/recruit-api/external/portal/job-detail',q.url).href,method:'POST',headers:q.headers,body:{jobId:id,queryType,userId:''}},{purpose:'job_detail'});
    if(detail.record.http_status!==200||detail.data?.code!==0||String(detail.data?.data?.id)!==id)throw Error('Tongcheng detail did not return same jobId');
    job=normalizeTongchengJob(row,detail.data.data,source,queryType,detail.record.response_file);if(!job.body_complete)errors.push('missing_body:'+id);
   }catch(e){errors.push(id+': '+e.message);}jobs.set(id,job);
  }
  const fresh=seen.size-before;pages.push({page,server_total:total,job_ids:ids,new_ids:fresh,response_file:r.record.response_file});
  if(seen.size===total){complete=true;reason='unique_ids_reconcile_server_total';break;}
  if(!data.content.length||!fresh||data.last===true){reason='end_or_repeat_before_total';break;}
 }}catch(e){errors.push(e.message);reason=e.message;}
 return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,
  coverage:{status:complete&&!errors.length?'complete':pages.length||jobs.size?'partial':'failed',pages:pages.length,server_total:total,jobs_observed:jobs.size,list_complete:complete,reason,errors,detail_skipped_city:detailSkipped,page_evidence:pages,scope:'queryType '+queryType+'; default 3 formal campus, 4 social and 5 internship only in explicit capability audit copies'}};
}
