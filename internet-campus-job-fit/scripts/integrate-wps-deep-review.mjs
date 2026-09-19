import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeJobLocations} from './lib/locations.mjs';
import {INDUSTRIES} from './lib/industry-routing.mjs';

const ROOT=path.resolve(process.argv[2]||path.join(import.meta.dirname,'..'));
const REVIEW=path.resolve(process.argv[3]||path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review'));
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.deep-review.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.copyFile(temp,file);await fs.unlink(temp);};
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,12);
const key=value=>String(value||'').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,'');
const relative=file=>file?path.relative(ROOT,path.resolve(file)).replaceAll('\\','/'):'';
const endpointKey=source=>{const q=source.validated_api_request_examples?.find(x=>/list|search/i.test(x.purpose||''))||source.validated_api_request_examples?.[0]||{};return JSON.stringify([source.provider,source.primary_entry_url,q.url,q.body,q.headers?.['website-path'],source.api_config]);};
const endpoint=source=>{const copy=structuredClone(source);for(const field of ['recruitment_sources','industry_tags','aliases','source_origin','verification_status','verified_at'])delete copy[field];copy.source_id||='api-'+hash(endpointKey(copy));return copy;};
const csvCell=value=>'"'+String(value??'').replaceAll('"','""').replaceAll('\r',' ').replaceAll('\n',' ')+'"';
const csv=(headers,rows)=>'\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';

const NAME_MAP=new Map(Object.entries({
  '爱善天使-补录':'爱善天使','澳柯玛-热招岗位':'澳柯玛','创想三维补录':'创想三维','汇川技术-留学生招聘':'汇川技术',
  '江淮汽车-热招岗位':'江淮汽车','江铃汽车-补录':'江铃汽车','金证股份-剩余岗位':'金证股份','盛邦安全-营销专场':'盛邦安全',
  '斯凯奇-销售培训生':'斯凯奇','旺旺-管培生':'旺旺集团','欢乐互娱海外管培生':'欢乐互娱','乐道销售培训生':'乐道汽车',
  '荔枝集团-AI技术专场':'荔枝集团','深圳航空“北溟鱼”管理培训生':'深圳航空','戴永红补录':'戴永红','东方财富东才计划':'东方财富',
  '富途-研发岗位专场':'富途','高途国际教育':'高途','吉迩集团超吉星':'吉迩集团','九州通集团-星九管培生':'九州通集团',
  '巨人网络-美术类岗位':'巨人网络','瑞幸咖啡总部':'瑞幸咖啡','深信服「X-STAR」顶尖人才计划':'深信服','诗悦网络-新增岗位':'诗悦网络',
  '无忧传媒-补录':'无忧传媒','新浪&微博':'新浪微博','猿辅导集团':'猿辅导','壳牌-毕业生英才计划':'壳牌中国',
  'ASML阿斯麦光刻':'ASML阿斯麦光刻','沃尔玛采销管培生专场':'沃尔玛','中国电科40、41所':'中国电科40所与41所','中国国际工程咨询有限公司-补录':'中国国际工程咨询有限公司',
  '国合通测':'中国有研','火炬电子集团':'火炬电子','小糊涂仙酒业':'小糊涂仙酒业','贝克休斯(中国)':'贝克休斯(中国)',
  '太平洋网络-管培生':'太平洋网络','Shopee研发中心':'Shopee',
  '国机智能':'国机集团','魏牌新能源':'长城汽车','中国化学五环公司':'中国化学工程集团','四川虹信软件':'长虹集团',
  '太平金科':'中国太平保险集团','中国质量认证中心':'中国检验认证集团','吉利沃飞长空':'吉利科技集团','华泰证券分公司':'华泰证券',
  '杭州扬趣':'杭州碧橙','北京地铁公司':'北京市地铁运营有限公司','泉州银行总行':'泉州银行','豌豆思维':'欢乐童年（豌豆思维）',
  '新百丽/百丽国际':'百丽国际','中审众环武汉总所补录':'中审众环会计师事务所','李宁集团-宁锐星':'李宁集团',
  '吉家宠物-电商运营岗位':'吉家宠物','电科芯片':'中电科芯片技术（集团）有限公司',
}));
const canonicalName=name=>NAME_MAP.get(name)||String(name).replace(/[-丨|]补录$/,'').trim();
const CATEGORY_OVERRIDES=new Map([
  ['北京大学首钢医院','医疗／医院／临床与科研'],
  ['康佳集团','智能硬件／家电／消费电子／智能制造'],
  ['安达科技','新能源／电池材料／化工材料'],['磅旗科技','工业软件／智能制造／数字科技'],
  ['北京市地铁运营有限公司','轨道交通／公共交通'],['播恩集团','农牧／饲料／消费品'],
  ['大北农猪饲料集团','农牧／饲料／农业科技'],['中电科芯片技术（集团）有限公司','半导体／集成电路／电子设备'],
  ['国机集团','机械装备／工程服务／智能制造'],['杭州碧橙','电子商务／数字营销／互联网'],
  ['吉家宠物','宠物消费品／零售'],['吉利科技集团','智能出行／汽车科技／产业投资'],
  ['杰牌传动','机械传动／智能制造'],['李宁集团','运动消费品／零售'],['泉州银行','银行／金融'],
  ['思念食品','食品／消费品'],['长虹集团','智能硬件／家电／电子制造'],['中国太平保险集团','保险／金融科技'],
  ['欢乐童年（豌豆思维）','在线教育／教育科技'],['万和电气','智能硬件／家电／制造'],
  ['沃顿科技','膜材料／环保科技／新材料'],['武汉市多比特信息科技有限公司','游戏／互联网／软件'],
  ['百丽国际','鞋服／零售／消费品'],['移远通信','物联网／通信模组／汽车电子'],['易蓓文化','文化传媒／内容服务'],
  ['中车山东风电公司','风电装备／新能源／智能制造'],['中国航空工业集团电源','航空电源／军工电子／智能制造'],
  ['中国化学工程集团','工程建设／化工／基础设施'],['中国检验认证集团','检测认证／专业服务'],
  ['PingCAP','数据库／云服务／开源软件'],
]);

const SAFE={
  ready:new Set(['奥士康','和黄医药','华宸绿科','火炬电子集团','康巴赫','西部数据','小糊涂仙酒业','怡安','中国能源建设集团云南火电建设有限公司','中国中信金融资产','贝克休斯(中国)','壳牌-毕业生英才计划']),
  discovered:new Set(['闪迪','西部数据','ASML阿斯麦光刻','北京城建集团','华泰财险','盈德气体']),
  zhaopin:new Set(['国邦医药','国机互联','国机数字科技有限公司','国家无线电监测中心检测中心','海南矿业','汉宸集团','江苏省电子质检院','洛阳格力','上海建科咨询集团','双汇集团','太阳纸业','沃尔玛采销管培生专场','一博环保','中船集团','中国大地保险','中国电科40、41所','中国光大环境','中国旅游集团','中国人民大学出版社','中国邮政储蓄银行安徽省分行','中国邮政储蓄银行上海分行']),
};
const manifests={
  common:await read(path.join(REVIEW,'common-ats-recovery-verification/manifest.json')),
  ready:await read(path.join(REVIEW,'ready-verification-v2/manifest.json')),
  discovered:await read(path.join(REVIEW,'discovered-tenant-verification/manifest.json')),
  zhaopin:await read(path.join(REVIEW,'zhaopin-verification-v3/manifest.json')),
  hcm:await read(path.join(REVIEW,'hcmcloud-verification-v4/manifest.json')),
  wechat:await read(path.join(REVIEW,'wechat-second-hop-review/verified-full-manifest.json')),
  wechatQr:await read(path.join(REVIEW,'wechat-qr-link-review/verified-full-manifest.json')),
};
const WECHAT_REJECT=new Set(['中工国际','时代长安']);
const selected=[
  ...manifests.common.filter(row=>row.admitted).map(row=>({...row,review_bucket:'common_ats'})),
  ...manifests.ready.filter(row=>row.admitted&&SAFE.ready.has(row.display_name)).map(row=>({...row,review_bucket:'51job_workday'})),
  ...manifests.discovered.filter(row=>row.admitted&&SAFE.discovered.has(row.display_name)).map(row=>({...row,review_bucket:'tenant_recovery'})),
  ...manifests.zhaopin.filter(row=>row.admitted&&SAFE.zhaopin.has(row.display_name)).map(row=>({...row,review_bucket:'zhaopin'})),
  ...manifests.hcm.filter(row=>row.admitted).map(row=>({...row,review_bucket:'hcmcloud'})),
  ...manifests.wechat.filter(row=>row.admitted&&!WECHAT_REJECT.has(row.display_name)).map(row=>({...row,review_bucket:'wechat_second_hop'})),
  ...manifests.wechatQr.filter(row=>row.admitted&&!WECHAT_REJECT.has(row.display_name)).map(row=>({...row,review_bucket:'wechat_qr'})),
];
const shlabDir=path.join(REVIEW,'self-built/shlab-verification'),shlabResult=await read(path.join(shlabDir,'result.json'));
selected.push({display_name:'上海人工智能实验室',company_id:'',category:'人工智能／科研机构',provider:'shlab_public',provider_hint:'shlab_public',source_file:path.join(shlabDir,'source.json'),result_file:path.join(shlabDir,'result.json'),checked_at:shlabResult.checked_at,jobs:shlabResult.jobs.length,complete_jds:shlabResult.jobs.filter(x=>x.body_complete).length,formal_jobs:0,coverage:shlabResult.coverage,admitted:true,review_bucket:'self_built'});

const rejected=[];
for(const [bucket,rows] of Object.entries(manifests))for(const row of rows.filter(x=>x.admitted)){
  const permitted=bucket==='common'||bucket==='hcm'||['wechat','wechatQr'].includes(bucket)&&!WECHAT_REJECT.has(row.display_name)||SAFE[bucket]?.has(row.display_name);
  if(!permitted)rejected.push({...row,review_bucket:bucket,identity_decision:'rejected_identity_mismatch_or_unresolved'});
}

const registry=await read(datasetPath(ROOT,'assets/sources.json')),beforeCompanies=registry.companies.length;
const cityData=await read(path.join(ROOT,'data/company-city-index.json')),businessData=await read(datasetPath(ROOT,'data/company-business-tags.json')),ownershipData=await read(datasetPath(ROOT,'data/company-ownership-tags.json')),profileData=await read(datasetPath(ROOT,'data/company-profiles.json'));
const companies=structuredClone(registry.companies),byId=new Map(companies.map(c=>[c.company_id,c])),byName=new Map(companies.flatMap(c=>[c.display_name,...(c.aliases||[])].filter(Boolean).map(name=>[key(name),c])));
const cityMap=new Map(cityData.companies.map(x=>[x.company_id,x])),businessMap=new Map(businessData.companies.map(x=>[x.company_id,x])),ownershipMap=new Map(ownershipData.companies.map(x=>[x.company_id,x])),profileMap=new Map(profileData.companies.map(x=>[x.company_id,x]));
const stamp=new Date().toISOString(),addedCompanies=[],addedSources=[],duplicates=[];
const industryTags=(category,name)=>{const value=category+' '+name,tags=[];const add=(id,re)=>{if(re.test(value))tags.push(id);};add('internet',/互联网|软件|网络安全|游戏|人工智能|AI|数字科技|电商|云服务/i);add('smart_hardware',/智能硬件|家电|消费电子|机器人|无人机|可穿戴/);add('automotive_oem',/整车|汽车制造|车企|乘用车|商用车/);add('supply_chain',/汽车零部件|汽车电子|智能驾驶|电池|电驱|芯片|半导体|集成电路|电子设备/);add('finance',/金融|银行|证券|基金|保险|信托|资管/);add('energy_environment',/能源|电力|燃气|新能源|光伏|环保/);add('industrial',/工业|机械|装备|自动化|仪器|智能制造/);add('healthcare',/医药|医疗|制药|生物|健康/);add('construction',/建筑|地产|基建|工程建设|市政|园林/);add('aerospace_transport_equipment',/航空|航天|船舶|轨道|军工/);add('professional_services',/咨询|科研|研究院|研究所|实验室|检测|认证/);add('logistics_trade',/物流|运输|贸易|航运|快递|航空公司/);add('consumer',/消费品|食品|饮料|美妆|零售|餐饮|服装|家居/);add('materials_chemicals',/石化|化工|材料|矿产|钢铁|冶金|金属/);add('education',/教育|培训|学校/);add('media_tourism',/文化|传媒|旅游|影视|出版|广告|娱乐/);add('agriculture',/农业|农牧|饲料|种业|养殖/);add('telecom',/通信|电信|运营商|5G|广电/);return [...new Set(tags.length?tags:['diversified'])];};
const emptyFact=()=>({value:'',status:'missing',entity:'',as_of:'',checked_at:'',evidence:[]});

for(const row of selected){
  const name=canonicalName(row.display_name),source=endpoint(await read(row.source_file)),proofFile=row.capability_only&&row.capability_result_file?row.capability_result_file:row.result_file,proof=await read(proofFile),regular=await read(row.result_file);
  let company=byId.get(row.company_id)||byName.get(key(name)),isNew=false;
  const category=CATEGORY_OVERRIDES.get(name)||row.category||'待确认细分行业';
  source.api_verified_at=row.checked_at;source.verification_scope=row.capability_only?'API 可取得完整 JD；当前目标校招列表为空':'深度复核：匿名 API 可取得完整 JD';
  source.verified_samples=proof.jobs.filter(j=>j.body_complete&&j.job_id&&j.official_url).slice(0,3).map(j=>({job_id:String(j.job_id),title:j.title,url:j.official_url,formal_status:j.formal_status,open_status:j.open_status}));
  if(!company){isNew=true;const id='company-'+hash(name),tags=industryTags(category,name);company={...source,company_id:id,display_name:name,aliases:row.display_name===name?[]:[row.display_name],category,industry_tags:tags,recruitment_sources:[],verification_status:'verified_api_full_jd',verified_at:stamp,source_origin:'wps-deep-api-review-20260919'};companies.push(company);byId.set(id,company);byName.set(key(name),company);addedCompanies.push({company_id:id,display_name:name,observed_as:row.display_name,category});}
  source.company_id=company.company_id;source.display_name=company.display_name;
  const existing=isNew?[]:[endpoint(company),...(company.recruitment_sources||[]).map(endpoint)],map=new Map(existing.map(item=>[endpointKey(item),item]));
  if(map.has(endpointKey(source))){duplicates.push({display_name:company.display_name,provider:source.provider,entry_url:source.primary_entry_url,reason:'endpoint_already_registered'});continue;}
  map.set(endpointKey(source),source);company.recruitment_sources=[...map.values()].map(item=>({...item,company_id:company.company_id,display_name:company.display_name}));company.aliases=[...new Set([...(company.aliases||[]),row.display_name].filter(alias=>alias&&alias!==company.display_name))];company.industry_tags=[...new Set([...(company.industry_tags||[]),...industryTags(category,name)])];
  addedSources.push({row,company,source,proof,regular,proofFile});
  const old=cityMap.get(company.company_id),cities=new Set(old?.cities||[]),evidence=[...(old?.city_evidence||[])];let formal=0,unknown=0,uncertain=0;
  for(const job of regular.jobs||[]){if(job.formal_status==='unknown'||job.open_status==='unknown')uncertain++;if(job.formal_status!=='formal'||job.open_status!=='open'||!job.body_complete)continue;formal++;const loc=normalizeJobLocations(job);if(!loc.cities.length)unknown++;for(const city of loc.cities)cities.add(city);if(loc.cities.length)evidence.push({job_id:String(job.job_id),title:job.title,cities:loc.cities,locations_raw:job.locations_raw||[],official_url:job.official_url,checked_at:row.checked_at,source_provider:source.provider});}
  cityMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,cities:[...cities].sort((a,b)=>a.localeCompare(b,'zh-CN')),updated_at:stamp,coverage:{status:'partial',reason:'深度 API 复核新增入口；城市只累加明确正式校招、开放且正文完整的岗位。',source_contexts:[...(old?.coverage?.source_contexts||[]),{provider:source.provider,entry_url:source.primary_entry_url,status:regular.coverage?.status||'unknown',checked_at:row.checked_at}]},formal_jobs_observed:(old?.formal_jobs_observed||0)+formal,unknown_location_jobs:(old?.unknown_location_jobs||0)+unknown,uncertain_type_or_status_jobs:(old?.uncertain_type_or_status_jobs||0)+uncertain,city_coverage_complete:false,city_evidence:evidence});
  if(!businessMap.has(company.company_id)){const summary=`WPS 校招表将该招聘主体归入：${category}。该分类只作为业务线索。`,ev=[{url:source.primary_entry_url,title:`${company.display_name}公开招聘入口`,evidence_type:'recruitment_api',note:'招聘 API 已取得完整 JD。',checked_at:stamp}];businessMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business_tags:category.split(/[/／、|]/).map(x=>x.trim()).filter(Boolean).slice(0,10),business_summary:summary,status:'partial',evidence:ev});profileMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business:{value:summary,status:'partial',entity:company.display_name,as_of:'2025—2027 届校招汇总',checked_at:stamp,evidence:ev},workforce:emptyFact(),capital:emptyFact()});ownershipMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,ownership_tag:'待核实',status:'verified_unresolved',reason:'招聘 API 可确认招聘主体，不足以推断最终控制关系。',checked_at:stamp.slice(0,10),evidence:[{url:source.primary_entry_url,title:`${company.display_name}公开招聘入口`,note:'只用于确认招聘主体。',checked_at:stamp.slice(0,10)}]});}
}

// Earlier review batches may have created these companies before a useful
// category was available.  Reconcile their routing tags deterministically.
for(const [name,category] of CATEGORY_OVERRIDES){
  const company=byName.get(key(name));if(!company)continue;
  company.category=category;company.industry_tags=[...new Set([...(company.industry_tags||[]),...industryTags(category,name)].filter(tag=>tag!=='diversified'))];
  const business=businessMap.get(company.company_id),tags=category.split(/[/／、|]/).map(x=>x.trim()).filter(Boolean),summary=`招聘主体与已验证 JD 将该公司归入：${category}。业务标签只作为推荐优先级参考。`;
  if(business)businessMap.set(company.company_id,{...business,business_tags:tags,business_summary:summary,status:'partial'});
  const profile=profileMap.get(company.company_id);if(profile)profileMap.set(company.company_id,{...profile,business:{...profile.business,value:summary,status:'partial',entity:company.display_name,as_of:'2025—2027 届校招汇总',checked_at:stamp}});
}

const counts=Object.fromEntries(INDUSTRIES.map(industry=>[industry.id,companies.filter(company=>(company.industry_tags||[]).includes(industry.id)).length]));
await write(datasetPath(ROOT,'assets/sources.json'),{...registry,companies,updated_at:stamp,verified_on:stamp.slice(0,10),industry_counts:counts,latest_deep_api_review_at:stamp});
for(const [file,base,map] of [['company-city-index',cityData,cityMap],['company-business-tags',businessData,businessMap],['company-ownership-tags',ownershipData,ownershipMap],['company-profiles',profileData,profileMap]])await write(datasetPath(ROOT,'data/'+file+'.json'),{...base,updated_at:stamp,companies:companies.map(company=>map.get(company.company_id))});

const proofRows=[];
for(const {row,company,source,proof,proofFile} of addedSources){const samples=proof.jobs.filter(job=>job.body_complete&&job.job_id&&job.official_url&&job.description&&job.requirements).slice(0,3).map(job=>({job_id:String(job.job_id),title:job.title,official_url:job.official_url,description_chars:job.description.length,requirements_chars:job.requirements.length,raw_file:relative(job.raw_file||job.evidence_files?.[0])}));const api_requests=(proof.requests||[]).filter(request=>request.http_status===200&&request.response_sha256).map(request=>({method:request.method,url:request.url,http_status:request.http_status,response_sha256:request.response_sha256,response_file:relative(request.response_file)}));if(!samples.length||!api_requests.length)throw Error(`Missing proof for ${company.display_name} ${source.source_id}`);proofRows.push({company_id:company.company_id,display_name:company.display_name,source_id:source.source_id,provider:source.provider,checked_at:row.checked_at,entry_url:source.primary_entry_url,source_file:relative(row.source_file),result_file:relative(proofFile),complete_jds_observed:row.complete_jds,formal_open_full_jds_observed:row.formal_jobs||0,samples,api_requests,capability_sample_coverage:row.capability_coverage||row.coverage,city_list_coverage:row.coverage,identity_reason:'WPS 原始链接、招聘门户主体和 API 返回的岗位组织经人工复核后归并。',registry_candidates:row.observed_names||[row.display_name],review_bucket:row.review_bucket});}
for(const filename of ['source-verification-wps-20260919.json','source-verification-20260917.json','source-verification-full-review-20260917.json']){const file=datasetPath(ROOT,'data/'+filename),base=await read(file),map=new Map((base.configurations||[]).map(item=>[`${item.company_id}:${item.source_id}`,item]));for(const item of proofRows)map.set(`${item.company_id}:${item.source_id}`,item);await write(file,{...base,updated_at:stamp,configurations:[...map.values()]});}

const summary={reviewed_at:stamp,before_companies:beforeCompanies,after_companies:companies.length,new_companies:addedCompanies.length,selected_verified_rows:selected.length,identity_rejected_rows:rejected.length,new_source_configurations:addedSources.length,duplicate_configurations:duplicates.length,providers:Object.fromEntries([...new Set(addedSources.map(x=>x.source.provider))].sort().map(provider=>[provider,addedSources.filter(x=>x.source.provider===provider).length])),added_companies:addedCompanies,added_sources:addedSources.map(({row,company,source})=>({company_id:company.company_id,display_name:company.display_name,observed_as:row.display_name,provider:source.provider,entry_url:source.primary_entry_url,complete_jds:row.complete_jds,formal_jobs:row.formal_jobs||0,review_bucket:row.review_bucket})),identity_rejected:rejected.map(row=>({display_name:row.display_name,provider:row.provider||row.provider_hint,entry_urls:row.entry_urls,employer_names:row.employer_names,reason:row.identity_decision}))};
await write(path.join(REVIEW,'deep-integration-summary.json'),summary);
await fs.writeFile(path.join(REVIEW,'深度复核新增API来源.csv'),csv(['公司','WPS标签','provider','入口','完整JD','正式校招JD','复核批次'],summary.added_sources.map(x=>[x.display_name,x.observed_as,x.provider,x.entry_url,x.complete_jds,x.formal_jobs,x.review_bucket])));
await fs.writeFile(path.join(REVIEW,'主体不符未准入.csv'),csv(['WPS标签','provider','API返回雇主','入口','原因'],summary.identity_rejected.map(x=>[x.display_name,x.provider,(x.employer_names||[]).join('|'),(x.entry_urls||[]).join('|'),x.reason])));
console.log(JSON.stringify({before:beforeCompanies,after:companies.length,new_companies:addedCompanies.length,new_sources:addedSources.length,duplicates:duplicates.length,identity_rejected:rejected.length,providers:summary.providers},null,2));
