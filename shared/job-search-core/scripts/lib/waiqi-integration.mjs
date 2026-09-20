const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const present = value => typeof value === 'string' && value.trim().length > 0;
const http = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

export function sourceKey(source) {
  const a = source.api_config || {};
  switch (source.provider) {
    case 'workday':
      if (!http(a.origin) || !present(a.tenant) || !present(a.site)) throw Error('incomplete Workday tenant configuration');
      // Hostnames are insensitive to case; tenant/site are URL path components.
      return JSON.stringify(['workday', new URL(a.origin).origin, a.tenant, a.site]);
    case 'smartrecruiters':
      if (!present(a.company_identifier)) throw Error('missing SmartRecruiters company identifier');
      return 'smartrecruiters|' + a.company_identifier.toLowerCase();
    case 'greenhouse':
      if (!present(a.board_token)) throw Error('missing Greenhouse board token');
      return 'greenhouse|' + a.board_token.toLowerCase();
    case 'oracle_recruiting':
      if (!http(a.origin) || !present(a.site)) throw Error('incomplete Oracle Recruiting site configuration');
      return JSON.stringify(['oracle_recruiting', new URL(a.origin).origin.toLowerCase(), a.site.toLowerCase()]);
    case 'hotjob': {
      const tenant = a.tenant || (http(source.primary_entry_url) ? new URL(source.primary_entry_url).pathname.match(/\/(SU[a-zA-Z0-9]+)/)?.[1] : null);
      if (!present(tenant)) throw Error('missing Hotjob tenant');
      return 'hotjob|' + tenant.toLowerCase();
    }
    case 'moka': {
      if (!http(source.primary_entry_url)) throw Error('missing Moka entry URL');
      const entry = new URL(source.primary_entry_url), route = entry.pathname.match(/\/(campus-recruitment|social-recruitment|campus_apply|social_apply|apply)\/([^/]+)\/([^/]+)/);
      const listBody = source.validated_api_request_examples?.find(q => /job_list/.test(q.purpose || ''))?.body || {};
      const channel = a.channel || route?.[1] || listBody.site, org = a.org_id || a.orgId || route?.[2] || listBody.orgId, site = a.site_id || a.siteId || route?.[3] || listBody.siteId;
      if (!present(channel) || !present(org) || !present(site)) throw Error('incomplete Moka route configuration');
      return JSON.stringify(['moka', entry.origin.toLowerCase(), channel.toLowerCase(), org.toLowerCase(), String(site).toLowerCase()]);
    }
    default:
      if (!present(source.provider) || !http(source.primary_entry_url)) throw Error('missing provider or HTTP entry URL');
      return JSON.stringify(canonical([source.provider, source.primary_entry_url, source.validated_api_request_examples?.filter(q => /job_list/.test(q.purpose)).map(q => [q.url, q.body])]));
  }
}

function candidateProblem(c, tags) {
  const zeroJob = c.verification_status === ZERO_JOB_VERIFICATION_STATUS;
  const samples = c.source_verification?.complete_jd_samples ?? c.api_verification?.complete_mainland_jds;
  const identity = c.source_verification?.identity_basis || c.identity_verification?.evidence_file;
  const evidence = c.source_verification?.proof_directory || c.api_verification?.evidence_file;
  const verifiedAt = c.verified_at || c.api_verified_at || c.source_verification?.checked_at;
  if (zeroJob) {
    const problem = zeroJobCandidateProblem(c);
    if (problem) return problem;
  } else if (!Number.isInteger(samples) || samples < 1 || !present(identity) || !present(evidence)) return 'missing complete JD / identity evidence / proof location';
  if (!present(verifiedAt) || !Number.isFinite(Date.parse(verifiedAt))) return 'missing valid API verification date';
  if (c.admitted === false || c.identity_verification?.identity_verified === false || c.verification_status && !['verified_api_full_jd', ZERO_JOB_VERIFICATION_STATUS].includes(c.verification_status)) return 'source explicitly not verified';
  if (!present(c.company_id) || !present(c.display_name) || !http(c.primary_entry_url)) return 'missing company ID, display name or HTTP entry';
  if (!Array.isArray(c.industry_tags) || !c.industry_tags.length || c.industry_tags.some(t => !tags.has(t))) return 'missing valid industry routing';
  if (!Array.isArray(c.validated_api_request_examples) || !c.validated_api_request_examples.some(q => http(q.url))) return 'missing verified API request configuration';
  return null;
}

export function planWaiqiIntegration(original, inputs, industryIds) {
  const registry = structuredClone(original), companies = new Map(registry.companies.map(c => [c.company_id, c]));
  const tags = new Set(industryIds), allKeys = new Map(), rejected = [], added = [], skipped = [], groups = new Map();
  const addOwner = (key, id) => { if (!allKeys.has(key)) allKeys.set(key, new Set()); allKeys.get(key).add(id); };
  for (const c of companies.values()) for (const s of c.recruitment_sources?.length ? c.recruitment_sources : [c]) {
    try { addOwner(sourceKey(s), c.company_id); } catch { /* Preserve legacy sources even if their config is incomplete. */ }
  }
  // Only verified candidates may influence identity resolution. Resolve the whole
  // group before adding anything, so an existing source later in the input wins.
  for (const input of inputs) {
    const c = input.item;
    let problem = candidateProblem(c, tags), key;
    if (!problem) try { key = sourceKey(c); } catch (error) { problem = error.message; }
    if (problem) { rejected.push({name: c.display_name, file: input.file, reason: problem}); continue; }
    const groupKey = c.merge_group_key ? 'group:' + c.merge_group_key : 'company:' + c.company_id;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({...input, key});
  }
  for (const entries of groups.values()) {
    const owners = new Set(), problems = [];
    for (const {item: c, key} of entries) {
      for (const owner of allKeys.get(key) || []) owners.add(owner);
      if (c.suggested_existing_company_id) {
        if (!companies.has(c.suggested_existing_company_id)) problems.push('suggested company ID does not exist: ' + c.suggested_existing_company_id);
        else owners.add(c.suggested_existing_company_id);
      }
    }
    if (owners.size > 1) problems.push('group resolves to conflicting existing IDs: ' + [...owners].join(', '));
    const id = [...owners][0] || entries[0].item.company_id;
    const groupNames = [...new Set(entries.map(x => x.item.suggested_group_display_name).filter(present))];
    if (groupNames.length > 1) problems.push('conflicting reviewed group display names: ' + groupNames.join(', '));
    if (!owners.size && companies.has(id)) problems.push('company ID already exists without a reviewed identity association: ' + id);
    if (problems.length) {
      for (const {item: c, file} of entries) rejected.push({name: c.display_name, file, reason: problems.join('; ')});
      continue;
    }
    for (const {item: c, file, key} of entries) {
      if (allKeys.has(key)) { skipped.push({name: c.display_name, company_id: id, key}); continue; }
      let company = companies.get(id);
      const isNew = !company;
      const source = {...structuredClone(c), company_id: id, display_name: c.display_name, verification_status: c.verification_status || 'verified_api_full_jd', verified_at: c.verified_at || c.api_verified_at || c.source_verification?.checked_at};
      for (const key of ['recruitment_sources', 'suggested_existing_company_id', 'suggested_group_display_name', 'merge_group_key', 'verified_samples']) delete source[key];
      if (source.source_verification?.coverage) delete source.source_verification.coverage.page_evidence;
      if (source.api_verification?.coverage) { delete source.api_verification.coverage.page_evidence; delete source.api_verification.coverage.excluded_location_rows; }
      if (!company) {
        company = {...source, display_name: groupNames[0] || c.display_name, aliases: c.aliases || [], industry_tags: [...c.industry_tags], recruitment_sources: [source]};
        companies.set(id, company); registry.companies.push(company);
      } else {
        if (!company.recruitment_sources?.length) { const old = {...company}; delete old.recruitment_sources; old.source_id ||= '0'; company.recruitment_sources = [old]; }
        company.recruitment_sources.push(source);
        company.industry_tags = [...new Set([...(company.industry_tags || []), ...c.industry_tags])];
      }
      addOwner(key, id);
      added.push({company_id: id, display_name: company.display_name, source_id: source.source_id, provider: source.provider, entry: source.primary_entry_url, new_company: isNew, input_file: file});
    }
  }
  return {registry, added, skipped, rejected};
}
import {ZERO_JOB_VERIFICATION_STATUS, zeroJobCandidateProblem} from './waiqi-zero-source-policy.mjs';
