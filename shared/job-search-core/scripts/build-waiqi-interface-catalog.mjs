import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sourceKey} from './lib/waiqi-integration.mjs';
import {atsConfiguration} from './discover-waiqi-zero-websites.mjs';
import {isIndividualJobRoute} from './lib/career-link-scope.mjs';

// Export company relationships and interface contracts; never export response bodies or JD rows.
const root=path.resolve(process.argv[2]||'campus-job-fit/artifacts/waiqi-expansion-followup');
const review=path.resolve(process.argv[3]||'campus-job-fit/artifacts/waiqi-candidate-review');
const output=path.resolve(process.argv[4]||'shared/job-search-core/assets/waiqi-interface-catalog.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const registry=read('shared/job-search-core/assets/sources.json').companies;
const candidates=read('shared/job-search-core/assets/waiqi-source-candidates.json');
const records=new Map();
const evidence=r=>({url:r.url,method:r.method,http_status:r.http_status,checked_at:r.checked_at,response_sha256:r.response_sha256,purpose:r.purpose});
function entryURL(provider,cfg,entry){
  if(provider==='oracle_recruiting')return cfg.origin+'/hcmUI/CandidateExperience/en/sites/'+cfg.site;
  if(provider==='workday')return cfg.origin+(cfg.public_path||'/'+cfg.site);
  if(provider==='greenhouse')return 'https://job-boards.greenhouse.io/'+cfg.board_token;
  if(provider==='smartrecruiters')return 'https://careers.smartrecruiters.com/'+cfg.company_identifier;
  return entry;
}
function add(provider,cfg,entry,ids=[],patch={}){
  cfg=cfg||{};entry=entryURL(provider,cfg,entry);
  let key;try{key=sourceKey({provider,api_config:cfg,primary_entry_url:entry});}catch{key=JSON.stringify([provider,cfg,entry]);}
  let row=records.get(key);
  if(!row){row={interface_id:createHash('sha256').update(key).digest('hex').slice(0,20),provider,entry_url:entry,api_config:cfg,waiqi_company_ids:[],registry_company_ids:[],status:'unverified_candidate',request_templates:[],evidence:[]};records.set(key,row);}
  row.waiqi_company_ids=[...new Set([...row.waiqi_company_ids,...ids].map(Number))].filter(Number.isFinite).sort((a,b)=>a-b);
  row.api_config={...row.api_config,...cfg};
  Object.assign(row,patch);
  return row;
}
for(const c of read(path.join(review,'unregistered-contexts-reviewed.json'))){
  add(c.provider,c.api_config,c.entry_url,c.company_records.map(x=>x.waiqi_company_id),{review_state:c.review_bucket,request_templates:c.source?.validated_api_request_examples?.map(({url,method,body})=>({url,method,body}))||[]});
}
for(const c of read(path.join(review,'historical-api-review.json'))){
  const row=add(c.provider,c.api_config,c.primary_entry_url,c.waiqi_company_ids,{historical_capability:c.capability_state,request_templates:c.validated_api_request_examples?.map(({url,method,body})=>({url,method,body}))||[]});
  if(c.identity_conflict||c.admission_blocked_reason)row.historical_identity_block={identity_conflict:!!c.identity_conflict,reason:c.admission_blocked_reason||'Historical employer identity conflict requires review'};
}
for(const c of read(path.join(root,'workday-alternate-results.json'))){
  add(c.provider,c.api_config,c.entry_url,c.companies.map(x=>x.id),{status:c.api_list_valid?'verified_api_pending_identity_and_scope':'api_failed',capability:{list_schema_valid:c.api_list_valid,list_complete:false,scope:'Global probe only; mainland coverage not established'},request_templates:[c.api],evidence:c.requests.map(evidence)});
}
for(const c of read(path.join(root,'platform-revisit/results.json'))){
  if(c.family==='ajinga')continue;
  add(c.family,{},c.url,c.companies.map(x=>x.id),{status:'entrance_only',capability:{list_schema_valid:false,list_complete:false,reason:c.status===200?'Entrance returned; public company-specific list API not established':'Entrance HTTP '+c.status+'; this does not prove observed job links unavailable'},evidence:c.record?[evidence(c.record)]:[]});
}
for(const c of read(path.join(root,'ajinga-results.json'))){
  const r=read(path.join(root,'ajinga',c.company_id,'result.json')),p=r.company_profile?.root_company;
  const row=add('ajinga_public',{company_id:c.company_id,...(p?{root_company_id:String(p.id)}:{})},'https://www.ajinga.com/recruiting/company/'+c.company_id+'/',c.waiqi_companies.map(x=>x.id),{status:r.coverage.list_complete?'verified_list_pending_identity':'verified_api_pending_scope',capability:{list_schema_valid:r.coverage.pages>0,list_complete:r.coverage.list_complete,scope:r.coverage.scope,reason:r.coverage.reason,checked_at:r.checked_at},request_templates:[{method:'GET',url:'https://www.ajinga.com/django_rest/company/info/'+c.company_id+'/',purpose:'company_identity'},{method:'GET',url:'https://www.ajinga.com/django_rest/job-list/?company_id='+c.company_id+'&page=1&page_size=100',purpose:'job_list'}],employer_profile:p?{company_id:c.company_id,root_company_id:String(p.id),name:p.name,cn_name:p.cn_name}:null,evidence:r.requests.map(evidence)});
  if(c.company_id==='12699')row.identity_conflicts=[{waiqi_company_id:16843,reason:'Waiqi Haleon reference points to AJINGA AbbVie root 12699. Do not associate this endpoint with Haleon.'}];
  if(c.company_id==='9620')row.identity_review_note='Profile names Marsh People and Investment; original Waiqi record names Mercer. Group/subsidiary relation requires independent confirmation.';
}
for(const c of read(path.join(root,'jobs2web-results.json'))){
  const r=read(path.join(root,'jobs2web',c.host,'result.json'));
  const refs=candidates.companies.filter(x=>x.recruitment_links?.some(l=>{try{return new URL(l.url).hostname===c.host;}catch{return false;}}));
  add('jobs2web_public',{origin:'https://'+c.host},'https://'+c.host+'/search/',refs.map(x=>x.waiqi_company_id),{status:r.coverage.list_complete?'verified_list_pending_identity':'list_partial',capability:{list_complete:r.coverage.list_complete,scope:r.coverage.scope,reason:r.coverage.reason,checked_at:r.checked_at},request_templates:[{url:'https://'+c.host+'/search/?optionsFacetsDD_country=CN',method:'GET',response_format:'html'}],evidence:r.requests.map(evidence)});
}
const revisits=read(path.join(root,'career-revisit/results.json'));
const searches=read(path.join(root,'search-revisit/results.json'));
const searchCandidates=read('campus-job-fit/artifacts/waiqi-2026-09-20/zero-position-source-discovery/discovery-candidates.json');
for(const c of searchCandidates.candidates){
  const url=c.effective_url||c.candidate_url,config=atsConfiguration(url);
  // Retain company/career entrances only; individual job URLs stay in the original candidate archive.
  if(!config&&isIndividualJobRoute(url))continue;
  const row=add(config?.provider||'career_site',config?.api_config||{},config?.entry_url||url,[c.waiqi_company_id]);
  row.historical_search_hint=true;
  if(!row.request_templates.length&&config?.api)row.request_templates=[config.api];
}
for(const c of [...revisits,...searches])for(const o of c.observations.filter(x=>x.http_status===200&&x.platform!=='unresolved'&&!isIndividualJobRoute(x.url)&&!isIndividualJobRoute(x.final_url||x.url))){
  const config=o.api_configuration||atsConfiguration(o.final_url||o.url);
  const row=add(config?.provider||o.platform,config?.api_config||{},config?.entry_url||o.final_url||o.url,[c.waiqi_company_id]);
  if(!row.career_observations)row.career_observations=[];
  row.career_observations.push({url:o.url,final_url:o.final_url,checked_at:c.checked_at,response_sha256:o.response_sha256,platform_hint:o.platform});
  if(!row.request_templates.length&&config?.api)row.request_templates=[config.api];
}
for(const row of records.values()){
  for(const c of registry)for(const s of c.recruitment_sources||[c]){
    let match=false;try{match=sourceKey(s)===sourceKey({provider:row.provider,api_config:row.api_config,primary_entry_url:row.entry_url});}catch{}
    if(match){row.registry_company_ids.push(c.company_id);row.status='registered_source';}
    if(row.provider==='workday'&&s.provider==='workday'&&s.api_config?.tenant===row.api_config.tenant&&s.api_config?.site.toLowerCase()===row.api_config.site.toLowerCase()&&!match){
      row.same_tenant_site_registry_hints=[...new Set([...(row.same_tenant_site_registry_hints||[]),c.company_id])];
    }
  }
  row.registry_company_ids=[...new Set(row.registry_company_ids)];
}
const identities=read(path.join(root,'identity-pending-reconciled.json'));
for(const d of read(path.join(root,'identity-priority-decisions.json'))){
  const row=[...records.values()].find(r=>r.provider==='oracle_recruiting'&&r.api_config.origin===d.api_config.origin&&r.api_config.site===d.api_config.site);
  if(row)row.inventory_equivalence={decision:d.decision,checked_at:d.checked_at,registry_company_id:d.matched_registry_company_id,registry_site:d.matched_registry_site,global_inventory_hash:d.inventory_hash,mainland_inventory_hash:d.mainland_hash,reason:'Compared complete live list inventories; no new company or mainland source counted. Recheck on refresh.'};
}
const out={schema_version:1,generated_at:new Date().toISOString(),company_snapshot_at:candidates.checked_at,policy:'Company references and public interface contracts only. No JD bodies, response payloads or credentials. Waiqi company IDs are discovery references, not employer identity proof. HTTP success, list completeness, mainland scope and registry admission are independent. Snapshot equivalence never guarantees future inventory equality.',review_coverage:{identity_pending:identities.length,same_tenant_registry_identity_hints:identities.filter(x=>x.identity_registry_candidates.length).length,career_revisited:revisits.length,career_platform_identified:revisits.filter(x=>x.status==='platform_identified_requires_api_identity_review').length},interfaces:[...records.values()].sort((a,b)=>a.interface_id.localeCompare(b.interface_id))};
out.review_coverage.historical_search_companies_revisited=searches.length;
out.review_coverage.historical_search_platform_identified=searches.filter(c=>c.observations.some(o=>o.http_status===200&&o.platform!=='unresolved'&&!isIndividualJobRoute(o.url)&&!isIndividualJobRoute(o.final_url||o.url))).length;
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({interfaces:out.interfaces.length,companies:new Set(out.interfaces.flatMap(x=>x.waiqi_company_ids)).size,states:out.interfaces.reduce((s,x)=>(s[x.status]=(s[x.status]||0)+1,s),{})}));
