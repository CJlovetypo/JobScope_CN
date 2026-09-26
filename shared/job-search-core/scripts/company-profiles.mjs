import {RESEARCH_ROOT} from '../maintenance-paths.mjs';
import {datasetPath} from '../registry.mjs';
import path from 'node:path';
import {SKILL_ROOT, readJson, writeJson} from './lib/io.mjs';
import {PROFILE_FIELDS, emptyFact, factProblem, mergeProfiles, profileGaps} from './lib/company-profiles.mjs';

const PROFILE_FILE=path.join(RESEARCH_ROOT,'inputs/company-profiles.json');
const [command, patchFile] = process.argv.slice(2);
if (!['sync', 'import', 'status'].includes(command) || (command === 'import' && !patchFile)) throw new Error('用法：company-profiles.mjs sync | import 补充资料.json | status');
const sources = (await readJson(datasetPath(SKILL_ROOT,'assets/sources.json'))).companies;
const business = await readJson(datasetPath(SKILL_ROOT,'data/company-business-tags.json'));
const previous = await readJson(PROFILE_FILE, await readJson(datasetPath(SKILL_ROOT,'data/company-profiles.json'),{companies:[]}));
const patches = command === 'import' ? (await readJson(path.resolve(patchFile))).companies : [];
// Status must inspect saved facts without invoking a strict maintenance merge.
// Historical partial clues are reported as issues, never upgraded or rewritten.
const byId = new Map((previous.companies || []).map(c => [c.company_id, c]));
const dataset = command === 'status' ? {companies:sources.map(c=>({...c,...Object.fromEntries(Object.keys(PROFILE_FIELDS).map(field=>[field,byId.get(c.company_id)?.[field] || emptyFact()]))}))} : mergeProfiles(sources, business, previous, patches);
if (command !== 'status') await writeJson(PROFILE_FILE, dataset);
const gaps = profileGaps(dataset);
const dataIssues=dataset.companies.flatMap(c=>Object.keys(PROFILE_FIELDS).flatMap(field=>{const issue=factProblem(c[field]);return issue?[{company_id:c.company_id,field,issue}]:[];}));
console.log(JSON.stringify({file: PROFILE_FILE, companies: dataset.companies.length, missing_fields: gaps.length, verified: Object.fromEntries(['business', 'workforce', 'capital'].map(field => [field, dataset.companies.filter(c => c[field].status === 'verified'&&!factProblem(c[field])).length])), gaps, data_issues:dataIssues}, null, 2));
