// Public SF campus portal; uses observed anonymous list API and detail routes.
import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';

const clean=value=>String(value??'').replace(/<br\s*\/?\s*>|<\/(?:p|div)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;/g,"'").replace(/&quot;/gi,'"').trim();
export function normalizeSfJob(row,source,rawFile,queryIntern='2'){
 const title=clean(row.positionName),description=clean(row.postDuty),requirements=clean(row.jobRequirement),season=String(row.seasonType??'');
 // The public detail component explicitly labels seasonType=3 internship; current graduate API rows are seasonType=2.
 // A required pre-graduation internship mentioned in the body does not change a formal campus role.
 let formal='unknown';const explicitType=String(row.recruitTypeName||row.recruitmentTypeName||'');
 if(season==='3'||/实习生|实习岗|\bintern(?:ship)?\b/i.test(title)||/实习|intern/i.test(explicitType))formal='internship';
 else if(/社招|社会招聘/.test(title+explicitType)||/social/i.test(explicitType))formal='social';
 else if(season==='2')formal='formal';
 const entry=new URL(source.primary_entry_url),official=new URL('/',entry.origin);
 official.hash='/postDetail/'+encodeURIComponent(String(row.id));
 const job={job_id:String(row.id),company_id:source.company_id,company_name:source.display_name,title,description,requirements,
  body_complete:description.length>0&&requirements.length>0,locations_raw:[row.demandCity].filter(Boolean),formal_status:formal,
  open_status:'unknown',official_url:official.href,job_url_kind:'official_detail',raw_file:rawFile,
  recruitment_evidence:{provider:'sf_campus',query_intern:String(queryIntern),seasonType:row.seasonType??null,seasonId:row.seasonId??null,
   explicit_type:explicitType||null,internType:row.internType??null,internTypeName:row.internTypeName??null,
   public_type_mapping:'Public list filter intern=2 is 应届生; detail component seasonType=3 is 实习生; seasonType=2 observed in graduate JD rows.',
   open_status_basis:'Published in current public API list. API does not expose a validated active/closed field; application availability remains unknown.'},
  raw_metadata:{orgSource:row.orgSource??null,orgSourceName:row.orgSourceName??null,created_at:row.createDate??null,raw_api_fields:structuredClone(row)}};
 const loc=normalizeJobLocations(job);return {...job,cities:loc.cities,location_unknown:loc.unknown,location_special:loc.special,location_unresolved:loc.unresolved};
}

export async function collectSf(source,options={}){
 const client=options.client||createClient(options),jobs=new Map(),seen=new Set(),pages=[],errors=[];
 const template=source.validated_api_request_examples?.find(q=>q.purpose==='job_list');
 if(!template)throw Error('SF source requires observed job_list API configuration');
 const initial=new URL(template.url),size=Math.max(1,Math.min(100,Number(options.pageSize||initial.searchParams.get('pageSize')||10))),maxPages=Math.max(1,Number(options.maxPages??1000)),queryIntern=initial.searchParams.get('intern')||'';
 let total=null,firstTotal=null,listComplete=false,reason='max_pages_reached';
 try{
  for(const q of source.public_bootstrap_requests||[])await client.request(q,{purpose:'public_bootstrap'});
  for(let page=1;page<=maxPages;page++){
   const url=new URL(initial);url.searchParams.set('pageNum',String(page));url.searchParams.set('pageSize',String(size));
   const r=await client.request({...template,url:url.href},{purpose:'job_list'}),data=r.data;
   if(r.record.http_status!==200||!data||!Array.isArray(data.list)||!Number.isInteger(data.total)||data.total<0)throw Error('SF list schema/status invalid');
   if(Number(data.pageNum)!==page)errors.push('server_page_mismatch:'+page+'->'+data.pageNum);
   if(firstTotal===null)firstTotal=data.total;if(total!==null&&total!==data.total)errors.push('server_total_changed:'+total+'->'+data.total);total=data.total;
   const ids=[],before=seen.size;
   for(const row of data.list){
    if(row.id===null||row.id===undefined||!row.positionName){errors.push('row_missing_id_or_title:page='+page);continue;}
    const id=String(row.id);ids.push(id);
    if(seen.has(id)){errors.push('duplicate_id:'+id+':page='+page);continue;}
    seen.add(id);jobs.set(id,normalizeSfJob(row,source,r.record.response_file,queryIntern));
   }
   const fresh=seen.size-before;pages.push({page,server_page:data.pageNum,server_total:total,job_ids:ids,new_ids:fresh,response_file:r.record.response_file,has_next_page:data.hasNextPage,is_last_page:data.isLastPage});
   if(seen.size===total){listComplete=true;reason='unique_ids_reconcile_server_total';break;}
   if(!data.list.length||!fresh){reason='empty_or_repeated_page_before_total';errors.push(reason);break;}
   if(data.isLastPage===true||data.hasNextPage===false){reason='terminal_signal_before_unique_total';errors.push(reason);break;}
  }
 }catch(error){reason=error.message;errors.push(error.message);}
 const incomplete=[...jobs.values()].filter(j=>!j.body_complete).map(j=>j.job_id);if(incomplete.length)errors.push('missing_full_jd_body:'+incomplete.join(','));
 return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:[...jobs.values()],requests:client.records,
  coverage:{status:listComplete&&!errors.length?'complete':jobs.size||pages.length?'partial':'failed',pages:pages.length,server_total:total,initial_server_total:firstTotal,jobs_observed:jobs.size,list_complete:listComplete,reason,errors,missing_body_ids:incomplete,page_evidence:pages,
   scope:'SF official campus query intern='+queryIntern+'; classify each role using API seasonType and explicit title/type, not URL alone.'}};
}
