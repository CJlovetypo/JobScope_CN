import {datasetPath} from '../../../shared/job-search-core/registry.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {SKILL_ROOT} from '../lib/io.mjs';import {INDUSTRIES} from '../lib/industry-routing.mjs';
const read=async p=>JSON.parse(await fs.readFile(datasetPath(SKILL_ROOT,p),'utf8'));
test('every legacy company has a traceable review without treating all as usable API sources',async()=>{
 const a=await read('data/legacy-registry-review-20260917.json');assert.equal(a.total_records,9295);assert.equal(a.unreviewed_records,0);assert.equal(a.companies.length,9295);assert.equal(new Set(a.companies.map(c=>c.registry_company_id)).size,9295);
 assert.equal(Object.values(a.status_counts).reduce((s,n)=>s+n,0),9295);assert(a.status_counts.api_not_confirmed>0);for(const c of a.companies){assert(c.registry_name&&c.status&&c.review_basis);assert(c.current_round_checks.length||c.linked_recruiting_entities.length);assert(c.current_round_checks.every(e=>e.file));}
});
test('new reviewed companies have complete-JD proofs and matching metadata entries',async()=>{
 const sources=(await read('assets/sources.json')).companies,proof=(await read('data/source-verification-full-review-20260917.json')).configurations,validTags=new Set(INDUSTRIES.map(i=>i.id));
 for(const c of sources.filter(c=>c.source_origin==='legacy-registry-full-review')){assert(c.industry_tags.length&&c.industry_tags.every(t=>validTags.has(t)));for(const s of c.recruitment_sources){const p=proof.find(p=>p.company_id===c.company_id&&p.source_id===s.source_id);assert(p,c.display_name+' missing source proof');assert(p.checked_at&&p.complete_jds_observed>0);assert(p.samples.every(j=>j.job_id&&j.official_url&&j.description_chars>0&&j.requirements_chars>0&&j.raw_file));assert(p.api_requests.some(q=>q.http_status===200&&q.response_sha256));}}
 const ids=sources.map(c=>c.company_id).sort();for(const f of ['company-city-index','company-business-tags','company-ownership-tags','company-profiles'])assert.deepEqual((await read('data/'+f+'.json')).companies.map(c=>c.company_id).sort(),ids);
 const retired=(await read('data/source-verification-full-review-20260917.json')).identity_migrations.filter(x=>x.kind==='merge_duplicate');assert(retired.every(r=>!ids.includes(r.from_id)&&ids.includes(r.to_id)));
});
