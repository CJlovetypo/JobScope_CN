import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {atsConfiguration} from './discover-waiqi-zero-websites.mjs';
import {recruitmentLink} from './lib/waiqi-utils.mjs';

const DEFAULT_CANDIDATES = path.resolve('datasets/recruitment-links/catalog/waiqi-source-candidates.json');
const DEFAULT_REGISTRY = path.resolve('shared/job-search-core/assets/sources.json');

function sourceRequest(source) {
  return source.validated_api_request_examples?.find(item => /job_list/.test(item.purpose || ''))
    || source.validated_api_request_examples?.[0];
}

export function sourceContextKey(source) {
  const config = source.api_config || {};
  const entry = source.primary_entry_url || source.entry_url;
  let url;
  try { url = new URL(entry); } catch { return null; }
  if (source.provider === 'workday' && config.origin && config.tenant && config.site) {
    return `workday|${new URL(config.origin).origin.toLowerCase()}|${String(config.tenant).toLowerCase()}|${String(config.site).toLowerCase()}`;
  }
  if (source.provider === 'smartrecruiters' && config.company_identifier) {
    return `smartrecruiters|${String(config.company_identifier).toLowerCase()}`;
  }
  if (source.provider === 'greenhouse' && config.board_token) {
    return `greenhouse|${String(config.board_token).toLowerCase()}`;
  }
  if (source.provider === 'oracle_recruiting' && config.origin && config.site) {
    return `oracle_recruiting|${new URL(config.origin).origin.toLowerCase()}|${String(config.site).toLowerCase()}`;
  }
  const request = sourceRequest(source);
  if (source.provider === 'moka') {
    const match = url.pathname.match(/\/(?:campus_apply|campus-recruitment|social-recruitment|apply)\/([^/]+)\/(\d+)/i);
    const org = request?.body?.orgId || match?.[1];
    const site = request?.body?.siteId || match?.[2];
    if (org && site) return `moka|${url.origin.toLowerCase()}|${String(org).toLowerCase()}|${site}`;
  }
  if (source.provider === 'beisen') return `beisen|${url.origin.toLowerCase()}|${request?.body?.PortalId || ''}`;
  if (source.provider === 'feishu') {
    const channel = request?.headers?.['website-path'] || url.pathname.split('/').filter(Boolean)[0] || 'index';
    return `feishu|${url.origin.toLowerCase()}|${String(channel).toLowerCase()}`;
  }
  if (source.provider === 'hotjob') {
    const tenant = entry.match(/SU[\da-f]{24}/i)?.[0] || request?.url?.match(/SU[\da-f]{24}/i)?.[0];
    if (tenant) return `hotjob|${tenant.toLowerCase()}`;
  }
  return `${source.provider}|host|${url.hostname.toLowerCase()}`;
}

function parsedSource(parsed) {
  if (parsed.source) return parsed.source;
  return {
    provider: parsed.provider,
    api_config: parsed.api_config,
    primary_entry_url: parsed.entry_url,
    validated_api_request_examples: parsed.api ? [{...parsed.api, purpose: 'job_list'}] : [],
  };
}

function increment(group, key, jobs, companyId) {
  const item = group.get(key) || {jobs: 0, companies: new Set(), registered_context_jobs: 0, registered_host_jobs: 0};
  item.jobs += jobs;
  item.companies.add(companyId);
  group.set(key, item);
  return item;
}

function serializeGroups(group) {
  return Object.fromEntries([...group].map(([key, value]) => [key, {
    jobs: value.jobs,
    companies: value.companies.size,
    registered_context_jobs: value.registered_context_jobs,
    registered_host_jobs: value.registered_host_jobs,
  }]));
}

function serializeUnregisteredContexts(group) {
  return [...group.values()].map(value => ({
    context_key: value.context_key,
    provider: value.provider,
    jobs: value.jobs,
    companies: value.companies.size,
    company_records: [...value.company_records.values()],
    entry_url: value.entry_url,
    api_config: value.api_config,
    source: value.source,
    example_urls: [...value.example_urls].slice(0, 10),
  })).sort((a, b) => b.jobs - a.jobs || a.context_key.localeCompare(b.context_key));
}

export function auditWaiqiRouting(candidates, registry) {
  const registeredContexts = new Map();
  const registeredHosts = new Set();
  for (const company of registry.companies || []) {
    for (const source of company.recruitment_sources?.length ? company.recruitment_sources : [company]) {
      const key = sourceContextKey(source);
      if (key) {
        const owners = registeredContexts.get(key) || new Set();
        owners.add(company.company_id);
        registeredContexts.set(key, owners);
      }
      try { registeredHosts.add(new URL(source.primary_entry_url).hostname.toLowerCase()); } catch { /* Legacy entry. */ }
    }
  }

  const providers = new Map();
  const hosts = new Map();
  const unregisteredContexts = new Map();
  const companies = [];
  const matchBasis = {
    exact_normalized_name: {companies: 0, jobs: 0},
    tenant_only_requires_review: {companies: 0, jobs: 0},
    unmatched: {companies: 0, jobs: 0},
  };
  const summary = {
    catalog_companies: (candidates.companies || []).length,
    active_companies: 0,
    waiqi_displayed_jobs: 0,
    jobs_with_external_url: 0,
    jobs_without_external_url: 0,
    skill_parseable_url_jobs: 0,
    registered_exact_context_jobs: 0,
    registered_host_jobs: 0,
    active_companies_with_any_registered_context: 0,
    active_companies_fully_context_covered: 0,
  };

  for (const company of candidates.companies || []) {
    const returned = Number(company.returned_position_count || 0);
    summary.waiqi_displayed_jobs += returned;
    if (returned > 0) summary.active_companies++;
    const bases = new Set((company.match_evidence || []).flatMap(item => item.basis || []));
    const basis = bases.has('exact_normalized_name') ? 'exact_normalized_name'
      : bases.has('same_recruitment_tenant_requires_entity_review') ? 'tenant_only_requires_review' : 'unmatched';
    if (returned > 0) {
      matchBasis[basis].companies++;
      matchBasis[basis].jobs += returned;
    }

    let urlJobs = 0;
    let parseableJobs = 0;
    let contextJobs = 0;
    let hostJobs = 0;
    const contexts = new Set();
    const registered = new Set();
    for (const link of company.recruitment_links || []) {
      const jobs = (link.job_ids || []).length;
      const normalized = recruitmentLink(link.url).url;
      if (!normalized) continue;
      urlJobs += jobs;
      let host = 'invalid';
      try { host = new URL(normalized).hostname.toLowerCase(); } catch { /* Count malformed links separately. */ }
      const hostRow = increment(hosts, host, jobs, company.waiqi_company_id);
      const parsed = atsConfiguration(normalized);
      const provider = parsed?.provider || 'unsupported';
      const providerRow = increment(providers, provider, jobs, company.waiqi_company_id);
      const key = parsed ? sourceContextKey(parsedSource(parsed)) : null;
      if (parsed) parseableJobs += jobs;
      if (key) contexts.add(key);
      if (key && registeredContexts.has(key)) {
        contextJobs += jobs;
        registered.add(key);
        providerRow.registered_context_jobs += jobs;
        hostRow.registered_context_jobs += jobs;
      }
      if (key && !registeredContexts.has(key)) {
        const source = parsedSource(parsed);
        const candidate = unregisteredContexts.get(key) || {
          context_key: key,
          provider,
          jobs: 0,
          companies: new Set(),
          company_records: new Map(),
          entry_url: source.primary_entry_url || source.entry_url,
          api_config: source.api_config || {},
          source,
          example_urls: new Set(),
        };
        candidate.jobs += jobs;
        candidate.companies.add(company.waiqi_company_id);
        candidate.company_records.set(company.waiqi_company_id, {
          waiqi_company_id: company.waiqi_company_id,
          display_name: company.display_name,
          jobs: (candidate.company_records.get(company.waiqi_company_id)?.jobs || 0) + jobs,
          source_url: company.source_url,
          website: company.website,
          ownership_hint: company.ownership_hint,
          industry_hint: company.industry_hint,
          matched_company_ids: company.matched_company_ids || [],
          match_evidence: company.match_evidence || [],
        });
        candidate.example_urls.add(normalized);
        unregisteredContexts.set(key, candidate);
      }
      if (registeredHosts.has(host)) {
        hostJobs += jobs;
        providerRow.registered_host_jobs += jobs;
        hostRow.registered_host_jobs += jobs;
      }
    }
    summary.jobs_with_external_url += urlJobs;
    summary.skill_parseable_url_jobs += parseableJobs;
    summary.registered_exact_context_jobs += contextJobs;
    summary.registered_host_jobs += hostJobs;
    if (contextJobs > 0) summary.active_companies_with_any_registered_context++;
    if (returned > 0 && urlJobs === returned && contextJobs === returned) summary.active_companies_fully_context_covered++;
    companies.push({
      waiqi_company_id: company.waiqi_company_id,
      display_name: company.display_name,
      displayed_jobs: returned,
      url_jobs: urlJobs,
      parseable_jobs: parseableJobs,
      registered_exact_context_jobs: contextJobs,
      registered_host_jobs: hostJobs,
      gap_jobs: returned - contextJobs,
      match_basis: basis,
      contexts: [...contexts],
      registered_contexts: [...registered],
    });
  }
  summary.jobs_without_external_url = summary.waiqi_displayed_jobs - summary.jobs_with_external_url;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_checked_at: candidates.checked_at || null,
    summary,
    match_basis: matchBasis,
    by_provider: serializeGroups(providers),
    unregistered_parseable_contexts: serializeUnregisteredContexts(unregisteredContexts),
    top_uncovered_hosts: Object.entries(serializeGroups(hosts))
      .sort((a, b) => (b[1].jobs - b[1].registered_context_jobs) - (a[1].jobs - a[1].registered_context_jobs))
      .slice(0, 100),
    top_company_gaps: companies.sort((a, b) => b.gap_jobs - a.gap_jobs).slice(0, 200),
    policy: 'Exact context means the skill has the same public ATS tenant configuration. Host-only matches are leads. Neither proves company identity or that a Waiqi row is still open; live official-list verification remains mandatory.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = Object.fromEntries(args.filter(item => item.startsWith('--') && item.includes('=')).map(item => {
    const index = item.indexOf('=');
    return [item.slice(2, index), item.slice(index + 1)];
  }));
  const candidatesFile = path.resolve(options.candidates || DEFAULT_CANDIDATES);
  const registryFile = path.resolve(options.registry || DEFAULT_REGISTRY);
  const output = options.output ? path.resolve(options.output) : null;
  const report = auditWaiqiRouting(
    JSON.parse(await fs.readFile(candidatesFile, 'utf8')),
    JSON.parse(await fs.readFile(registryFile, 'utf8')),
  );
  if (output) {
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({output, ...report.summary, source_checked_at: report.source_checked_at}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
