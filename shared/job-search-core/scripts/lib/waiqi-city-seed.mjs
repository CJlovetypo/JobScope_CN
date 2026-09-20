import {reviewRecruitment} from './recruitment-policy.mjs';
import {reviewJobBody} from './body-review.mjs';
import {reconcileTargetJob} from './target-api-proof.mjs';
import {normalizeJobLocations} from './locations.mjs';
import {mergeSourceResults, sourceConfigFingerprint} from './source-collector.mjs';
import {refreshedCityTag, compactCityTag} from './city-index.mjs';

export function officialArchivedJob(job) {
  if (job.job_id == null || !job.raw_file || !job.official_url) return false;
  try { const url = new URL(job.official_url); return ['http:', 'https:'].includes(url.protocol) && !/(?:^|\.)(waiqi\.com|offerxiansheng\.com)$/.test(url.hostname); } catch { return false; }
}

export function seedCompanyCityTag(company, observations, previous, mode, resultFile) {
  const prepared = observations.map(({source, result}) => {
    const bound = {...source, company_id: company.company_id, display_name: company.display_name};
    return {source: bound, result: {...result, jobs: (result.jobs || []).filter(officialArchivedJob).map(raw => {
      // This remap uses the reviewed source-owner plan, never a Waiqi name match.
      let job = {...raw, archive_company_id: raw.company_id, company_id: company.company_id};
      job = reviewRecruitment(job, mode);
      if (!job.body_complete && !['manual_full_record_review', 'model_full_available_body_and_local_evidence_review'].includes(job.body_review?.method)) job = reviewJobBody(job);
      job = reconcileTargetJob(job, bound, mode);
      const loc = normalizeJobLocations(job);
      return {...job, company_name: company.display_name, cities: loc.cities, location_special: loc.special,
        location_unresolved: loc.unresolved, location_unknown: loc.unknown, location_code_evidence: loc.code_evidence,
        location_structured_evidence: loc.structured_evidence || [], location_description_evidence: loc.description_evidence,
        location_title_evidence: loc.title_evidence || [], locations_raw: loc.raw};
    })}};
  });
  const result = mergeSourceResults(company, prepared, {mode: 'full', targetMode: mode});
  const dates = observations.map(x => x.result.checked_at).filter(x => Number.isFinite(Date.parse(x))).sort();
  result.checked_at = dates.at(-1) || null;
  result.coverage = {...result.coverage, status: 'partial', collection_complete: false,
    scope: 'Offline seed from archived verified official API jobs; historical observations, not a live refresh or exhaustive company inventory',
    reason: 'Only archived official jobs observed during Waiqi source verification; existing cities retained; no Waiqi city hints used'};
  const fingerprint = sourceConfigFingerprint(company, mode);
  let tag = refreshedCityTag(company, result, previous, {mode, fingerprint, resultFile});
  // Keep historical evidence as well as historical cities when adding a partial sample.
  const evidence = new Map([...(previous?.city_evidence || []), ...(tag.city_evidence || [])].map(row => [JSON.stringify([row.raw_file, row.job_id, row.cities]), row]));
  tag = compactCityTag({...previous, ...tag, city_evidence: [...evidence.values()],
    city_evidence_total: Math.max(previous?.city_evidence_total || 0, tag.city_evidence_total || 0, evidence.size),
    city_freshness: !tag.cities.length ? 'unknown' : tag.city_freshness,
    seed_origin: 'waiqi_official_api_archive', seed_observation_files: [...new Set(observations.map(x => x.file).filter(Boolean))]});
  const needsUpdate = !previous || fingerprint !== previous.source_config_fingerprint || tag.cities.some(city => !previous.cities?.includes(city));
  return {tag, result, needsUpdate};
}
