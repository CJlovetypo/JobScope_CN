import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectRound3} from './lib/providers-round3.mjs';

const ROOT=path.resolve(process.argv[2]||path.join(import.meta.dirname,'..'));
const REVIEW=path.resolve(process.argv[3]||path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review/round3-live-verification'));
await fs.mkdir(REVIEW,{recursive:true});
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);
const write=async(file,value)=>{const tmp=file+'.round3.tmp';await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');let lastError;
  for(let attempt=1;attempt<=12;attempt++){try{await fs.copyFile(tmp,file);lastError=null;break;}catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,attempt*150));}}
  if(lastError)throw lastError;await fs.unlink(tmp);};
const clean=value=>String(value||'').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,'');
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const emptyFact=()=>({value:'',status:'missing',entity:'',as_of:'',checked_at:'',evidence:[]});
const stamp=new Date().toISOString();
const ROUND_BASELINE={company_count:2186,source_configuration_count:2775};

const crec=await read(path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review/round3-followup-probes/crec-active-companies.json'));
const sydwFiles=(await fs.readdir(path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review/round3-followup-probes'))).filter(name=>/^sydw-[a-f0-9]{32}-full\.json$/.test(name));
const campaigns=[];
for(const file of sydwFiles){const viewId=file.match(/^sydw-([a-f0-9]{32})-/)[1],payload=await read(path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review/round3-followup-probes',file));campaigns.push({viewId,rows:payload.items||[]});}
const cscec8bDirectory=await fetch('https://job.cscec8b.com.cn/cscec8b/81/data/names.json').then(async response=>{if(!response.ok)throw new Error(`CSCEC8B directory HTTP ${response.status}`);return response.json();});
await write(path.join(REVIEW,'cscec8b-company-directory.json'),cscec8bDirectory);

const candidates=[
  {name:'畅唐网络',provider:'ct108_campus',entry:'https://campus.ct108.com/position',category:'游戏／人工智能／软件研发',industries:['internet'],api_config:{code:'e6592c5f7b4984988332c98afe32731d',locations:['杭州']},aliases:['杭州畅唐科技有限公司']},
  {name:'中信证券',provider:'citics_campus',entry:'https://careers.citics.com/campus/headquarters',category:'证券／投资银行／财富管理',industries:['finance'],api_config:{sys_no:'CSE001',recruit_type:'08'},aliases:['中信证券股份有限公司']},
  {name:'九机',provider:'jiuji_public',entry:'https://m.9ji.com/job/school',category:'智能终端零售／新零售／消费电子',industries:['consumer','smart_hardware'],api_config:{recruitment_type:2},aliases:['九机网','云南九机科技有限公司']},
  {name:'网易游戏雷火',provider:'leihuo_campus',entry:'https://leihuo.163.com/campus/#/full',category:'游戏研发／人工智能／数字内容',industries:['internet'],api_config:{project_id:77},aliases:['雷火事业群','网易雷火']},
  {name:'海南交规院',provider:'ihnhr_public',entry:'https://job.ihnhr.com/company/jobs?id=10685392028336822',category:'交通规划／工程勘察设计／科研服务',industries:['construction','professional_services'],api_config:{company_id:'10685392028336822'},aliases:['海南省交通规划勘察设计研究院有限公司']},
];
for(const item of cscec8bDirectory.list||[]){const companyParam=new URL(item.jobApi,'https://job.cscec8b.com.cn').searchParams.get('company');if(!companyParam)continue;
  const digital=/云汉时代数字科技/.test(item.name),technology=/中建科技集团/.test(item.name);
  candidates.push({name:item.name,provider:'cscec8b_public',entry:`https://job.cscec8b.com.cn/${item.path||''}`,category:digital?'建筑数字科技／软件研发':technology?'智能建造／绿色建筑科技':'建筑／基础设施／投资运营',industries:digital?['construction','internet','professional_services']:technology?['construction','smart_hardware']:['construction'],
    api_config:{entity_id:String(item.id),company_param:String(companyParam)},aliases:[item.short,item.title].filter(Boolean)});
}
for(const item of crec.active){
  const name=item.companyName,industries=/宝盈基金/.test(name)?['finance']:/职业技术学院/.test(name)?['education']:/实验室/.test(name)?['professional_services','construction']:/水务|环境/.test(name)?['construction','energy_environment']:['construction'];
  candidates.push({name,provider:'crec_public',entry:`https://zhr.crec.cn/zhaopin/#/webLogin?pkCompany=${encodeURIComponent(item.pkCompany)}&pkOrg=${encodeURIComponent(item.pkOrg||item.pkCompany)}`,
    category:industries.includes('finance')?'基金／资产管理':industries.includes('education')?'职业教育':industries.includes('professional_services')?'科研／工程技术':['construction','energy_environment'].every(x=>industries.includes(x))?'基础设施／市政环保':'建筑／基础设施',
    industries,api_config:{pk_company:item.pkCompany,pk_org:item.pkOrg||item.pkCompany},aliases:[...new Set(item.rows.map(row=>row.companyName).filter(Boolean).filter(alias=>clean(alias)!==clean(name)))],tree:item});
}
const sydwGroups=new Map();
for(const campaign of campaigns)for(const row of campaign.rows){if(!row.zpdw)continue;const item=sydwGroups.get(row.zpdw)||{viewIds:new Set(),rows:[]};item.viewIds.add(campaign.viewId);item.rows.push(row);sydwGroups.set(row.zpdw,item);}
for(const [name,item] of sydwGroups){const environment=/生态环境|环境监测|环境出版/.test(name),education=/学院|培训基地/.test(name),media=/商报社|出版/.test(name),trade=/商务|贸易|进口博览|电子商务|投资促进/.test(name);
  const industries=[...new Set([environment&&'energy_environment',environment&&'professional_services',education&&'education',media&&'media_tourism',trade&&'logistics_trade',!environment&&!education&&!media&&!trade&&'professional_services'].filter(Boolean))];
  candidates.push({name,provider:'sydw_public',entry:`https://www.sydwgkzp.cn/mohrss/index.html#/zpDetails?viewId=${[...item.viewIds][0]}`,category:environment?'生态环境／科研事业单位':trade?'商务／贸易事业单位':education?'教育／培训事业单位':media?'出版／传媒事业单位':'公共事业／专业服务',
    industries,api_config:{view_ids:[...item.viewIds],employer_names:[name]},aliases:[]});
}

const deduped=[...new Map(candidates.map(item=>[`${item.provider}:${clean(item.name)}`,item])).values()];
const verified=[];let cursor=0;
await Promise.all(Array.from({length:6},async()=>{while(cursor<deduped.length){const item=deduped[cursor++],folder=path.join(REVIEW,`${item.provider}-${hash(item.name)}`);
  const source={company_id:'pending',display_name:item.name,provider:item.provider,primary_entry_url:item.entry,api_config:item.api_config};
  try{const result=await collectRound3(source,{evidenceDir:path.join(folder,'http'),timeoutMs:25000});await write(path.join(folder,'result.json'),result);verified.push({item,result,result_file:path.join(folder,'result.json')});console.log(JSON.stringify({company:item.name,provider:item.provider,jobs:result.jobs.length,formal:result.jobs.filter(j=>j.formal_status==='formal').length,full:result.jobs.filter(j=>j.body_complete).length,status:result.coverage.status}));}
  catch(error){verified.push({item,error:error.message});console.log(JSON.stringify({company:item.name,provider:item.provider,error:error.message}));}
}}));
verified.sort((a,b)=>a.item.name.localeCompare(b.item.name,'zh-CN'));

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
const added=[],enriched=[],failed=[];

function examples(item,result){
  if(item.provider==='ct108_campus')return [{url:'https://campus.ct108.com/api/campusrecruit/CampusPostData?code=e6592c5f7b4984988332c98afe32731d',method:'POST',purpose:'job_list_full_body'}];
  if(item.provider==='citics_campus')return [{url:'https://global-kong.citics.com/api/v1/recruit/getPositionList',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'sysNo=CSE001&recruitType=08&deptype=Headquarter&batchId=63&practice=0&pageSize=100&pageNo=1',purpose:'job_list_full_body'},{url:'https://global-kong.citics.com/api/v1/recruit/getPositionInfo',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'sysNo=CSE001&recruitType=08&deptype=Branch&positionNo=<from list>&deptNo=<from list>',purpose:'job_detail_full_body'}];
  if(item.provider==='jiuji_public')return [{url:'https://m.9ji.com/cloudapi_nc/org_service/api/hrRecruitmentStation/mobile-station-page?xservicename=oa-org&current=1&size=100&recruitmentType=2',method:'GET',purpose:'job_list'},{url:'https://m.9ji.com/cloudapi_nc/org_service/api/hrRecruitmentStation/get-station-detail?xservicename=oa-org&stationId=<from list>',method:'GET',purpose:'job_detail_full_body'}];
  if(item.provider==='leihuo_campus')return [{url:'https://xiaozhao.leihuo.netease.com/api/apply/job/list/show?project_id=77&page_number=1&page_size=100&job_name=',method:'GET',purpose:'job_list_full_body'}];
  if(item.provider==='cscec8b_public')return [{url:'https://job.cscec8b.com.cn/cscec8b/81/data/names.json',method:'GET',purpose:'company_directory'},{url:`https://job.cscec8b.com.cn/api/job/getIndexPublishJob.json?company=${encodeURIComponent(item.api_config.company_param)}&id=${encodeURIComponent(item.api_config.entity_id)}&jobnature=2&p=1`,method:'GET',purpose:'job_list_full_body'}];
  if(item.provider==='ihnhr_public')return [{url:'https://gp-api.iguopin.com/api/jobs/v1/list',method:'POST',headers:{Device:'pc',Version:'5.2.300',Subsite:'ihnhr'},body:{page:1,page_size:100,company_id:[item.api_config.company_id]},purpose:'job_list_full_body'}];
  if(item.provider==='crec_public')return [{url:`https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/postPage?pageSize=1000&pageNum=1&workType=10271001&pkCompany=${encodeURIComponent(item.api_config.pk_company)}`,method:'GET',headers:{clientId:'crechr',appId:'5549',tenantId:'crechr'},purpose:'job_list_full_body'}];
  return [{url:'https://www.sydwgkzp.cn/mohrss/api/Affiche/GetPostSelectFyList',method:'POST',body:{viewId:item.api_config.view_ids[0],zpdw:'',zpgw:'',xwxlyq:'',pageIndex:1,pageSize:100},purpose:'job_list_full_body'}];
}

for(const row of verified){if(row.error){failed.push({company:row.item.name,error:row.error});continue;}const {item,result}=row;
  if(!result.jobs.length){failed.push({company:item.name,error:'API 可达但当前没有岗位'});continue;}
  let company=byName.get(clean(item.name)),isNew=false;
  if(!company){const companyId='company-'+hash(item.name);company={company_id:companyId,display_name:item.name,aliases:item.aliases||[],category:item.category,industry_tags:item.industries,recruitment_sources:[],verification_status:'verified_api_access',verified_at:stamp,source_origin:'round3-deep-api-expansion-20260919'};companies.push(company);byName.set(clean(item.name),company);for(const alias of item.aliases||[])byName.set(clean(alias),company);isNew=true;}
  const sourceId='api-'+hash(JSON.stringify([item.provider,item.entry,item.api_config]));
  const source={company_id:company.company_id,display_name:company.display_name,provider:item.provider,category:item.category,primary_entry_url:item.entry,api_config:item.api_config,
    validated_api_request_examples:examples(item,result),public_bootstrap_requests:[{url:item.entry,method:'GET',purpose:'public_recruitment_entry'}],source_id:sourceId,api_verified_at:result.checked_at,
    verification_scope:result.coverage.status==='complete'?'匿名第一方 API；当前列表完整枚举，完整 JD 状态逐岗记录':'匿名第一方 API；当前列表完整枚举，但部分岗位未填写完整职责或要求',
    verified_samples:result.jobs.filter(job=>job.body_complete&&job.official_url).slice(0,3).map(job=>({job_id:String(job.job_id),title:job.title,url:job.official_url,formal_status:job.formal_status,open_status:job.open_status}))};
  const current=company.recruitment_sources?.length?company.recruitment_sources:[];
  if(!current.some(x=>x.source_id===sourceId)){company.recruitment_sources=[...current,source];(isNew?added:enriched).push({company_id:company.company_id,display_name:company.display_name,provider:item.provider,jobs:result.jobs.length,full_jds:result.jobs.filter(j=>j.body_complete).length});}
  Object.assign(company,{provider:company.provider||source.provider,primary_entry_url:company.primary_entry_url||source.primary_entry_url,api_config:company.api_config||source.api_config,validated_api_request_examples:company.validated_api_request_examples||source.validated_api_request_examples,public_bootstrap_requests:company.public_bootstrap_requests||source.public_bootstrap_requests});
  company.industry_tags=[...new Set([...(company.industry_tags||[]),...item.industries])];company.aliases=[...new Set([...(company.aliases||[]),...(item.aliases||[])])];

  const formal=result.jobs.filter(job=>job.formal_status==='formal'&&job.open_status==='open'),cities=[...new Set(formal.flatMap(job=>job.cities||[]))].sort((a,b)=>a.localeCompare(b,'zh-CN')),
    unknown=formal.filter(job=>job.location_unknown||!(job.cities||[]).length),uncertain=result.jobs.filter(job=>job.formal_status==='unknown'||job.open_status==='unknown');
  cityMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,cities,updated_at:result.checked_at,coverage:result.coverage,formal_jobs_observed:formal.length,
    unknown_location_jobs:unknown.length,uncertain_type_or_status_jobs:uncertain.length,city_coverage_complete:result.coverage.status==='complete'&&!unknown.length&&!uncertain.length,
    city_evidence:formal.filter(job=>job.cities?.length).map(job=>({job_id:String(job.job_id),title:job.title,cities:job.cities,locations_raw:job.locations_raw||[],official_url:job.official_url,raw_file:job.raw_file}))});
  const summary=item.tree?.companyBusiness?String(item.tree.companyBusiness).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():`${company.display_name}在本轮官方招聘 API 中归入“${item.category}”；该信息用于业务方向优先级，不代表完整业务清单。`;
  const tags=item.category.split(/[／、]/).map(x=>x.trim()).filter(Boolean),evidence=[{url:item.entry,title:`${company.display_name}公开招聘入口`,evidence_type:'recruitment_api',note:`匿名 API 当前返回 ${result.jobs.length} 个岗位，其中 ${result.jobs.filter(j=>j.body_complete).length} 个有完整职责和任职条件。`,checked_at:result.checked_at}];
  businessMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business_tags:tags,business_summary:summary,status:'partial',evidence});
  if(!profileMap.has(company.company_id))profileMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business:emptyFact(),workforce:emptyFact(),capital:emptyFact()});
  if(!ownershipMap.has(company.company_id))ownershipMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,ownership_tag:'待核实',status:'verified_unresolved',reason:'本轮仅核验招聘 API 和招聘主体归属，未据此推断最终控制关系。',checked_at:stamp.slice(0,10),evidence:[{url:item.entry,title:`${company.display_name}招聘入口`,note:'用于确认招聘主体及岗位，不用于推断控制关系。',checked_at:stamp.slice(0,10)}]});
  proofMap.set(`${company.company_id}:${sourceId}`,{company_id:company.company_id,display_name:company.display_name,source_id:sourceId,provider:item.provider,checked_at:result.checked_at,entry_url:item.entry,result_file:path.relative(ROOT,row.result_file).replaceAll('\\','/'),
    jobs_observed:result.jobs.length,complete_jds_observed:result.jobs.filter(j=>j.body_complete).length,formal_open_full_jds_observed:result.jobs.filter(j=>j.formal_status==='formal'&&j.open_status==='open'&&j.body_complete).length,
    samples:source.verified_samples,api_requests:result.requests.filter(q=>q.http_status>=200&&q.http_status<300&&q.response_sha256).map(q=>({method:q.method,url:q.url,http_status:q.http_status,response_sha256:q.response_sha256,response_file:path.relative(ROOT,q.response_file).replaceAll('\\','/')})),
    identity_reason:item.provider==='crec_public'?'官方公司树的 pkCompany 与岗位返回 pkCompany 精确一致。':item.provider==='sydw_public'?'官方岗位行的招聘单位字段与公司名称精确一致。':item.provider==='cscec8b_public'?'官方公司目录的实体 ID、company 参数与岗位返回的招聘组织逐项核对。':'官方招聘门户、接口域名与岗位品牌一致。',review_bucket:'round3_deep_api_expansion'});
}

companies.sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN'));
const industryCounts={};for(const company of companies)for(const tag of company.industry_tags||[])industryCounts[tag]=(industryCounts[tag]||0)+1;
await write(datasetPath(ROOT,'assets/sources.json'),{...registry,companies,updated_at:stamp,verified_on:stamp.slice(0,10),latest_deep_api_review_at:stamp,industry_counts:industryCounts});
for(const [filename,base,map] of [['company-city-index.json',cityData,cityMap],['company-business-tags.json',businessData,businessMap],['company-ownership-tags.json',ownershipData,ownershipMap],['company-profiles.json',profileData,profileMap]])await write(datasetPath(ROOT,'data/'+filename),{...base,updated_at:stamp,companies:companies.map(company=>map.get(company.company_id))});
await write(verificationFile,{...verification,updated_at:stamp,configurations:[...proofMap.values()]});
const sourceConfigurationCount=companies.reduce((sum,c)=>sum+(c.recruitment_sources?.length||1),0);
const summary={integrated_at:stamp,candidates:deduped.length,verified:verified.filter(x=>!x.error&&x.result.jobs.length).length,failed,
  new_companies_this_execution:added.length,existing_companies_enriched_this_execution:enriched.length,added_this_execution:added,
  round_baseline:ROUND_BASELINE,round_added_companies:companies.length-ROUND_BASELINE.company_count,
  round_added_source_configurations:sourceConfigurationCount-ROUND_BASELINE.source_configuration_count,
  company_count:companies.length,source_configuration_count:sourceConfigurationCount,jobs_observed:verified.reduce((n,x)=>n+(x.result?.jobs.length||0),0),complete_jds_observed:verified.reduce((n,x)=>n+(x.result?.jobs.filter(j=>j.body_complete).length||0),0)};
await write(path.join(REVIEW,'integration-summary.json'),summary);console.log(JSON.stringify(summary,null,2));
