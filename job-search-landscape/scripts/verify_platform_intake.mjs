import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=new URL('../artifacts/live-platform-validation-20260919/',import.meta.url);
const read=p=>JSON.parse(fs.readFileSync(new URL(p,dir),'utf8'));
const jobs=read('normalized_jobs.json');
assert.equal(new Set(jobs.map(x=>x.job_id)).size,jobs.length);
for(const j of jobs){
  assert.ok(/^https?:\/\//.test(j.source_url)); // retain upstream HTTP URLs rather than silently rewriting them
  assert.equal(j.open_status,'unknown');assert.equal(j.production_eligible,false);
  if(j.intake_status==='body_ready'){assert.equal(j.record_kind,'job');assert.ok(j.body_complete);assert.ok(j.full_jd);assert.ok(!j.detail_status.includes('login'));}
  if(j.record_kind==='announcement')assert.equal(j.intake_status,'quarantine');
  if(j.source==='zhilian')assert.equal(j.intake_status,'quarantine');
  if(j.source==='shixiseng')assert.ok(!/[\uE000-\uF8FF]/u.test(j.full_jd+j.title+j.salary));
}
assert.equal(read('liepin/mcp-search.json').result.isError,true);
assert.equal(read('liepin/mcp-result.json').status,'blocked_auth');
const c=read('commercial/51job/result.json').checks;
assert.ok(c.new_on_page2>0 && c.new_on_page2<c.page_counts[1]); // real overlapping pages must be deduplicated
assert.equal(jobs.filter(x=>x.source==='51job').length,34);
assert.equal(jobs.filter(x=>x.source==='liepin'&&x.intake_status==='body_ready').length,2);
assert.equal(jobs.filter(x=>x.source==='nowcoder'&&x.intake_status==='body_ready').length,10);
assert.ok(jobs.some(x=>x.source==='shixiseng'&&x.full_jd.length===85&&x.intake_status==='quarantine'));
console.log(`Verified ${jobs.length} records: unique identities, blocked/partial isolation, PUA decoding, existing body gate and no invented recruitment status.`);
