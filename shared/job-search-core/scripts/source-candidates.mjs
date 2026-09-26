import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const DEFAULT_CANDIDATES = fileURLToPath(new URL('../../../datasets/recruitment-links/catalog/waiqi-source-candidates.json', import.meta.url));
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
const contains = (values, query) => !query || list(values).some(value => norm(value).includes(norm(query)));

export function recruitmentUrls(company) {
  return [...new Set(list(company.recruitment_links).map(link => typeof link === 'string' ? link : link?.url).filter(url => {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }))];
}

export function queryCandidates(dataset, filters = {}) {
  if (!Array.isArray(dataset?.companies)) throw new Error('Candidate dataset must contain a companies array');
  return dataset.companies.filter(company => {
    const searchable = [company.display_name, ...list(company.aliases), company.waiqi_company_id,
      ...list(company.industry_hint), ...list(company.ownership_hint), ...list(company.matched_company_ids)];
    return contains(searchable, filters.query)
      && contains(company.industry_hint, filters.industry)
      && contains(company.ownership_hint, filters.ownership)
      && (!filters.status || company.status === filters.status)
      && (!filters.companyId || list(company.matched_company_ids).includes(filters.companyId))
      && (!filters.hasRecruitment || recruitmentUrls(company).length > 0);
  });
}

export function discoveryCandidates(companies) {
  return companies.filter(company => recruitmentUrls(company).length).map(company => {
    const id = String(company.waiqi_company_id ?? '');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Missing or unsafe waiqi_company_id: ' + id);
    return {
      company_id: 'waiqi-' + id,
      display_name: company.display_name,
      industry_tags: [],
      entry_urls: recruitmentUrls(company),
      provenance: {
        dataset: 'waiqi-source-candidates', waiqi_company_id: company.waiqi_company_id,
        source_url: company.source_url, status: company.status,
        industry_hint: company.industry_hint, ownership_hint: company.ownership_hint,
        matched_company_ids: list(company.matched_company_ids),
        identity_verified: false,
      },
    };
  });
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...flags] = args;
  if (!['query', 'export-discovery'].includes(command)) throw new Error('Usage: source-candidates.mjs query|export-discovery [--query=名称] [--industry=行业] [--ownership=性质] [--status=状态] [--company-id=ID] [--has-recruitment] [--input=候选库.json] [--output=输出.json]');
  const options = {};
  const allowed = new Set(['query', 'industry', 'ownership', 'status', 'company-id', 'input', 'output']);
  for (const flag of flags) {
    if (flag === '--has-recruitment') { options.hasRecruitment = true; continue; }
    const match = flag.match(/^--([^=]+)=(.+)$/);
    if (!match || !allowed.has(match[1])) throw new Error('Unknown or empty option: ' + flag);
    options[match[1]] = match[2];
  }
  const input = path.resolve(options.input || DEFAULT_CANDIDATES);
  const dataset = JSON.parse(await fs.readFile(input, 'utf8'));
  const selected = queryCandidates(dataset, {...options, companyId: options['company-id']});
  const output = command === 'export-discovery' ? discoveryCandidates(selected) : {
    source: input, total_candidates: dataset.companies.length, matched_candidates: selected.length,
    candidates_with_recruitment_links: selected.filter(company => recruitmentUrls(company).length).length,
    companies: selected,
  };
  if (options.output) {
    const destination = path.resolve(options.output);
    // This maintenance command never replaces the candidate registry or admitted API registry.
    if (destination.toLowerCase() === input.toLowerCase() || ['sources.json', 'waiqi-source-candidates.json'].includes(path.basename(destination).toLowerCase())) throw new Error('Output must not overwrite a source registry');
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({output: destination, matched_candidates: selected.length, exported_candidates: command === 'export-discovery' ? output.length : selected.length}));
  } else console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
