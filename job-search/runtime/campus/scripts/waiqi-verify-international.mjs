// Incremental anonymous verification of ATS links actually observed in the Waiqi archive.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectInternational} from '../../../../shared/job-search-core/scripts/lib/providers-international.mjs';
import {recruitmentLink} from '../../../../shared/job-search-core/scripts/lib/waiqi-utils.mjs';
const root=path.resolve('job-search/runtime/campus/artifacts/waiqi-2026-09-20');
const summarizeOnly=process.argv.includes('--summarize-only');
const out=path.join(root,'official-verification');await fs.mkdir(out,{recursive:true});
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const save=async(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2)+'\n');
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
function identify(link){try{const u=new URL(link),parts=u.pathname.split('/').filter(Boolean);let m=u.hostname.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i);if(m){if(/^[a-z]{2}-[a-z]{2}$/i.test(parts[0]))parts.shift();if(!parts[0]||parts[0]==='job')return null;return{provider:'workday',primary_entry_url:u.origin+'/'+parts[0],api_config:{origin:u.origin,tenant:m[1],site:parts[0]}};}if(/^(?:jobs|careers)\.smartrecruiters\.com$/i.test(u.hostname)&&parts[0])return{provider:'smartrecruiters',primary_entry_url:u.origin+'/'+parts[0],api_config:{company_identifier:parts[0]}};}catch{}return null;}
const key=s=>s.provider==='workday'?`workday:${s.api_config?.tenant}:${s.api_config?.site}`.toLowerCase():s.provider==='smartrecruiters'?`smartrecruiters:${s.api_config?.company_identifier}`.toLowerCase():'';
const existing=(await read('shared/job-search-core/assets/sources.json')).companies;
const reviews=await read(path.join(out,'manual-reviews.json')).catch(()=>({}));
const pendingReviews=await read(path.join(out,'pending-reviews.json')).catch(()=>({}));
const existingKeys=new Set(existing.flatMap(c=>[c,...(c.recruitment_sources||[])].map(key)).filter(Boolean));
const candidates=new Map();
for(const file of (await fs.readdir(path.join(root,'positions')).catch(()=>[])).filter(f=>f.endsWith('.json'))){let response;try{response=await read(path.join(root,'positions',file));}catch{continue;}if(!response.success||!Array.isArray(response.data))continue;let company=await read(path.join(root,'companies',file)).catch(()=>null);company=company?.data||{};
for(const row of response.data){const normalized=recruitmentLink(row.outsideUrl);if(!['unchanged','extracted_explicit_url'].includes(normalized.normalization))continue;const cfg=identify(normalized.url);if(!cfg)continue;const k=key(cfg);if(existingKeys.has(k))continue;if(!candidates.has(k))candidates.set(k,{...cfg,key:k,source_id:'waiqi-20260920-'+hash(k),company_id:'company-'+hash(k).slice(0,12),display_name:company.name||row.companyName,discovery_records:[]});const c=candidates.get(k);if(!c.discovery_records.some(r=>r.waiqi_company_id===file.slice(0,-5)))c.discovery_records.push({waiqi_company_id:file.slice(0,-5),name:company.name||row.companyName,industry_hint:company.businessDictName||row.businessDictName,observed_link:row.outsideUrl,normalized_link:normalized.url,link_normalization:normalized.normalization,archive_file:path.join(root,'positions',file)});}}
await save(path.join(out,'candidates.json'),[...candidates.values()]);
let admitted=[],pending=[];
let cursor=0;const queue=[...candidates.values()];await Promise.all(Array.from({length:2},async()=>{while(cursor<queue.length){const c=queue[cursor++];const dir=path.join(out,c.source_id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'verification.json');let result=await read(file).catch(()=>null);if(!result&&summarizeOnly){pending.push({candidate:c,status:'not_yet_verified'});continue;}if(!result){console.log('VERIFY',c.key,c.display_name);result=await collectInternational(c,{evidenceDir:path.join(dir,'raw'),maxPages:1,pageSize:20,maxDetails:5,detailConcurrency:1,timeoutMs:10000,requestBudget:{remaining:15}});await save(file,result);}
const review=reviews[c.key];const samples=[];let reviewHashMismatches=[];
for(const j of result.jobs.filter(j=>!review?.excluded_job_ids?.includes(j.job_id)&&(j.body_complete||review?.complete_job_ids?.includes(j.job_id))&&j.job_id&&j.official_url)){
  // These approved hashes were written after manual review, never minted by this replay path.
  const approved=review?.reviewed_job_evidence?.find(e=>e.job_id===j.job_id&&e.official_url===j.official_url);
  const raw=await fs.readFile(j.raw_file).catch(()=>null);
  const sha=value=>createHash('sha256').update(value).digest('hex');
  if(approved&&raw&&sha(raw)===approved.response_sha256&&sha(j.description||'')===approved.description_sha256)samples.push(j);
  else if(review)reviewHashMismatches.push({job_id:j.job_id,reason:approved?'approved_body_changed':'no_fixed_manual_approval_for_this_body'});
}
let identity=[];for(const j of samples){const raw=await read(j.raw_file).catch(()=>null);const name=raw?.hiringOrganization?.name||raw?.hiringOrganization?.descriptor||raw?.company?.name;if(name)identity.push({name,job_id:j.job_id,raw_file:j.raw_file,official_url:j.official_url});}identity=[...new Map(identity.map(i=>[i.name,i])).values()];
// Keep broad/global portals and ambiguous multi-employer sites pending for manual review.
const status=samples.length&&review?.identity_basis?'api_and_employer_verified':'pending';
if(status==='pending'){pending.push({candidate:c,status,reason:reviewHashMismatches.length?'Fixed manual approval hash missing or changed; new body requires new review':review?'No complete official JD sample confirmed in tested mainland scope':'Employer/portal/sector attribution or complete JD not approved; preserve candidate for review',review_hash_mismatches:reviewHashMismatches,complete_jd_samples:samples.length,identity,coverage:result.coverage,verification_file:file,manual_disposition:pendingReviews[c.key]||null});continue;}
const employer=review.display_name;const source={...c,display_name:employer,aliases:[],category:review.industry_tags[0],industry_tags:review.industry_tags,industry_assignment:{status:'reviewed_routing',basis:review.industry_basis},suggested_existing_company_id:review.suggested_existing_company_id||null,merge_group_key:review.merge_group_key||employer.replace(/（.*?）/g,'').trim().toLowerCase(),source_origin:'waiqi-20260920',source_verification:{checked_at:result.checked_at,method:'public_api_full_jd_and_explicit_employer',complete_jd_samples:samples.length,observed_jobs:result.jobs.length,identity_basis:review.identity_basis,observed_employers:identity,scope:result.coverage.scope,proof_directory:dir,pagination:'one_list_page_and_up_to_five_details; not_full_inventory',coverage:result.coverage,semantic_review:review,offline_reprocessing:result.offline_reprocessing||null},discovery_provenance:{dataset:'waiqi-company-20260920',records:c.discovery_records},verified_samples:samples.slice(0,2)};delete source.key;delete source.discovery_records;admitted.push(source);
if(process.argv.includes('--verbose'))console.log('RESULT',c.key,status,samples.length,employer);
source.verification_status='verified_api_full_jd';source.verified_at=result.checked_at;
if(review.suggested_group_display_name)source.suggested_group_display_name=review.suggested_group_display_name;
source.validated_api_request_examples=[result.requests.find(r=>/job_list$/.test(r.purpose)&&r.http_status===200),result.requests.find(r=>r.purpose==='job_detail'&&r.response_file===samples[0].raw_file&&r.http_status===200)].filter(Boolean).map(r=>({method:r.method,url:r.url,body:r.body,purpose:r.purpose,response_file:r.response_file,response_sha256:r.response_sha256,checked_at:r.checked_at}));
source.verified_samples=samples.slice(0,2).map(j=>({job_id:j.job_id,title:j.title,official_url:j.official_url,raw_file:j.raw_file,body_complete:j.body_complete,semantic_review_complete:review.complete_job_ids?.includes(j.job_id)||false}));
}}));
await save(path.join(out,'admitted.json'),admitted);await save(path.join(out,'pending.json'),pending);console.log(JSON.stringify({candidates:candidates.size,admitted:admitted.length,pending:pending.length}));
