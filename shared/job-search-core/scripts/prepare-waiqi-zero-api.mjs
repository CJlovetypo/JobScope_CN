import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareZeroJobCandidate} from './lib/waiqi-zero-source-policy.mjs';

const read = file => fs.readFile(file, 'utf8').then(JSON.parse);
const write = async (file, value) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
const resolveFrom = (base, file) => path.isAbsolute(file) ? file : path.resolve(base, file);

export async function prepareZeroJobAdmissions(reviewFile, outputDirectory) {
  const absoluteReview = path.resolve(reviewFile), base = path.dirname(absoluteReview), rows = await read(absoluteReview);
  if (!Array.isArray(rows)) throw Error('Zero-job review file must contain an array');
  const admitted = [], pending = [];
  for (const row of rows) {
    try {
      if (!row?.source_file || !row?.result_file || !row?.identity_evidence_file) throw Error('source_file, result_file and identity_evidence_file are required');
      const sourceFile = resolveFrom(base, row.source_file), resultFile = resolveFrom(base, row.result_file), identityFile = resolveFrom(base, row.identity_evidence_file);
      await fs.access(identityFile);
      const source = await read(sourceFile), result = await read(resultFile);
      const review = {
        ...row,
        basis: row.identity_basis,
        evidence_file: identityFile,
      };
      admitted.push(prepareZeroJobCandidate({source, result, review, proofDirectory: path.dirname(resultFile)}));
    } catch (error) {
      pending.push({...row, admitted: false, reason: error.message});
    }
  }
  const output = path.resolve(outputDirectory);
  await write(path.join(output, 'admitted.json'), admitted);
  await write(path.join(output, 'pending.json'), pending);
  const summary = {checked_at: new Date().toISOString(), input: rows.length, admitted: admitted.length, pending: pending.length};
  await write(path.join(output, 'summary.json'), summary);
  return {admitted, pending, summary};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [reviewFile, outputDirectory] = process.argv.slice(2);
  if (!reviewFile || !outputDirectory) throw Error('Usage: node prepare-waiqi-zero-api.mjs reviews.json output-directory');
  if (/sources\.json$/i.test(path.resolve(outputDirectory))) throw Error('Output must be an evidence directory, not the formal source registry');
  const result = await prepareZeroJobAdmissions(reviewFile, outputDirectory);
  console.log(JSON.stringify(result.summary, null, 2));
}
