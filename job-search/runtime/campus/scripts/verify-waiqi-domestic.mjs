// Incremental maintenance verification. Only follows ATS URLs present in archived Waiqi responses.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sourceFromEntry, verifyCandidate} from './source-discovery.mjs';
import {recruitmentLink} from '../../../../shared/job-search-core/scripts/lib/waiqi-utils.mjs';

const root = path.resolve(process.argv[2] || 'job-search/runtime/campus/artifacts/waiqi-2026-09-20');
const output = path.join(root, 'official-domestic-verification');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, data) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n'); };
const registry = await read(new URL('../../../../shared/job-search-core/assets/sources.json', import.meta.url));
const matches = /mokahr\.com|zhiye\.com|hotjob\.cn|jobs\.feishu\.cn|jobs\.f\.mioffice\.cn/i;
function context(source) {
  const q = source.validated_api_request_examples?.find(q => q.purpose === 'job_list') || {};
  let body = q.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); } }
  if (source.provider === 'moka') return JSON.stringify(['moka', new URL(q.url).host, String(body.orgId), String(body.siteId)]);
  if (source.provider === 'beisen') return JSON.stringify(['beisen', new URL(q.url).host, String(body.PortalId || '')]);
  if (source.provider === 'hotjob') return JSON.stringify(['hotjob', new URL(q.url).host, q.url.match(/SU[\da-f]{24}/i)?.[0]]);
  if (source.provider === 'feishu') return JSON.stringify(['feishu', new URL(q.url).host, q.headers?.['website-path'] || 'index']);
  return null;
}
const existing = new Set();
for (const company of registry.companies) for (const source of company.recruitment_sources?.length ? company.recruitment_sources : [company]) {
  try { const key = context(source); if (key) existing.add(key); } catch {}
}
const groups = new Map(), unsupported = [], skipped = [];
let scanned = 0, jobCount = 0;
for (const file of await fs.readdir(path.join(root, 'positions'))) {
  if (!file.endsWith('.json')) continue;
  let data; try { data = await read(path.join(root, 'positions', file)); } catch { continue; }
  if (!Array.isArray(data.data)) continue;
  scanned++;
  for (const job of data.data) {
    jobCount++;
    if (!matches.test(job.outsideUrl || '')) continue;
    const observed = recruitmentLink(job.outsideUrl);
    const provenance = {waiqi_company_id: path.basename(file, '.json'), company_name_hint: job.companyName, position_id: job.id, outside_url: job.outsideUrl, extracted_url: observed.url, link_normalization: observed.normalization, response_file: path.join(root, 'positions', file)};
    if (!observed.url || observed.normalization === 'assumed_https_for_bare_domain') { unsupported.push({...provenance, reason: 'No explicit HTTP(S) URL observed; do not probe an assumed scheme'}); continue; }
    try {
      const source = sourceFromEntry({display_name: job.companyName || '待核实招聘主体'}, observed.url);
      const key = context(source);
      if (existing.has(key)) { skipped.push({...provenance, context: key}); continue; }
      if (!groups.has(key)) groups.set(key, {company_id: 'waiqi-domestic-' + createHash('sha256').update(key).digest('hex').slice(0, 12), display_name: job.companyName || '待核实招聘主体', entry_urls: [], provenance: [], context: key});
      const item = groups.get(key);
      if (!item.entry_urls.includes(observed.url)) item.entry_urls.push(observed.url);
      item.provenance.push(provenance);
    } catch (error) { unsupported.push({...provenance, reason: error.message}); }
  }
}
await write(path.join(output, 'candidates.json'), [...groups.values()]);
await write(path.join(output, 'already-registered.json'), skipped);
const pending = [...unsupported.map(item => ({...item, state: 'observed_ats_requires_configuration_discovery'}))];
const admitted = [];
let identities = {};
try { identities = await read(path.join(output, 'identity-reviews.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const item of groups.values()) {
  let row;
  try { row = await read(path.join(output, item.company_id, 'verification.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  row ||= await verifyCandidate({...item, entry_urls: item.entry_urls.slice(0, 1)}, output, {maxPages: 1, pageSize: 5, timeoutMs: 12000});
  const review = identities[item.company_id];
  if (row.admitted && review?.identity_verified === true && review.official_display_name && review.evidence_file && review.evidence_url && review.industry_tags?.length) {
    await fs.access(review.evidence_file);
    const source=await read(row.capability_source_file||row.source_file);
    const result=await read(row.capability_result_file||row.result_file);
    const full=result.jobs.filter(job=>job.body_complete&&job.job_id&&job.official_url);
    admitted.push({...source,source_id:item.company_id,display_name:review.official_display_name,
      industry_tags:review.industry_tags,category:review.industry_tags[0],aliases:[],
      source_origin:'waiqi-2026-09-20-official-domestic-api',verification_status:'verified_api_full_jd',verified_at:row.checked_at,
      suggested_existing_company_id:review.suggested_existing_company_id||null,merge_group_key:review.merge_group_key||item.company_id,
      identity_review:review,discovery_provenance:item.provenance,
      source_verification:{checked_at:row.checked_at,method:'anonymous_api_full_jd_with_official_identity_review',complete_jd_samples:full.length,
        identity_basis:review.basis,identity_evidence_file:review.evidence_file,proof_directory:path.join(output,item.company_id),
        coverage:result.coverage,scope:'Sample API verification only; current job types and availability require per-job checks'},
      verified_samples:full.slice(0,5).map(job=>({job_id:job.job_id,title:job.title,official_url:job.official_url,raw_file:job.raw_file,body_complete:true})),
    });
  } else pending.push({...row, admitted: false, api_full_jd_verified: !!row.admitted, reason: row.admitted ? 'Full API JD obtained; official recruitment identity still requires human review' : row.reason});
  console.log(JSON.stringify({company_id: item.company_id, hint: item.display_name, api_full_jd_verified: !!row.admitted}));
}
await write(path.join(output, 'admitted.json'), admitted);
await write(path.join(output, 'pending.json'), pending);
const summary = {checked_at: new Date().toISOString(), position_files_scanned: scanned, jobs_scanned: jobCount, observed_domestic_ats_contexts: groups.size, existing_registry_link_occurrences: skipped.length, admitted: admitted.length, pending: pending.length, limitation: 'Only observed Moka, Beisen, Feishu and Hotjob URLs; sample API verification, not full job coverage. Existing saved verification is reused.'};
await write(path.join(output, 'summary.json'), summary);
console.log(JSON.stringify(summary));
