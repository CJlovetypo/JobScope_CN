// Public Yotta campus API and its current published project/city configuration.
import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';
// Public current apps-pc.bundle.js maps these work_position IDs and constructs /job share URLs.
const cityMap={1:'上海',2:'北京',3:'杭州',4:'台北',5:'洛杉矶',6:'东京',7:'新加坡'};
const clean=x=>String(x||'').replace(/<br\s*\/?>|<\/p>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
export function normalizeYottaRows(payload,source,rawFile,projects=[]){
  if(!Array.isArray(payload?.data?.accurate_jobs))throw new Error('Yotta JSON accurate_jobs array missing');
  const campus=payload.data.accurate_jobs.filter(x=>x.apply_type==='校招'), jobs=[];
  for(const row of campus){
    const zh=row.job_info?.zh;if(!zh)continue;
    const shownTabs=(zh.projectTabs||[]).filter(x=>Number(x.is_show)===1);
    const variants=shownTabs.length?shownTabs:[null];
    for(const tab of variants){
      const projectId=tab?.project_id,project=projects.find(x=>String(x.id)===String(projectId));
      const jobId=String(row.job_id)+(tab?'-project-'+projectId:''),title=row.job_name+(tab?'（'+(project?.project_name||tab.project_name||'项目 '+projectId)+'）':'');
      const description=clean(tab?.job_tasks??zh.job_tasks),requirements=clean(tab?.job_requirements??zh.job_requirements);
      const rawCities=(zh.work_position||[]).map(id=>cityMap[id]||'未识别地点代码 '+id);
      const excluded=/校园大使|训练营|实习|intern/i.test(title.replace(/提前实习|实习经历优先/g,''));
      const loc=normalizeJobLocations({locations_raw:rawCities});
      const url=new URL('https://www.yottagames.com.cn/job');url.searchParams.set('jobTypes','[1]');url.searchParams.set('job_id',String(row.job_id));if(tab)url.searchParams.set('project_id',String(projectId));
      jobs.push({job_id:jobId,company_id:source.company_id,company_name:source.display_name,title,locations_raw:rawCities,cities:loc.cities,location_special:loc.special,location_unknown:loc.unknown,description,requirements,body_complete:description.length>15&&requirements.length>15,formal_status:excluded?'internship':'formal',open_status:Number(zh.is_on)===1?'open':'closed',official_url:url.href,job_url_kind:'official_detail',raw_file:rawFile,recruitment_evidence:{provider:'yotta',apply_type:row.apply_type,is_on:zh.is_on,source_job_id:row.job_id,project_id:projectId??null,formal_basis:excluded?'Explicit temporary/student role title':'Official public API campus category; current campus page identifies this as graduate recruitment; no internship title'},raw_metadata:{education:zh.degree_requirement,work_position_ids:zh.work_position,project:project||tab||null,location_records:rawCities}});
    }
  }
  return jobs;
}
export async function collectYotta(source,options={}){
  if(source.provider!=='yotta')return null;
  const client=createClient(options),checked=new Date().toISOString(),failures=[],pages=[];let jobs=[];
  try{
    const request=source.validated_api_request_examples.find(x=>/get-online-jobs/.test(x.url));if(!request)throw new Error('Missing verified Yotta request');
    const response=await client.request(request,{purpose:'job_list_and_inline_details'});
    if(response.record.http_status!==200||String(response.data?.error_code)!=='0')throw new Error('Yotta API '+response.record.http_status+' / '+response.data?.error_msg);
    let projects=[];
    const projectRequest=source.validated_api_request_examples.find(x=>/project-list/.test(x.url));
    if(projectRequest){const p=await client.request(projectRequest,{purpose:'public_job_project_names'});if(String(p.data?.error_code)==='0'&&Array.isArray(p.data?.data))projects=p.data.data;else failures.push('Project names unavailable; IDs retained');}
    jobs=normalizeYottaRows(response.data,source,response.record.response_file,projects);
    const ids=jobs.map(x=>x.job_id);if(new Set(ids).size!==ids.length)failures.push('Duplicate campus job/project IDs');
    pages.push({page:1,response_file:response.record.response_file,job_ids:ids,new_ids:new Set(ids).size,all_categories_rows:response.data.data.accurate_jobs.length,campus_base_rows:response.data.data.accurate_jobs.filter(x=>x.apply_type==='校招').length,explicit_end:true,end_evidence:'Public site client makes one argument-free get-online-jobs request and filters all returned campus records locally; no pagination contract'});
    const incomplete=jobs.filter(j=>j.formal_status==='formal'&&j.open_status==='open'&&!j.body_complete).length;if(incomplete)failures.push(incomplete+' formal jobs lack complete duties/requirements');
  }catch(e){failures.push(e.message);}
  return {company_id:source.company_id,display_name:source.display_name,checked_at:checked,jobs,requests:client.records,coverage:{status:failures.length?pages.length?'partial':'failed':'complete',pages:pages.length,server_total:null,jobs_observed:jobs.length,reason:failures.join('; ')||'Complete nonpaginated campus job collection from public API; source reports no numeric total',list_complete:!!pages.length,page_evidence:pages}};
}
