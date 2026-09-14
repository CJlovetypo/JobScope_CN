import fs from 'node:fs/promises';
import path from 'node:path';
import {readJson, workspacePath} from './io.mjs';

// Full source text belongs in process storage, never in the reader's workbook.
// JSONL preserves long text, newlines, recruitment fields and string IDs without
// Excel cell limits. Raw API responses continue to live under raw/.
export async function writeJdArchive(dir) {
  dir = workspacePath(dir);
  const run = await readJson(path.join(dir, 'run.json'));
  const file = path.join(dir, 'archive', 'jd-originals.jsonl');
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.tmp';
  const handle = await fs.open(temporary, 'w');
  let records = 0;
  try {
    for (const company of run.companies) {
      const data = await readJson(path.join(dir, 'companies', company.company_id + '.json'), null);
      for (const job of data?.jobs || []) {
        await handle.writeFile(JSON.stringify({schema_version: 1, ...job,
          company_id: company.company_id, company_name: company.display_name, job_id: String(job.job_id),
          checked_at: data.checked_at, source_coverage: data.coverage}) + '\n', 'utf8');
        records++;
      }
    }
  } finally { await handle.close(); }
  await fs.rename(temporary, file);
  return {file, records, format: 'jsonl', lookup_keys: ['company_id', 'job_id']};
}
