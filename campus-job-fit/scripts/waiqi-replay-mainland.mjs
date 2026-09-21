// Offline replay only: exact recorded request/body -> immutable archived response.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collectWorkdayLocationFallback} from '../../shared/job-search-core/scripts/lib/workday-location-fallback.mjs';
const base=path.resolve('campus-job-fit/artifacts/waiqi-2026-09-20/official-verification');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const candidates=await read(path.join(base,'candidates.json'));
const selected=new Set(['workday:freudenberg:freudenberg-group','workday:jll:jllcareerschina','workday:accenture:accenturecareers']);
const signature=q=>JSON.stringify([q.method||'GET',q.url,q.body||null]);
for(const c of candidates.filter(c=>selected.has(c.key))){
  const dir=path.join(base,c.source_id),file=path.join(dir,'verification.json'),backup=path.join(dir,'verification-before-mainland-alias-fix.json');
  if(await fs.access(backup).then(()=>true,()=>false)){console.log('Already replayed',c.key);continue;}
  const originalBytes=await fs.readFile(file),original=JSON.parse(originalBytes);
  const records=[];
  const response=async record=>({data:await read(record.response_file),text:await fs.readFile(record.response_file,'utf8'),record});
  const client={records,async request(q){const record=original.requests.find(r=>signature(r)===signature(q));if(!record)throw Error('No exact recorded request; network disabled: '+signature(q));records.push(record);return response(record);}};
  const bootstrapRecord=original.requests.find(r=>r.purpose==='public_country_facet_discovery');
  records.push(bootstrapRecord);
  const result=await collectWorkdayLocationFallback(c,{client,bootstrap:await response(bootstrapRecord),maxPages:1,pageSize:20,maxDetails:5,detailConcurrency:1});
  result.checked_at=original.checked_at;
  result.offline_reprocessing={at:new Date().toISOString(),original_verification_sha256:createHash('sha256').update(originalBytes).digest('hex'),original_verification_file:backup,network_requests:0,reason:'Recognize explicit China (Mainland) / China/Mainland country descriptors; retain exact original location-filtered API requests and immutable responses.'};
  await fs.writeFile(backup,originalBytes,{flag:'wx'});
  await fs.writeFile(file,JSON.stringify(result,null,2)+'\n');
  console.log(c.key,JSON.stringify({jobs:result.jobs.length,complete:result.jobs.filter(j=>j.body_complete).length,requests:result.requests.length,excluded:result.coverage.excluded_country_rows.length}));
}
