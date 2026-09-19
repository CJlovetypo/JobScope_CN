import {datasetPath} from '../registry.mjs';
import path from 'node:path';
import {SKILL_ROOT, readJson, writeJson} from './lib/io.mjs';
import {PROFILE_FILE, mergeProfiles, profileGaps} from './lib/company-profiles.mjs';

const [command, patchFile] = process.argv.slice(2);
if (!['sync', 'import', 'status'].includes(command) || (command === 'import' && !patchFile)) throw new Error('用法：company-profiles.mjs sync | import 补充资料.json | status');
const sources = (await readJson(datasetPath(SKILL_ROOT,'assets/sources.json'))).companies;
const business = await readJson(datasetPath(SKILL_ROOT,'data/company-business-tags.json'));
const previous = await readJson(PROFILE_FILE, {companies: []});
const patches = command === 'import' ? (await readJson(path.resolve(patchFile))).companies : [];
const dataset = mergeProfiles(sources, business, previous, patches);
if (command !== 'status') await writeJson(PROFILE_FILE, dataset);
const gaps = profileGaps(dataset);
console.log(JSON.stringify({file: PROFILE_FILE, companies: dataset.companies.length, missing_fields: gaps.length, verified: Object.fromEntries(['business', 'workforce', 'capital'].map(field => [field, dataset.companies.filter(c => c[field].status === 'verified').length])), gaps}, null, 2));
