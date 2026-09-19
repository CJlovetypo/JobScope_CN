import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SKILL_ROOT} from './lib/io.mjs';

const manifestFiles=process.argv.slice(2);
if(!manifestFiles.length)throw new Error('Usage: node build-wps-source-proof.mjs manifest.json [manifest.json ...]');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=async(file,value)=>{await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};
const relative=file=>file?path.relative(SKILL_ROOT,path.resolve(file)).replaceAll('\\','/'):'';
const rows=(await Promise.all(manifestFiles.map(file=>read(path.resolve(file)))).then(groups=>groups.flat())).filter(row=>row.admitted);
const rowIndex=new Map();
for(const row of rows){
  const source=await read(row.source_file);
  const key=JSON.stringify([source.provider,source.primary_entry_url]);
  const list=rowIndex.get(key)||[];list.push(row);rowIndex.set(key,list);
}
const registry=await read(datasetPath(SKILL_ROOT,'assets/sources.json'));
const configurations=[];
for(const company of registry.companies){
  for(const source of (company.recruitment_sources||[]).filter(item=>item.verification_scope)){
    const candidates=rowIndex.get(JSON.stringify([source.provider,source.primary_entry_url]))||[];
    const row=candidates.sort((a,b)=>(b.complete_jds||0)-(a.complete_jds||0))[0];
    if(!row)throw new Error(`No WPS proof row for ${company.display_name} ${source.source_id} ${source.primary_entry_url}`);
    const proofFile=row.capability_only&&row.capability_result_file?row.capability_result_file:row.result_file;
    const result=await read(proofFile);
    const samples=result.jobs.filter(job=>job.body_complete&&job.job_id&&job.official_url&&job.description&&job.requirements).slice(0,3).map(job=>({
      job_id:String(job.job_id),title:job.title,official_url:job.official_url,
      description_chars:job.description.length,requirements_chars:job.requirements.length,
      raw_file:relative(job.raw_file||job.evidence_files?.[0]),
    }));
    if(!samples.length)throw new Error(`No complete sample for ${company.display_name} ${source.source_id}`);
    const apiRequests=result.requests.filter(request=>request.http_status===200&&request.response_sha256).map(request=>({method:request.method,url:request.url,http_status:request.http_status,response_sha256:request.response_sha256,response_file:relative(request.response_file)}));
    if(!apiRequests.length)throw new Error(`No successful API evidence for ${company.display_name} ${source.source_id}`);
    configurations.push({company_id:company.company_id,display_name:company.display_name,source_id:source.source_id,provider:source.provider,checked_at:row.checked_at,entry_url:source.primary_entry_url,
      source_file:relative(row.source_file),result_file:relative(proofFile),complete_jds_observed:row.complete_jds,formal_open_full_jds_observed:row.formal_jobs||0,
      samples,api_requests:apiRequests,capability_sample_coverage:row.capability_coverage||row.coverage,city_list_coverage:row.coverage,
      identity_reason:'WPS 2025—2027 届校招汇总表记录该公司与招聘入口；本轮按 ATS 租户归并并通过匿名列表、详情 API 复核完整 JD。',registry_candidates:row.observed_names||[row.display_name]});
  }
}
const stamp=new Date().toISOString(),proofFile=path.join(SKILL_ROOT,'data/source-verification-wps-20260919.json');
await write(proofFile,{schema_version:1,verified_on:stamp.slice(0,10),scope:'WPS 2025、2026、2027 届校招汇总表新增招聘入口；仅收录匿名 API 可返回完整 JD 的配置。',updated_at:stamp,configurations});
for(const filename of ['source-verification-20260917.json','source-verification-full-review-20260917.json']){
  const file=path.join(SKILL_ROOT,'data',filename),base=await read(file),map=new Map((base.configurations||[]).map(item=>[`${item.company_id}:${item.source_id}`,item]));
  for(const item of configurations)map.set(`${item.company_id}:${item.source_id}`,item);
  await write(file,{...base,updated_at:stamp,configurations:[...map.values()]});
}
console.log(JSON.stringify({configurations:configurations.length,output:proofFile},null,2));
