import fs from 'node:fs';
import path from 'node:path';
import {repository, dataset, readJSON, parseCSV, inspectURL, hash} from '../../../recruitment-link-repair/scripts/history.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(s => {const i=s.indexOf('='); return [s.slice(2,i),s.slice(i+1)];}));
const snapshot = args.snapshot || '2026-09-22';
if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?$/.test(snapshot)) throw new Error('Use a dated snapshot ID');
const base = path.join(dataset,'snapshots',snapshot);
const mappings = {
  'feishu-records.json':'collections/feishu-source-expansion-20260919/records.json',
  'feishu-links.json':'collections/feishu-source-expansion-20260919/link-occurrences.json',
  'feishu-verification.json':'collections/feishu-source-expansion-20260919/verification-summary.json',
  'wps-links.csv':'collections/wps-campus-sources-20260919/derived/all-link-occurrences.csv',
  'wps-manifest.json':'collections/wps-campus-sources-20260919/raw/manifest.json',
  'wps-summary.json':'collections/wps-campus-sources-20260919/final-summary.json',
  'wps-api-verification.json':'../../shared/.local/archive/20260919/internet-campus-job-fit/data/source-verification-wps-20260919.json',
  'feishu-api-verification.json':'../../shared/.local/archive/20260919/internal-records/shared/job-search-core/data/source-verification-feishu-20260919.json',
  'feishu-admission.json':'../../shared/.local/archive/20260919/internal-records/shared/job-search-core/data/feishu-expansion-20260919.json',
  'waiqi-candidates.json':'../../shared/job-search-core/assets/waiqi-source-candidates.json',
  'waiqi-interfaces.json':'../../shared/job-search-core/assets/waiqi-interface-catalog.json',
  'registry.json':'../../shared/job-search-core/assets/sources.json',
};
fs.mkdirSync(base,{recursive:true});
const sources = [];
for (const [name,origin] of Object.entries(mappings)) {
  const target=path.join(base,name), source=path.resolve(dataset,origin);
  // Existing snapshots are immutable; rebuilding never silently refreshes their dates.
  if (!fs.existsSync(target)) fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  const content=fs.readFileSync(target);
  sources.push({file:`snapshots/${snapshot}/${name}`,origin:path.relative(repository,source).replaceAll('\\','/'),bytes:content.length,sha256:hash(content)});
}
const get = name => readJSON(path.join(base,name));
const output = path.join(dataset,'index'); fs.mkdirSync(output,{recursive:true});
const observations = [], contracts = [];
function add(r) {
  const row={schema_version:1,...r,url_parts:inspectURL(r.url_original),current_availability:'not_checked'};
  row.observation_id=hash(JSON.stringify(row)).slice(0,24); observations.push(row);
}
const pointer=(file,location)=>({file:`snapshots/${snapshot}/${file}`,location});
const fr=get('feishu-records.json');
get('feishu-links.json').forEach((r,i)=>add({family:'feishu',company_name:r.company,company_id_hint:null,source_record_id:r.record_id,
  source_url:fr.source_url,observed_at:fr.exported_at,time_basis:'source_exported_at',period_hint:null,
  url_original:r.url,evidence_level:'third_party_link_observed',source_status:null,
  evidence:pointer('feishu-links.json',`/${i}`),context:{field:r.field}}));
const wm=new Map(get('wps-manifest.json').map(r=>[r.tag,r]));
parseCSV(fs.readFileSync(path.join(base,'wps-links.csv'),'utf8')).forEach((r,i)=>add({family:'wps',company_name:r.company_name,
  company_id_hint:r.known_company_id||null,source_record_id:`${r.document_tag}/${r.sheet_name}/${r.row}/${r.column}/${r.link_index}`,
  source_url:r.document_url,observed_at:wm.get(r.document_tag)?.captured_at||null,time_basis:'document_captured_at',period_hint:r.document_tag,
  url_original:r.url_original,evidence_level:'third_party_link_observed',source_status:r.status||null,
  evidence:pointer('wps-links.csv',`CSV data record ${i+1}`),context:{sheet:r.sheet_name,row:r.row,column:r.column,source_kind:r.source_kind,
    category:r.link_category,provider_hint:r.provider_hint,display_text:r.display_text,recruitment_type:r.recruitment_type,recruitment_target:r.recruitment_target}}));
const wc=get('waiqi-candidates.json');
wc.companies.forEach((c,ci)=>c.recruitment_links.forEach((r,ri)=>add({family:'waiqi',company_name:c.display_name,company_id_hint:null,
  source_record_id:String(c.waiqi_company_id),source_url:c.source_url,observed_at:c.positions_fetched_at||null,time_basis:'positions_fetched_at',period_hint:null,
  url_original:r.url,evidence_level:'third_party_link_observed',source_status:c.status,
  evidence:pointer('waiqi-candidates.json',`/companies/${ci}/recruitment_links/${ri}`),context:{original_text:r.raw,job_ids:r.job_ids,
    matched_company_ids_hints:c.matched_company_ids,raw_positions:`collections/waiqi-2026-09-20/positions/${c.waiqi_company_id}.json`}})));
const registry=get('registry.json');
registry.companies.forEach((c,ci)=>(c.recruitment_sources?.length?c.recruitment_sources:[c]).forEach((s,si)=>{
  const location=c.recruitment_sources?.length?`/companies/${ci}/recruitment_sources/${si}`:`/companies/${ci}`;
  // Registry membership is kept separately from third-party sightings, without upgrading either.
  const evidence=pointer('registry.json',location), status=s.verification_status||s.status||null;
  const observed=s.checked_at||s.verified_at||s.verified_on||null;
  for(const url of [...new Set([s.primary_entry_url,...s.alternative_entry_urls||[]].filter(Boolean))]) add({family:'registry',company_name:c.display_name,
    company_id_hint:c.company_id,source_record_id:s.source_id||c.company_id,source_url:null,observed_at:observed,
    time_basis:observed?'configuration_verification_field':'unknown',period_hint:null,url_original:url,
    evidence_level:'registry_configuration_snapshot',source_status:status,evidence,context:{provider:s.provider,snapshot_at:snapshot,
      complete_jd_sample_count:s.verified_samples?.length||0,issues:s.issues||[]}});
  contracts.push({family:'registry',company_name:c.display_name,company_id:c.company_id,provider:s.provider,entry_url:s.primary_entry_url,
    api_config:s.api_config||null,request_examples:s.validated_api_request_examples||[],source_status:status,evidence,
    policy:'Historical configuration; replay only after fresh identity and scope verification.'});
}));
const interfaces=get('waiqi-interfaces.json');
interfaces.interfaces.forEach((s,i)=>contracts.push({...s,source_evidence:s.evidence,family:'waiqi_interface',evidence:pointer('waiqi-interfaces.json',`/interfaces/${i}`)}));
for(const file of ['feishu-api-verification.json','wps-api-verification.json'])get(file).configurations.forEach((s,i)=>contracts.push({
  ...s,company_name:s.company_name||s.display_name,family:file.startsWith('feishu')?'feishu_verification':'wps_verification',
  source_reported_capability:'historical_api_full_jd',current_availability:'not_checked',evidence:pointer(file,`/configurations/${i}`)}));
for(const [file,rows] of [['observations.jsonl',observations],['contracts.jsonl',contracts]]){
  const temp=path.join(output,file+'.tmp');fs.writeFileSync(temp,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.renameSync(temp,path.join(output,file));
}
const count=(rows,key)=>Object.fromEntries([...rows.reduce((m,r)=>m.set(key(r),(m.get(key(r))||0)+1),new Map())].sort((a,b)=>b[1]-a[1]));
const families=Object.fromEntries([...new Set(observations.map(r=>r.family))].map(f=>{
  const rows=observations.filter(r=>r.family===f);return [f,{observations:rows.length,unique_urls:new Set(rows.map(r=>r.url_original)).size,
    company_labels:new Set(rows.map(r=>r.company_name)).size,providers:count(rows,r=>r.url_parts.provider),invalid_urls:rows.filter(r=>!r.url_parts.valid_http_url).length}];
}));
const companyGroups=new Map();
for(const r of observations.filter(r=>r.family==='wps'&&r.url_parts.valid_http_url)){
  const key=r.company_name; if(!companyGroups.has(key))companyGroups.set(key,{families:new Set(),hosts:new Set(),periods:new Set(),examples:[]});
  const g=companyGroups.get(key);g.families.add(r.family);g.hosts.add(r.url_parts.host);if(r.period_hint)g.periods.add(r.period_hint);
  if(g.examples.filter(e=>e.period===r.period_hint).length<2&&!g.examples.some(e=>e.url===r.url_original&&e.period===r.period_hint))g.examples.push({url:r.url_original,period:r.period_hint,evidence:r.evidence});
}
const multi=[...companyGroups].filter(([,g])=>g.periods.size>1).map(([company,g])=>({company,periods:[...g.periods],hosts:[...g.hosts],examples:g.examples}));
const stats={snapshot,generated_at:new Date().toISOString(),policy:'Local historical analysis; no live availability check. Company labels are not resolved entities.',
  families,total_observations:observations.length,unique_urls:new Set(observations.map(r=>r.url_original)).size,contracts:contracts.length,
  wps_cross_period_company_labels:multi.length,waiqi_companies_including_without_links:wc.companies.length,
  feishu_records:fr.records.length,wps_documents:wm.size,sources,index_files:['observations.jsonl','contracts.jsonl'].map(file=>({file:`index/${file}`,sha256:hash(fs.readFileSync(path.join(output,file)))}))};
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(stats,null,2)+'\n');
fs.writeFileSync(path.join(output,'cross-period-examples.json'),JSON.stringify(multi,null,2)+'\n');
console.log(JSON.stringify({...stats,sources:undefined,index_files:undefined},null,2));
