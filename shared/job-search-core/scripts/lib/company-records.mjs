import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_ROOT, PACK_ROOT, MODE_ROOTS} from '../../runtime-context.mjs';
import {INDUSTRIES} from './industry-routing.mjs';
import {classifyCompanySize} from './company-size.mjs';

export const RECORD_VERSION = 1;
export const REVIEW_FILE = path.join(CORE_ROOT, 'data/company-label-reviews.json');
export const STATIC_FIELDS = Object.freeze([
  'tags.industry', 'tags.business', 'tags.ownership', 'tags.headquarters_country', 'tags.listing_status',
  'descriptions.business_summary', 'descriptions.products_services', 'descriptions.customers',
  'descriptions.business_regions', 'descriptions.workforce', 'descriptions.capital', 'descriptions.entity_relationships',
]);
export const MODES = Object.keys(MODE_ROOTS);
const read = async (p, fallback) => {try {return JSON.parse(await fs.readFile(p, 'utf8'));} catch (e) {if(e.code==='ENOENT' && fallback!==undefined)return fallback;throw e;}};
const text = v => typeof v === 'string' && v.trim().length > 0;
const date = v => text(v) && Number.isFinite(Date.parse(v));
const http = v => {try{return ['http:', 'https:'].includes(new URL(v).protocol);}catch{return false;}};
export const contentHash = v => createHash('sha256').update(v).digest('hex');
export function indexById(dataset) {
  const map = new Map();
  for (const row of dataset?.companies || []) {
    if (!text(row.company_id) || map.has(row.company_id)) throw Error('缺失或重复公司ID：'+row.company_id);
    map.set(row.company_id, row);
  }
  return map;
}
const get = (row, key) => key.split('.').reduce((r,k)=>r?.[k], row);
const set = (row, key, value) => {const keys=key.split('.'),last=keys.pop();let at=row;for(const k of keys)at=at[k]??={};at[last]=value;};
const metadata = (row={}, overrides={}) => ({status:row.status||'unknown',reason:row.reason||'',entity:row.entity||'',as_of:row.as_of||'',checked_at:row.checked_at||null,evidence:row.evidence||[],origin:'legacy_import',review_state:'pending',...overrides});

// This queue deliberately contains identity anchors only. Old labels never become prompts or proof.
export function researchQueue(registry, {campaignId, startedAt=new Date().toISOString(), vocabulary=[]}={}) {
  indexById(registry);
  if(!text(campaignId) || !date(startedAt))throw Error('复核批次需要ID和开始时间');
  return {schema_version:1,campaign_id:campaignId,started_at:startedAt,
    vocabulary:[...new Set(vocabulary)].sort(),required_fields:STATIC_FIELDS,
    companies:registry.companies.map(c=>({company_id:c.company_id,display_name:c.display_name,aliases:c.aliases||[],
      recruitment_urls:[...new Set([c.primary_entry_url,...(c.recruitment_sources||[]).map(s=>s.primary_entry_url)].filter(http))],
      state:'pending'}))};
}

export function validateReview(review, campaign, {now=new Date().toISOString()}={}) {
  const fail = message => {throw Error(message);};
  if(review.campaign_id!==campaign.campaign_id || !campaign.companies.some(c=>c.company_id===review.company_id))fail('复核批次或主体ID不一致');
  const fresh = t => date(t) && Date.parse(t)>=Date.parse(campaign.started_at) && Date.parse(t)<=Date.parse(now)+60000;
  if(!Array.isArray(review.searches)||!review.searches.length)fail('每家公司必须有本轮实际搜索记录');
  for(const s of review.searches)if(!text(s.query)||!text(s.tool)||!fresh(s.searched_at)||!['success','failed'].includes(s.status)||!Array.isArray(s.result_urls)||s.result_urls.some(u=>!http(u))||(s.status==='failed'&&!text(s.error)))fail('搜索记录缺失、过期或无效');
  if(!text(review.identity_reason))fail('缺少本轮主体关联说明');
  const docs=new Map();
  for(const d of review.documents||[]) {
    if(!text(d.id)||docs.has(d.id)||!http(d.url)||!text(d.title)||!text(d.content)||!text(d.entity)||!text(d.identity_basis)||!fresh(d.fetched_at)||!text(d.tool)||d.read_kind!=='page_body'||d.sha256!==contentHash(d.content))fail('正文证据缺失、摘要冒充正文、过期或哈希不一致');
    docs.set(d.id,d);
  }
  const entries=Object.entries(review.decisions||{});
  if(!entries.length)fail('缺少逐字段结论');
  for(const [key,d] of entries) {
    if(!STATIC_FIELDS.includes(key))fail('未发布字段：'+key);
    if(!['verified','unresolved'].includes(d.status)||!text(d.reason)||!text(d.entity)||!fresh(d.checked_at))fail('字段结论缺少状态、理由、主体或本轮时间：'+key);
    if(d.status==='verified' && (!Array.isArray(d.citations)||!d.citations.length))fail('已核实结论必须引用本轮正文：'+key);
    if(d.status==='unresolved' && d.value!==null)fail('未决值必须为null：'+key);
    for(const c of d.citations||[])if(!docs.has(c.document_id)||!text(c.excerpt)||!docs.get(c.document_id).content.includes(c.excerpt))fail('引用必须来自本公司本轮已保存正文：'+key);
    if(d.status==='unresolved')continue;
    if(['tags.industry','tags.business'].includes(key)) {
      const allowed=new Set(key==='tags.industry'?INDUSTRIES.map(i=>i.id):campaign.vocabulary);
      if(!Array.isArray(d.value)||!d.value.length||new Set(d.value).size!==d.value.length||d.value.some(v=>!allowed.has(v)))fail('标签超出现有词表或为空：'+key);
    } else if(key==='tags.ownership') {
      if(!['国企','私企','外企'].includes(d.value))fail('性质超出既有枚举');
    } else if(key==='tags.listing_status') {
      if(!['已上市','未上市'].includes(d.value))fail('上市状态无效');
    } else if(!text(d.value))fail('已核实描述或国家字段不能为空：'+key);
  }
  return true;
}

function reviewedMetadata(d, review) {
  const docs=new Map(review.documents.map(x=>[x.id,x]));
  return {status:d.status,reason:d.reason,entity:d.entity,as_of:d.as_of||'',checked_at:d.checked_at,
    evidence:(d.citations||[]).map(c=>{const doc=docs.get(c.document_id);return {url:doc.url,title:doc.title,note:c.excerpt,evidence_type:doc.evidence_type||'official_website',checked_at:doc.fetched_at,document_id:doc.id,sha256:doc.sha256};}),
    origin:'fresh_web_review',review_state:d.status==='verified'?'reviewed':'reviewed_unresolved',campaign_id:review.campaign_id};
}

export function buildCompanyRecords({registry,business,ownership,profiles,size,cities={},reviews={companies:[]}}, {now=new Date().toISOString()}={}) {
  const sources=indexById(registry),biz=indexById(business),own=indexById(ownership),prof=indexById(profiles),sizes=indexById(size),rev=indexById(reviews);
  const cityMaps=Object.fromEntries(MODES.map(m=>[m,indexById(cities[m])]));
  for(const [name,map] of Object.entries({business:biz,ownership:own,profiles:prof,size:sizes,reviews:rev,...cityMaps}))for(const id of map.keys())if(!sources.has(id))throw Error(name+'包含未知公司：'+id);
  const companies=registry.companies.map(c=>{
    const b=biz.get(c.company_id)||{},o=own.get(c.company_id)||{},p=prof.get(c.company_id)||{},r=rev.get(c.company_id);
    const row={company_id:c.company_id,identity:{company_id:c.company_id,display_name:c.display_name,aliases:c.aliases||[]},
      tags:{industry:c.industry_tags||[],business:b.business_tags||[],ownership:o.ownership_tag||'待核实',organization_size:sizes.get(c.company_id)?.label||'待核实',headquarters_country:null,listing_status:null,recruitment:{}},
      descriptions:{business_summary:b.business_summary||p.business?.value||'',products_services:'',customers:'',business_regions:'',workforce:p.workforce?.value||'',capital:p.capital?.value||'',entity_relationships:''},
      sources:(c.recruitment_sources?.length?c.recruitment_sources:[c]).map(s=>({source_id:s.source_id||null,provider:s.provider||null,url:s.primary_entry_url||null,verification:s.source_verification||null})),
      governance:{fields:{},recruitment:{}}};
    const g=row.governance.fields;
    for(const key of STATIC_FIELDS)g[key]=metadata();
    g['tags.industry']=metadata(c.industry_assignment||c.industry_tag_basis||{});
    g['tags.business']=metadata(b,{checked_at:b.evidence?.[0]?.checked_at||null});
    g['descriptions.business_summary']=metadata(b,{checked_at:b.evidence?.[0]?.checked_at||null});
    g['tags.ownership']=metadata(o);
    for(const k of ['workforce','capital'])g['descriptions.'+k]=metadata(p[k]);
    for(const mode of MODES) {
      const entry=cityMaps[mode].get(c.company_id)||{};
      row.tags.recruitment[mode]={cities:entry.cities||[]};
      row.governance.recruitment[mode]={...structuredClone(entry),company_id:undefined,display_name:undefined,cities:undefined,origin:'official_job_observation',review_state:'pending'};
    }
    if(r)for(const [key,decision] of Object.entries(r.decisions)) {
      if(!STATIC_FIELDS.includes(key))throw Error('复核记录包含未知字段：'+key);
      set(row,key,decision.value);g[key]=reviewedMetadata(decision,r);
    }
    // Size is derived using the existing model; never retain a stale ownership input.
    const workforceMeta=g['descriptions.workforce'];
    const workforce={value:row.descriptions.workforce||'',...workforceMeta};
    const sizeRow=classifyCompanySize(c,{ownership_tag:row.tags.ownership,status:g['tags.ownership'].status},{workforce},{now});
    row.tags.organization_size=sizeRow.label;
    g['tags.organization_size']={...metadata(sizeRow),origin:'derived_existing_model',model_version:sizeRow.model_version,dependencies:['tags.ownership','descriptions.workforce'],review_state:g['tags.ownership'].origin==='fresh_web_review'&&workforceMeta.origin==='fresh_web_review'?'reviewed':'pending'};
    return row;
  });
  return {schema_version:RECORD_VERSION,generated_at:now,companies};
}

// Compatibility projection lets the established search/report logic consume the same field decisions.
export function projectCompanyRecords(records, inputs) {
  const result={...inputs,registry:{...inputs.registry,companies:inputs.registry.companies.map(c=>({...c}))},
    business:{...inputs.business},ownership:{...inputs.ownership},profiles:{...inputs.profiles}},byId=indexById(records);
  const reviewed=(r,key)=>r.governance.fields[key]?.origin==='fresh_web_review';
  const b=indexById(result.business),o=indexById(result.ownership),p=indexById(result.profiles);
  for(const source of result.registry.companies) {
    const r=byId.get(source.company_id),g=r.governance.fields,base={company_id:source.company_id,display_name:source.display_name};
    if(reviewed(r,'tags.industry')&&r.tags.industry?.length)source.industry_tags=r.tags.industry;
    if(reviewed(r,'tags.business')||reviewed(r,'descriptions.business_summary')) {
      const old=b.get(source.company_id)||base;
      b.set(source.company_id,{...old,...base,business_tags:r.tags.business||[],business_summary:r.descriptions.business_summary||'',status:g['tags.business'].status==='unresolved'?'unknown':g['tags.business'].status,evidence:g['tags.business'].evidence});
    }
    if(reviewed(r,'tags.ownership'))o.set(source.company_id,{...base,ownership_tag:r.tags.ownership||'待核实',status:g['tags.ownership'].status==='unresolved'?'verified_unresolved':'verified',reason:g['tags.ownership'].reason,checked_at:g['tags.ownership'].checked_at,evidence:g['tags.ownership'].evidence});
    const profile={...(p.get(source.company_id)||base)};
    for(const [old,key] of [['business','descriptions.business_summary'],['workforce','descriptions.workforce'],['capital','descriptions.capital']])if(reviewed(r,key))profile[old]={value:get(r,key)||'',status:g[key].status==='verified'?'verified':'missing',entity:g[key].entity,as_of:g[key].as_of,checked_at:g[key].checked_at,evidence:g[key].status==='verified'?g[key].evidence:[],review_reason:g[key].reason};
    p.set(source.company_id,profile);
  }
  result.business.companies=[...b.values()];result.ownership.companies=[...o.values()];result.profiles.companies=[...p.values()];
  result.size={schema_version:1,companies:records.companies.map(r=>({company_id:r.company_id,display_name:r.identity.display_name,label:r.tags.organization_size,...r.governance.fields['tags.organization_size']}))};
  return result;
}

export async function loadCompanyInputs() {
  const filenames={registry:'assets/sources.json',business:'data/company-business-tags.json',ownership:'data/company-ownership-tags.json',profiles:'data/company-profiles.json',size:'data/company-size-tags.json',reviews:'data/company-label-reviews.json'};
  const data=Object.fromEntries(await Promise.all(Object.entries(filenames).map(async([key,file])=>[key,await read(path.join(CORE_ROOT,file),{companies:[]})])));
  data.cities=Object.fromEntries(await Promise.all(Object.entries(MODE_ROOTS).map(async([mode,root])=>[mode,await read(path.join(PACK_ROOT,root,'data/company-city-index.json'),{companies:[]})])));
  return data;
}
export async function loadCompanyContext() {
  const inputs=await loadCompanyInputs(),records=buildCompanyRecords(inputs);
  return {...projectCompanyRecords(records,inputs),records};
}

export function campaignProgress(campaign, reviews, cities={}) {
  const byId=indexById(reviews),cityMaps=Object.fromEntries(MODES.map(m=>[m,indexById(cities[m])]));
  const companies=campaign.companies.map(c=>{
    const r=byId.get(c.company_id),same=r?.campaign_id===campaign.campaign_id;
    const searched=same&&r.searches?.some(s=>s.status==='success');
    const reviewed=same?STATIC_FIELDS.filter(f=>r.decisions[f]):[];
    const cityState=Object.fromEntries(MODES.map(mode=>{const e=cityMaps[mode].get(c.company_id);return [mode,date(e?.last_refresh_at)&&Date.parse(e.last_refresh_at)>=Date.parse(campaign.started_at)?e.last_refresh_status||'unknown':'pending'];}));
    return {...c,searched:!!searched,reviewed_fields:reviewed.length,static_complete:!!searched&&reviewed.length===STATIC_FIELDS.length,city_state:cityState,
      unresolved_fields:same?Object.entries(r.decisions).filter(([,d])=>d.status==='unresolved').map(([k])=>k):[]};
  });
  return {campaign_id:campaign.campaign_id,total:companies.length,searched:companies.filter(c=>c.searched).length,
    static_complete:companies.filter(c=>c.static_complete).length,fully_reviewed:companies.filter(c=>c.static_complete&&Object.values(c.city_state).every(v=>v!=='pending')).length,
    untouched:companies.filter(c=>!c.searched&&!c.reviewed_fields).length,companies};
}
