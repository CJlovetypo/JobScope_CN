const present = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
const http = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

export const ZERO_JOB_VERIFICATION_STATUS = 'verified_api_zero_jobs';

const listPaths = {
  moka: 'data.jobs',
  moka_api_platform: 'jobs|data.jobs',
  beisen: 'Data',
  feishu: 'data.job_post_list',
  hotjob: 'data.pageForm.pageData',
};

function sensitiveRequestMaterial(request) {
  if (!request || typeof request !== 'object') return true;
  if (Object.keys(request.headers || {}).some(key => /^(cookie|authorization|proxy-authorization)$/i.test(key))) return true;
  try { const url = new URL(request.url); if (url.username || url.password) return true; } catch { return true; }
  return false;
}

/**
 * Turn a completed collector result into auditable zero-job API evidence.
 * This proves only anonymous API capability. Corporate identity is deliberately
 * reviewed separately before integration.
 */
export function zeroJobCapability(source, result, {listItemsPath} = {}) {
  if (!source || !present(source.provider)) return {problem: 'missing source provider'};
  if (!Array.isArray(result?.jobs) || result.jobs.length !== 0) return {problem: 'collection is not an empty job result'};
  const contexts = Array.isArray(result.coverage?.contexts) && result.coverage.contexts.length ? result.coverage.contexts : [result.coverage];
  if (result.coverage?.status !== 'complete' || !contexts[0]) return {problem: 'empty list coverage is not complete'};
  if (contexts.some(context => context.list_complete !== true || !Number.isInteger(context.pages) || context.pages < 1 || context.jobs_observed !== 0)) {
    return {problem: 'empty list did not reach a reconciled API end state'};
  }
  const pages = result.coverage?.page_evidence;
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page.job_ids) || page.job_ids.length !== 0
    || page.server_total !== null && Number(page.server_total) !== 0)) return {problem: 'list-page evidence is not an actual zero-job response'};
  if (pages.length !== contexts.reduce((count, context) => count + context.pages, 0)) return {problem: 'list-page evidence does not cover every checked page'};
  const requestIndexes = new Set(pages.map(page => page.request_index));
  const requests = (result.requests || []).filter(request => request.purpose === 'job_list' && requestIndexes.has(request.index));
  if (!requests.length) return {problem: 'missing job-list request evidence'};
  for (const request of requests) {
    if (sensitiveRequestMaterial(request)) return {problem: 'job-list evidence contains credentials'};
    if (request.anonymous_session_from_scratch !== true) return {problem: 'job-list request was not made in a fresh anonymous session'};
    if (!Number.isInteger(request.http_status) || request.http_status < 200 || request.http_status >= 300) return {problem: 'job-list request was not successful'};
    if (request.response_is_json !== true || /text\/html/i.test(request.content_type || '')) return {problem: 'job-list response is not JSON API data'};
    if (!sha256(request.response_sha256) || !present(request.response_file)) return {problem: 'job-list response lacks immutable evidence'};
    if (!Array.isArray(request.response_schema_keys) || !request.response_schema_keys.length) return {problem: 'job-list response lacks a stable JSON schema signature'};
  }
  const path = listPaths[source.provider] || listItemsPath;
  if (!path) return {problem: 'provider has no reviewed zero-job list contract'};
  const schemaKeys = [...new Set(requests.flatMap(request => request.response_schema_keys))].sort();
  if (!path.split('|').some(candidate => schemaKeys.includes(candidate))) return {problem: 'JSON schema does not contain the reviewed job-list path'};
  return {capability: {
    anonymous: true,
    credentials_used: false,
    response_format: 'json',
    list_contract_verified: true,
    list_items_path: path,
    jobs_observed: 0,
    list_complete: true,
    pages_checked: contexts.reduce((count, context) => count + context.pages, 0),
    schema_keys: schemaKeys,
    request_evidence: requests.map(request => ({
      method: request.method,
      url: request.url,
      purpose: request.purpose,
      http_status: request.http_status,
      content_type: request.content_type,
      response_is_json: true,
      response_sha256: request.response_sha256,
      response_file: request.response_file,
      anonymous_session_from_scratch: true,
    })),
  }};
}

export function zeroJobCandidateProblem(candidate) {
  const verification = candidate?.source_verification;
  const capability = verification?.zero_job_capability;
  const identity = candidate?.identity_verification;
  const checkedAt = candidate?.verified_at || verification?.checked_at;
  if (candidate?.verification_status !== ZERO_JOB_VERIFICATION_STATUS) return 'wrong zero-job verification status';
  if (!present(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) return 'missing valid API verification date';
  if (candidate.admitted !== true) return 'zero-job source was not explicitly admitted';
  if (!present(verification?.proof_directory) || !present(verification?.identity_basis)) return 'missing zero-job proof location or identity basis';
  if (verification.observed_jobs !== 0 || verification.complete_jd_samples !== 0) return 'zero-job counts are inconsistent';
  if (identity?.identity_verified !== true || !present(identity.official_name) || !present(identity.evidence_file) || !present(identity.basis)) {
    return 'missing reviewed official corporate identity evidence';
  }
  if (!capability || capability.anonymous !== true || capability.credentials_used !== false || capability.response_format !== 'json'
    || capability.list_contract_verified !== true || capability.jobs_observed !== 0 || capability.list_complete !== true
    || !present(capability.list_items_path) || !Number.isInteger(capability.pages_checked) || capability.pages_checked < 1) {
    return 'missing reviewed anonymous zero-job list capability';
  }
  if (!Array.isArray(capability.schema_keys) || !capability.schema_keys.length) return 'missing zero-job JSON schema signature';
  if (!Array.isArray(capability.request_evidence) || !capability.request_evidence.length) return 'missing zero-job request evidence';
  for (const request of capability.request_evidence) {
    if (sensitiveRequestMaterial(request) || request.purpose !== 'job_list' || request.anonymous_session_from_scratch !== true
      || request.response_is_json !== true || /text\/html/i.test(request.content_type || '')
      || !Number.isInteger(request.http_status) || request.http_status < 200 || request.http_status >= 300
      || !sha256(request.response_sha256) || !present(request.response_file)) return 'invalid anonymous zero-job request evidence';
  }
  const examples = candidate.validated_api_request_examples;
  if (!Array.isArray(examples) || !examples.some(request => /job_list/.test(request.purpose || '') && http(request.url) && !sensitiveRequestMaterial(request))) {
    return 'missing replayable anonymous job-list request';
  }
  return null;
}

export function prepareZeroJobCandidate({source, result, review, proofDirectory}) {
  const inspected = zeroJobCapability(source, result, {listItemsPath: review?.list_items_path});
  if (inspected.problem) throw Error(inspected.problem);
  if (!review || review.identity_verified !== true || !present(review.official_name) || !present(review.evidence_file) || !present(review.basis)) {
    throw Error('reviewed official identity is required');
  }
  if (!Array.isArray(review.industry_tags) || !review.industry_tags.length) throw Error('reviewed industry tags are required');
  const checkedAt = result.checked_at;
  if (!present(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) throw Error('collection has no valid checked_at');
  return {
    ...structuredClone(source),
    company_id: review.company_id || source.company_id,
    display_name: review.official_name,
    aliases: review.aliases || [],
    industry_tags: [...review.industry_tags],
    admitted: true,
    verification_status: ZERO_JOB_VERIFICATION_STATUS,
    verified_at: checkedAt,
    identity_verification: {
      identity_verified: true,
      official_name: review.official_name,
      evidence_file: review.evidence_file,
      basis: review.basis,
    },
    source_verification: {
      checked_at: checkedAt,
      method: 'anonymous_official_list_api_zero_jobs_with_explicit_employer_review',
      complete_jd_samples: 0,
      observed_jobs: 0,
      proof_directory: proofDirectory,
      identity_basis: review.basis,
      zero_job_capability: inspected.capability,
    },
    ...(review.suggested_existing_company_id ? {suggested_existing_company_id: review.suggested_existing_company_id} : {}),
    ...(review.merge_group_key ? {merge_group_key: review.merge_group_key} : {}),
    ...(review.suggested_group_display_name ? {suggested_group_display_name: review.suggested_group_display_name} : {}),
  };
}
