import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeJobLocations} from './lib/locations.mjs';

const ROOT=path.resolve(process.argv[2]||path.join(import.meta.dirname,'..'));
const REVIEW=path.resolve(process.argv[3]||path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review/selfhosted-recovery-v2'));
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);
const write=async(file,value)=>{const tmp=file+'.selfhosted.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.copyFile(tmp,file);await fs.unlink(tmp);};
const clean=value=>String(value||'').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,'');
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const manifest=await read(path.join(REVIEW,'manifest.json'));
const registry=await read(datasetPath(ROOT,'assets/sources.json'));
const cityData=await read(path.join(ROOT,'data/company-city-index.json'));
const businessData=await read(datasetPath(ROOT,'data/company-business-tags.json'));
const ownershipData=await read(datasetPath(ROOT,'data/company-ownership-tags.json'));
const profileData=await read(datasetPath(ROOT,'data/company-profiles.json'));
const verificationFile=path.join(ROOT,'data/source-verification-wps-20260919.json'),verification=await read(verificationFile);
const companies=structuredClone(registry.companies),byName=new Map(companies.flatMap(company=>[company.display_name,...(company.aliases||[])].map(name=>[clean(name),company])));
const cityMap=new Map(cityData.companies.map(x=>[x.company_id,x])),businessMap=new Map(businessData.companies.map(x=>[x.company_id,x]));
const ownershipMap=new Map(ownershipData.companies.map(x=>[x.company_id,x])),profileMap=new Map(profileData.companies.map(x=>[x.company_id,x]));
const proofMap=new Map((verification.configurations||[]).map(x=>[`${x.company_id}:${x.source_id}`,x]));
const tags={
  '同花顺':['internet','finance'],
  '中国电子信息产业集团':['diversified','internet','supply_chain','industrial','smart_hardware'],
  '文华财经':['internet','finance'],
  'TP-LINK':['internet','smart_hardware','supply_chain'],
  '中国建设银行':['finance'],
};
const category={
  '同花顺':'互联网／金融科技／人工智能',
  '中国电子信息产业集团':'电子信息／数字科技／智能制造／多元集团',
  '文华财经':'金融科技／软件服务',
  'TP-LINK':'智能硬件／网络通信设备',
  '中国建设银行':'银行／金融科技／综合金融',
};
const stamp=new Date().toISOString(),addedCompanies=[],addedSources=[];
for(const row of manifest.filter(item=>item.state==='verified_api_full_jd'&&item.coverage?.list_complete)){
  const source=await read(row.source_file),result=await read(row.result_file);
  let company=byName.get(clean(row.display_name));
  if(!company){
    const companyId='company-'+hash(row.display_name),industryTags=tags[row.display_name]||['diversified'];
    company={...source,company_id:companyId,display_name:row.display_name,aliases:[],category:category[row.display_name]||'待确认细分行业',industry_tags:industryTags,recruitment_sources:[],verification_status:'verified_api_full_jd',verified_at:stamp,source_origin:'wps-interface-contract-review-20260919'};
    companies.push(company);byName.set(clean(row.display_name),company);addedCompanies.push(row.display_name);
  }
  const sourceId='api-'+hash(JSON.stringify([source.provider,source.primary_entry_url,source.api_config||{}]));
  const prepared={...source,company_id:company.company_id,display_name:company.display_name,source_id:sourceId,api_verified_at:result.checked_at,verification_scope:result.coverage.status==='complete'?'匿名第一方 API；完整分页并取得完整 JD':'匿名第一方 API；列表完整分页，详情能力经样本验证并在运行时按城市补齐',
    verified_samples:result.jobs.filter(job=>job.body_complete&&job.official_url).slice(0,3).map(job=>({job_id:String(job.job_id),title:job.title,url:job.official_url,formal_status:job.formal_status,open_status:job.open_status}))};
  if(company.provider===prepared.provider&&company.primary_entry_url===prepared.primary_entry_url)Object.assign(company,prepared);
  const existing=company.recruitment_sources?.length?company.recruitment_sources:[Object.fromEntries(Object.entries(company).filter(([key])=>!['recruitment_sources','industry_tags','aliases','category','verification_status','verified_at','source_origin'].includes(key)))];
  if(!existing.some(item=>item.provider===prepared.provider&&item.primary_entry_url===prepared.primary_entry_url)){
    company.recruitment_sources=[...existing,prepared];addedSources.push(`${company.display_name}:${prepared.provider}`);
  }
  company.industry_tags=[...new Set([...(company.industry_tags||[]),...(tags[row.display_name]||[])])];
  const old=cityMap.get(company.company_id),cities=new Set(old?.cities||[]),evidence=[...(old?.city_evidence||[])];let formal=0,unknown=0;
  for(const job of result.jobs){if(job.formal_status!=='formal'||job.open_status!=='open'||!job.body_complete)continue;formal++;const loc=normalizeJobLocations(job);if(!loc.cities.length)unknown++;for(const city of loc.cities)cities.add(city);if(loc.cities.length)evidence.push({job_id:String(job.job_id),title:job.title,cities:loc.cities,locations_raw:job.locations_raw||[],official_url:job.official_url,checked_at:result.checked_at,source_provider:prepared.provider});}
  cityMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,cities:[...cities].sort((a,b)=>a.localeCompare(b,'zh-CN')),updated_at:stamp,coverage:{status:'complete',reason:'第一方 API 已完成列表分页；城市仅取开放、完整、明确正式校招岗位。',source_contexts:[...(old?.coverage?.source_contexts||[]),{provider:prepared.provider,entry_url:prepared.primary_entry_url,status:result.coverage.status,checked_at:result.checked_at}]},formal_jobs_observed:(old?.formal_jobs_observed||0)+formal,unknown_location_jobs:(old?.unknown_location_jobs||0)+unknown,uncertain_type_or_status_jobs:old?.uncertain_type_or_status_jobs||0,city_coverage_complete:true,city_evidence:evidence});
  if(!businessMap.has(company.company_id)){
    const summary=`${company.display_name}按招聘主体归入：${category[row.display_name]||'待确认细分行业'}。业务标签只影响推荐优先级。`,ev=[{url:prepared.primary_entry_url,title:`${company.display_name}招聘入口`,evidence_type:'recruitment_api',note:'第一方岗位 API 已验证。',checked_at:stamp}];
    businessMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business_tags:tags[row.display_name]||['diversified'],business_summary:summary,status:'partial',evidence:ev});
    profileMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business:{value:summary,status:'partial',entity:company.display_name,as_of:'2026-09-19',checked_at:stamp,evidence:ev},workforce:{value:'',status:'missing',entity:'',as_of:'',checked_at:'',evidence:[]},capital:{value:'',status:'missing',entity:'',as_of:'',checked_at:'',evidence:[]}});
    ownershipMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,ownership_tag:'待核实',status:'verified_unresolved',reason:'招聘 API 可确认招聘主体，不足以推断最终控制关系。',checked_at:'2026-09-19',evidence:[{url:prepared.primary_entry_url,title:`${company.display_name}招聘入口`,note:'用于确认招聘主体。',checked_at:'2026-09-19'}]});
  }
  proofMap.set(`${company.company_id}:${sourceId}`,{company_id:company.company_id,display_name:company.display_name,source_id:sourceId,provider:prepared.provider,checked_at:result.checked_at,entry_url:prepared.primary_entry_url,
    source_file:path.relative(ROOT,row.source_file).replaceAll('\\','/'),result_file:path.relative(ROOT,row.result_file).replaceAll('\\','/'),complete_jds_observed:row.complete_jds,formal_open_full_jds_observed:row.formal_jobs,
    samples:prepared.verified_samples,api_requests:result.requests.filter(q=>q.http_status===200&&q.response_sha256).map(q=>({method:q.method,url:q.url,http_status:q.http_status,response_sha256:q.response_sha256,response_file:path.relative(ROOT,q.response_file).replaceAll('\\','/')})),
    identity_reason:'招聘门户品牌、第一方 API 域名及返回岗位组织经核对一致。',review_bucket:'selfhosted_contract_recovery'});
}
await write(datasetPath(ROOT,'assets/sources.json'),{...registry,companies,updated_at:stamp,verified_on:'2026-09-19',latest_interface_contract_review_at:stamp});
for(const [filename,base,map] of [['company-city-index.json',cityData,cityMap],['company-business-tags.json',businessData,businessMap],['company-ownership-tags.json',ownershipData,ownershipMap],['company-profiles.json',profileData,profileMap]])await write(datasetPath(ROOT,'data/'+filename),{...base,updated_at:stamp,companies:companies.map(company=>map.get(company.company_id))});
await write(verificationFile,{...verification,updated_at:stamp,configurations:[...proofMap.values()]});
const summary={integrated_at:stamp,new_companies:addedCompanies,new_sources:addedSources,company_count:companies.length,source_configuration_count:companies.reduce((sum,company)=>sum+(company.recruitment_sources?.length||1),0)};
await fs.writeFile(path.join(REVIEW,'integration-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
