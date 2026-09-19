// Deliberately reviewed identities, not a company-name guessing algorithm.
// API evidence remains local; only confirmed public contracts enter the shared registry.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readSourceRegistry,SOURCE_REGISTRY_FILE,COMPANY_BUSINESS_FILE,COMPANY_OWNERSHIP_FILE,COMPANY_PROFILES_FILE} from '../../shared/job-search-core/registry.mjs';
import {emptyFact} from '../../shared/job-search-core/scripts/lib/company-profiles.mjs';
const root=path.resolve('internet-campus-job-fit/artifacts/feishu-source-expansion-20260919');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p,v)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n');};
const registry=await readSourceRegistry(),reviews=await read(root+'/identity-review.json'),tasks=new Map((await read(root+'/verification-plan.json')).map(t=>[t.id,t]));
// id | actual recruitment entity/portal | industry | literal employer fragment in API evidence
const workday=`
ba1f38a6648e09047a92|费森尤斯医疗（中国招聘门户）|healthcare|Fresenius Medical Care
730dcab45f08579718bb|华侨银行（中国招聘门户）|finance|OCBC China
4995521e8bb764a750bf|宏利（中国招聘门户）|finance|Manulife
613f49bd98cf4e513995|马士基（中国招聘门户）|logistics_trade|Maersk
a7ce6373ba5799add7cc|GE医疗|healthcare|GE Medical
1f137c865d2f74de572d|AIG（中国招聘门户）|finance|AIG Insurance
6969b57088ca075bc3e4|捷普|supply_chain|Jabil
3149f0dd4d357f129c53|AIA友邦（集团招聘入口）|finance|AIA
ef5742cb5883feb817ec|杜邦公司|materials_chemicals|DuPont
4d302f12163a9883114c|辉瑞（中国招聘门户）|healthcare|Pfizer
884b91fef7f6e23763d9|阿斯利康中国|healthcare|AstraZeneca
a55eeb5384053dabf022|赛诺菲（中国招聘门户）|healthcare|Sanofi
291972bccb784ad981fd|ICON（中国招聘门户）|healthcare|ICON Clinical
6027dfb18a74fe8be1af|百时美施贵宝（中国招聘门户）|healthcare|BMS
7ee5e57a28f46ab59c0e|Fortrea（中国招聘门户）|healthcare|Fortrea
4a86740d0ae6b280c80d|强生（中国招聘门户）|healthcare|Johnson & Johnson
b9f0ed77d749c6717c6a|赫力昂（中国招聘门户）|healthcare|Haleon
8944306e0c3939fb22c6|Labcorp（中国招聘门户）|healthcare|Labcorp
b9118f63cd2147e75c06|森萨塔（中国招聘门户）|supply_chain|Sensata
af9c7994d486b8ec84c1|LSEG（中国招聘门户）|finance|Refinitiv
e4f6dacfe2d187d5b1a2|液化空气（中国招聘门户）|materials_chemicals|AIR LIQUIDE
5adbafa4ccc089794787|应用材料（中国招聘门户）|supply_chain|Applied Materials
d6283ed88a3b89532222|Vantive（中国招聘门户）|healthcare|VANTIVE
ecd23ef9e61a5273ec91|雅培（中国招聘门户）|healthcare|Abbott
d079a6ff0d109cf4d500|蔡司（中国招聘门户）|smart_hardware|Carl Zeiss
ccca5a193d800f667151|赛默飞（中国招聘门户）|healthcare|Thermo Fisher
33bdd2d7409367970b05|联邦快递（中国招聘门户）|logistics_trade|Federal Express
5b22f4f37c3a754b6d1f|3M（中国招聘门户）|materials_chemicals|3M
dd2459706604642f280a|KLA科磊（中国招聘门户）|supply_chain|KLA
b540449cbfe26777f966|道富（中国招聘门户）|finance|SS TECH
96a8ac802089588db264|玛氏（中国招聘门户）|consumer|Mars
6f9c400cc348e6690577|哈曼（中国招聘门户）|smart_hardware|Harman
a3ab6d19f07542c02c08|开利（中国招聘门户）|smart_hardware|Carrier
e5507e14d79c82ca59d6|金鹰集团（中国招聘门户）|materials_chemicals|RGE
9ed6348e90bb5598ac52|戴森（中国招聘门户）|smart_hardware|Dyson
446b27944f2571603865|ASML阿斯麦光刻|supply_chain|ASML
e86cb05dc56a1526c538|电通（中国招聘门户）|media_tourism|Dentsu
3cb93010d62d1411e08c|Logicalis（中国招聘门户）|internet|Logicalis
e8afeb60cc05f909a4d0|GE Vernova（中国招聘门户）|energy_environment|GE Energy
56139264b4d6a7e96c43|空气产品（中国招聘门户）|materials_chemicals|Air Products
b81d2054fbf77f3fab00|爱德华生命科学（中国招聘门户）|healthcare|Edwards
d53ed25e042797fe7129|星展（中国招聘门户）|finance|DBS
51e20fda05f21221f448|亿滋（中国招聘门户）|consumer|Mondelez
47d081b4350ab8065550|IQVIA（中国招聘门户）|healthcare|IQVIA
7df8a613f9b68d32a399|Cadence|supply_chain|CDNS
43ffdda7484dc8ebff76|默沙东（中国招聘门户）|healthcare|MSD
d50af650960cb442db88|乔治费歇尔（中国招聘门户）|industrial|Georg Fischer
d54908940723d6252749|安捷伦（中国招聘门户）|industrial|Agilent
cc9bd41d3c298f2f96bc|空中客车（中国招聘门户）|aerospace_transport_equipment|Airbus
13af1bee183b49773e6b|凯度（中国招聘门户）|professional_services|Kantar
0fa44ce6960a196b4444|Bose（中国招聘门户）|smart_hardware|Bose
a8a1272ae34cc6489cc8|华纳兄弟探索（中国招聘门户）|media_tourism|Warner Bros
4e0c4b5d71e2068c51a2|庄信万丰（中国招聘门户）|materials_chemicals|Johnson Matthey
ff497c66c4b7560068eb|Medline（中国招聘门户）|healthcare|Medline
512e5ff3710c49c35225|思科（中国招聘门户）|telecom|Cisco
97093371dca614e0bc8d|施普林格自然（中国招聘门户）|media_tourism|Springer Nature
6447ff58b847980a311a|Syneos Health（中国招聘门户）|healthcare|Syneos
eb019cd244152c40656a|陶氏（中国招聘门户）|materials_chemicals|DOW
85ed7d91caada98b7414|IFF（中国招聘门户）|materials_chemicals|International Flavors
ee222c07db27f931138d|MPS芯源系统|supply_chain|MPS
8d1f7c204f1da8c73485|爱尔康（中国招聘门户）|healthcare|Alcon
8193b7cf4b8c90c2269e|A&F（中国招聘门户）|consumer|AFH
92a56a75f3bcae79babe|德昌电机（中国招聘门户）|supply_chain|Johnson Electric
25c208e0b62bc8c7f951|壳牌中国|energy_environment|SHELL
c34617c17d51c7cc2b3b|伊莱克斯（中国招聘门户）|smart_hardware|Electrolux
2e7dfb72095e54344c62|PPG（中国招聘门户）|materials_chemicals|PPG
204edeb1fa0cd77ddc8c|阿法拉伐（中国招聘门户）|industrial|Alfa Laval
269e010788a5cacbe995|Autodesk（中国招聘门户）|internet|Autodesk
9d2e61d6d23212c7b671|益普生（中国招聘门户）|healthcare|Ipsen
e772e7d85539d7a1cdf8|Apex Group（中国招聘门户）|finance|Apex Group
1345d18d29731641ad72|英特尔（中国招聘门户）|supply_chain|Intel
99e81fb64de43fbc574e|Tory Burch（中国招聘门户）|consumer|Tory Burch
00e4c2c30401d9ff9059|PVH（中国招聘门户）|consumer|PVH
b2765ffd65ed1fc6e4e9|迪士尼（中国招聘门户）|media_tourism|TWDC
a69684c1ffaafae9a10f|皮尔法伯（中国招聘门户）|healthcare|Pierre Fabre
9e56cdce9217f5e75420|珀金埃尔默（中国招聘门户）|industrial|PerkinElmer
29f468e7f6f5d4ee5783|安霸（中国招聘门户）|supply_chain|Ambarella
703d9db481fa86184f3a|Wiley（中国招聘门户）|media_tourism|JWS
c5e9b34fc3fde5fb4011|史赛克（中国招聘门户）|healthcare|Stryker
bff710cf0d5fe6a27c37|耐克（中国招聘门户）|consumer|Nike
632d0da8ea15ed027a09|迈图（中国招聘门户）|materials_chemicals|MOMENTIVE
10e89d7acf131f4d15c4|PHINIA（中国招聘门户）|supply_chain|PHINIA
b195718eba7b676642cf|赢创（中国招聘门户）|materials_chemicals|Evonik
414802de87e5b3b278d5|富达国际（中国招聘门户）|finance|FIL Technology
c392e67f419cc4d6ef25|Palo Alto Networks（中国招聘门户）|internet|Palo Alto Networks
694319b34006d48650c9|罗宾逊物流（中国招聘门户）|logistics_trade|C.H. Robinson
743a9ed1440452151298|科思创（中国招聘门户）|materials_chemicals|Covestro
fc7385ac5862f28e9271|苏尔寿（中国招聘门户）|industrial|Sulzer
9f731f0a24a0cc253523|Global Payments（中国招聘门户）|finance|Global Payments
03c7091dc269edc3293d|爱思唯尔（中国招聘门户）|media_tourism|Elsevier
1abdced2c2bdaba1ffdb|赛多利斯（中国招聘门户）|healthcare|Sartorius
a2914bfe159e8610de10|伟创力（中国招聘门户）|supply_chain|FLEX
8d0fdab625eab6ea4eeb|OmniOn Power（中国招聘门户）|industrial|OmniOn Power
0d8c994701f2a6027954|富勒（中国招聘门户）|materials_chemicals|Fuller
04ff902ec60e06ed8aaa|布伦泰格（中国招聘门户）|materials_chemicals|Brenntag
7a382e83369837fc81b2|ERM（中国招聘门户）|professional_services|ERM
910d18c8f286660bb8ea|吉利德（中国招聘门户）|healthcare|Gilead
1536e27993d592a0faa1|AVEVA（中国招聘门户）|internet|AVEVA
41091114d887e49a39b2|英纳法（中国招聘门户）|supply_chain|Inalfa
e46f2e2fdd3c3a90890a|艺康（中国招聘门户）|materials_chemicals|Ecolab
b007aef561e1844a3543|英迈（中国招聘门户）|logistics_trade|Ingram Micro
49c68feab17dac9be82c|索理思（中国招聘门户）|materials_chemicals|Solenis
0c6f4cf024159964ffd5|美光（中国招聘门户）|supply_chain|Micron
9868ac2a5307c6b9032b|拓领（中国招聘门户）|logistics_trade|Toll Global
2c7754537a0bb72a43e2|爱德曼（中国招聘门户）|media_tourism|Edelman
add8474d17610eb255eb|Expedia（中国招聘门户）|media_tourism|Expedia
0c6e1c9c2d89ca2c1e36|保乐力加（中国招聘门户）|consumer|Pernod Ricard
916124bdb95fbf1b3ba7|4flow（中国招聘门户）|professional_services|forflow
39bd1591a8246059e5de|威富（中国招聘门户）|consumer|VF China
2d4f57c67cab32905222|大华银行|finance|UOB China
fd68a716e9191f33f0b9|爱德华生命科学（中国招聘门户）|healthcare|Edwards
`;
const specific=`
e9e559baa82f812d7752|湖北大数据集团有限公司|internet|湖北大数据集团有限公司
3a19a2fd23124ba2ec12|和黄医药|healthcare|和黄医药
45a3e8ce6448491758d3|丹纳赫（中国招聘门户）|healthcare|丹纳赫集团中国
9da60a5bd6b3e1d43d98|雀巢（大中华区招聘门户）|consumer|Nestle GCR
6d0c921b1689b9daad31|参天（中国招聘门户）|healthcare|参天公司
1b53d37bd4e1e25306e6|万豪（中国招聘门户）|consumer|Marriott International
adeeb899544a333c0946|云顶新耀|healthcare|云顶新耀
ed78e781d50ba6a391fe|深蓝互动|internet|深蓝互动
f7ca7c345231389c4579|景昱医疗|healthcare|景昱医疗招聘门户
6dc1106eb03ad2f56aae|菲仕兰（中国招聘门户）|consumer|菲仕兰食品贸易
4d09e8bc9bc7f4c4ee25|网龙网络|internet|网龙网络公司
abb80b5e0f2a5872fc0f|史泰博（上海）有限公司|consumer|史泰博（上海）有限公司
4f644a507c4addd65012|阿克苏诺贝尔（中国招聘门户）|materials_chemicals|阿克苏诺贝尔
ff8fc5901cab19ab0ecc|伊顿（中国招聘门户）|industrial|伊顿(中国)投资有限公司
28444d302728b0da683b|埃夫特机器人|smart_hardware|埃夫特智能机器人
de79c2d3391d886103ea|希尔顿（中国招聘门户）|consumer|希尔顿招聘
4c80f843857a427c379e|隆鑫通用|automotive_oem|隆鑫通用动力
4bd7e3b4cb7eac466303|诺诚健华|healthcare|诺诚健华
c2ed51131a03cac11dd9|紫龙游戏|internet|紫龙上海黑杰克
b46c996c619608fff51a|昆拓信诚|healthcare|昆拓信诚招聘
2045f45354b7fc2fcf43|永星互动|internet|永星互动
a5cbbd4cbb3000361c24|连连支付|finance|连连支付
4e6477346ab014af5e72|中亦科技|internet|中亦科技
a1535ff8908bad6a3d52|施耐德电气（中国招聘门户）|industrial|施耐德电气(中国)有限公司
3aaa840c9aae36ffc9ee|滔搏|consumer|滔搏 TOPSPORTS
c2a157132d886a7c3f9f|汇宇制药|healthcare|四川汇宇制药
3c304717c9d5bd29e244|联宇集团|logistics_trade|联宇集团
0a28b3f61e2b472a7c0a|济南城建集团有限公司|construction|济南城建集团
d2cb2f0bc06e87aa9c88|新希望金融科技|internet|新希望金融科技
5456840800b8620f4b10|上海医药|healthcare|上海医药人才招聘
5af62c744f504fdaedab|拜尔斯道夫（中国招聘门户）|consumer|拜尔斯道夫
5dd02f752fe9b9d931ff|万事达工业科技股份有限公司|industrial|万事达工业科技股份有限公司
e6b5e078b50bc7f1af64|百奥游戏|internet|百奥家庭互动有限公司
ef1bfc7bab5d8e0102c0|万兴科技|internet|万兴科技社会招聘
3e7f5bfd3a8703c10f93|电魂网络|internet|杭州电魂网络科技
633c36e874ad0fe61359|海通恒信|finance|海通恒信国际融资租赁
e9276b06e6725d50696d|百胜中国|consumer|百胜中国
8de96c29cc347c3c81d0|散爆网络|internet|散爆网络
`;
const decisions=new Map((workday+specific).trim().split('\n').filter(Boolean).map(line=>{const [id,name,industry,fragment]=line.split('|');return [id,{name,industry,fragment}];}));
const actualKey=s=>{const u=new URL(s.primary_entry_url),q=s.validated_api_request_examples?.find(q=>/job_list/.test(q.purpose||''));return JSON.stringify([s.provider,s.provider==='workday'?[s.api_config.origin,s.api_config.tenant,String(s.api_config.site).toLowerCase()]:s.provider==='moka'?[u.origin,q?.body?.orgId,q?.body?.siteId]:[u.origin,s.provider==='hotjob'?u.pathname.match(/SU[\da-f]{24}/i)?.[0]:s.provider==='feishu'?q?.headers?.['website-path']||'index':'']]);};
const existingEndpoints=new Map();for(const c of registry.companies)for(const s of c.recruitment_sources?.length?c.recruitment_sources:[c])try{existingEndpoints.set(actualKey(s),c.company_id);}catch{}
const added=[],held=[],newCompanies=[],now=new Date().toISOString();
// Known tenants are independently linked in the existing verified registry. Keep group scope.
for(const r of reviews){let decision=decisions.get(r.id),company,created=false;
 if(r.known.length===1)company=registry.companies.find(c=>c.company_id===r.known[0]);
 else if(r.id==='100b342e48dd41799119')company=registry.companies.find(c=>c.company_id==='company-96c91570391e');
 else if(r.id==='2d6d4dfb9d5ca6132940')company=registry.companies.find(c=>c.company_id==='hardware-oem-geely');
 if(!company&&!decision){held.push({id:r.id,status:'identity_needs_review',labels:r.labels});continue;}
 if(decision&&!r.names.concat(r.titles).some(v=>String(v).toLowerCase().includes(decision.fragment.toLowerCase())))throw Error('Missing required public identity evidence '+r.id);
 const task=tasks.get(r.id),config=structuredClone(task.source),key=actualKey(config);
 if(existingEndpoints.has(key)){held.push({id:r.id,status:'already_registered_endpoint',company_id:existingEndpoints.get(key)});continue;}
 if(!company&&decision){const hits=registry.companies.filter(c=>[c.display_name,...c.aliases||[]].includes(decision.name));if(hits.length>1)throw Error('Ambiguous canonical company '+decision.name);company=hits[0];}
 if(!company){created=true;const id='company-'+createHash('sha256').update('confirmed-feishu:'+decision.name).digest('hex').slice(0,12);company={company_id:id,display_name:decision.name,aliases:[],category:decision.industry,industry_tags:[decision.industry],industry_assignment:{status:'reviewed_routing',basis:'公司公开招聘门户和招聘主体信息；行业分流不替代主营业务核实',checked_at:now},...config};company.company_id=id;company.display_name=decision.name;registry.companies.push(company);newCompanies.push(id);}
 config.company_id=company.company_id;config.display_name=company.display_name;config.source_id='feishu-20260919-'+r.id;
 config.source_origin='feishu-expansion-20260919';
 config.source_verification={checked_at:now,method:'public_api_full_jd_and_employer_identity',complete_jd_samples:r.full,observed_jobs:r.jobs,identity_basis:decision?'public_employer_name:'+decision.fragment:'previously_verified_same_ats_tenant',scope:company.display_name,proof_directory:'internet-campus-job-fit/artifacts/feishu-source-expansion-20260919/api-verification/'+r.id,pagination:'sample_up_to_two_pages; not_full_inventory'};
 config.discovery_provenance={dataset:'user_feishu_base_20260919',entry_url:config.primary_entry_url};
 if(!created){if(!company.recruitment_sources?.length){const prior=structuredClone(company);delete prior.recruitment_sources;company.recruitment_sources=[{...prior,source_id:prior.source_id||'original-primary'}];}company.recruitment_sources.push(config);}else Object.assign(company,config);
 existingEndpoints.set(key,company.company_id);added.push({id:r.id,company_id:company.company_id,company:company.display_name,provider:config.provider,entry_url:config.primary_entry_url,identity_basis:config.source_verification.identity_basis,complete_jds:r.full});
}
if(!added.length){console.log(JSON.stringify({new_configurations:0,reason:'All reviewed endpoints already registered; preserving original admission audit'}));process.exit(0);}
const duplicateNames=new Set();for(const c of registry.companies){if(duplicateNames.has(c.display_name))throw Error('Duplicate canonical name '+c.display_name);duplicateNames.add(c.display_name);}
try{await fs.access(root+'/registry-before-admission.json');}catch{await save(root+'/registry-before-admission.json',await readSourceRegistry());}await save(SOURCE_REGISTRY_FILE,{...registry,verified_on:now.slice(0,10)});
for(const [file,kind] of [[COMPANY_BUSINESS_FILE,'business'],[COMPANY_OWNERSHIP_FILE,'ownership'],[COMPANY_PROFILES_FILE,'profiles']]){const data=await read(file),seen=new Set(data.companies.map(c=>c.company_id));for(const c of registry.companies)if(!seen.has(c.company_id)){const base={company_id:c.company_id,display_name:c.display_name};data.companies.push(kind==='business'?{...base,business_tags:[],business_summary:'',status:'unknown',evidence:[],reason:'招聘主体已核实，主营业务标签待公开资料补核'}:kind==='ownership'?{...base,ownership_tag:'待核实',status:'unknown',reason:'新增招聘主体的控制关系尚未核查',evidence:[],checked_at:null}:{...base,business:emptyFact(),workforce:emptyFact(),capital:emptyFact()});}data.updated_at=now;await save(file,data);}
let priorAudit={added:[]};try{priorAudit=await read(root+'/admission-summary.json');}catch{}const allAdded=[...new Map([...priorAudit.added,...added].map(r=>[r.id,r])).values()],admittedIds=new Set(allAdded.map(r=>r.id)),baseline=await read(root+'/registry-before-admission.json');
const count=r=>r.companies.reduce((n,c)=>n+(c.recruitment_sources?.length||1),0);
const summary={checked_at:now,new_companies:registry.companies.length-baseline.companies.length,new_configurations:count(registry)-count(baseline),total_companies:registry.companies.length,total_configurations:count(registry),added:allAdded,held:held.filter(r=>!admittedIds.has(r.id))};await save(root+'/admission-summary.json',summary);await save('shared/job-search-core/data/feishu-expansion-20260919.json',summary);
const proof=[];for(const x of allAdded){const c=registry.companies.find(c=>c.company_id===x.company_id),s=(c.recruitment_sources||[c]).find(s=>s.source_id==='feishu-20260919-'+x.id);if(!s)throw Error('Missing admitted contract '+x.id);const r=await read(root+'/api-verification/'+x.id+'/result.json');proof.push({company_id:c.company_id,company_name:c.display_name,source_id:s.source_id,provider:s.provider,entry_url:s.primary_entry_url,checked_at:r.checked_at,complete_jds_observed:r.jobs.filter(j=>j.body_complete).length,identity_basis:x.identity_basis,coverage:r.coverage.status,pagination_reason:r.coverage.reason,samples:r.jobs.filter(j=>j.body_complete).slice(0,3).map(j=>({job_id:j.job_id,title:j.title,official_url:j.official_url,description_chars:j.description?.length||0,requirements_chars:j.requirements?.length||0,raw_file:j.raw_file})),api_requests:r.requests.filter(q=>/job_list|job_detail|location_filtered_job_list/.test(q.purpose)).slice(0,6).map(q=>({purpose:q.purpose,url:q.url,method:q.method,body:q.body,http_status:q.http_status,response_sha256:q.response_sha256,response_file:q.response_file}))});}
await save('shared/job-search-core/data/source-verification-feishu-20260919.json',{schema_version:1,checked_at:now,configurations:proof});console.log(JSON.stringify({...summary,added:undefined,held:undefined}));
