import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
import {normalizeWorkday,normalizeSmartRecruiters} from '../lib/providers-international.mjs';
import {normalizeJobLocations} from '../lib/locations.mjs';import {reviewRecruitment} from '../lib/recruitment-policy.mjs';
import {verifyCandidate} from '../discover-and-verify.mjs';import {skillRoot} from '../sources.mjs';
const source={company_id:'test',display_name:'测试'},record={response_file:'saved-evidence.json'};
test('explicit cohort requirements differ from accepting or preferring graduates',()=>{
 const work=(title,body)=>normalizeWorkday({jobPostingInfo:{title,jobReqId:'1',jobDescription:'职责：参与内容策划和执行工作，负责用户运营与相关反馈整理工作。\n职位要求：\n'+body,timeType:'Full time',canApply:true}},source,record);
 assert.equal(work('培训生','1.2027应届毕业生，专业不限。\n2.具备良好的沟通与数据分析能力。').formal_status,'formal');
 assert.equal(work('生产班长储备岗（可接受应届）','面向2023-2026届毕业生。具备生产管理与团队协调能力。').formal_status,'unknown');
 assert.equal(work('质量工程师','应届毕业生表现优异者，以上任职资格要求可适当放宽。').formal_status,'unknown');
 assert.equal(work('营销实习生','2027应届毕业生，专业不限，需每周到岗三天。').formal_status,'internship');
});
test('single-field SmartRecruiters JD retains complete duty and requirement sections',()=>{
 const j=normalizeSmartRecruiters({id:'1',name:'Engineer',location:{city:'SHANG HAI',country:'cn'},jobAd:{sections:{jobDescription:{text:'Responsibilities:\nDevelop sensors and test the integrated embedded system.\nRequirement:\nBachelor degree in electronics and experience with embedded C programming.'}}}},source,record);
 assert.equal(j.body_complete,true);assert.deepEqual(j.cities,['上海']);assert.match(j.requirements,/Bachelor/);
});
test('work cities resolve English spellings without guessing a city from an ambiguous district',()=>{
 assert.deepEqual(normalizeJobLocations({locations_raw:['Tianjin, China','Chongqing, China']}).cities.sort(),['天津','重庆'].sort());
 assert.deepEqual(normalizeJobLocations({locations_raw:['Su Zhou Shi, Jiangsu, China']}).cities,['苏州']);
 assert.deepEqual(normalizeJobLocations({locations_raw:['Longgang District']}).cities,[]);
});
test('campus talent recruitment is admitted and early internship does not negate it',()=>{
 const r=reviewRecruitment({title:'研发工程师',description:'正式校招，要求提前实习三个月。',formal_status:'unknown',recruitment_evidence:{provider:'beisen',Category:'校园人才招聘',Kind:'全职'}});assert.equal(r.formal_status,'formal');
});
test('all observed portals are visited after first complete JD; pagination limits remain partial',async()=>{
 const start=async(formal,total=1)=>{const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');const job={Id:formal?'campus':'social',JobAdName:'研发工程师',Category:formal?'校园人才招聘':'社会招聘',CategoryId:formal?'2':'1',Kind:'全职',Status:1,LocNames:['上海'],Duty:'负责产品研发、需求分析与实施，协助完成系统联调和性能验证工作。',Require:'要求计算机相关专业本科及以上学历，能够使用编程语言完成开发任务。'};res.end(JSON.stringify(req.url.includes('GetJobAdInfo')?{Code:200,Data:job}:{Code:200,Data:[job],Count:total}));});let bound=false;for(let attempt=0;attempt<10&&!bound;attempt++){try{await new Promise((resolve,reject)=>{const onError=e=>reject(e);server.once('error',onError);server.listen(50000+Math.floor(Math.random()*12000),'127.0.0.1',()=>{server.off('error',onError);resolve();});});bound=true;}catch(e){if(e.code!=='EADDRINUSE')throw e;}}if(!bound)throw Error('No test port available');return {server,url:'http://127.0.0.1:'+server.address().port+'/campus'};};
 const a=await start(false),b=await start(true,2);try{const result=await verifyCandidate({company_id:'two-portals',display_name:'本地测试',provider:'beisen',entry_urls:[a.url,b.url]},path.join(skillRoot,'tmp/regression-'+Date.now()),{maxPages:1});assert.equal(result.verified_sources.length,2);assert.equal(result.formal_jobs,1);assert.equal(result.verified_sources[1].coverage.status,'partial');assert.equal(result.verified_sources[0].coverage.status,'complete');}finally{await Promise.all([a,b].map(x=>new Promise(r=>x.server.close(r))));}
});
test('saved real API regressions remain correctly normalized',async()=>{
 const registry=JSON.parse(await fs.readFile(path.join(skillRoot,'data/verification-index.json')));
 const jobsFor=async name=>{const c=registry.find(c=>c.display_name===name);const jobs=[];for(const v of c.verification){const result=JSON.parse(await fs.readFile(path.join(skillRoot,v.result_file)));jobs.push(...result.jobs);}return jobs;};
 assert.equal((await jobsFor('惠普')).find(j=>j.job_id==='UNI4323').formal_status,'formal');
 assert.equal((await jobsFor('博世中国')).find(j=>j.job_id==='744000144504559').formal_status,'unknown');
 for(const id of ['R00260910','R00260900'])assert.equal((await jobsFor('麦格纳')).find(j=>j.job_id===id).formal_status,'unknown');
});
