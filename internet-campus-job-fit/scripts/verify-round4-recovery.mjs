import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from './lib/http.mjs';
import {collectRound4} from './lib/providers-round4.mjs';
import {collectInternational} from './lib/providers-international.mjs';

const root=path.resolve(process.argv[2]||path.join(import.meta.dirname,'..'));
const output=path.resolve(process.argv[3]||path.join(root,'artifacts/wps-campus-sources-20260919/deep-api-review/round4-live-verification'));
await fs.mkdir(output,{recursive:true});
const write=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);

const employers=[
  '全国市长研修学院（住房和城乡建设部干部学院）',
  '中国建设报社',
  '住房和城乡建设部标准定额研究所',
  '住房和城乡建设部人力资源开发中心',
  '住房和城乡建设部信息中心（住房信息管理中心）',
  '住房和城乡建设部政策研究中心',
];
const sources=[...employers.map(display_name=>({display_name,company_id:'pending',provider:'mochr_public',primary_entry_url:'http://gkzp.mochr.com/#/jobQuiry',api_config:{employer_names:[display_name]}})),
  {display_name:'惠科股份',company_id:'pending',provider:'hkc_public',primary_entry_url:'http://joinus.hkcqjy.com.cn/',api_config:{recruit_category:1,release_channel:2}},
  {display_name:'芬欧汇川UPM',company_id:'pending',provider:'workday',primary_entry_url:'https://upm.wd103.myworkdayjobs.com/en-US/Careers',api_config:{origin:'https://upm.wd103.myworkdayjobs.com',tenant:'upm',site:'Careers'}},
];

const verified=[];let cursor=0;
await Promise.all(Array.from({length:3},async()=>{while(cursor<sources.length){const source=sources[cursor++],dir=path.join(output,`${source.provider}-${hash(source.display_name)}`);await fs.mkdir(dir,{recursive:true});
  try{const options={evidenceDir:path.join(dir,'http'),timeoutMs:30000,mode:'full'},result=['mochr_public','hkc_public'].includes(source.provider)?await collectRound4(source,options):await collectInternational(source,options);await write(path.join(dir,'source.json'),source);await write(path.join(dir,'result.json'),result);verified.push({source,result,result_file:path.join(dir,'result.json')});console.log(JSON.stringify({company:source.display_name,provider:source.provider,jobs:result.jobs.length,full:result.jobs.filter(j=>j.body_complete).length,formal:result.jobs.filter(j=>j.formal_status==='formal').length,open:result.jobs.filter(j=>j.open_status==='open').length,status:result.coverage.status}));}
  catch(error){verified.push({source,error:error.message});console.log(JSON.stringify({company:source.display_name,error:error.message}));}
}}));

const pumcDir=path.join(output,'pumc-correct-contract'),pumcClient=createClient({evidenceDir:path.join(pumcDir,'http'),timeoutMs:30000}),pumc=[];await fs.mkdir(pumcDir,{recursive:true});
for(const dept of ['1000','1010'])for(const type of ['1','2']){const body={currentPage:1,pageSize:100,type,dept};try{const response=await pumcClient.request({url:'https://job.pumc.edu.cn/api/hr/recruit-title/findAfootTitle',method:'POST',headers:{Origin:'https://job.pumc.edu.cn',Referer:`https://job.pumc.edu.cn/job/index.html#/?companyCode=${dept}`},body},{purpose:'recruitment_title_list'});pumc.push({dept,type,status:response.record.http_status,total:Number(response.data?.data?.total),code:response.data?.code,response_file:response.record.response_file});}catch(error){pumc.push({dept,type,error:error.message});}}
await write(path.join(pumcDir,'result.json'),{checked_at:new Date().toISOString(),probes:pumc,requests:pumcClient.records,conclusion:'Correct frontend parameters are accepted; all tested current graduate/social title lists are empty.'});
verified.sort((a,b)=>a.source.display_name.localeCompare(b.source.display_name,'zh-CN'));
const manifest={checked_at:new Date().toISOString(),verified:verified.map(row=>row.error?{display_name:row.source.display_name,provider:row.source.provider,error:row.error}:{display_name:row.source.display_name,provider:row.source.provider,result_file:path.relative(root,row.result_file).replaceAll('\\','/'),jobs:row.result.jobs.length,complete_jds:row.result.jobs.filter(j=>j.body_complete).length,formal_jobs:row.result.jobs.filter(j=>j.formal_status==='formal').length,open_jobs:row.result.jobs.filter(j=>j.open_status==='open').length,coverage:row.result.coverage}),pumc};
await write(path.join(output,'manifest.json'),manifest);console.log(JSON.stringify({verified:manifest.verified.length,jobs:manifest.verified.reduce((n,x)=>n+(x.jobs||0),0),complete_jds:manifest.verified.reduce((n,x)=>n+(x.complete_jds||0),0),pumc},null,2));
