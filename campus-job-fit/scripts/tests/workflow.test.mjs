import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inflateRawSync} from 'node:zlib';
import {normalizeLocations,normalizeJobLocations,companyCityMatches,jobCityStatus} from '../lib/locations.mjs';
import {buildReportData,renderRun,reviewNeedsUpdate} from '../lib/reports.mjs';
import {SKILL_ROOT,writeJson,readJson} from '../lib/io.mjs';
import {jobFingerprint} from '../lib/job-version.mjs';
import {profileFingerprint} from '../lib/evidence-model.mjs';
import {deriveMatchTier, actionProblem, interestProblem} from '../lib/matching.mjs';
import {ownershipDatasetProblems,ownershipEntryProblem} from '../lib/ownership.mjs';

test('公司城市硬排除与岗位多城市/未知处理不同',()=>{
 assert.equal(companyCityMatches({cities:[]},['武汉']),false);
 assert.equal(companyCityMatches({cities:['上海']},['武汉']),false);
 assert.equal(companyCityMatches({cities:['上海','武汉']},['武汉']),true);
 assert.equal(jobCityStatus({cities:['上海','武汉'],location_unknown:false},['武汉']),'included');
 assert.equal(jobCityStatus({cities:['上海'],location_unknown:false},['武汉']),'excluded');
 assert.equal(jobCityStatus({cities:[],location_unknown:true},['武汉']),'unknown');
});
test('工作城市归一，面试远程不等于远程办公',()=>{
 assert.deepEqual(normalizeLocations(['浙江省·宁波市','广州市-天河区','Shanghai','深圳总部']).cities,['宁波','广州','上海','深圳']);
 const interview=normalizeLocations(['远程面试']);assert.deepEqual(interview.special,[]);assert.deepEqual(interview.cities,[]);
});
test('行政区只通过明确cityId和一致名称映射，不猜内部ID',()=>{
 assert.deepEqual(normalizeLocations(['广东省·南山区'],[{cityId:440305,cityName:'南山区'}]).cities,['深圳']);
 assert.deepEqual(normalizeLocations(['广东省·南山区'],[{id:440305,cityName:'南山区'}]).cities,[]);
 assert.deepEqual(normalizeLocations(['广东省·南山区'],[{cityId:440605,cityName:'南山区'}]).cities,[]);
});
test('列表地点缺失时仅提取正文明确工作地点，不借用总部或面试城市',()=>{
 assert.deepEqual(normalizeJobLocations({description:'测试工程师（工作地点：杭州/太原）\n岗位要求：本科',locations_raw:[]}).cities,['杭州','太原']);
 assert.deepEqual(normalizeJobLocations({description:'总部在北京。\n面试地点：上海。',locations_raw:[]}).cities,[]);
 assert.deepEqual(normalizeLocations(['新加坡']).cities,['新加坡']);
});
const EXPECTED_HEADERS=['公司','公司业务标签','公司性质标签','岗位','关注优先级','匹配层级','岗位城市','意愿匹配度','能力匹配度','详细评估理由','JD链接'];
const EXPECTED_SHEETS=['岗位匹配','待核实与未评估','来源覆盖','JD原文','说明'];
const runCommand=promisify(execFile);
function readZipEntry(archive,entryName){
 // Read the central directory so this also handles ZIP data descriptors.
 let end=archive.length-22;while(end>=0&&archive.readUInt32LE(end)!==0x06054b50)end--;
 assert.ok(end>=0,'XLSX 缺少 ZIP 目录');
 const count=archive.readUInt16LE(end+10);let offset=archive.readUInt32LE(end+16);
 for(let index=0;index<count;index++){
  assert.equal(archive.readUInt32LE(offset),0x02014b50);
  const method=archive.readUInt16LE(offset+10),size=archive.readUInt32LE(offset+20),nameLength=archive.readUInt16LE(offset+28),extraLength=archive.readUInt16LE(offset+30),commentLength=archive.readUInt16LE(offset+32);
  const name=archive.subarray(offset+46,offset+46+nameLength).toString('utf8');
  if(name===entryName){
   const local=archive.readUInt32LE(offset+42);assert.equal(archive.readUInt32LE(local),0x04034b50);
   const start=local+30+archive.readUInt16LE(local+26)+archive.readUInt16LE(local+28),compressed=archive.subarray(start,start+size);
   assert.ok(method===0||method===8,'XLSX 使用不支持的 ZIP 压缩方法');return (method===8?inflateRawSync(compressed):compressed).toString('utf8');
  }
  offset+=46+nameLength+extraLength+commentLength;
 }
 throw new Error('XLSX 缺少条目：'+entryName);
}
function sheet(data,name='岗位匹配'){
 const result=data.sheets.find(s=>s.name===name);assert.ok(result,'工作簿缺少工作表：'+name);return result;
}
async function updateJson(file,mutate){const data=await readJson(file);mutate(data);await writeJson(file,data);}
function testProfile(overrides={}){
 return {city_filters:['武汉'],business_preferences:['人工智能'],evidence:[{id:'E1',kind:'resume',source:'测试简历：招聘实习经历',claim_type:'objective_experience',experience_type:'internship',experience_id:'I1',text:'测试经历：参与校园招聘，协调40场面试'}],...overrides};
}
function testSummary(overrides={}){
 return {conclusion:'招聘实习与岗位协调职责相符，可结合资格和业务倾向决定是否关注。',ability:'对口招聘实习中的面试协调形成直接实践依据，独立决策经验仍待补充。',interest:'测试用户明确希望从事招聘职能。',gaps:'缺少独立招聘策略设计证据，提前实习安排需进一步核对。',...overrides};
}
function actionFields(priority='high') {
 return {next_action:'verify',priority_reason:'先核对实际部门业务及提前实习安排，当前材料核对依赖这项信息。',timing_evidence:priority==='high'?'测试场景：用户当前申请决定被提前实习起始时间阻塞。':''};
}
function interestChecks(interest='aligned') {
 return [{preference:'招聘职能',importance:'prefer',status:({aligned:'met',explore:'partial',conflict:'conflict',unknown:'unknown'})[interest],user_basis:'测试场景中用户明确表达对应职能倾向或未确认该倾向。',job_basis:'测试JD实际交付为招聘协调。'}];
}
async function fixture(name,{missing=false,badEvidence=false,profile:profileOverrides={},company:companyOverrides={},job:jobOverrides={},review:reviewOverrides={}}={}){
 const dir=path.join(SKILL_ROOT,'artifacts/implementation/tests',name+'-'+Date.now());
 const company={company_id:'fixture-company',display_name:'测试游戏公司',selected:true,city_tags:['武汉'],city_index_updated_at:'2026-09-06',business_tags:['游戏'],business_summary:'仅供测试的游戏公司',business_alignment:{status:'mismatch'},ownership_tag:'私企',ownership_status:'verified',ownership_reason:'测试夹具已预先确认公司性质。',ownership_evidence:[{url:'https://example.com/ownership',title:'测试性质来源',note:'测试夹具性质依据。',checked_at:'2026-09-06'}],ownership_checked_at:'2026-09-06',...companyOverrides};
 const job={job_id:'fixture-job',company_id:company.company_id,company_name:company.display_name,title:'HR校招生（测试）',locations_raw:['武汉','上海'],cities:['武汉','上海'],evaluation_status:'to_assess',description:'职责：协助校园招聘，组织面试并跟进候选人。',requirements:'要求：2027届本科生，有招聘相关实习经历；录用后需提前实习。',body_complete:true,official_url:'https://example.com/campus',job_url_kind:'official_listing',...jobOverrides};
 const profile=testProfile(profileOverrides);
 await writeJson(path.join(dir,'run.json'),{is_test:true,created_at:new Date().toISOString(),profile,companies:[company],city_index_updated_at:'2026-09-06'});
 await writeJson(path.join(dir,'companies',company.company_id+'.json'),{checked_at:new Date().toISOString(),jobs:[job],coverage:{status:'complete',reason:'测试单页'},counts:{to_assess:1,other_city:0}});
 const interestReasons={aligned:'测试用户明确希望从事招聘职能。',explore:'测试用户明确表示愿意探索招聘职能。',conflict:'测试用户明确表示不考虑招聘职能。'};
 if(!missing)await writeJson(path.join(dir,'assessments',company.company_id+'.json'),{assessments:[{job_id:job.job_id,jd_fingerprint:jobFingerprint(job),profile_fingerprint:profileFingerprint(profile),review_method:'full_jd',assessment_version:4,ability:'high',ability_reason:'同职能招聘实习中实际协调40场面试，直接覆盖岗位的主要招聘协调任务；独立决策经验仍待补充。',experience_relevance:[{experience_id:'I1',industry_relation:'same',business_relation:'same',role_relation:'same',explanation:'合成实习在同类业务部门承担招聘协调任务。'}],report_summary:testSummary({interest:interestReasons[reviewOverrides.interest??'aligned']||'测试用户尚未说明对招聘职能的意愿。'}),priority:'high',...actionFields(),interest_checks:interestChecks(reviewOverrides.interest??'aligned'),interest:'aligned',interest_reason:interestReasons[reviewOverrides.interest??'aligned'],eligibility:'eligible',eligibility_reason:'测试画像2027届本科，符合测试JD的届次与学历要求。',conclusion:'测试招聘实习经历与岗位职责吻合，但公司业务倾向不符。',next_step:'核对提前实习开始时间。',early_internship:'正式校招要求提前实习，保留并核对安排。',comparisons:[{jd_requirement:'校园招聘协调',requirement_type:'core',support:'direct',evidence_strength:'strong',profile_evidence_ids:[badEvidence?'E999':'E1'],explanation:'测试经历直接涉及面试协调。'}],...reviewOverrides}]});
 return dir;
}
test('独立能力与意愿覆盖完整16格矩阵，非法输入不得被当作低匹配',()=>{
 const expected={
  high:['high','conditional','low','unknown'],
  medium:['conditional','conditional','low','unknown'],
  low:['low','low','low','low'],
  unknown:['unknown','unknown','low','unknown'],
 };
 for(const [ability,tiers] of Object.entries(expected))for(const [index,interest] of ['aligned','explore','conflict','unknown'].entries())assert.equal(deriveMatchTier(ability,interest),tiers[index],ability+' / '+interest);
 for(const [ability,interest] of [['match','aligned'],['high','maybe'],['toString','aligned'],['high','toString']])assert.throws(()=>deriveMatchTier(ability,interest),/无效/);
});
test('同一高能力随独立意愿改变双向汇总，优先核实不依赖匹配层级',async()=>{
 for(const interest of ['aligned','explore','conflict','unknown']){
  const dir=await fixture('independent-interest-'+interest,{company:{business_alignment:{status:'aligned'}},review:{ability:'high',interest}});
  const row=sheet(await buildReportData(dir)).rows[0];assert.equal(row[8],'高');
  assert.equal(row[5],({aligned:'双向高匹配',explore:'双向有条件匹配',conflict:'当前匹配不足',unknown:'信息待确认'})[interest]);assert.equal(row[4],'高优先·核实');
  if(interest==='conflict'){assert.equal(row[7],'低');assert.match(row[9],/不考虑招聘职能/);}
 }
});
test('意愿高不抵消能力不足，意愿未知属于已完成评估且不会反复进入next-batch',async()=>{
 const gapDir=await fixture('develop-ability',{review:{ability:'low',interest:'aligned'}});const gap=sheet(await buildReportData(gapDir)).rows[0];assert.equal(gap[5],'当前匹配不足');assert.equal(gap[7],'高');assert.equal(gap[8],'低');
 const dir=await fixture('pending-interest',{review:{ability:'medium',interest:'unknown',transferable_evidence:'协调招聘面试的经历能用于跟进流程，缺少独立策略经验。'}});
 const report=await buildReportData(dir);assert.equal(sheet(report).rows[0][5],'信息待确认');assert.equal(report.audit.assessed_jobs,1);assert.equal(report.audit.missing_assessments.length,0);
 await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});const batch=await readJson(path.join(dir,'next-batch.json'));
 assert.equal(batch.already_assessed,1);assert.equal(batch.remaining,0);assert.equal(batch.pending.length,0);assert.equal(batch.evaluation_contract.assessment_version,4);assert.equal(batch.evaluation_contract.match_matrix.low.aligned,'low');assert.equal(batch.profile_fingerprint,profileFingerprint((await readJson(path.join(dir,'run.json'))).profile));
});

test('行动优先级独立于适配程度，双高可以常规，有条件匹配可以优先准备',async()=>{
 const high=await fixture('high-fit-normal-action',{review:{priority:'normal',...actionFields('normal'),next_action:'apply'}});
 const conditional=await fixture('conditional-fit-urgent-action',{review:{ability:'medium',transferable_evidence:'协调经历可迁移，但独立策略设计需要准备。',next_action:'prepare'}});
 const a=sheet(await buildReportData(high)).rows[0],b=sheet(await buildReportData(conditional)).rows[0];
 assert.equal(a[5],'双向高匹配');assert.equal(a[4],'常规关注·投递');
 assert.equal(b[5],'双向有条件匹配');assert.equal(b[4],'高优先·准备');
});

test('投递动作服从资格和意愿可行性，核实与暂缓不靠匹配等级排序',()=>{
 const base={priority:'normal',...actionFields('normal'),next_action:'apply',eligibility:'eligible',interest:'aligned'};
 for(const eligibility of ['unknown','ineligible'])assert.match(actionProblem({...base,eligibility}),/不能直接投递/);
 for(const interest of ['unknown','conflict'])assert.match(actionProblem({...base,interest}),/不能直接投递/);
 assert.equal(actionProblem({...base,ability:'medium',interest:'explore'}),null);
 assert.equal(actionProblem({...base,...actionFields(),priority:'high',next_action:'verify',eligibility:'unknown',interest:'unknown'}),null);
 assert.match(actionProblem({...base,priority:'high',timing_evidence:''}),/timing_evidence/);
 assert.match(actionProblem({...base,next_action:'hold'}),/低优先/);
 assert.equal(actionProblem({...base,next_action:'hold',priority:'low',interest:'conflict',eligibility:'ineligible'}),null);
});

test('意愿对照单独保留用户和岗位依据，硬冲突及关键未知不能被平均为高',()=>{
 const check={preference:'只考虑上海',importance:'must',status:'met',user_basis:'用户明确只考虑上海',job_basis:'工作地点为上海'};
 assert.equal(interestProblem({interest:'aligned',interest_checks:[check]}),null);
 assert.equal(interestProblem({interest:'unknown',interest_checks:[]}),null);
 for(const status of ['unknown','partial','conflict'])assert.ok(interestProblem({interest:'aligned',interest_checks:[{...check,status}]}));
 assert.ok(interestProblem({interest:'aligned',interest_checks:[]}));
 assert.ok(interestProblem({interest:'explore',interest_checks:[{...check,status:'conflict'}]}));
 assert.equal(interestProblem({interest:'conflict',interest_checks:[{...check,status:'conflict'}]}),null);
 assert.ok(interestProblem({interest:'aligned',interest_checks:[{...check,user_basis:''}]}));
});

test('v4新字段缺失与矛盾时next-batch和render一致拒绝，不自动补写或静默降级',async()=>{
 const cases=[{interest_checks:undefined},{interest_checks:[]},{next_action:undefined},{priority_reason:' '},{timing_evidence:''},{next_action:'apply',eligibility:'unknown'},{next_action:'apply',interest:'conflict'},{assessment_version:3}];
 for(const [index,review] of cases.entries()){
  const dir=await fixture('v4-shared-contract-'+index,{review});const file=path.join(dir,'assessments/fixture-company.json'),before=await readJson(file);
  await assert.rejects(()=>buildReportData(dir));
  const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);
  await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});
  const batch=await readJson(path.join(dir,'next-batch.json'));assert.equal(batch.remaining,1);assert.equal(batch.pending[0].assessment_reason,report.audit.missing_assessments[0].reason);
  assert.deepEqual(await readJson(file),before);
 }
});
test('旧结构、缺独立能力和综合层级冲突均须复核，Excel与next-batch不自动迁移',async()=>{
 const cases=[{assessment_version:undefined,ability:undefined,match_tier:'match'},{assessment_version:1,ability:'high',match_tier:'match'},{ability:undefined},{ability:'high',interest:'conflict',match_tier:'high'}];
 for(const [index,review] of cases.entries()){
  const dir=await fixture('assessment-v2-'+index,{review});await assert.rejects(()=>buildReportData(dir),/尚未评估/);
  const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);assert.match(sheet(report,'待核实与未评估').rows[0][9],/独立|不一致/);
  await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});const batch=await readJson(path.join(dir,'next-batch.json'));assert.equal(batch.remaining,1);assert.equal(batch.already_assessed,0);
 }
});
test('高或中能力必须引用个人证据，即使综合结果因为意愿变成其他层级',async()=>{
 for(const ability of ['high','medium']){
  const dir=await fixture('ability-evidence-'+ability,{review:{ability,interest:'conflict',transferable_evidence:'已有经历可迁移。',comparisons:[{jd_requirement:'独立完成招聘流程',requirement_type:'core',support:'unsupported',evidence_strength:'none',profile_evidence_ids:[],explanation:'没有可核对的个人经历。'}]}});
  await assert.rejects(()=>buildReportData(dir),/能力判断必须有个人经历证据/);
 }
});
test('独立意愿依据必须是非空文本，未知意愿不要求编造依据',()=>{
 const job={job_id:'memory-only',body_complete:true,description:'完整招聘协调职责。',requirements:'完整招聘实习要求。'};
 const profile=testProfile();
 const review={job_id:job.job_id,jd_fingerprint:jobFingerprint(job),profile_fingerprint:profileFingerprint(profile),review_method:'full_jd',assessment_version:4,ability:'high',ability_reason:'对口实习中实际协调40场面试，直接对应招聘协调的核心职责。',experience_relevance:[{experience_id:'I1',industry_relation:'same',business_relation:'same',role_relation:'same',explanation:'合成实习在同类业务部门承担招聘协调任务。'}],report_summary:testSummary(),interest:'aligned',interest_checks:interestChecks(),priority:'normal',...actionFields('normal'),eligibility:'unknown',conclusion:'招聘协调经历对应主要职责。',next_step:'核对资格。',comparisons:[{jd_requirement:'招聘协调',requirement_type:'core',support:'direct',evidence_strength:'strong',profile_evidence_ids:['E1'],explanation:'经历直接覆盖协调工作。'}]};
 for(const interest of ['aligned','explore','conflict']){
  for(const interest_reason of [undefined,null,'','  \n\t ',{}])assert.match(reviewNeedsUpdate({...review,interest,interest_reason},job,profile),/独立意愿依据/);
  assert.equal(reviewNeedsUpdate({...review,interest,interest_reason:'测试用户已明确说明该职能倾向。'},job,profile),null);
 }
 assert.equal(reviewNeedsUpdate({...review,interest:'unknown'},job,profile),null);
});
test('证据结构或独立意愿依据缺失时next-batch与render一致保留待评估',async()=>{
 const comparison={jd_requirement:'校园招聘协调',requirement_type:'core',support:'direct',evidence_strength:'strong',profile_evidence_ids:['E1'],explanation:'测试经历直接涉及面试协调。'};
 const cases=[
  {review:{comparisons:[]},reason:/缺少 JD 与个人证据对照/},
  {review:{comparisons:{}},reason:/缺少 JD 与个人证据对照/},
  {review:{comparisons:[null]},reason:/对照缺少要求或解释/},
  {review:{comparisons:[{...comparison,profile_evidence_ids:'E1'}]},reason:/个人证据 ID 必须为数组/},
  {review:{comparisons:[{...comparison,profile_evidence_ids:['E999']}]},reason:/不存在的个人证据/},
  {review:{comparisons:[{...comparison,profile_evidence_ids:[],support:'unsupported',evidence_strength:'none'}]},reason:/能力判断必须有个人经历证据/},
  {review:{ability:'medium',transferable_evidence:' \n '},reason:/可迁移经历/},
  {review:{interest:'conflict',interest_reason:undefined},reason:/独立意愿依据/},
 ];
 for(const [index,{review,reason}] of cases.entries()){
  const dir=await fixture('shared-review-validation-'+index,{review});
  await assert.rejects(()=>buildReportData(dir),reason);
  const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);assert.equal(report.audit.missing_assessments.length,1);assert.equal(report.audit.complete_assessment,false);assert.equal(sheet(report).rows.length,0);assert.match(sheet(report,'待核实与未评估').rows[0][9],reason);
  await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});const batch=await readJson(path.join(dir,'next-batch.json'));
  assert.equal(batch.already_assessed,0);assert.equal(batch.remaining,1);assert.equal(batch.pending.length,1);assert.equal(batch.pending[0].assessment_reason,report.audit.missing_assessments[0].reason);assert.match(batch.evaluation_contract.interest_reason,/非 unknown.*非空字符串/);
 }
});
test('四段报告摘要缺失或空白时next-batch与render一致保留待评估，不自动从内部明细补写',async()=>{
 const summaries=[undefined,...['conclusion','ability','interest','gaps'].flatMap(field=>[testSummary({[field]:undefined}),testSummary({[field]:' \n\t '})])];
 for(const [index,report_summary] of summaries.entries()){
  const dir=await fixture('missing-report-summary-'+index,{review:{report_summary}}),assessmentFile=path.join(dir,'assessments/fixture-company.json');
  const saved=await readJson(assessmentFile);assert.ok(saved.assessments[0].comparisons.length);assert.ok(saved.assessments[0].ability_reason);
  await assert.rejects(()=>renderRun(dir),/report_summary|摘要/);
  const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);assert.equal(report.audit.missing_assessments.length,1);assert.equal(sheet(report).rows.length,0);assert.match(sheet(report,'待核实与未评估').rows[0][9],/report_summary|摘要/);
  await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});
  const batch=await readJson(path.join(dir,'next-batch.json'));assert.equal(batch.already_assessed,0);assert.equal(batch.remaining,1);assert.equal(batch.pending[0].assessment_reason,report.audit.missing_assessments[0].reason);
  assert.deepEqual(await readJson(assessmentFile),saved,'缺少摘要时不得从内部逐项明细自动拼接或补写模型摘要');
 }
});
test('公司性质独立于业务标签；待核实仅允许已核查仍无法判断，未经确认必须阻止报告',async()=>{
 const evidence=[{url:'https://example.com/about',title:'官方公司介绍',note:'明确企业性质及控制关系。',checked_at:'2026-09-06'},{url:'https://example.com/report',title:'官方年报',note:'核对股权控制关系。',checked_at:'2026-09-06'}];
 for(const ownership_tag of ['国企','私企','外企']){
  const dir=await fixture('ownership-'+ownership_tag,{company:{ownership_tag,ownership_status:'verified',ownership_evidence:evidence,ownership_reason:'已核对主体与控制关系',ownership_checked_at:'2026-09-06'}});const report=await buildReportData(dir);
  assert.equal(sheet(report).rows[0][1],'游戏');assert.equal(sheet(report).rows[0][2],ownership_tag);
  const coverage=sheet(report,'来源覆盖');assert.equal(coverage.rows[0][14],ownership_tag);assert.match(coverage.rows[0][15],/控制关系/);for(const item of evidence)for(const part of Object.values(item))assert.ok(coverage.rows[0][16].includes(part));assert.equal(coverage.rows[0][17],'2026-09-06');
 }
 const unresolved=await fixture('ownership-confirmed-unresolved',{company:{display_name:'控制关系仍不明确的公司',ownership_tag:'待核实',ownership_status:'verified_unresolved',ownership_evidence:evidence,ownership_reason:'已核对年报与官网，但当前控制关系仍不明确。',ownership_checked_at:'2026-09-06'}});const unresolvedReport=await buildReportData(unresolved);assert.equal(sheet(unresolvedReport).rows[0][2],'待核实');assert.equal(sheet(unresolvedReport,'来源覆盖').rows[0][14],'待核实');
 for(const [index,company] of [{ownership_status:'verified',ownership_evidence:[]},{ownership_status:'unknown',ownership_evidence:evidence},{ownership_status:undefined,ownership_evidence:evidence},{ownership_tag:'待核实',ownership_status:'unknown',ownership_evidence:evidence}].entries()){
  const dir=await fixture('ownership-unverified-'+index,{company:{display_name:'中国海外上市科技公司',ownership_tag:'外企',...company}});await assert.rejects(()=>buildReportData(dir),/公司性质标签|未经确认|性质状态|公开来源|待核实/);
 }
});
test('性质数据源只接受已定性或已核查仍无法定性的记录',()=>{
 const evidence=[{url:'https://example.com/report',title:'官方年报',note:'已核对控制关系。'}];
 assert.equal(ownershipEntryProblem({company_id:'c',ownership_tag:'国企',status:'verified',reason:'国资控制。',checked_at:'2026-09-07',evidence},'c'),null);
 assert.equal(ownershipEntryProblem({company_id:'c',ownership_tag:'待核实',status:'verified_unresolved',reason:'已核对公开披露，控制关系仍不明确。',checked_at:'2026-09-07',evidence},'c'),null);
 assert.match(ownershipEntryProblem({company_id:'c',ownership_tag:'待核实',status:'unknown',reason:'尚未核实。',checked_at:'2026-09-07',evidence},'c'),/verified_unresolved/);
 assert.match(ownershipEntryProblem({company_id:'c',ownership_tag:'私企',status:'verified',reason:'民营。',checked_at:'2026-09-07',evidence:[]},'c'),/公开来源/);
});
test('prepare从公司性质索引保存本轮快照，不依赖报告生成时的最新标签',async()=>{
 const dir=await fixture('prepare-ownership-snapshot');const profileFile=path.join(dir,'profile.json');await writeJson(profileFile,testProfile({city_filters:[]}));
 const output=path.join(dir,'prepared');const index=await readJson(path.join(SKILL_ROOT,'data/company-ownership-tags.json'),{companies:[]}),sources=(await readJson(path.join(SKILL_ROOT,'assets/sources.json'))).companies;const problems=ownershipDatasetProblems(sources,index);
 if(problems.length){await assert.rejects(()=>runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'prepare','--profile',profileFile,'--out',output],{cwd:SKILL_ROOT}),/公司性质标签数据源未完成/);return;}
 await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'prepare','--profile',profileFile,'--out',output],{cwd:SKILL_ROOT});const run=await readJson(path.join(output,'run.json'));const byId=new Map(index.companies.map(company=>[company.company_id,company]));
 for(const company of run.companies){const source=byId.get(company.company_id);assert.equal(company.ownership_tag,source?.ownership_tag||'待核实');assert.equal(company.ownership_status,source?.status||'unknown');assert.deepEqual(company.ownership_evidence,source?.evidence||[]);assert.equal(company.ownership_checked_at,source?.checked_at||null);}
});
test('Excel严格使用十一列，公司标签不再在render重复改写模型已判断的意愿和行动',async()=>{
 const dir=await fixture('business-gate');const data=await buildReportData(dir);assert.equal(data.audit.assessed_jobs,1);
 assert.deepEqual(data.sheets.map(s=>s.name),EXPECTED_SHEETS);
 assert.deepEqual(sheet(data).headers,EXPECTED_HEADERS);
 assert.deepEqual(sheet(data,'待核实与未评估').headers,EXPECTED_HEADERS);
 assert.equal(sheet(data).rows.length,1,'多城市岗位不可重复计数');
 const row=sheet(data).rows[0];assert.equal(row.length,11);
 assert.deepEqual(row.slice(0,9),['测试游戏公司','游戏','私企','HR校招生（测试）','高优先·核实','双向高匹配','武汉、上海','高','高']);
 assert.match(row[9],/下一步：核实/);assert.doesNotMatch(row[9],/已调整|不列高优先/);
 assert.match(JSON.stringify(sheet(data,'JD原文').rows),/提前实习/);
});
test('尚未评估的岗位不允许伪装完整交付',async()=>{
 const dir=await fixture('missing-review',{missing:true});await assert.rejects(()=>buildReportData(dir),/尚未评估/);
 const data=await buildReportData(dir,{allowPartial:true});assert.equal(data.audit.complete_assessment,false);assert.equal(data.audit.missing_assessments.length,1);
 assert.equal(data.audit.assessed_jobs,0);assert.equal(sheet(data).rows.length,0);
 const pending=sheet(data,'待核实与未评估');assert.equal(pending.rows.length,1);
 assert.equal(pending.rows[0][7],'待确认');assert.equal(pending.rows[0][8],'待评估');
 assert.match(pending.rows[0][9],/尚未评估/);
});
test('不允许引用简历中不存在的证据',async()=>{
 const dir=await fixture('fake-evidence',{badEvidence:true});await assert.rejects(()=>buildReportData(dir),/不存在的个人证据/);
});
test('同一岗位JD改变后旧评估失效',async()=>{
 const dir=await fixture('changed-jd');const p=path.join(dir,'companies/fixture-company.json');await updateJson(p,data=>{data.jobs[0].requirements+='更新：需要硕士学历。';});await assert.rejects(()=>buildReportData(dir),/尚未评估/);
 const data=await buildReportData(dir,{allowPartial:true});assert.equal(sheet(data).rows.length,0);assert.match(sheet(data,'待核实与未评估').rows[0][9],/JD更新|旧评估|失效/);
});
test('相同证据ID但画像内容改变时有效v4评估失效，next-batch与render一致拒绝复用',async()=>{
 const dir=await fixture('changed-profile-same-evidence-id');
 const before=await buildReportData(dir);assert.equal(before.audit.assessed_jobs,1);
 const assessmentFile=path.join(dir,'assessments/fixture-company.json');
 const savedAssessment=await readJson(assessmentFile);const oldFingerprint=savedAssessment.assessments[0].profile_fingerprint;
 await updateJson(path.join(dir,'run.json'),run=>{run.profile.evidence[0].text='另一位测试候选人的经历：餐饮门店实习中完成收银与盘点，未记载招聘协调。';});
 const run=await readJson(path.join(dir,'run.json'));assert.equal(run.profile.evidence[0].id,'E1');assert.notEqual(profileFingerprint(run.profile),oldFingerprint);
 await assert.rejects(()=>renderRun(dir),/画像/);
 const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);assert.equal(sheet(report).rows.length,0);assert.match(sheet(report,'待核实与未评估').rows[0][9],/画像/);
 await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});
 const batch=await readJson(path.join(dir,'next-batch.json'));assert.equal(batch.already_assessed,0);assert.equal(batch.remaining,1);assert.equal(batch.pending.length,1);assert.match(batch.pending[0].assessment_reason,/画像/);assert.equal(batch.profile_fingerprint,profileFingerprint(run.profile));
 assert.deepEqual(await readJson(assessmentFile),savedAssessment,'失效检查不得自动改写旧评估或给它补上新画像指纹');
});
test('v2评估即使补齐当前画像指纹也不能通过next-batch或render复用',async()=>{
 const dir=await fixture('v2-with-profile-fingerprint',{review:{assessment_version:2}});const run=await readJson(path.join(dir,'run.json'));
 const assessmentFile=path.join(dir,'assessments/fixture-company.json'),savedAssessment=await readJson(assessmentFile);
 assert.equal(savedAssessment.assessments[0].profile_fingerprint,profileFingerprint(run.profile));
 await assert.rejects(()=>renderRun(dir),/评估结构|版本|重评/);
 const report=await buildReportData(dir,{allowPartial:true});assert.equal(report.audit.assessed_jobs,0);assert.equal(sheet(report).rows.length,0);
 await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir],{cwd:SKILL_ROOT});
 const batch=await readJson(path.join(dir,'next-batch.json'));assert.equal(batch.already_assessed,0);assert.equal(batch.remaining,1);assert.match(batch.pending[0].assessment_reason,/评估结构|版本|重评/);
 assert.deepEqual(await readJson(assessmentFile),savedAssessment,'检查版本不得将旧结论自动升级为v4');
});
test('中能力判断必须说明可迁移经历，不能只给评级',async()=>{
 const report_summary=testSummary({ability:'面试协调是可迁移经历，可用于招聘流程跟进；暂无招聘策略设计经验。',interest:'测试用户明确表示愿意探索招聘职能。'});
 const dir=await fixture('explore-evidence',{review:{ability:'medium',interest:'explore',report_summary}});const p=path.join(dir,'assessments/fixture-company.json');await assert.rejects(()=>buildReportData(dir),/可迁移经历/);
 await updateJson(p,data=>{data.assessments[0].transferable_evidence='面试协调可以迁移到招聘流程跟进，暂无招聘策略设计经验。';});
 const data=await buildReportData(dir);const row=sheet(data).rows[0];assert.equal(row[5],'双向有条件匹配');assert.equal(row[8],'中');assert.match(row[9],/可迁移经历/);assert.match(row[9],/暂无招聘策略设计经验/);
});
test('只prepare没有采集，不得报告已完成',async()=>{
 const dir=await fixture('not-collected');const p=path.join(dir,'run.json');await updateJson(p,run=>{run.companies.push({...run.companies[0],company_id:'not-fetched',display_name:'未采集测试公司'});});await assert.rejects(()=>buildReportData(dir),/尚未获取/);
 const data=await buildReportData(dir,{allowPartial:true});assert.equal(data.audit.complete_assessment,false);assert.equal(data.audit.complete_collection,false);assert.deepEqual(data.audit.unattempted_companies,['未采集测试公司']);assert.match(JSON.stringify(sheet(data,'来源覆盖').rows),/未采集测试公司/);
});
test('详细评估理由固定为四段摘要，逐项证据和对口分层仍完整保存在内部评估',async()=>{
 const report_summary=testSummary({conclusion:'招聘协调实践与岗位主要职责相符，结合业务倾向列为常规关注。',ability:'同类业务和招聘职能的实习提供直接实践依据；主要协调任务有具体成果支持。',gaps:'独立招聘策略和录用决策缺少证据，需核对提前实习时间。'});
 const dir=await fixture('complete-reasons',{review:{report_summary,gaps:['缺少独立招聘策略设计经验'],comparisons:[{jd_requirement:'校园招聘协调',requirement_type:'core',support:'direct',evidence_strength:'strong',profile_evidence_ids:['E1'],explanation:'测试经历直接涉及面试协调。',gap:'未负责录用决策。'}]}});
 const assessmentFile=path.join(dir,'assessments/fixture-company.json'),saved=await readJson(assessmentFile);
 const data=await buildReportData(dir);const reason=sheet(data).rows[0][9];
 assert.deepEqual(reason.split(/\n+/).map(paragraph=>paragraph.slice(0,paragraph.indexOf('：')+1)),['评估结论：','能力匹配度结论：','个人意愿匹配度结论：','主要缺口：']);
 for(const fragment of Object.values(report_summary))assert.ok(reason.includes(fragment),'详细评估遗漏摘要：'+fragment);
 assert.doesNotMatch(reason,/对照\d+｜|\bE1\b|\bI1\b|个人证据：|实习／工作对口分层：/);
 assert.ok(!reason.includes(saved.assessments[0].comparisons[0].explanation),'报告不能追加逐项比较的全文');
 assert.deepEqual(await readJson(assessmentFile),saved,'展示摘要不能删改原始评估明细');assert.equal(saved.assessments[0].comparisons[0].gap,'未负责录用决策。');assert.equal(saved.assessments[0].experience_relevance[0].role_relation,'same');
});
test('四段摘要保留客观实践优先的结论，完整证据分类与同段经历关系留在内部',async()=>{
 const evidence=[...testProfile().evidence,
  {id:'E2',kind:'resume',source:'测试简历：招聘实习成果',claim_type:'objective_achievement',experience_type:'internship',experience_id:'I1',text:'测试成果：参与的40场面试全部按排期完成。'},
  {id:'E3',kind:'self_description',source:'测试候选人自述',claim_type:'self_assessment',experience_type:'none',text:'测试自述：我认为自己沟通能力很强。'}];
 const report_summary=testSummary({ability:'招聘实习的客观经历和客观成就直接支持协调执行，主观自评仅作辅助；同一段实习的任务和成果不重复计数。'});
 const dir=await fixture('evidence-classification-reasons',{profile:{evidence},review:{report_summary,comparisons:[
  {jd_requirement:'校园招聘协调',requirement_type:'core',support:'direct',evidence_strength:'strong',profile_evidence_ids:['E1','E2'],explanation:'实习任务与排期结果直接支持协调执行；同一I1经历的任务和成果共同说明质量，不算成两段实习。'},
 {jd_requirement:'有沟通能力',requirement_type:'supporting',support:'unsupported',evidence_strength:'none',profile_evidence_ids:['E3'],explanation:'自评表达候选人的主观判断，尚不足以单独证明沟通能力。'}]}});
 const report=await buildReportData(dir);assert.equal(report.audit.assessed_jobs,1);const reason=sheet(report).rows[0][9];
 assert.ok(reason.includes(report_summary.ability));assert.doesNotMatch(reason,/对照\d+｜|\bE[123]\b|\bI1\b/);
 for(const item of evidence)assert.ok(!reason.includes(item.text),'摘要不应逐条追加个人证据原文');
 const run=await readJson(path.join(dir,'run.json')),saved=await readJson(path.join(dir,'assessments/fixture-company.json'));
 assert.deepEqual(run.profile.evidence,evidence);assert.deepEqual(saved.assessments[0].comparisons[0].profile_evidence_ids,['E1','E2']);assert.deepEqual(saved.assessments[0].comparisons[1].profile_evidence_ids,['E3']);assert.equal(saved.assessments[0].comparisons[1].support,'unsupported');assert.equal(saved.assessments[0].experience_relevance.length,1);
});
test('资格检查不改写能力和行动优先级，核实资格不等于投递',async()=>{
 for(const eligibility of ['ineligible','unknown']){
  const eligibility_reason=eligibility==='ineligible'?'JD仅面向2026届，画像为2027届。':'提前实习开始时间尚未确认。';
  const dir=await fixture('eligibility-'+eligibility,{company:{business_alignment:{status:'aligned'}},review:{eligibility,eligibility_reason,report_summary:testSummary({gaps:eligibility_reason+'独立招聘策略的实践证据仍待补充。'})}});
  const row=sheet(await buildReportData(dir)).rows[0];assert.equal(row[4],'高优先·核实');assert.equal(row[8],'高');assert.match(row[9],/资格|到岗/);assert.match(row[9],/2026届|提前实习开始时间尚未确认/);
 }
});
test('未知意愿与未知能力明确标记，不伪造数值分数',async()=>{
 const dir=await fixture('unknown-ratings',{review:{ability:'unknown',match_tier:'unknown',interest:'unknown',eligibility:'unknown',comparisons:[]}});
 await assert.rejects(()=>buildReportData(dir),/尚未评估|待评估/);
 const data=await buildReportData(dir,{allowPartial:true});assert.equal(sheet(data).rows.length,0);assert.equal(data.audit.assessed_jobs,0);
 const row=sheet(data,'待核实与未评估').rows[0];assert.equal(row[5],'待评估');assert.equal(row[7],'待确认');assert.equal(row[8],'待评估');assert.notEqual(row[4],'高优先');
});
test('缺少全文阅读标记或标题规则的旧评估必须进入待全文重评',async()=>{
 for(const review_method of [undefined,'title_rules']){
  const dir=await fixture('full-jd-required-'+String(review_method),{review:{review_method}});
  await assert.rejects(()=>buildReportData(dir),/尚未评估|全文|重评/);
  const data=await buildReportData(dir,{allowPartial:true});assert.equal(data.audit.assessed_jobs,0);assert.equal(data.audit.complete_assessment,false);assert.equal(sheet(data).rows.length,0);
  const pending=sheet(data,'待核实与未评估').rows;assert.equal(pending.length,1);assert.equal(pending[0][8],'待评估');assert.match(pending[0][9],/全文|重评/);
 }
});
test('即使已声明全文阅读，正文不完整或完整状态缺失的岗位仍不得计入已评估',async()=>{
 for(const body_complete of [false,undefined]){
  const dir=await fixture('incomplete-full-jd-'+String(body_complete),{job:{body_complete,description:'仅取得部分职责，任职要求尚未完整获取。'}});
  await assert.rejects(()=>buildReportData(dir),/尚未评估|全文/);
  const data=await buildReportData(dir,{allowPartial:true});assert.equal(data.audit.assessed_jobs,0);assert.equal(data.audit.complete_assessment,false);assert.equal(data.audit.missing_assessments.length,1);
  assert.equal(sheet(data).rows.length,0);const pending=sheet(data,'待核实与未评估').rows;assert.equal(pending.length,1);assert.equal(pending[0][8],'待评估');assert.match(pending[0][9],/完整 JD 正文未取得/);
 }
});
test('next-batch 与 Excel 使用同一全文评估门槛，并交付完整 JD 供重评',async()=>{
 const dir=await fixture('next-batch-full-jd',{review:{review_method:'title_rules'}});
 await runCommand(process.execPath,[path.join(SKILL_ROOT,'scripts/campus.mjs'),'next-batch','--run',dir,'--limit','10'],{cwd:SKILL_ROOT});
 const batch=await readJson(path.join(dir,'next-batch.json'));const data=await buildReportData(dir,{allowPartial:true});
 assert.equal(batch.already_assessed,data.audit.assessed_jobs);assert.equal(batch.already_assessed,0);assert.equal(batch.remaining,1);assert.equal(batch.pending.length,1);
 assert.equal(batch.pending[0].job.description,'职责：协助校园招聘，组织面试并跟进候选人。');assert.match(batch.pending[0].job.requirements,/录用后需提前实习/);
});
test('意愿和能力使用统一的高、中、低、未知文字分档',async()=>{
 for(const [interest,ability,interestLabel,abilityLabel] of [['aligned','high','高','高'],['explore','medium','中','中'],['conflict','low','低','低']]){
  const dir=await fixture('ratings-'+interest,{company:{business_alignment:{status:'aligned'}},review:{interest,ability,transferable_evidence:'面试协调经验可迁移到招聘流程跟进。'}});
  const row=sheet(await buildReportData(dir)).rows[0];assert.equal(row[7],interestLabel);assert.equal(row[8],abilityLabel);
 }
});
test('官方详情页直接链接，列表入口回退为工作簿内 JD 原文链接',async()=>{
 const detailDir=await fixture('official-detail',{job:{official_url:'https://example.com/jobs/fixture?channel=campus',job_url_kind:'official_detail'}});
 const detail=sheet(await buildReportData(detailDir));assert.equal(detail.links.length,1);assert.deepEqual({row:detail.links[0].row,column:detail.links[0].column,url:detail.links[0].url},{row:2,column:11,url:'https://example.com/jobs/fixture?channel=campus'});
 const listingDir=await fixture('listing-snapshot');const data=await buildReportData(listingDir);const listing=sheet(data);
 assert.equal(listing.links.length,1);assert.equal(listing.links[0].row,2);assert.equal(listing.links[0].column,11);assert.match(listing.links[0].url,/^#'JD原文'!A\d+$/);
 const rowNumber=Number(listing.links[0].url.match(/A(\d+)$/)[1]);assert.ok(rowNumber>=2&&rowNumber<=sheet(data,'JD原文').rows.length+1);
 assert.ok(sheet(data,'JD原文').links.some(link=>link.url==='https://example.com/campus'),'原文页仍须保留官方招聘入口');
});
test('不安全或缺失的官方链接只能回退到 JD 原文',async()=>{
 for(const official_url of ['javascript:alert(1)','file:///C:/private.txt','']){
  const dir=await fixture('unsafe-link-'+encodeURIComponent(official_url).slice(0,12),{job:{official_url,job_url_kind:'official_detail'}});const data=await buildReportData(dir);
  assert.match(sheet(data).links[0].url,/^#'JD原文'!A\d+$/);
  for(const part of data.sheets)for(const link of part.links||[])assert.match(link.url,/^(https?:\/\/|#'JD原文'!A\d+$)/);
 }
});
test('全部城市和长文本均保留，已评估与待核实岗位数量可以逐项核对',async()=>{
 const cities=['武汉','上海','北京','深圳','杭州','广州','成都','南京'];const codeText='类型 List<T>；比较 a < b && c > d。';const longDescription='职责全文：'+codeText+('完整职责内容，'.repeat(700))+'结尾保留标记。';
 const recruitmentEvidence={recruitment_type:'正式校园招聘',graduation_window:['2026-09','2027-08'],source_label:'官网资格说明原字段'};
 const dir=await fixture('preserve-records',{job:{cities,locations_raw:cities,description:longDescription,recruitment_evidence:recruitmentEvidence}});
 await updateJson(path.join(dir,'companies/fixture-company.json'),data=>{
  const original=data.jobs[0];
  data.jobs.push({...original,job_id:'unassessed',title:'尚未评估岗位'},
   {...original,job_id:'needs-check',title:'待核实岗位',evaluation_status:'needs_verification'},
   {...original,job_id:'missing-body',title:'缺少正文岗位',evaluation_status:'missing_body',body_complete:false,description:'已取得片段',requirements:''});
  data.counts.to_assess=2;
 });
 const data=await buildReportData(dir,{allowPartial:true});assert.equal(sheet(data).rows.length,1);assert.equal(sheet(data,'待核实与未评估').rows.length,3);
 assert.equal(data.audit.assessed_jobs,1);assert.equal(data.audit.missing_assessments.length,1);assert.equal(data.audit.needs_verification,2);
 assert.equal(sheet(data).rows[0][6],cities.join('、'));
 const allRows=[...sheet(data).rows,...sheet(data,'待核实与未评估').rows];assert.equal(new Set(allRows.map(row=>row[3])).size,4);assert.ok(allRows.every(row=>row.length===11));
 const snapshots=sheet(data,'JD原文');const serialized=JSON.stringify(snapshots.rows);for(const title of allRows.map(row=>row[3]))assert.ok(serialized.includes(title),'JD 原文遗漏岗位：'+title);
 const jobIdColumn=snapshots.headers.indexOf('岗位ID'),bodyColumn=snapshots.headers.indexOf('JD原文');assert.ok(jobIdColumn>=0&&bodyColumn>=0);
 for(const jobId of ['fixture-job','unassessed','needs-check']){
  const parts=snapshots.rows.filter(row=>row[jobIdColumn]===jobId).map(row=>row[bodyColumn]);assert.ok(parts.length>1,'长 JD 应分段保留');assert.ok(parts.every(part=>part.length<=1600));
  assert.ok(parts.join('').includes(longDescription),'JD 分段重组必须保留全部原文：'+jobId);
  assert.ok(parts.join('').includes(codeText),'已归一化的JD纯文本不能再次按HTML剥掉泛型或比较符');
  assert.ok(parts.join('').includes(JSON.stringify(recruitmentEvidence)),'工作簿原文必须完整保留招聘性质与毕业窗口证据：'+jobId);
 }
});
test('真实导出 Excel 可重新打开且只生成 xlsx 交付文件，不再生成 Markdown',async()=>{
 const officialUrl='https://example.com/campus?id=4735&projectId=102&filter=a%26b&quote="double"&literal=&amp;&tag=<value>#段落';const expectedUrl=new URL(officialUrl).href;
 const dir=await fixture('xlsx-integration',{job:{job_id:'fixture&"quoted"<tag>\'é &amp;',official_url:officialUrl}});const expected=await buildReportData(dir);const audit=await renderRun(dir);
 assert.equal(audit.workbook_file,path.join(dir,'outputs',path.basename(dir),'校招岗位匹配.xlsx'));assert.equal(audit.assessed_jobs,1);
 const bytes=await fs.readFile(audit.workbook_file);assert.equal(bytes.subarray(0,2).toString('ascii'),'PK','输出必须是真实 XLSX ZIP 文件');
 for(const file of ['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']){
  const pane=readZipEntry(bytes,file).match(/<(?:\w+:)?pane\b[^>]*>/)?.[0];assert.ok(pane,'保存后的岗位表必须保留冻结窗格');
  assert.match(pane,/\bxSplit="3"/);assert.match(pane,/\bySplit="1"/);assert.match(pane,/\bstate="frozen"/);
 }
 const runtimeRequire=createRequire(path.join(process.env.CODEX_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'__campus_tests__.cjs'));
 const {xml2js}=runtimeRequire('xml-js');const JSZip=runtimeRequire('jszip');const zip=await JSZip.loadAsync(bytes);
 for(const [name,entry] of Object.entries(zip.files))if(!entry.dir&&/\.(xml|rels)$/i.test(name)){const xml=await entry.async('string');assert.doesNotThrow(()=>xml2js(xml,{compact:false}),'成品XML必须合法：'+name);}
 const xmlRoot=xml=>xml2js(xml,{compact:false}).elements.find(element=>element.type==='element');const elements=(node,name)=>(node.elements||[]).filter(element=>element.type==='element'&&element.name.split(':').pop()===name);
 const mainXml=readZipEntry(bytes,'xl/worksheets/sheet1.xml');const internalLink=elements(elements(xmlRoot(mainXml),'hyperlinks')[0],'hyperlink').find(element=>element.attributes.ref==='K2');assert.ok(internalLink,'JD链接必须保存为真实 Excel 超链接');assert.equal(internalLink.attributes.location,"'JD原文'!A2");assert.equal(internalLink.attributes.display,sheet(expected).links[0].label,'含&、引号、尖括号及实体样文本的标签必须恰好转义一次');
 const snapshotXml=readZipEntry(bytes,'xl/worksheets/sheet4.xml');const externalLink=elements(elements(xmlRoot(snapshotXml),'hyperlinks')[0],'hyperlink').find(element=>element.attributes.ref==='G2');assert.ok(externalLink,'JD原文的官方入口必须保留可点击链接');
 const relationshipId=externalLink.attributes['r:id'];assert.ok(relationshipId);
 const relationships=readZipEntry(bytes,'xl/worksheets/_rels/sheet4.xml.rels');const relationship=elements(xmlRoot(relationships),'Relationship').find(element=>element.attributes.Id===relationshipId);assert.ok(relationship);assert.equal(relationship.attributes.Target,expectedUrl,'多查询参数URL需完整还原，不能漏转义或重复转义');assert.equal(relationship.attributes.TargetMode,'External');
 const {loadArtifactTool}=await import('../lib/excel-report.mjs');const {FileBlob,SpreadsheetFile}=await loadArtifactTool();
 const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(audit.workbook_file));
 for(const name of EXPECTED_SHEETS)assert.ok(workbook.worksheets.getItem(name));
 for(const name of ['岗位匹配','待核实与未评估'])assert.deepEqual(workbook.worksheets.getItem(name).getRange('A1:K1').values[0],EXPECTED_HEADERS);
 assert.deepEqual(workbook.worksheets.getItem('岗位匹配').getRange('A2:J2').values[0],sheet(expected).rows[0].slice(0,10));
 assert.ok(!workbook.worksheets.getItem('岗位匹配').getRange('K2').formulas[0][0],'JD链接应是原生超链接，不依赖不受支持的 HYPERLINK 公式');
 const files=await fs.readdir(dir,{recursive:true});assert.ok(!files.some(file=>/\.md$/i.test(file)),'本轮 Excel 导出不得额外生成 Markdown');
 const savedAudit=await readJson(path.join(dir,'report-audit.json'));assert.equal(savedAudit.workbook_file,audit.workbook_file);
});
test('两张岗位表数据行固定36pt，四段中的长摘要不截断且不改变支持工作表行高',async()=>{
 const longReason='长摘要开始标记。'+'保留对实践质量、岗位要求、判断依据和具体差距的完整总结。'.repeat(180)+'长摘要结束标记。';
 const internalConclusion='仅内部详细结论标记。'+('内部逐项推理内容。'.repeat(400));
 const dir=await fixture('compact-reason-rows',{review:{conclusion:internalConclusion,report_summary:testSummary({conclusion:longReason})}});let secondJob;
 await updateJson(path.join(dir,'companies/fixture-company.json'),data=>{
  secondJob={...data.jobs[0],job_id:'second-assessed',title:'第二个完整评估岗位'};
  data.jobs.push(secondJob,{...data.jobs[0],job_id:'pending-review',title:'等待完整评估岗位'},{...data.jobs[0],job_id:'pending-verification',title:'资格待核实岗位',evaluation_status:'needs_verification'});
  data.counts.to_assess=3;
 });
 await updateJson(path.join(dir,'assessments/fixture-company.json'),data=>{data.assessments.push({...data.assessments[0],job_id:secondJob.job_id,jd_fingerprint:jobFingerprint(secondJob),report_summary:{...data.assessments[0].report_summary,conclusion:longReason+'第二个岗位独立结尾标记。'}});});
 const expected=await buildReportData(dir,{allowPartial:true});assert.equal(sheet(expected).rows.length,2);assert.equal(sheet(expected,'待核实与未评估').rows.length,2);assert.ok(sheet(expected).rows.every(row=>row[9].length>3000));
 for(const row of sheet(expected).rows){assert.ok(row[9].includes(longReason),'模型提交的长摘要应完整保留');assert.ok(!row[9].includes('仅内部详细结论标记。'),'内部conclusion不能自动追加到报告摘要');assert.equal(row[9].split(/\n+/).length,4,'长摘要仍只展示四段');}
 const audit=await renderRun(dir,{allowPartial:true});const archive=await fs.readFile(audit.workbook_file);
 const rowTags=xml=>xml.match(/<(?:\w+:)?row\b[^>]*>/g)||[];const height=tag=>Number(tag.match(/\bht="([^"]+)"/)?.[1]);
 for(const [name,file] of [['岗位匹配','xl/worksheets/sheet1.xml'],['待核实与未评估','xl/worksheets/sheet2.xml']]){
  const xml=readZipEntry(archive,file);const rows=rowTags(xml);assert.equal(rows.length,sheet(expected,name).rows.length+1);
  assert.equal(height(rows[0]),34,'表头必须保持34pt');
  for(const row of rows){assert.doesNotMatch(row,/\bhidden="(?:1|true)"/,'岗位表不能通过隐藏行来缩短展示');assert.match(row,/\bcustomHeight="(?:1|true)"/);}
  for(const row of rows.slice(1))assert.equal(height(row),36,'长理由不能再自动撑高岗位表数据行');
  const widths=(xml.match(/<(?:\w+:)?col\b[^>]*>/g)||[]).map(column=>Number(column.match(/\bwidth="([^"]+)"/)?.[1]));assert.deepEqual(widths,[18,25,18,42,16,24,28,16,16,230,48],'新增性质列后其他岗位表列宽应保持原值');
 }
 for(const file of ['xl/worksheets/sheet3.xml','xl/worksheets/sheet4.xml']){
  const rows=rowTags(readZipEntry(archive,file));assert.ok(rows.length>1);assert.equal(height(rows[0]),34);
  assert.ok(rows.slice(1).every(row=>height(row)>0&&height(row)!==36),'来源覆盖及JD原文保持原来的按内容行高，不应用岗位表36pt规则');
 }
 const {loadArtifactTool}=await import('../lib/excel-report.mjs');const {FileBlob,SpreadsheetFile}=await loadArtifactTool();const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(audit.workbook_file));
 for(const name of ['岗位匹配','待核实与未评估']){
  const reasons=sheet(expected,name).rows.map(row=>[row[9]]);assert.deepEqual(workbook.worksheets.getItem(name).getRangeByIndexes(1,9,reasons.length,1).values,reasons,'降低行高后所有理由必须逐字保留，不得截断或摘要化');
 }
});
test('等号原文不执行公式，数字文本保存并重新导入后逐字保留且无保护引号',async()=>{
 const title='=SUM(1,2)',jobId='12345678901234567890';const sourceIds=[jobId,'00000123','+00123','-00123','1.2300',"'00123"];
 const dir=await fixture('xlsx-literal-formula',{job:{title,job_id:jobId}});
 await updateJson(path.join(dir,'companies/fixture-company.json'),data=>{data.jobs.push(...sourceIds.slice(1).map(id=>({...data.jobs[0],job_id:id})));data.counts.to_assess=data.jobs.length;});
 await updateJson(path.join(dir,'run.json'),run=>{run.report_note='000314';});
 const audit=await renderRun(dir,{allowPartial:true});
 const {loadArtifactTool}=await import('../lib/excel-report.mjs');const {FileBlob,SpreadsheetFile}=await loadArtifactTool();const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(audit.workbook_file));
 const cell=workbook.worksheets.getItem('岗位匹配').getRange('D2');assert.ok(!cell.formulas[0][0],'导入后不得存在可执行公式');assert.equal(cell.values[0][0],title);
 const archive=await fs.readFile(audit.workbook_file);const snapshotXml=readZipEntry(archive,'xl/worksheets/sheet4.xml');
 sourceIds.forEach((expected,index)=>{
  const idCell=workbook.worksheets.getItem('JD原文').getRange('C'+(index+2));assert.ok(!idCell.formulas[0][0]);assert.equal(idCell.values[0][0],expected,'数字文本必须逐字等于原文，不加保护引号、不转科学计数、不丢精度');
  const address='C'+(index+2);const savedId=(snapshotXml.match(/<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g)||[]).find(value=>value.includes('r="'+address+'"'));assert.ok(savedId);assert.match(savedId,/\bt="str"/);assert.doesNotMatch(savedId,/<(?:\w+:)?f(?:\s|>)/);assert.ok(savedId.includes('>'+expected+'</'));
 });
 assert.equal(workbook.worksheets.getItem('说明').getRange('B2').values[0][0],'000314','没有超链接的说明表也必须保留原始数字文本');
 assert.equal(workbook.worksheets.getItem('来源覆盖').getRange('D2').values[0][0],sourceIds.length,'真实数值计数不得被改成文本');
 const xml=readZipEntry(archive,'xl/worksheets/sheet1.xml');const savedCell=xml.match(/<(?:\w+:)?c\b[^>]*\br="D2"[^>]*>[\s\S]*?<\/(?:\w+:)?c>/)?.[0];assert.ok(savedCell);
 assert.doesNotMatch(savedCell,/<(?:\w+:)?f(?:\s|>)/,'保存后的 XML 不能含公式节点');assert.match(savedCell,/=SUM\(1,2\)/);
});
