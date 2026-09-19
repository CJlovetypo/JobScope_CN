import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readJson, writeJson, workspacePath} from './io.mjs';

// Full source text belongs in process storage, never in the reader's workbook.
// JSONL preserves long text, newlines, recruitment fields and string IDs without
// Excel cell limits. Raw API responses continue to live under raw/.
export async function writeJdArchive(dir) {
  dir = workspacePath(dir);
  const run = await readJson(path.join(dir, 'run.json'));
  const file = path.join(dir, 'archive', 'jd-originals.jsonl');
  const coverageFile = path.join(dir, 'archive', 'source-coverage.json');
  const indexFile = path.join(dir, 'archive', 'archive-index.json');
  const inputs = await Promise.all(run.companies.map(async company => {
    const source = path.join(dir, 'companies', company.company_id + '.json');
    const stat = await fs.stat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    return {company, source, stat};
  }));
  const signature = createHash('sha256').update(JSON.stringify(inputs.map(({company, stat}) =>
    [company.company_id, company.display_name, stat?.size, stat?.mtimeMs]))).digest('hex');
  const previous = await readJson(indexFile, null);
  const exists = async target => fs.stat(target).then(() => true).catch(() => false);
  if (previous?.schema_version === 2 && previous.input_signature === signature && await exists(file) && await exists(coverageFile)) {
    return {file, records: previous.records, coverage_file: coverageFile, reused: true, format: 'jsonl', lookup_keys: ['company_id', 'job_id']};
  }
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.tmp';
  const handle = await fs.open(temporary, 'w');
  let records = 0;
  const coverage = {};
  try {
    for (const {company, source, stat} of inputs) {
      const data = stat ? await readJson(source) : null;
      if (data) coverage[company.company_id] = {checked_at: data.checked_at, coverage: data.coverage};
      for (const job of data?.jobs || []) {
        // Page evidence contains all job IDs and must not be repeated for every JD.
        const summary = Object.fromEntries(['status', 'list_complete', 'jobs_observed', 'server_total']
          .filter(key => data.coverage?.[key] !== undefined).map(key => [key, data.coverage[key]]));
        await handle.writeFile(JSON.stringify({...job, schema_version: 2,
          company_id: company.company_id, company_name: company.display_name, job_id: String(job.job_id),
          checked_at: data.checked_at, source_coverage: summary,
          source_coverage_ref: {file: 'source-coverage.json', company_id: company.company_id}}) + '\n', 'utf8');
        records++;
      }
    }
  } finally { await handle.close(); }
  await writeJson(coverageFile, {schema_version: 1, companies: coverage});
  await fs.rename(temporary, file);
  await writeJson(indexFile, {schema_version: 2, input_signature: signature, records, updated_at: new Date().toISOString()});
  return {file, records, coverage_file: coverageFile, reused: false, format: 'jsonl', lookup_keys: ['company_id', 'job_id']};
}
