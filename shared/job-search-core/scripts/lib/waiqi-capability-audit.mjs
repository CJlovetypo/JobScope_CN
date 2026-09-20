import {sourceKey} from './waiqi-integration.mjs';
import {zeroJobCapability} from './waiqi-zero-source-policy.mjs';

const present = value => typeof value === 'string' && value.trim().length > 0;
const array = value => Array.isArray(value) ? value : [];
const get = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);

const contracts = {
  workday: {items: ['jobPostings'], totals: ['total']},
  greenhouse: {items: ['jobs'], totals: ['meta.total']},
  smartrecruiters: {items: ['content'], totals: ['totalFound', 'total']},
  oracle_recruiting: {items: ['items'], totals: ['totalResults', 'count']},
  beisen: {items: ['Data'], totals: ['Count', 'Total']},
  feishu: {items: ['data.job_post_list'], totals: ['data.count']},
  moka: {items: ['data.jobs'], totals: ['data.jobStats.total']},
  moka_api_platform: {items: ['jobs', 'data.jobs'], totals: ['total', 'data.total']},
  hotjob: {items: ['data.pageForm.pageData'], totals: ['data.pageForm.dataCount', 'data.positonNum']},
};

export function formalSourceFromDiscovery(candidate) {
  const request = candidate.api_request || array(candidate.api_requests).find(item => /job_list|public_job_list/.test(item.purpose || ''));
  return {
    company_id: `waiqi-${candidate.waiqi_company_id}`,
    display_name: candidate.display_name,
    provider: candidate.provider,
    primary_entry_url: candidate.entry_url,
    ...(candidate.api_config ? {api_config: structuredClone(candidate.api_config)} : {}),
    validated_api_request_examples: request ? [{
      url: request.url,
      method: request.method || 'GET',
      ...(request.headers ? {headers: structuredClone(request.headers)} : {}),
      body: request.body ?? null,
      purpose: 'job_list',
    }] : [],
  };
}

function completeJdSamples(candidate) {
  const explicit = candidate.source_verification?.complete_jd_samples ?? candidate.api_verification?.complete_mainland_jds;
  if (Number.isInteger(explicit)) return explicit;
  return array(candidate.verified_samples).filter(sample => sample?.body_complete === true && present(sample.job_id) && present(sample.official_url)).length;
}

function comparable(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/(?:incorporated|corporation|company|limited|ltd|llc|plc|holdings?|group|股份有限公司|有限责任公司|有限公司|集团)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function namesAgree(left, right) {
  const a = comparable(left), b = comparable(right);
  return !!a && !!b && (a === b || Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

function returnedIdentityNames(provider, payload, items) {
  const values = [];
  const take = value => { if (present(value)) values.push(value.trim()); };
  if (provider === 'greenhouse') for (const item of items) take(item?.company_name);
  if (provider === 'smartrecruiters') for (const item of items) { take(item?.company?.name); take(item?.companyName); }
  // Beisen Org and Oracle OrganizationName commonly identify a department or
  // requisition organization rather than the legal employer. They remain in
  // raw evidence and must not create an automatic identity decision.
  take(payload?.company?.name); take(payload?.organization?.name);
  return [...new Set(values)];
}

function listObservation(candidate, payload) {
  const contract = contracts[candidate.provider];
  if (!contract || !payload || typeof payload !== 'object') return {problem: 'provider has no reviewed list-response contract'};
  const itemPath = contract.items.find(path => Array.isArray(get(payload, path)));
  if (!itemPath) return {problem: 'response does not contain the reviewed job-list array'};
  const items = get(payload, itemPath);
  const totalValue = contract.totals.map(path => get(payload, path)).find(value => value !== undefined && value !== null && Number.isFinite(Number(value)));
  const total = totalValue === undefined ? null : Number(totalValue);
  if (total !== null && total < items.length) return {problem: 'reported total is smaller than returned list'};
  return {items, itemPath, total, returnedIdentityNames: returnedIdentityNames(candidate.provider, payload, items)};
}

function listRecord(candidate) {
  return array(candidate.api_requests).find(record => /job_list|public_job_list/.test(record.purpose || '') && record.http_status >= 200 && record.http_status < 300);
}

export async function auditDiscoveryCandidates(candidates, registry, loadResponse) {
  const existing = new Map();
  for (const company of registry.companies || []) for (const source of company.recruitment_sources?.length ? company.recruitment_sources : [company]) {
    try {
      const key = sourceKey(source);
      if (!existing.has(key)) existing.set(key, []);
      existing.get(key).push({company_id: company.company_id, display_name: company.display_name, source_id: source.source_id});
    } catch { /* Legacy incomplete entries do not define a reusable source key. */ }
  }
  const groups = new Map(), invalid = [];
  for (const candidate of candidates) {
    try {
      const source = formalSourceFromDiscovery(candidate), key = sourceKey(source);
      if (!groups.has(key)) groups.set(key, {key, source, candidates: []});
      groups.get(key).candidates.push(candidate);
    } catch (error) {
      invalid.push({waiqi_company_id: candidate.waiqi_company_id, display_name: candidate.display_name, reason: error.message});
    }
  }
  const rows = [];
  for (const group of groups.values()) {
    const observations = [];
    for (const candidate of group.candidates) {
      const record = listRecord(candidate);
      if (!record || record.response_is_json !== true || !present(record.response_sha256) || /text\/html/i.test(record.content_type || '')) {
        observations.push({candidate, problem: 'missing anonymous JSON list-response evidence'}); continue;
      }
      try {
        const payload = await loadResponse(record.decoded_response_file || record.response_file);
        observations.push({candidate, record, ...listObservation(candidate, payload)});
      } catch (error) { observations.push({candidate, problem: error.message}); }
    }
    const valid = observations.filter(item => !item.problem);
    const positive = valid.filter(item => item.items.length > 0 || item.total > 0);
    const empty = valid.filter(item => item.items.length === 0 && (item.total === null || item.total === 0));
    const returnedNames = [...new Set(valid.flatMap(item => item.returnedIdentityNames || []))];
    const hints = [...new Set(group.candidates.map(item => item.display_name).filter(present))];
    const identityConflict = returnedNames.length > 0 && !hints.some(hint => returnedNames.some(name => namesAgree(hint, name)));
    const conflicts = [];
    if (hints.length > 1) conflicts.push('multiple_waiqi_identity_hints_share_source_key');
    if (identityConflict) conflicts.push('returned_employer_differs_from_waiqi_identity_hint');
    if (positive.length && empty.length) conflicts.push('inconsistent_positive_and_empty_observations');
    const maxSamples = Math.max(0, ...group.candidates.map(completeJdSamples));
    let capability_state = 'unverified_pending';
    let zeroCapability = null;
    if (positive.length) capability_state = maxSamples > 0 ? 'positive_full_jd_reviewable' : 'positive_list_only_pending_full_jd';
    else if (empty.length) {
      const observation = empty[0], record = {...observation.record, purpose: 'job_list'};
      const result = {
        checked_at: record.checked_at,
        jobs: [], requests: [record],
        coverage: {status: 'complete', jobs_observed: 0, pages: 1, list_complete: true,
          contexts: [{status: 'complete', jobs_observed: 0, pages: 1, list_complete: true}],
          page_evidence: [{request_index: record.index, job_ids: [], server_total: observation.total}]},
      };
      const inspected = zeroJobCapability(group.source, result, {listItemsPath: observation.itemPath});
      if (inspected.capability) { capability_state = 'zero_api_pending_identity'; zeroCapability = inspected.capability; }
      else conflicts.push('zero_policy_rejected:' + inspected.problem);
    }
    rows.push({
      source_key: group.key,
      provider: group.source.provider,
      primary_entry_url: group.source.primary_entry_url,
      api_config: group.source.api_config || null,
      validated_api_request_examples: group.source.validated_api_request_examples,
      waiqi_company_ids: [...new Set(group.candidates.map(item => item.waiqi_company_id))],
      waiqi_identity_hints: hints,
      matched_company_id_hints: [...new Set(group.candidates.flatMap(item => array(item.matched_company_ids)))],
      returned_identity_names: returnedNames,
      automatic_identity_hints: group.candidates.map(item => item.identity_evidence || null),
      identity_review_required: true,
      identity_review_status: 'pending',
      identity_conflict: identityConflict,
      admission_blocked_reason: identityConflict ? 'Automatic discovery followed a link to a different employer; confirm the API employer and never admit it under the Waiqi company.' : null,
      capability_state,
      complete_jd_samples: maxSamples,
      zero_job_capability: zeroCapability,
      existing_sources: existing.get(group.key) || [],
      source_key_already_registered: existing.has(group.key),
      warnings: conflicts,
      evidence: observations.map(item => ({waiqi_company_id: item.candidate.waiqi_company_id, response_file: item.record?.response_file || null,
        response_sha256: item.record?.response_sha256 || null, list_items_path: item.itemPath || null, returned_items: item.items?.length ?? null,
        reported_total: item.total ?? null, problem: item.problem || null})),
      review: {decision: null, official_name: null, company_id: null, identity_basis: null, identity_evidence_file: null, industry_tags: []},
    });
  }
  return {rows, invalid};
}
