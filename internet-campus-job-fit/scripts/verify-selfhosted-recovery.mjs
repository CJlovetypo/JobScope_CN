import fs from 'node:fs/promises';
import path from 'node:path';
import {collectSelfHosted} from './lib/providers-selfhosted.mjs';

const output=path.resolve(process.argv[2]||'internet-campus-job-fit/artifacts/selfhosted-recovery');
await fs.mkdir(output,{recursive:true});
const sources=[
  {company_id:'recovery-10jqka',display_name:'同花顺',provider:'10jqka_campus',primary_entry_url:'https://campus.10jqka.com.cn/job/list'},
  {company_id:'recovery-cec',display_name:'中国电子信息产业集团',provider:'cec_campus',primary_entry_url:'https://campus.cec.com.cn/position?positionType=0'},
  {company_id:'recovery-wenhua',display_name:'文华财经',provider:'wenhua_public',primary_entry_url:'https://hr.wenhua.com.cn/',api_config:{}},
  {company_id:'recovery-tplink',display_name:'TP-LINK',provider:'tplink_domestic',primary_entry_url:'https://hr.tp-link.com.cn/',api_config:{campus_stream:true}},
  {company_id:'recovery-ccb',display_name:'中国建设银行',provider:'ccb_public',primary_entry_url:'http://job.ccb.com/cn/job/plan_index.html?planType=XY',api_config:{}},
];
const rows=[];
for(const source of sources){
  const folder=path.join(output,source.company_id);
  const result=await collectSelfHosted(source,{mode:'full',pageSize:100,maxPages:100,maxDetails:source.provider==='ccb_public'?30:undefined,timeoutMs:20000,evidenceDir:path.join(folder,'http')});
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'source.json'),JSON.stringify(source,null,2)+'\n');
  await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(result,null,2)+'\n');
  const complete=result.jobs.filter(job=>job.body_complete),formal=result.jobs.filter(job=>job.body_complete&&job.formal_status==='formal'&&job.open_status==='open');
  const row={display_name:source.display_name,provider:source.provider,state:complete.length?'verified_api_full_jd':result.jobs.length?'empty_or_incomplete_api':'unverified',
    jobs:result.jobs.length,complete_jds:complete.length,formal_jobs:formal.length,employers:[...new Set(result.jobs.map(job=>job.raw_metadata?.employer_name).filter(Boolean))],
    coverage:result.coverage,source_file:path.join(folder,'source.json'),result_file:path.join(folder,'result.json')};
  rows.push(row);console.log(JSON.stringify({name:row.display_name,state:row.state,jobs:row.jobs,complete:row.complete_jds,formal:row.formal_jobs,coverage:row.coverage.status}));
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(rows,null,2)+'\n');
