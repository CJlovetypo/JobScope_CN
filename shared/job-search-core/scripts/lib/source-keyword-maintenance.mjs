import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CORE_ROOT} from '../../runtime-context.mjs';
import {SOURCE_REGISTRY_FILE} from '../../registry.mjs';
import {directionSourceKey} from './direction-validation.mjs';

export const keywordReviewDirectory=registryFile=>path.resolve(registryFile)===path.resolve(SOURCE_REGISTRY_FILE)?path.join(CORE_ROOT,'state/source-keyword-reviews'):registryFile+'.keyword-reviews';
export function keywordConfigurations(registry){
 return registry.companies.flatMap(company=>(company.recruitment_sources?.length?company.recruitment_sources:[company]).flatMap((source,index)=>['campus','internship','social'].map(mode=>({key:directionSourceKey(company,source,index),mode,company_id:company.company_id,source_id:source.source_id||String(index),provider:source.provider}))));
}
// Write the recovery manifest BEFORE publishing the registry. If publication fails,
// its non-current keys are ignored; if the process stops afterwards, the work survives.
export async function queueKeywordReviews(before,after,{registryFile=SOURCE_REGISTRY_FILE}={}){
 const old=new Set(keywordConfigurations(before).map(r=>r.key+'|'+r.mode));
 const configurations=keywordConfigurations(after).filter(r=>!old.has(r.key+'|'+r.mode));
 if(!configurations.length)return {required:false,configurations:0};
 const folder=keywordReviewDirectory(registryFile);await fs.mkdir(folder,{recursive:true});
 const manifest=path.join(folder,randomUUID()+'.json');
 await fs.writeFile(manifest,JSON.stringify({schema_version:1,requested_at:new Date().toISOString(),configurations},null,2)+'\n',{flag:'wx'});
 return {required:true,configurations:configurations.length,manifest,next_command:'node shared/job-search-core/scripts/audit-search-capabilities.mjs --maintenance'};
}
export async function pendingKeywordReviews(registry,capabilities,{registryFile=SOURCE_REGISTRY_FILE}={}){
 const folder=keywordReviewDirectory(registryFile),current=new Set(keywordConfigurations(registry).map(r=>r.key+'|'+r.mode)),done=new Map((capabilities.configurations||[]).map(r=>[r.key+'|'+r.mode,r]));
 let names;try{names=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const pending=new Map();
 for(const name of names.filter(n=>n.endsWith('.json'))){const manifest=JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
  for(const row of manifest.configurations){const id=row.key+'|'+row.mode,proof=done.get(id);
   if(current.has(id)&&!(proof?.maintenance_checked_at&&(['unsupported','unconfirmed'].includes(proof.support_status)&&proof.status!=='verified_native_keyword'||proof.support_status==='supported'&&proof.status==='verified_native_keyword')&&proof.reason))pending.set(id,row);
  }
 }
 return [...pending.values()];
}
