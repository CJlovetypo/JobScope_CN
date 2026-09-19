/** Offline platform intake: preserve evidence; reuse the production body review, never invent hiring status. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { reviewJobBody } from '../../shared/job-search-core/scripts/lib/body-review.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.resolve(process.argv[2] || path.join(root,'artifacts/live-platform-validation-20260919'));
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const write=(f,x)=>fs.writeFileSync(path.join(dir,f),JSON.stringify(x,null,2)+'\n');
const raw=[];
const details=new Map(read('liepin/jobs.json').map(x=>[x.source_job_id,x]));
for(const page of [1,2]) for(const c of read(`liepin/list-page${page}.json`).results){
  raw.push({item:{source:'liepin',source_job_id:c.id,source_url:c.url,title:c.title,company:c.company,location:c.location,salary:c.salary,source_date:c.date,full_jd:'',detail_status:'not_fetched',...details.get(c.id)},file:details.has(c.id)?'liepin/jobs.json':`liepin/list-page${page}.json`});
}
for(const file of ['campus/jobs.json','shixiseng/jobs.json','commercial/51job/jobs.json','commercial/zhilian/jobs.json']){
  for(const item of read(file))raw.push({item,file});
}
const unique=new Map();
for(const {item:x,file} of raw){
  const id=String(x.source_job_id??x.source_id??x.id??'');
  const url=x.source_url??x.url;
  if(!id || !url)throw new Error(`Missing stable identity: ${file}`);
  const key=`${x.source}:${id}`;
  const full=x.full_jd??x.description??'';
  const status=x.detail_status??(x.details_verified?'body_available':'not_fetched');
  const kind=x.record_kind??'job';
  // Preserve the original body; explicit site heading maps to the existing requirements field.
  const siteReq=x.source==='shixiseng'?full.match(/岗位基本要求\s*([\s\S]*?)(?=岗位亮点|$)/)?.[1]:'';
  const review=reviewJobBody({job_id:id,description:full,requirements:x.requirements??siteReq??''});
  let reason=kind!=='job'?'announcement':/login|gated/.test(status)?'login_gated':!full?'detail_not_fetched':/[\uE000-\uF8FF]/u.test(full)?'font_not_decoded':!review.body_complete?'body_review_pending':null;
  const record={source:x.source,source_job_id:id,job_id:key,title:x.title,company_name:x.company,source_url:url,job_url_kind:'platform_detail',locations_raw:x.location??x.city??'',salary:x.salary??'',record_kind:kind,full_jd:full,partial_jd:x.partial_jd??'',description:review.description,requirements:review.requirements,body_complete:review.body_complete,body_review:review.body_review,detail_status:status,source_date:x.source_date??x.published_at??x.publish_date_ms??null,date_semantics:'source_supplied_not_independently_verified',hiring_status:'unknown',open_status:'unknown',fetched_at:x.fetched_at??null,evidence_file:file,evidence_sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),intake_status:reason?'quarantine':'body_ready',quarantine_reason:reason,production_eligible:false};
  unique.set(key,record);
}
const jobs=[...unique.values()];
write('normalized_jobs.json',jobs);
write('body_ready_jobs.json',jobs.filter(x=>x.intake_status==='body_ready'));
write('quarantine.json',jobs.filter(x=>x.intake_status==='quarantine'));
const counts={};
for(const x of jobs){counts[x.source]??={records:0,body_ready:0,quarantine:0};counts[x.source].records++;counts[x.source][x.intake_status==='body_ready'?'body_ready':'quarantine']++;}
const summary={records:jobs.length,body_ready:jobs.filter(x=>x.intake_status==='body_ready').length,counts,gate:'Existing shared/job-search-core reviewJobBody. Body readiness is NOT production eligibility: recruitment validity, candidate matching and cross-source identity remain unverified.'};
write('intake_summary.json',summary);console.log(JSON.stringify(summary,null,2));
