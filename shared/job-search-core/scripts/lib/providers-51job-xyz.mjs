import crypto from 'node:crypto';import {createClient} from './http.mjs';import {splitCommonBody} from './providers-common.mjs';import {normalizeJobLocations,jobCityStatus} from './locations.mjs';
export function publicXYZSign(params){const p={...params,timestamp:Math.floor(Date.now()/1000)},serialized=Object.keys(p).sort().map(k=>p[k]==null?'':typeof p[k]==='object'?JSON.stringify(p[k]):typeof p[k]==='string'?p[k].trim():String(p[k])).join(''),md5=s=>crypto.createHash('md5').update(s).digest('hex');return{...p,sign:md5(md5('null'+serialized+'sfhVda5dsmZf'))};}
export function normalizeXYZ(d,s,record){const parts=splitCommonBody(d.jobInfo||''),loc=[d.jobAreas].filter(Boolean),l=normalizeJobLocations({locations_raw:loc,title:d.jobName,...parts});let formal='unknown';const title=d.jobName||'';if(/实习|\bintern/i.test(title))formal='internship';else if(/社会招聘|社招/.test(title))formal='social';else if(/校招|校园招聘|应届|20\d{2}届/.test(title)&&/应届|毕业|本科|硕士|学位/.test(parts.description))formal='formal';const q=new URLSearchParams({ctmid:String(s.api_config.ehire_ctm_id),_jobId:d.jobId,jobid:String(d.ehireJobId||d.eHireJobId)});return {job_id:String(d.jobId||''),company_id:s.company_id,company_name:s.display_name,title,...parts,locations_raw:loc,cities:l.cities,location_special:l.special,location_unknown:l.unknown,location_unresolved:l.unresolved,official_url:'https://xyz.51job.com/consumer/pc/home/job?'+q,job_url_kind:'official_detail',formal_status:formal,open_status:d.isExpired===true?'closed':d.isExpired===false?'open':'unknown',recruitment_evidence:{provider:'51job_xyz',jobTerm:d.jobTerm,isExpired:d.isExpired,classification_basis:'Unknown numeric jobTerm is not treated as formal-campus proof'},raw_metadata:{companyName:d.companyName,jobCompanyName:d.jobCompanyName,orgId:d.orgId,ehireCtmId:d.ehireCtmId,ehireJobId:d.ehireJobId},raw_file:record.response_file};}
export async function collectXYZ(source,options={}) {
  if(source.provider!=='51job_xyz')return null;
  const opts={mode:'list',maxPages:100,pageSize:100,timeoutMs:15000,...options};
  if(!['list','full'].includes(opts.mode))throw Error('mode must be list or full');
  for(const k of ['pageSize','maxPages'])if(!Number.isInteger(opts[k])||opts[k]<1)throw Error(k+' must be a positive integer');
  const cities=opts.cityFilters??opts.cities??[];
  if(!Array.isArray(cities))throw Error('city filters must be an array');
  const client=opts.client||createClient(opts),jobs=[],pages=[],errors=[];
  let total=null,firstTotal=null,listComplete=false,reason='max_pages_reached',ctmId,detailsSkippedCity=0;
  const request=async(endpoint,params,method,purpose)=>{
    const signed=publicXYZSign(params),r=await client.request({url:'https://xyzapij.51job.com/'+endpoint+(method==='GET'?'?'+new URLSearchParams(signed):''),method,body:method==='POST'?signed:null,headers:{'Content-Type':'application/json',token:'null'}},{purpose});
    if(r.record.http_status!==200||String(r.data?.result)!=='1')throw Error('Public XYZ API rejected '+(r.data?.code||r.record.http_status));return r;
  };
  try {
    const boot=await request('talent-domain/consumer/noauth/apply/get_customer_setting',{ehireCtmId:String(source.api_config.ehire_ctm_id)},'GET','public_employer_bootstrap');
    ctmId=boot.data.data?.ctmId;if(!ctmId)throw Error('Missing employer GUID');
    const ids=new Set();
    for(let p=1;p<=opts.maxPages;p++) {
      const r=await request('position-domain/consumer/noauth/get_job_list',{ctmId,pageIndex:p,pageSize:opts.pageSize,companyId:[],funcType:[],jobArea:[],jobType:[],jobCategory:[],keyWord:'',sceneType:'00'},'POST','job_list_with_full_JD');
      const arr=r.data.data?.records;total=Number(r.data.data?.total);
      if(!Array.isArray(arr)||!Number.isFinite(total))throw Error('Missing list/total');
      if(firstTotal===null)firstTotal=total;else if(total!==firstTotal)errors.push('server_total_changed');
      if(arr.some(d=>ids.has(String(d.jobId)))||new Set(arr.map(d=>String(d.jobId))).size!==arr.length)errors.push('duplicate_job_ids_across_pages');
      const before=ids.size;
      for(const d of arr) {
        if(!d.jobId){errors.push('missing_job_id');continue;}
        if(ids.has(String(d.jobId)))continue;
        if(String(d.ehireCtmId||d.eHireCtmId)!==String(source.api_config.ehire_ctm_id)){errors.push('Tenant mismatch '+d.jobId);continue;}
        ids.add(String(d.jobId));const j=normalizeXYZ(d,source,r.record);j.list_raw_file=r.record.response_file;
        // This API already returns full content. Retain it; the marker only scopes required bodies.
        if(opts.mode==='full'&&cities.length&&jobCityStatus(j,cities)==='excluded'){j.detail_skipped_reason='explicit_non_target_city';detailsSkippedCity++;}
        jobs.push(j);
      }
      pages.push({page:p,job_ids:arr.map(x=>x.jobId),server_total:total,response_file:r.record.response_file,new_ids:ids.size-before});
      if(ids.size===total){listComplete=!errors.length;reason='unique_ids_reconcile_total';break;}
      if(ids.size===before){reason='empty_or_repeated_page_before_total';break;}
    }
  }catch(e){reason=e.message;errors.push(e.message);}
  const incomplete=jobs.filter(j=>!j.body_complete).length;
  const requiredIncomplete=opts.mode==='full'?jobs.filter(j=>!j.body_complete&&j.detail_skipped_reason!=='explicit_non_target_city').length:0;
  if(requiredIncomplete)errors.push(requiredIncomplete+' required JD bodies need section review');
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs,requests:client.records,
    coverage:{status:listComplete&&!errors.length?'complete':pages.length?'partial':'failed',mode:opts.mode,city_filters:cities,pages:pages.length,
      server_total:total,jobs_observed:jobs.length,list_complete:listComplete,reason:[reason,...errors].filter(Boolean).join('; '),page_evidence:pages,
      incomplete_bodies:incomplete,required_incomplete_bodies:requiredIncomplete,details_failed:0,details_requested:0,details_skipped_city:0,jobs_outside_city:detailsSkippedCity,
      metadata_unresolved:jobs.filter(j=>j.location_unknown||jobCityStatus(j,[])==='unknown'||j.formal_status==='unknown'||j.open_status==='unknown').length,
      scope:'Anonymous employer GUID resolved from observed 51job numeric employer identifier; full content arrives in the list response'}};
}
