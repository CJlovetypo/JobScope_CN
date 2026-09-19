import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeJobLocations} from './lib/locations.mjs';
import {INDUSTRIES} from './lib/industry-routing.mjs';

const [manifestFile,rootArg,summaryFile]=process.argv.slice(2);
if(!manifestFile||!rootArg||!summaryFile)throw new Error('Usage: node integrate-wps-verified-sources.mjs manifest-v2.json skill-root summary.json');
const root=path.resolve(rootArg), stamp=new Date().toISOString();
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const key=value=>String(value||'').toLowerCase().replace(/[\s·•・—–_()（）\[\]【】|丨／/\-]/g,'');

const NAME_MAP=new Map(Object.entries({
  'Ampace新能安':'新能安', '飞鹤':'中国飞鹤', '豪迈':'豪迈集团', '金斯瑞':'金斯瑞生物',
  '金田集团':'金田铜业集团', '正浩EcoFlow':'正浩', '中车大连所':'中车大连公司',
  '康师傅百饮':'百事饮品事业（康师傅百饮）', '广晟财务公司':'广晟控股',
  '捷途汽车':'奇瑞控股集团', '三一重能':'三一集团（含重卡）', '一汽丰田':'中国一汽',
  '长安科技智驾领域':'长安汽车', '中国电科8所':'中国电科集团招聘',
  '中国电科9所':'中国电科集团招聘', '中化泉州石化':'中国中化',
  '隆基绿能数字化中心':'隆基绿能',
  'WELLMAX昭关照明':'昭关照明WELLMAX', '中国机械工业集团':'国机集团',
  '哈罗-两轮事业部':'哈啰', '喜马拉雅-急招岗位':'喜马拉雅',
  '奥飞娱乐重点人才项目':'奥飞娱乐', '字节跳动 Data':'字节跳动',
  '字节跳动搜索团队':'字节跳动', '小猿':'猿辅导', '得物App':'得物',
  '江苏时代':'宁德时代', '海兴电力-春招末班车':'海兴电力',
  '腾讯云智研发公司':'腾讯', '虹科-岗位补录':'虹科', '青岛鼎信通讯':'鼎信通讯',
  '宁德时代-急招岗位':'宁德时代', '舜宇-末班车':'舜宇集团', '舜宇':'舜宇集团',
  '春秋航空_专项生项目':'春秋航空',
}));
function resolvedName(value){
  let name=NAME_MAP.get(value)||value;
  name=name.replace(/[-｜丨|](?:财务管培生|海外业务管培生|起点培训生|仓储管理储备干部|末班车|补录|补招|专场|专项|剩余岗位|热招岗位|岗位合集|研发岗).*$/,'').trim();
  return NAME_MAP.get(name)||name;
}
function endpointKey(source){
  const list=source.validated_api_request_examples?.find(q=>/list|search/i.test(q.purpose||''))||source.validated_api_request_examples?.[0]||{};
  return JSON.stringify([source.provider,list.url,list.body,list.headers?.['website-path'],source.primary_entry_url]);
}
function endpoint(source){
  const output=structuredClone(source);delete output.recruitment_sources;delete output.industry_tags;
  output.source_id||='api-'+hash(endpointKey(output));return output;
}
function industryTags(category,name){
  const value=`${category} ${name}`, tags=[];
  const add=(id,re)=>{if(re.test(value))tags.push(id);};
  add('internet',/互联网|软件|网络安全|游戏|人工智能|\bAI\b|数字科技|电商|云服务/i);
  add('smart_hardware',/智能硬件|智能终端|家电|消费电子|机器人|无人机|可穿戴|智能设备/);
  add('automotive_oem',/整车|车企|汽车制造|乘用车|商用车|摩托车|一汽大众|一汽丰田|长安马自达/);
  add('supply_chain',/汽车零部件|汽车电子|智能驾驶|车载|电池|电驱|芯片|半导体|集成电路|电子设备|光学光电|电子元件/);
  add('finance',/金融|银行|证券|基金|保险|信托|投融资|资管|财险/);
  add('energy_environment',/能源|电力|燃气|核能|新能源|光伏|风能|环保|水处理/);
  add('industrial',/工业|机械|装备|自动化|仪器仪表|重工|智能制造/);
  add('healthcare',/医药|医疗|制药|生物|健康|医院|医疗器械/);
  add('construction',/建筑|地产|基建|物业|工程建设|市政|园林|水利/);
  add('aerospace_transport_equipment',/航空|航天|船舶|轨道|军工|国防/);
  add('professional_services',/咨询|科研|研究院|研究所|实验室|检测|认证|会计|法律服务/);
  add('logistics_trade',/物流|运输|贸易|航运|快递|航空公司|交通/);
  add('consumer',/消费品|食品|饮料|美妆|日化|零售|餐饮|酒店|服装|时尚|家居/);
  add('materials_chemicals',/石化|化工|材料|矿产|钢铁|冶金|金属|水泥/);
  add('education',/教育|培训|学校/);
  add('media_tourism',/文化|传媒|旅游|影视|出版|广告|娱乐/);
  add('agriculture',/农业|农林|牧业|养殖|渔业/);
  add('telecom',/通信|电信|运营商|5G|广电/);
  add('diversified',/综合集团|投资集团|产业运营|控股集团|招商引资/);
  return [...new Set(tags.length?tags:['diversified'])];
}
const categoryTags=value=>[...new Set(String(value||'').split(/[／/、|｜]/).map(x=>x.replace(/[\u200b-\u200d\ufeff]/g,'').trim()).filter(x=>x&&x.length<=20))].slice(0,10);
const emptyFact=()=>({value:'',status:'missing',entity:'',as_of:'',checked_at:'',evidence:[]});

const registry=await read(datasetPath(root,'assets/sources.json'));
const cityData=await read(path.join(root,'data/company-city-index.json'));
const businessData=await read(datasetPath(root,'data/company-business-tags.json'));
const ownershipData=await read(datasetPath(root,'data/company-ownership-tags.json'));
const profileData=await read(datasetPath(root,'data/company-profiles.json'));
const manifest=(await read(path.resolve(manifestFile))).filter(row=>row.admitted);
const companies=structuredClone(registry.companies);
const cityMap=new Map(cityData.companies.map(x=>[x.company_id,x]));
const businessMap=new Map(businessData.companies.map(x=>[x.company_id,x]));
const ownershipMap=new Map(ownershipData.companies.map(x=>[x.company_id,x]));
const profileMap=new Map(profileData.companies.map(x=>[x.company_id,x]));
for(const [duplicateName,targetName] of [['宁德时代-急招岗位','宁德时代'],['舜宇','舜宇集团']]){
  const duplicateIndex=companies.findIndex(company=>company.display_name===duplicateName), target=companies.find(company=>company.display_name===targetName);
  if(duplicateIndex<0||!target)continue;
  const duplicate=companies[duplicateIndex], sourceMap=new Map([endpoint(target),...(target.recruitment_sources||[]).map(endpoint)].map(source=>[endpointKey(source),source]));
  for(const source of [endpoint(duplicate),...(duplicate.recruitment_sources||[]).map(endpoint)])sourceMap.set(endpointKey(source),source);
  target.recruitment_sources=[...sourceMap.values()].map(source=>({...source,company_id:target.company_id,display_name:target.display_name}));
  target.aliases=[...new Set([...(target.aliases||[]),duplicate.display_name,...(duplicate.aliases||[])])];
  target.industry_tags=[...new Set([...(target.industry_tags||[]),...(duplicate.industry_tags||[])])];
  const targetCity=cityMap.get(target.company_id), duplicateCity=cityMap.get(duplicate.company_id);
  if(duplicateCity)cityMap.set(target.company_id,{...targetCity,company_id:target.company_id,display_name:target.display_name,cities:[...new Set([...(targetCity?.cities||[]),...(duplicateCity.cities||[])])].sort((a,b)=>a.localeCompare(b,'zh-CN')),updated_at:stamp,city_evidence:[...(targetCity?.city_evidence||[]),...(duplicateCity.city_evidence||[])]});
  cityMap.delete(duplicate.company_id);businessMap.delete(duplicate.company_id);ownershipMap.delete(duplicate.company_id);profileMap.delete(duplicate.company_id);
  companies.splice(duplicateIndex,1);
}
const byName=new Map(companies.flatMap(c=>[c.display_name,...(c.aliases||[])].map(name=>[key(name),c])));
const grouped=new Map();
for(const row of manifest){
  const name=resolvedName(row.display_name), group=grouped.get(key(name))||{name,rows:[],aliases:new Set(),categories:new Set()};
  group.rows.push(row);group.categories.add(row.category);
  for(const alias of [row.display_name,...(row.observed_names||[])])if(alias&&alias!==name)group.aliases.add(alias);
  grouped.set(key(name),group);
}

const added=[],merged=[],sourcesAdded=[];
for(const group of grouped.values()){
  let company=byName.get(key(group.name));
  const isNew=!company;
  const rows=group.rows.sort((a,b)=>(b.formal_jobs||0)-(a.formal_jobs||0)||(b.complete_jds||0)-(a.complete_jds||0));
  const prepared=[];
  const cityEvidence=[];const observedCities=new Set();let formalObserved=0,unknownLocation=0,uncertain=0;
  for(const row of rows){
    const config=endpoint(await read(row.source_file));
    const proofFile=row.capability_only&&row.capability_result_file?row.capability_result_file:row.result_file;
    const proof=await read(proofFile), regular=await read(row.result_file);
    config.verified_samples=proof.jobs.filter(j=>j.body_complete&&j.job_id&&j.official_url).slice(0,3).map(j=>({job_id:String(j.job_id),title:j.title,url:j.official_url}));
    config.api_verified_at=row.checked_at;config.verification_scope=row.capability_only?'API 可取得完整 JD；当前正式校招列表为空':'API 可取得完整 JD';
    prepared.push(config);
    for(const job of regular.jobs){
      if(job.formal_status==='unknown'||job.open_status==='unknown')uncertain++;
      if(job.formal_status!=='formal'||job.open_status!=='open'||!job.body_complete)continue;
      formalObserved++;
      const loc=normalizeJobLocations(job);
      if(!loc.cities.length)unknownLocation++;
      for(const city of loc.cities)observedCities.add(city);
      if(loc.cities.length)cityEvidence.push({job_id:String(job.job_id),title:job.title,cities:loc.cities,locations_raw:job.locations_raw||[],official_url:job.official_url,checked_at:row.checked_at,source_provider:row.provider});
    }
  }
  const tags=industryTags([...group.categories].join(' / '),group.name);
  if(isNew){
    const companyId='company-'+hash(group.name), first=prepared[0];
    company={...first,company_id:companyId,display_name:group.name,aliases:[...group.aliases],category:[...group.categories][0]||'待确认细分行业',industry_tags:tags,
      recruitment_sources:prepared.map(source=>({...source,company_id:companyId,display_name:group.name})),verification_status:'verified_api_full_jd',verified_at:stamp,source_origin:'wps-campus-spreadsheets-2025-2027'};
    companies.push(company);added.push({company_id:companyId,display_name:group.name,sources:prepared.length,formal_jobs_observed:formalObserved});
    for(const alias of [company.display_name,...company.aliases])byName.set(key(alias),company);
  }else{
    const all=[endpoint(company),...(company.recruitment_sources||[]).map(endpoint)];
    const sourceMap=new Map(all.map(source=>[endpointKey(source),source]));
    let addedCount=0;for(const source of prepared)if(!sourceMap.has(endpointKey(source))){sourceMap.set(endpointKey(source),source);addedCount++;}
    company.recruitment_sources=[...sourceMap.values()].map(source=>({...source,company_id:company.company_id,display_name:company.display_name}));
    company.industry_tags=[...new Set([...(company.industry_tags||[]),...tags])];
    company.aliases=[...new Set([...(company.aliases||[]),group.name,...group.aliases])].filter(alias=>alias!==company.display_name);
    company.api_verified_at=stamp;merged.push({company_id:company.company_id,display_name:company.display_name,observed_as:group.name,sources_added:addedCount});
  }
  sourcesAdded.push(...prepared.map(source=>({company_id:company.company_id,display_name:company.display_name,provider:source.provider,entry_url:source.primary_entry_url,source_id:source.source_id})));

  const oldCity=cityMap.get(company.company_id);const cities=[...new Set([...(oldCity?.cities||[]),...observedCities])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  cityMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,cities,updated_at:stamp,
    coverage:{status:oldCity?'partial':rows.every(r=>r.coverage?.status==='complete')?'complete':'partial',reason:'合入 WPS 校招汇总表发现并经匿名 API 验证的招聘入口；城市仅取本轮明确正式、开放且完整 JD 的岗位。',source_contexts:rows.map(r=>({provider:r.provider,entry_url:r.entry_url,status:r.coverage?.status||'unknown',checked_at:r.checked_at}))},
    formal_jobs_observed:(oldCity?.formal_jobs_observed||0)+formalObserved,unknown_location_jobs:(oldCity?.unknown_location_jobs||0)+unknownLocation,
    uncertain_type_or_status_jobs:(oldCity?.uncertain_type_or_status_jobs||0)+uncertain,city_coverage_complete:false,
    city_evidence:[...(oldCity?.city_evidence||[]),...cityEvidence]});
  if(!businessMap.has(company.company_id)){
    const category=[...group.categories].filter(Boolean).join('；'), summary=`WPS 校招汇总表将该招聘主体归入：${category}。该分类只作为业务线索，尚未核实是否覆盖全部主营业务。`;
    businessMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business_tags:categoryTags(category),business_summary:summary,status:'partial',
      evidence:[{url:'https://www.kdocs.cn/l/ctPDh6NGylGa',title:'2025—2027 届校招信息汇总表归档',evidence_type:'recruitment_spreadsheet',note:'公司名称、行业分类与招聘入口来自本次本地全量归档；招聘 API 已另行实测。',checked_at:stamp}]});
    profileMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,business:{value:summary,status:'partial',entity:company.display_name,as_of:'2025—2027 届校招汇总',checked_at:stamp,evidence:businessMap.get(company.company_id).evidence},workforce:emptyFact(),capital:emptyFact()});
    ownershipMap.set(company.company_id,{company_id:company.company_id,display_name:company.display_name,ownership_tag:'待核实',status:'verified_unresolved',reason:'WPS 校招汇总表与招聘 API 能确认招聘主体和岗位，但不足以确认当前最终控制关系。',checked_at:stamp.slice(0,10),evidence:[{url:company.primary_entry_url,title:`${company.display_name}公开招聘入口`,note:'只用于确认招聘主体；不据招聘入口推断所有制。',checked_at:stamp.slice(0,10)}]});
  }
}

const counts=Object.fromEntries(INDUSTRIES.map(industry=>[industry.id,companies.filter(company=>(company.industry_tags||[]).includes(industry.id)).length]));
const outputRegistry={...registry,updated_at:stamp,verified_on:stamp.slice(0,10),industry_counts:counts,latest_wps_expansion_verified_on:stamp,companies};
await write(datasetPath(root,'assets/sources.json'),outputRegistry);
for(const [file,base,map] of [['company-city-index',cityData,cityMap],['company-business-tags',businessData,businessMap],['company-ownership-tags',ownershipData,ownershipMap],['company-profiles',profileData,profileMap]]){
  await write(datasetPath(root,'data/'+file+'.json'),{...base,updated_at:stamp,companies:companies.map(company=>map.get(company.company_id))});
}
await write(path.resolve(summaryFile),{integrated_at:stamp,before_companies:registry.companies.length,after_companies:companies.length,new_companies:added.length,existing_companies_enriched:merged.length,verified_api_sources:sourcesAdded.length,formal_jobs_observed:added.reduce((n,x)=>n+x.formal_jobs_observed,0),industry_counts:counts,added,merged,sources:sourcesAdded});
console.log(JSON.stringify({before:registry.companies.length,after:companies.length,added:added.length,merged:merged.length,sources:sourcesAdded.length,industry_counts:counts},null,2));
