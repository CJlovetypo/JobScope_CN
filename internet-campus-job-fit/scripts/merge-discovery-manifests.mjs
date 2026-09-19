import fs from 'node:fs/promises';
import path from 'node:path';

const [sampleFile, fullFile, outputFile] = process.argv.slice(2).map(value => value && path.resolve(value));
if (!sampleFile || !fullFile || !outputFile) {
  throw new Error('Usage: node merge-discovery-manifests.mjs sample/manifest.json full/manifest.json output.json');
}

const read = file => fs.readFile(file, 'utf8').then(JSON.parse);
const [sample, full] = await Promise.all([read(sampleFile), read(fullFile)]);
const byContext = new Map(sample.map(row => [row.context_key, row]));
for (const row of full) byContext.set(row.context_key, row);

const verified = [...byContext.values()]
  .filter(row => row.state === 'verified_api_full_jd' && row.complete_jds > 0)
  .map(row => ({ ...row, admitted: true }));

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(verified, null, 2) + '\n');
console.log(JSON.stringify({
  sample_rows: sample.length,
  full_rows: full.length,
  merged_contexts: byContext.size,
  verified_contexts: verified.length,
  jobs_observed: verified.reduce((sum, row) => sum + (row.jobs || 0), 0),
  complete_jds: verified.reduce((sum, row) => sum + (row.complete_jds || 0), 0),
  formal_open_full_jds: verified.reduce((sum, row) => sum + (row.formal_jobs || 0), 0),
}, null, 2));
