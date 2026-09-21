import {createClient} from './http.mjs';
import {normalizeJobLocations} from './locations.mjs';
import locationCodes from './location-codes.json' with {type:'json'};
const mainlandCities=new Set(Object.values(locationCodes.by_code).filter(x=>!/[港澳台臺]/.test(x.province||'')).map(x=>x.city));

export async function collectAjinga(source,options={}){
  if(source.provider!=='ajinga_public')return null;
  const company=String(source.api_config?.company_id||'');if(!/^\d+$/.test(company))throw Error('Missing AJINGA company ID');
  const client=options.client||createClient(options),seen=new Set(),jobs=[],pages=[],errors=[],excluded=[];let total=null,complete=false,reason='page_limit_reached';
  let profile=null;
  try{
    const identity=await client.request({url:'https://www.ajinga.com/django_rest/company/info/'+company+'/'},{purpose:'company_identity'});
    profile=identity.data?.data?.company;
    if(identity.record.http_status!==200||identity.data?.code!==200||String(profile?.id)!==company||!profile?.root_company?.id)throw Error('AJINGA company profile mismatch');
    if(source.api_config.root_company_id&&String(profile.root_company.id)!==String(source.api_config.root_company_id))throw Error('AJINGA configured root company changed');
    for(let p=1;p<=(options.maxPages??1000);p++){
    const url=new URL('https://www.ajinga.com/django_rest/job-list/');url.searchParams.set('company_id',company);url.searchParams.set('page',String(p));url.searchParams.set('page_size',String(Math.min(options.pageSize||100,100)));
    const r=await client.request({url:url.href},{purpose:'job_list'}),data=r.data?.data;
    if(r.record.http_status!==200||r.data?.code!==200||!Array.isArray(data?.list)||!Number.isSafeInteger(data.count))throw Error('AJINGA list schema or HTTP error');
    if(total!==null&&total!==data.count)errors.push('server_total_changed');total=data.count;
    const before=seen.size;
    for(const d of data.list){const id=String(d.pk||'');if(!id)throw Error('missing_job_id');if(seen.has(id)){errors.push('duplicate_job_ids');continue;}seen.add(id);
      if(String(d.company?.root_pk??d.company?.pk)!==String(profile.root_company.id)){errors.push('returned_employer_root_mismatch');continue;}
      const raw=[...d.cities||[],...d.locations?.map(x=>x.city)||[]],loc=normalizeJobLocations({locations_raw:raw,title:d.title});
      if(d.is_overseas!==true&&d.is_overseas!==false){errors.push('unresolved_country_scope');continue;}
      if(d.is_overseas===true||raw.some(x=>/hong\s*kong|macau|macao|taiwan|taipei|hsinchu|香港|澳门|澳門|台湾|臺灣|台北|臺北/i.test(x))||loc.cities.some(x=>['香港','澳门','台北','新竹','新加坡','东京','首尔','伦敦'].includes(x))){excluded.push({job_id:id,is_overseas:d.is_overseas,locations:raw});continue;}
      if(!loc.cities.length||loc.cities.some(x=>!mainlandCities.has(x))){errors.push('unresolved_mainland_location');continue;}
      let official;try{official=new URL(d.url,'https://www.ajinga.com');if(official.origin!=='https://www.ajinga.com')throw Error();}catch{errors.push('invalid_official_url');continue;}
      jobs.push({job_id:id,company_id:source.company_id,company_name:source.display_name,title:d.title,official_url:official.href,job_url_kind:'official_detail',locations_raw:raw,cities:loc.cities,location_unknown:loc.unknown,location_special:loc.special,description:null,requirements:null,body_complete:false,formal_status:'unknown',open_status:d.cant_applied===false&&d.show_apply===1?'open':'unknown',raw_file:r.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'ajinga_public',company_root_id:d.company.root_pk,company_name:d.company.name,company_cn_name:d.company.cn_name,role_type:d.role_type},raw_metadata:{company:d.company,updated_time:d.updated_time}});
    }
    pages.push({url:url.href,returned:data.list.length,server_total:total,job_ids:data.list.map(x=>String(x.pk)),response_file:r.record.response_file});
    if(seen.size===total){complete=!errors.length;reason='unique_ids_reconcile_server_total';break;}
    if(seen.size===before||seen.size>total)throw Error('empty_or_repeated_page_before_total');
  }}catch(e){errors.push(e.message);reason=e.message;}
  const listComplete=complete&&!errors.length,status=listComplete&&(options.mode==='list'||jobs.length===0)?'complete':pages.length?'partial':'failed';
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),company_profile:profile,jobs,requests:client.records,coverage:{status,collection_complete:status==='complete',list_complete:listComplete,server_total:total,pages:pages.length,jobs_observed:jobs.length,capability:'public_list_only',scope:'AJINGA company channel list, validated against returned root company; recognized mainland cities and non-overseas records only; JD and recruitment type unverified',reason:[reason,...new Set(errors),...(options.mode==='list'?[]:['job_details_not_collected'])].join('; '),page_evidence:pages,excluded_location_rows:excluded,incomplete_bodies:jobs.length}};
}
