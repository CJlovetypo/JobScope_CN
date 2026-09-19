import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {targetApiProof} from './lib/target-api-proof.mjs';
import {directionEndpointProof} from './lib/direction-endpoint-proof.mjs';
import {directionSourceKey,validatedDirectionRegistry} from './lib/direction-validation.mjs';
const pack=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const name of ['internship-job-fit','social-job-fit']){
 const skill=path.join(pack,name),base=path.join(skill,'artifacts/direction-api-audit-20260919'),mode=name.startsWith('internship')?'internship':'social';
 const registry=await read(datasetPath(skill,'assets/sources.json')),snapshot=await read(path.join(base,'registry-snapshot.json')),audit=await read(path.join(base,'audit-summary.json')),validation=await read(path.join(skill,'data/source-direction-validation.json'));
 const historicKeys=new Set(snapshot.companies.flatMap(c=>(c.recruitment_sources?.length?c.recruitment_sources:[c]).map((s,i)=>directionSourceKey(c,s,i))));
 const configs=new Map(registry.companies.flatMap(c=>(c.recruitment_sources?.length?c.recruitment_sources:[c]).map((s,i)=>[directionSourceKey(c,s,i),{...s,company_id:c.company_id,display_name:c.display_name}])));
 const tested=audit.configurations.filter(r=>r.attempt_count>0).length;
 assert.equal(audit.tested_count,tested);assert.equal(validation.tested_count,tested);
 assert.equal(audit.configurations.length,configs.size);assert.equal(validation.configurations.length,configs.size);
 for(const row of audit.configurations){
  assert(configs.has(row.key));
  if(!row.attempt_count){assert.equal(row.status,'untested');assert.equal(row.proof.accepted,false);assert.equal(row.endpoint_proof,null);}
  if(historicKeys.has(row.key))assert(row.attempt_count>0,'Historical audit evidence must remain traceable');
  const gate=validation.configurations.find(x=>x.key===row.key);assert.equal(row.status,gate.status);assert.equal(row.enabled,gate.enabled);
  assert.equal(row.enabled,true,'All inherited sources stay enabled');
  if(!row.proof.accepted){
   if(row.endpoint_proof?.accepted){const endpoint=row.endpoint_proof,result=await read(endpoint.result_file),record=result.requests.find(r=>(r.decoded_response_file||r.response_file)===endpoint.raw_file&&r.url===endpoint.api_url);assert(record);assert.equal(directionEndpointProof(configs.get(row.key),mode,record,await read(endpoint.raw_file)).accepted,true);}
   continue;
  }
  const result=await read(row.result_file),jobs=[...(result.witnesses||[]),...(result.target_examples||[]),...(result.other_examples||[])];
  const job=jobs.find(j=>j.job_id===row.witness.job_id&&j.raw_file===row.witness.raw_file);assert(job,'Traceable witnessed JD required');
  assert.equal(targetApiProof(job,configs.get(row.key),mode).accepted,true);
  assert((await fs.stat(job.raw_file)).isFile());
  assert(result.requests.some(r=>[r.response_file,r.decoded_response_file].includes(job.raw_file)&&r.http_status>=200&&r.http_status<300));
 }
 const gate=validatedDirectionRegistry(registry.companies,validation,mode);
 assert.equal(gate.enabled_configurations,configs.size);assert.equal(gate.enabled_configurations,validation.enabled_count);assert.equal(gate.companies.length,validation.enabled_companies);
 assert.equal(gate.current_jd_verified_configurations,validation.current_jd_verified_count);assert.equal(gate.endpoint_confirmed_configurations,validation.endpoint_only_count);assert.equal(gate.unverified_configurations,validation.pending_count);
 const run=path.join(skill,'runs/direction-api-verified-smoke-20260919'),runData=await read(path.join(run,'run.json')),company=runData.companies.find(c=>c.selected);
 const resultFile=path.join(run,'companies',company.company_id+'.json'),before=await fs.readFile(resultFile),result=JSON.parse(before),started=performance.now();
 const cached=spawnSync(process.execPath,[path.join(skill,'scripts/jobs.mjs'),'collect','--run',run],{encoding:'utf8',windowsHide:true});
 assert.equal(cached.status,0,cached.stderr);assert.equal(sha(before),sha(await fs.readFile(resultFile)),'Repeat collection must reuse unchanged complete result');
 const runtimeFiles=[];
 for(const dir of ['scripts/lib','scripts'])for(const entry of await fs.readdir(path.join(skill,dir),{withFileTypes:true}))if(entry.isFile()){
  const relative=dir+'/'+entry.name;runtimeFiles.push({file:relative,sha256:sha(await fs.readFile(path.join(skill,relative)))});
 }
 const inheritanceFile=path.join(skill,'data/registry-inheritance.json'),inheritance=await read(inheritanceFile);
 Object.assign(inheritance,{runtime_updated_at:new Date().toISOString(),current_runtime_files:runtimeFiles,target_validation:{file:'data/source-direction-validation.json',policy_version:validation.policy_version,inventory:validation.inventory_count,tested:validation.tested_count,enabled:validation.enabled_count,current_jd_verified:validation.current_jd_verified_count,endpoint_only:validation.endpoint_only_count,pending:validation.pending_count},note:'inherited_files records historical provenance only; current runtime and registry are shared/job-search-core; local scripts/lib files are compatibility re-exports.'});
 await fs.writeFile(inheritanceFile,JSON.stringify(inheritance,null,2)+'\n');
 const summary={checked_at:new Date().toISOString(),skill:name,mode,inventory:configs.size,tested:validation.tested_count,enabled:gate.enabled_configurations,companies:gate.companies.length,current_jd_verified:validation.current_jd_verified_count,endpoint_only:validation.endpoint_only_count,pending:validation.pending_count,all_claimed_evidence_rechecked:true,shared_registry:true,historical_configurations:historicKeys.size,new_configurations_without_historical_audit:[...configs.keys()].filter(k=>!historicKeys.has(k)).length,duplicate_keys:0,complete_collection_smoke:{company:company.display_name,jobs:result.jobs.length,coverage:result.coverage.status,counts:result.counts,run},cache_smoke:{elapsed_ms:Math.round(performance.now()-started),company_snapshot_sha256_unchanged:true},runtime_files:runtimeFiles.length};
 await fs.writeFile(path.join(base,'delivery-check.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
