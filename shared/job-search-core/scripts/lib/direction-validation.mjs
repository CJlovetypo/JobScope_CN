import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const DIRECTION_VALIDATION_POLICY='2026-09-19-enabled-with-evidence-v2';
export function directionSourceKey(company,source,index){const normalized={...source,company_id:company.company_id,display_name:company.display_name};return hash([company.company_id,source.source_id||index,normalized]).slice(0,24);}
/** Evidence describes confidence, never disables an inherited source. */
export function validatedDirectionRegistry(companies,validation,mode){
 if(mode==='campus')return {companies,gate:'not_applied'};
 const usable=validation?.mode===mode&&validation.schema_version===1&&validation.policy_version===DIRECTION_VALIDATION_POLICY&&Array.isArray(validation.configurations);
 const byKey=new Map(),duplicates=new Set();
 for(const row of usable?validation.configurations:[]){if(byKey.has(row.key))duplicates.add(row.key);byKey.set(row.key,row);}
 let total=0,jds=0,endpoints=0;
 for(const company of companies)for(const [index,source]of (company.recruitment_sources?.length?company.recruitment_sources:[company]).entries()){
  total++;const key=directionSourceKey(company,source,index),row=duplicates.has(key)?null:byKey.get(key);
  if(row?.proof?.accepted===true&&row.status==='verified_current_target')jds++;
  else if(row?.endpoint_proof?.accepted===true)endpoints++;
 }
 return {companies,gate:'all_sources_enabled_with_evidence_labels',original_companies:companies.length,original_configurations:total,enabled_configurations:total,disabled_configurations:0,current_jd_verified_configurations:jds,endpoint_confirmed_configurations:endpoints,unverified_configurations:total-jds-endpoints,validation_status:usable?'available':'missing_or_incompatible',checked_at:usable?validation.checked_at:null};
}
