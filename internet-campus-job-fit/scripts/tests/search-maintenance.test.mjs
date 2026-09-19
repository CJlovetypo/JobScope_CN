import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {workforceRange,classifyCompanySize} from '../../../shared/job-search-core/scripts/lib/company-size.mjs';
import {refreshedCityTag} from '../../../shared/job-search-core/scripts/lib/city-index.mjs';
import {validateSearchPlan,matchesSearchTitle,searchPlanFingerprint} from '../../../shared/job-search-core/scripts/lib/targeted-search.mjs';
import {collectTargeted} from '../../../shared/job-search-core/scripts/lib/collect-targeted.mjs';
import {sourceCacheMatches,sourceConfigFingerprint} from '../../../shared/job-search-core/scripts/lib/source-collector.mjs';
import {sourceFailureKind,repairCandidateAccepted,commitSourceRepair,repairConfigKey,discoverRepairCandidates} from '../../../shared/job-search-core/scripts/lib/source-repair.mjs';
import {directionSourceKey} from '../../../shared/job-search-core/scripts/lib/direction-validation.mjs';
const company={company_id:'test',display_name:'测试公司',provider:'beisen',primary_entry_url:'https://test.zhiye.com/jobs'};
const fact=value=>({value,status:'verified',as_of:'2025-12-31',entity:'测试公司',evidence:[{url:'https://example.org/annual-report'}]});
const owner={status:'verified',ownership_tag:'私企'},now='2026-09-19T00:00:00Z';
test('organization size preserves uncertainty, entity scope and disclosure date',()=>{
 for(const [value,label]of [['499人','小厂'],['500人','中厂'],['5,000人','大厂'],['1–2万人','大厂'],['100–999人','待核实'],['约500人','待核实'],['不少于600人','待核实']])assert.equal(classifyCompanySize(company,owner,{workforce:fact(value)},{now}).label,label,value);
 assert.equal(workforceRange(fact('参保人数5000人')),null);
 assert.equal(classifyCompanySize(company,owner,{workforce:{...fact('6000人'),as_of:'2020年'}},{now}).label,'待核实');
 assert.equal(classifyCompanySize(company,owner,{workforce:{...fact('6000人'),as_of:''}},{now}).label,'待核实');
 assert.equal(classifyCompanySize({...company,display_name:'测试分公司'},owner,{workforce:{...fact('6000人'),entity:'集团全球'}},{now}).label,'待核实');
 assert.equal(classifyCompanySize(company,{...owner,ownership_tag:'国企'},{workforce:fact('6000人')},{now}).label,'不适用');
});
test('city refresh preserves history on failure or incomplete coverage, but complete empty clears it',()=>{
 const previous={cities:['武汉','深圳'],updated_at:'2025-01-01'},opts={mode:'campus'};
 assert.deepEqual(refreshedCityTag(company,{jobs:[],coverage:{status:'failed'}},previous,opts).cities,previous.cities);
 const job={job_id:'1',formal_status:'formal',open_status:'open',cities:['上海']};
 assert.deepEqual(refreshedCityTag(company,{jobs:[job],coverage:{status:'partial'}},previous,opts).cities,['上海','武汉','深圳']);
 assert.deepEqual(refreshedCityTag(company,{jobs:[],coverage:{status:'complete'}},previous,opts).cities,[]);
});
const plan=validateSearchPlan({mode:'targeted',target:'房地产销售',keywords:['置业顾问','房产销售'],exclude_keywords:['总监'],company_ids:['test'],company_reasons:[{company_id:'test',reason:'住宅经纪业务相关',business_basis:'公开公司业务资料'}],keyword_reasons:[{keyword:'置业顾问',reason:'开发商销售职能'}, {keyword:'房产销售',reason:'直接对应目标'}]},[company]);
test('title plan requires semantic reasons and isolates exhaustive/targeted cache',()=>{
 assert(matchesSearchTitle('高级置业顾问（上海）',plan));assert(!matchesSearchTitle('房产销售总监',plan));
 assert.throws(()=>validateSearchPlan({...plan,keyword_reasons:[]},[company]),/理由/);
 const result={search_plan_fingerprint:searchPlanFingerprint(plan),source_config_fingerprint:sourceConfigFingerprint(company)};
 assert(sourceCacheMatches(result,company,plan));assert(!sourceCacheMatches(result,company));assert(!sourceCacheMatches({...result,search_plan_fingerprint:undefined},company,plan));
});
test('targeted collector uses native query only for matching source and direction proof; title filter remains final',async()=>{
 const calls=[],collect=async(s,o)=>{calls.push(o);return {jobs:[{job_id:'1',title:'置业顾问',body_complete:true,formal_status:'formal',open_status:'open'},{job_id:'2',title:'会计',body_complete:true}],coverage:{status:'complete',pages:1},requests:[]};};
 let result=await collectTargeted(company,plan,{mode:'full',targetMode:'campus'}, {},collect);assert.equal(calls.length,1);assert.equal(calls[0].keyword,'');assert.equal(result.jobs.length,1);assert.equal(result.coverage.market_complete,false);
 calls.length=0;const proof={key:directionSourceKey(company,company,0),mode:'campus',status:'verified_native_keyword'};
 result=await collectTargeted(company,plan,{mode:'full',targetMode:'campus'},{configurations:[proof,{...proof,mode:'social',status:'parameter_candidate'}]},collect);assert.deepEqual(calls.map(c=>c.keyword),plan.keywords);assert.equal(result.jobs.length,1);
 calls.length=0;await collectTargeted(company,plan,{mode:'full',targetMode:'social'},{configurations:[proof]},collect);assert.equal(calls[0].keyword,'');
});
test('repair excludes empty streams, transient faults, rate limits and unverified employers',()=>{
 const r=(status,reason,jobs=[])=>({jobs,coverage:{status,reason}});
 assert.equal(sourceFailureKind(r('complete','',[])),'empty');assert.equal(sourceFailureKind(r('failed','HTTP 429')),'rate_limited');assert.equal(sourceFailureKind(r('failed','fetch failed')),'transient_network');assert.equal(sourceFailureKind(r('failed','Missing expected list fields')),'contract_changed');
 const full=r('partial','max_pages',[{body_complete:true,job_id:'1',official_url:'https://test.zhiye.com/1'}]);
 assert(!repairCandidateAccepted(company,company,full,{accepted:false}).accepted);assert(!repairCandidateAccepted(company,company,r('complete',''),{accepted:true}).accepted);assert(repairCandidateAccepted(company,company,full,{accepted:true}).accepted);
});
test('repair during targeted search invalidates old native proof and fingerprints the adopted contract',async()=>{
 const changed={...company,primary_entry_url:'https://test.zhiye.com/current'},calls=[];
 const collector=async(s,o)=>{calls.push(o.keyword);return {jobs:[{job_id:'1',title:'置业顾问',body_complete:true,formal_status:'formal',open_status:'open'}],coverage:{status:'complete',pages:1},requests:[],...(calls.length===1?{effective_source:changed,repair:{status:'adopted'}}:{})};};
 const capabilities={configurations:[{key:directionSourceKey(company,company,0),mode:'campus',status:'verified_native_keyword'}]};
 const result=await collectTargeted(company,plan,{mode:'full',targetMode:'campus'},capabilities,collector);
 assert.deepEqual(calls,['置业顾问','']);assert.equal(result.source_config_fingerprint,sourceConfigFingerprint(changed));assert.equal(result.coverage.search_strategy[0].strategy,'repaired_contract_local_title_filter');
});
test('every newly admitted Feishu endpoint has live full-JD and employer evidence; all metadata indexes cover the registry',async()=>{
 const read=async p=>JSON.parse(await fs.readFile(path.resolve(p),'utf8')),root='shared/job-search-core';
 const sources=(await read(root+'/assets/sources.json')).companies,proof=(await read(root+'/data/source-verification-feishu-20260919.json')).configurations;
 for(const c of sources)for(const s of c.recruitment_sources||[c])if(s.source_origin==='feishu-expansion-20260919'){
  const p=proof.find(p=>p.company_id===c.company_id&&p.source_id===s.source_id);assert(p,c.display_name);assert(p.identity_basis&&p.checked_at&&p.complete_jds_observed>0);assert(p.samples.length&&p.samples.every(j=>j.job_id&&j.official_url&&j.description_chars&&j.requirements_chars&&j.raw_file));assert(p.api_requests.some(q=>q.http_status===200&&q.response_sha256));
 }
 const ids=sources.map(c=>c.company_id).sort();assert.deepEqual((await read(root+'/data/company-size-tags.json')).companies.map(c=>c.company_id).sort(),ids);
 for(const skill of ['internet-campus-job-fit','internship-job-fit','social-job-fit'])assert.deepEqual((await read(skill+'/data/company-city-index.json')).companies.map(c=>c.company_id).sort(),ids);
});
test('repair commits only unchanged expected config, preserves history and refuses concurrent replacement',async()=>{
 const folder=path.resolve('internet-campus-job-fit/artifacts/implementation/tests/repair-'+Date.now()),file=path.join(folder,'registry.json');await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,JSON.stringify({companies:[company]}));
 const next={...company,primary_entry_url:'https://test.zhiye.com/new'};
 assert((await commitSourceRepair(company,next,{reason:'fixture_verified'},{registryFile:file})).updated);
 const saved=JSON.parse(await fs.readFile(file,'utf8')).companies[0];assert.equal(saved.repair_history[0].previous_config.primary_entry_url,company.primary_entry_url);assert.equal(repairConfigKey(saved),repairConfigKey(next));
 assert.equal((await commitSourceRepair(company,next,{}, {registryFile:file})).reason,'configuration_changed_concurrently');
});
test('Moka repair discovers observed project tuple and confirms tenant and channel',async()=>{
 const old={...company,provider:'moka',primary_entry_url:'https://app.mokahr.com/campus-recruitment/test/1',validated_api_request_examples:[{purpose:'job_list',url:'https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2',body:{orgId:'test',siteId:'1',site:'campus-recruitment'}}]};
 const config=id=>({org:{id:'test',siteId:id,type:'camp',webSettings:{nav:{menus:[{type:'site',siteId:'2',siteType:'camp',siteVersion:2}]}}},siteId:id,mode:'camp'});
 const records=[],client={records,request:async q=>{const cfg=config(q.url.endsWith('/2')?'2':'1'),r={url:q.url,text:`<input id="init-data" value='${JSON.stringify(cfg)}'>`,record:{http_status:200,response_file:'fixture'}};records.push(r.record);return r;}};
 const found=await discoverRepairCandidates(old,{client});assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].source.validated_api_request_examples[0].body.siteId,'2');assert(found.candidates[0].identity.accepted);
});
