import crypto from 'node:crypto';
import {createClient} from './http.mjs';
import {splitCommonBody} from './providers-common.mjs';
import {normalizeJobLocations,jobCityStatus} from './locations.mjs';

// Public anonymous contracts observed in the employer-hosted frontend. No user session.
const coKey='tuD&#mheJQBlgy&Sm300l8xK^X4NzFYBcrN8@YLCret$fv1AZbtujg*KN^$YnUkh';
export function coapiUrl(endpoint,params){const index=17,serialized=JSON.stringify(params);return 'https://coapi.51job.com/'+endpoint+'?'+new URLSearchParams({key:String(index),sign:crypto.createHash('md5').update('coapi'+serialized+coKey.substr(index,15)).digest('hex'),params:serialized});}
export function parsePublicJson(text){try{return JSON.parse(text);}catch{const m=String(text).match(/^\s*\w+\(([\s\S]*)\)\s*;?\s*$/);return m?JSON.parse(m[1]):null;}}
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function classify(title,body,{type='',graduate='',campus=false}={}){const clean=title.replace(/(?:可|需|要求)?提前实习/g,'');if(/实习|\bintern(?:ship)?\b/i.test(clean+' '+type))return 'internship';if(/社招|社会招聘/.test(title))return 'social';if(/校园大使|训练营|夏令营|博士后/.test(title))return 'unknown';if(/校招|校园招聘/.test(title)&&/本科|硕士|学位|应届|毕业|学历/.test(body))return 'formal';if(/^(全职|正式|full.?time)$/i.test(type)&&/^(在校生\/应届生|应届生|应届毕业生)$/.test(graduate))return 'formal';if(campus&&/(?:招聘对象为|面向|招聘对象[：:]?)\s*(?:20\d{2}届.{0,20})?(?:境内外院校)?应届毕业生/.test(body))return 'formal';return 'unknown';}
export function normalizeRecovered(d,source,record,fromPublishedList=false){let id,title,body,loc,url,type='',graduate='',campus=false,meta={};
 if(source.provider==='51job_coapi'){({jobid:id,jobname:title,jobinfo:body,term:type,workyearname:graduate}=d);loc=[d.jobareaname,d.workareaname].filter(Boolean);url='https://xyz.51job.com/external/apply.aspx?jobid='+id+'&ctmid='+d.ctmid;meta={ctmid:d.ctmid,coid:d.coid,coname:d.coname,poscode:d.poscode,term:d.term,workyearname:d.workyearname};}
 else if(source.provider==='zhaopin_grace'){const j=d.job||d;id=j.jobNumber;title=j.title;body=j.detail;loc=[j.cityName,j.districtName].filter(Boolean);url=j.url;campus=source.api_config?.job_source===2;meta={company:d.company,employmentType:j.employmentType,positionSourceType:j.positionSourceType,workingExpName:j.workingExpName};}
 else if(source.provider==='greenhouse'){id=d.id;title=d.title;body=decode(d.content);loc=[d.location?.name].filter(Boolean);url=d.absolute_url;meta={company_name:d.company_name,metadata:d.metadata};}
 else if(source.provider==='ashby'){id=d.id;title=d.title;body=d.descriptionHtml||d.descriptionPlain;loc=[d.location,...(d.secondaryLocations||[]).map(x=>x.location)].filter(Boolean);url=d.jobUrl;type=d.employmentType;meta={department:d.department,team:d.team,isRemote:d.isRemote,workplaceType:d.workplaceType,publishedAt:d.publishedAt};}
 else throw Error('Unsupported recovered provider');
 const parts=splitCommonBody(body||'');const location=normalizeJobLocations({locations_raw:loc,title,...parts});
 return {job_id:String(id||''),company_id:source.company_id,company_name:source.display_name,title:title||'',...parts,locations_raw:loc,cities:location.cities,location_special:location.special,location_unknown:location.unknown,location_unresolved:location.unresolved,official_url:url||null,job_url_kind:url?'official_detail':'unavailable',formal_status:classify(title||'',parts.description,{type,graduate,campus}),open_status:fromPublishedList?'open':'unknown',recruitment_evidence:{provider:source.provider,type,graduate,campus_context:campus,published_list_returned:fromPublishedList,open_basis:fromPublishedList?'Returned by current employer-facing public published-job list; direct detail-only responses do not establish openness.':null,classification_basis:'Explicit per-job title/eligibility only; platform campus channel alone does not prove formal campus recruitment.'},raw_metadata:meta,raw_file:record.response_file};
}
export async function collectRecovered(source,options={}) {
  if(!['51job_coapi','zhaopin_grace','greenhouse','ashby'].includes(source.provider))return null;
  const globalListScope=['verified_public_list_only','verified_api_zero_jobs','verified_api_list_contract'].includes(source.verification_status);
  if(source.provider==='greenhouse'&&!source.api_config?.mainland_location_pattern&&!globalListScope)throw Error('Greenhouse requires an observed mainland location pattern for this employer');
  const opts={mode:'list',pageSize:100,maxPages:100,detailConcurrency:2,timeoutMs:15000,...options};
  if(!['list','full'].includes(opts.mode))throw Error('mode must be list or full');
  for(const k of ['pageSize','maxPages','detailConcurrency'])if(!Number.isInteger(opts[k])||opts[k]<1)throw Error(k+' must be a positive integer');
  const cities=opts.cityFilters??opts.cities??[];
  if(!Array.isArray(cities))throw Error('city filters must be an array');
  const limit=opts.validationMaxDetails??opts.maxDetails??null;
  if(limit!==null&&(!Number.isInteger(limit)||limit<0))throw Error('detail limit must be a non-negative integer');
  const client=opts.client||createClient(opts),jobs=[],pages=[],rows=new Map(),errors=[],cfg=source.api_config||{};
  let total=null,firstTotal=null,listComplete=false,reason='max_pages_reached';
  let detailFailures=0,detailsSkippedCity=0,detailsSkippedMode=0,detailsSkippedLimit=0,detailsRequested=0;
  const excludedLocationRows=[];
  const req=async(q,purpose)=>{const r=await client.request(q,{purpose});const data=r.data||parsePublicJson(r.text);if(r.record.http_status!==200||!data)throw Error('Expected public API payload: HTTP '+r.record.http_status);return {...r,data};};
  // Materialize acquired rows outside this try so a later list failure cannot erase them.
  try {
    for(let p=1;p<=opts.maxPages;p++) {
      let r,arr;
      if(source.provider==='51job_coapi') {
        r=await req({url:coapiUrl('job_list.php',{ctmid:String(cfg.ctmid),pagesize:opts.pageSize,pagenum:p,...(cfg.list_filters||{})})},'job_list');
        if(String(r.data.status)!=='1')throw Error('CoAPI rejected request: '+r.data.message);
        arr=r.data.resultbody?.joblist;total=Number(r.data.resultbody?.totalnum);
      }else if(source.provider==='zhaopin_grace') {
        r=await req({url:'https://fe.zhaopin.com/grace/api/dsc/search-job-list',method:'POST',body:{pageIndex:p,pageSize:opts.pageSize,orgNumbers:String(cfg.org_number),jobSource:cfg.job_source??2,...(cfg.list_filters||{})}},'job_list');
        if(r.data.code!==200)throw Error('Grace rejected request: '+r.data.message);
        arr=r.data.data?.jobList;total=Number(r.data.data?.pageInfo?.totalNum);
      }else if(source.provider==='greenhouse') {
        r=await req({url:'https://boards-api.greenhouse.io/v1/boards/'+encodeURIComponent(cfg.board_token)+'/jobs?content=true'},'job_list_with_full_content');
        arr=r.data.jobs;total=Number(r.data.meta?.total??arr?.length);
      }else {
        r=await req({url:'https://api.ashbyhq.com/posting-api/job-board/'+encodeURIComponent(cfg.board_token)},'job_list_with_full_content');
        arr=r.data.jobs;total=Number(arr?.length);
      }
      if(!Array.isArray(arr)||!Number.isFinite(total))throw Error('Missing list or total');
      if(firstTotal===null)firstTotal=total;else if(total!==firstTotal)errors.push('server_total_changed');
      const ids=arr.map(d=>String(d.jobid||d.job?.jobNumber||d.jobNumber||d.id||'')),before=rows.size;
      if(ids.some(id=>rows.has(id))||new Set(ids).size!==ids.length)errors.push('duplicate_job_ids_across_pages');
      arr.forEach((d,i)=>{if(ids[i])rows.set(ids[i],{data:d,record:r.record});});
      pages.push({page:p,job_ids:ids,server_total:total,response_file:r.record.response_file,new_ids:rows.size-before});
      if(ids.some(x=>!x)){reason='missing_job_id';errors.push(reason);break;}
      if(rows.size===total){listComplete=!errors.length;reason='unique_ids_reconcile_total';break;}
      if(!arr.length||rows.size===before){reason='empty_or_repeated_page_before_total';break;}
      if(['greenhouse','ashby'].includes(source.provider)){reason='single_endpoint_total_mismatch';break;}
    }
  }catch(e){reason=e.message;errors.push(e.message);}
  let queue=[...rows.values()];
  if(source.provider==='greenhouse'&&cfg.mainland_location_pattern) {
    const pattern=new RegExp(cfg.mainland_location_pattern,'i');
    queue=queue.filter(row=>{if(pattern.test(row.data.location?.name||''))return true;excludedLocationRows.push({job_id:String(row.data.id),location:row.data.location?.name,reason:'No explicit mainland location in this posting'});return false;});
  }
  let cursor=0;
  await Promise.all(Array.from({length:opts.detailConcurrency},async()=>{
    while(cursor<queue.length) {
      const row=queue[cursor++];let j=normalizeRecovered(row.data,source,row.record,true);
      j.list_raw_file=row.record.response_file;
      if(opts.mode==='full'&&cities.length&&jobCityStatus(j,cities)==='excluded') {
        j.detail_skipped_reason='explicit_non_target_city';detailsSkippedCity++;
      }else if(source.provider==='51job_coapi') {
        const needsMetadata=j.location_unknown||jobCityStatus(j,[])==='unknown'||j.formal_status==='unknown'||j.open_status==='unknown';
        if(opts.mode==='list'&&!needsMetadata) {j.detail_skipped_reason='list_metadata_sufficient';detailsSkippedMode++;}
        else if(limit!==null&&detailsRequested>=limit) {
          j.detail_skipped_reason='validation_detail_limit';j.raw_metadata.validation_detail_skipped=true;detailsSkippedLimit++;
        }else {
          detailsRequested++;
          try {
            const r=await req({url:coapiUrl('job_detail.php',{jobid:String(row.data.jobid)})},'job_detail');
            const d=r.data.resultbody;
            if(String(d?.ctmid)!==String(cfg.ctmid)||String(d?.jobid)!==String(row.data.jobid))throw Error('CoAPI detail tenant or job mismatch');
            // Detail responses may omit list-only location/company fields.
            const merged={...row.data,...Object.fromEntries(Object.entries(d).filter(([,v])=>v!==undefined&&v!==null))};
            merged.jobareaname=d.jobareaname||row.data.jobareaname;
            merged.workareaname=d.workareaname||row.data.workareaname;
            j=normalizeRecovered(merged,source,r.record,true);j.list_raw_file=row.record.response_file;
          }catch(e) {
            errors.push(e.message);detailFailures++;j.body_complete=false;j.raw_metadata.detail_fetch_error=e.message;
          }
        }
      }
      jobs.push(j);
    }
  }));
  if(detailsSkippedLimit)errors.push('Explicit validation detail limit '+limit+' skipped '+detailsSkippedLimit+' details');
  const incomplete=jobs.filter(j=>!j.body_complete).length;
  const requiredIncomplete=opts.mode==='full'?jobs.filter(j=>!j.body_complete&&j.detail_skipped_reason!=='explicit_non_target_city').length:0;
  if(requiredIncomplete)errors.push(requiredIncomplete+' required JD bodies need section review');
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs,requests:client.records,
    coverage:{status:listComplete&&!errors.length?'complete':pages.length?'partial':'failed',mode:opts.mode,city_filters:cities,pages:pages.length,
      server_total:total,jobs_observed:jobs.length,list_complete:listComplete,reason:[reason,...errors].join('; '),page_evidence:pages,
      details_requested:detailsRequested,details_failed:detailFailures,details_skipped_mode:detailsSkippedMode,details_skipped_city:source.provider==='51job_coapi'?detailsSkippedCity:0,jobs_outside_city:detailsSkippedCity,
      details_skipped_limit:detailsSkippedLimit,incomplete_bodies:incomplete,required_incomplete_bodies:requiredIncomplete,
      metadata_unresolved:jobs.filter(j=>j.location_unknown||jobCityStatus(j,[])==='unknown'||j.formal_status==='unknown'||j.open_status==='unknown').length,
      validation_detail_limit:limit,excluded_location_rows:excludedLocationRows,
      scope:source.provider==='greenhouse'?(cfg.mainland_location_pattern?'Public global tenant enumerated; only postings with explicitly observed mainland locations retained':'Public global Greenhouse board; geography and recruitment direction evaluated per posting, mainland coverage not established'):source.provider==='ashby'?'Public global Ashby job board enumerated; city and recruitment direction are evaluated per posting':'Public employer tenant; recruitment type reviewed separately for each JD'}};
}
