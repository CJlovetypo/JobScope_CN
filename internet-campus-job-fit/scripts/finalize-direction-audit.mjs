import fs from 'node:fs/promises';
import {SOURCE_REGISTRY_FILE} from '../../shared/job-search-core/registry.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {targetApiProof} from './lib/target-api-proof.mjs';
import {directionEndpointProof} from './lib/direction-endpoint-proof.mjs';
import {directionSourceKey,DIRECTION_VALIDATION_POLICY} from './lib/direction-validation.mjs';
import {sourceDirectionPlan} from './lib/source-directions.mjs';
const pack=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const flags=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n','utf8');};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=async file=>{try{return (await fs.stat(file)).isFile();}catch{return false;}};
const norm=s=>path.resolve(s||'.').replaceAll('\\','/').toLowerCase();
const names={verified_current_target:'已取得当前目标方向完整 JD',verified_direction_endpoint:'已确认对应检索接口',target_body_incomplete:'目标岗位正文不完整',target_type_unverified:'返回岗位但招聘类型证据不足',target_not_open:'仅取得已关闭或开放状态不明的目标岗位',no_target_in_observed_rows:'已观察岗位中未验证目标方向',empty_or_unresolved:'接口当前为空或响应尚未解析出岗位',request_failed:'当次请求失败或超过核验时间',untested:'尚未测试'};
const levelNames={current_jd:'已取得目标岗位',direction_endpoint:'已确认对应检索接口',pending:'方向仍待核实'};
const csvCell=x=>{let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
for(const skillName of flags.skill?[flags.skill]:['internship-job-fit','social-job-fit']){
 const skill=path.join(pack,skillName),mode=skillName.startsWith('internship')?'internship':'social',label=mode==='internship'?'实习':'社招';
 const base=path.join(skill,'artifacts/direction-api-audit-20260919'),registry=await read(SOURCE_REGISTRY_FILE);
 const phases=(await fs.readdir(base,{withFileTypes:true})).filter(x=>x.isDirectory()&&/^phase\d/.test(x.name)).map(x=>x.name).sort();
 const rows=[];let attemptCount=0,requests=0;
 for(const company of registry.companies)for(const [index,config]of (company.recruitment_sources?.length?company.recruitment_sources:[company]).entries()){
  const key=directionSourceKey(company,config,index),source={...config,company_id:company.company_id,display_name:company.display_name},attempts=[];
  for(const phase of phases)try{attempts.push(await read(path.join(base,phase,key,'result.json')));}catch{}
  attempts.sort((a,b)=>String(b.checked_at).localeCompare(String(a.checked_at)));attemptCount+=attempts.length;requests+=attempts.reduce((n,a)=>n+(a.fetch_requests||0),0);
  let accepted=null,chosen=attempts[0],rejected=[],targetSeen=false,targetIncomplete=false,closed=false;
  for(const result of attempts){
   const jobs=[...(result.witnesses||[]),...(result.target_examples||[]),...(result.other_examples||[])];
   for(const job of jobs){
    const proof=targetApiProof(job,source,mode);
    if(job.formal_status===mode){targetSeen=true;if(job.open_status!=='open')closed=true;else if(!job.body_complete)targetIncomplete=true;}
    if(!proof.accepted){rejected.push({reason:proof.reason,title:job.title,job_id:job.job_id});continue;}
    const record=(result.requests||[]).find(r=>[r.response_file,r.decoded_response_file].filter(Boolean).some(f=>norm(f)===norm(job.raw_file)));
    if(!job.raw_file||!await exists(job.raw_file)||!record||record.http_status<200||record.http_status>=300){rejected.push({reason:'successful_saved_api_response_not_bound',title:job.title,job_id:job.job_id});continue;}
    accepted={job,proof,record};chosen=result;break;
   }
   if(accepted)break;
  }
  let status=accepted?'verified_current_target':!attempts.length?'untested':targetIncomplete?'target_body_incomplete':targetSeen&&!closed?'target_type_unverified':closed?'target_not_open':attempts.some(a=>a.jobs_observed>0)?'no_target_in_observed_rows':attempts.some(a=>!['request_failed','worker_timeout_or_error'].includes(a.status))?'empty_or_unresolved':'request_failed';
  const observation_status=status;let endpointProof=null;
  if(!accepted&&['beisen','hotjob','feishu','moka'].includes(source.provider))for(const result of attempts){
   for(const record of result.requests||[]){
    if(record.http_status!==200||!/GetJobAdPageList|\/listPosition\/|\/search\/job\/posts|\/website\/jobs\/v2/.test(record.url||''))continue;
    try{const payload=await read(record.decoded_response_file||record.response_file),proof=directionEndpointProof(source,mode,record,payload);
     if(proof.accepted){endpointProof={...proof,result_file:result.result_file};break;}
    }catch{}
   }
   if(endpointProof)break;
  }
  if(endpointProof)status='verified_direction_endpoint';
  const witness=accepted?{job_id:accepted.job.job_id,title:accepted.job.title,url:accepted.job.official_url,link_kind:accepted.job.job_url_kind||'provided_job_url',raw_file:accepted.job.raw_file,api_url:accepted.record.url,http_status:accepted.record.http_status}:null;
  rows.push({key,company_id:company.company_id,company:company.display_name,source_id:config.source_id||null,provider:config.provider,entry_url:config.primary_entry_url,mode,status,observation_status,evidence_level:accepted?'current_jd':endpointProof?'direction_endpoint':'pending',enabled:true,proof:accepted?.proof||{accepted:false,reason:rejected[0]?.reason||chosen?.error||observation_status},endpoint_proof:endpointProof,witness,checked_at:chosen?.checked_at||null,result_file:chosen?.result_file||null,attempt_count:attempts.length,attempts:attempts.map(a=>({phase:a.phase,checked_at:a.checked_at,status:a.status,jobs_observed:a.jobs_observed||0,requests:a.fetch_requests||0,result_file:a.result_file})),limitations:{sample_verifies_at_least_one_current_target_job:!!accepted,exhaustive_pagination:chosen?.coverage?.status==='complete',collection_status:chosen?.coverage?.status||null,limits:chosen?.limits||null,source_binding:'沿用已核实的公司/租户绑定；本轮不重新宣称独立工商归属核验。',reason:chosen?.coverage?.reason||chosen?.error||null},rejection_examples:rejected.slice(0,3)});
 }
 const statuses={};for(const r of rows)statuses[r.status]=(statuses[r.status]||0)+1;
 const currentJds=rows.filter(x=>x.evidence_level==='current_jd').length,endpoints=rows.filter(x=>x.evidence_level==='direction_endpoint').length,companies=new Set(rows.map(x=>x.company_id));
 const report={schema_version:1,mode,checked_at:new Date().toISOString(),evidence_reprocessed_without_new_http:true,inventory_count:rows.length,tested_count:rows.length-(statuses.untested||0),enabled_count:rows.length,disabled_count:0,verified_count:currentJds+endpoints,current_jd_verified_count:currentJds,endpoint_only_count:endpoints,pending_count:rows.length-currentJds-endpoints,enabled_companies:companies.size,status_counts:statuses,attempt_count:attemptCount,fetch_request_count:requests,source_registry:SOURCE_REGISTRY_FILE,historical_registry_snapshot:path.join(base,'registry-snapshot.json'),acceptance:'所有继承配置均保留并启用。来源证据分为已取得目标岗位、已确认对应检索接口、方向待核实；明确检索接口可以暂无岗位。空列表、证据不足或当次请求失败不自动停用。具体岗位仍按真实招聘类型和完整正文评估。',configurations:rows};
 report.policy_version=DIRECTION_VALIDATION_POLICY;
 await write(path.join(base,'audit-summary.json'),report);
 if(flags.publish==='true'){
  const {configurations,...metadata}=report;
  await write(path.join(skill,'data/source-direction-validation.json'),{...metadata,audit_details:path.join(base,'audit-summary.json'),configurations:rows.map(r=>({key:r.key,company_id:r.company_id,company:r.company,source_id:r.source_id,provider:r.provider,status:r.status,observation_status:r.observation_status,evidence_level:r.evidence_level,enabled:true,checked_at:r.checked_at,proof:{accepted:r.proof.accepted,reason:r.proof.reason},endpoint_proof:r.endpoint_proof,witness:r.witness?{job_id:r.witness.job_id,title:r.witness.title,url:r.witness.url}:null,result_file:r.result_file}))});
  const byKey=new Map(rows.map(r=>[r.key,r]));
  const capabilities=registry.companies.flatMap(c=>(c.recruitment_sources?.length?c.recruitment_sources:[c]).map((s,i)=>{const r=byKey.get(directionSourceKey(c,s,i));return {company_id:c.company_id,display_name:c.display_name,source_id:s.source_id||String(i),provider:s.provider,entry:s.primary_entry_url,...sourceDirectionPlan(s,mode),target_validation_status:r.status,enabled:r.enabled,proof_file:r.result_file};}));
  await write(path.join(skill,'data/source-mode-capabilities.json'),{schema_version:1,mode,checked_at:report.checked_at,note:'全部来源启用；路由策略与方向证据只用于说明确定程度，不作为停用条件。',configurations:capabilities});
 }
 const headers=['公司','配置ID','平台','目标方向','来源证据分级','核验结果','岗位观察结果','默认启用','入口','实际API','岗位ID','岗位标题','官方JD链接','链接类型','判据','核验时间','测试轮数','分页/范围限制','证据结果文件','原始响应文件'];
 const lines=rows.map(r=>[r.company,r.source_id||r.key,r.provider,label,levelNames[r.evidence_level],names[r.status],names[r.observation_status],'是',r.entry_url,r.witness?.api_url||r.endpoint_proof?.api_url,r.witness?.job_id,r.witness?.title,r.witness?.url,r.witness?.link_kind,r.endpoint_proof?.basis||r.proof.reason,r.checked_at,r.attempt_count,r.limitations.reason,r.endpoint_proof?.result_file||r.result_file,r.witness?.raw_file||r.endpoint_proof?.raw_file]);
 await write(path.join(base,'逐配置核验.csv'),'\uFEFF'+[headers,...lines].map(l=>l.map(csvCell).join(',')).join('\r\n')+'\r\n');
 const md=[
  '# '+label+' API 来源核验','',
  '本次按新的来源规则重新整理已有实测证据，没有重新发起网络请求。各项实际测试时间保留在明细中。','',
  '库存及启用配置均为 **'+rows.length+'**，覆盖 **'+companies.size+' 家招聘主体**；已测试 '+report.tested_count+' 个。证据不足或当前无岗位均不自动停用。','',
  '| 来源证据 | 配置数 | 启用状态 |','| --- | ---: | --- |',
  '| 已取得当前目标岗位及完整 JD | '+currentJds+' | 启用 |',
  '| 已确认对应检索接口，未取得完整当前 JD | '+endpoints+' | 启用 |',
  '| 招聘方向仍待核实 | '+report.pending_count+' | 启用 |','',
  '明确接口证据来自已核实的招聘平台类型约定和本配置成功的标准列表响应；空列表也能证明检索入口可用。仅有 HTTP 200、猜测的路径或任意筛选参数，不会被写成方向已确认，但仍保留并启用。','',
  '岗位匹配仍核对实际招聘类型与正文。来源已启用不代表当前有岗位，也不代表返回的所有岗位都属于目标类型。','',
  '## 实测观察结果','', '| 结论 | 配置数 |','| --- | ---: |',...Object.entries(statuses).map(([k,v])=>'| '+names[k]+' | '+v+' |'),'','空列表不等于请求失败；当次请求失败也不会被写成公司没有招聘。分页上限与覆盖限制保留在逐项记录。','',
  '## 证据','',
  '- [逐配置核验表](逐配置核验.csv)：API、JD 链接、方向判据和原始响应。',
  '- [完整核验清单](audit-summary.json)：原测试观察结果、当前证据分级与启用状态。',
  '- 历史累计 '+attemptCount+' 次配置核验尝试、'+requests+' 次 HTTP 调用；响应仍保存在各 phase 目录。','',
  flags.publish==='true'?'运行清单已更新：所有来源启用。':'当前为预览，尚未更新运行清单。',''];
 await write(path.join(base,'README.md'),md.join('\n'));
 console.log(JSON.stringify({skill:skillName,inventory:rows.length,tested:report.tested_count,enabled:rows.length,current_jds:currentJds,endpoint_only:endpoints,pending:report.pending_count,companies:companies.size,published:flags.publish==='true'}));
}
