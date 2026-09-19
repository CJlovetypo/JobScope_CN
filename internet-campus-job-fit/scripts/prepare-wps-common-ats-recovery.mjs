import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceFromEntry} from './source-discovery.mjs';

const [inputFile,registryFile,outputFile]=process.argv.slice(2);
if(!inputFile||!registryFile||!outputFile)throw new Error('Usage: node prepare-wps-common-ats-recovery.mjs candidates.json sources.json output.json');
const items=JSON.parse(await fs.readFile(inputFile,'utf8'));
const registry=JSON.parse(await fs.readFile(registryFile,'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const contextKey=source=>{
  const q=source.validated_api_request_examples?.find(request=>request.purpose==='job_list');
  return q?createHash('sha256').update(JSON.stringify(canonical([source.provider,new URL(q.url).origin,new URL(q.url).pathname,q.body,q.headers?.['website-path']]))).digest('hex'):'';
};
const configured=new Set();
for(const company of registry.companies)for(const source of company.recruitment_sources||[]){
  let prepared=source;
  if(!source.validated_api_request_examples?.length&&source.primary_entry_url){try{prepared=sourceFromEntry({...company,provider:source.provider},source.primary_entry_url)}catch{}}
  const key=contextKey(prepared);if(key)configured.add(key);
}
const groups=new Map(),rejected=[];
for(const item of items)for(const entry of item.entry_urls||[]){
  try{
    const source=sourceFromEntry(item,entry),key=contextKey(source);if(!key)continue;
    if(configured.has(key)){rejected.push({display_name:item.display_name,entry,reason:'context_already_configured'});continue;}
    const group=groups.get(key)||{...item,provider_hint:source.provider,state:'ready',entry_urls:new Set(),observed_names:new Set(),context_key:key};
    group.entry_urls.add(source.primary_entry_url);group.observed_names.add(item.display_name);groups.set(key,group);
  }catch{}
}
const output=[...groups.values()].map(group=>({...group,entry_urls:[...group.entry_urls],observed_names:[...group.observed_names]})).sort((a,b)=>a.provider_hint.localeCompare(b.provider_hint)||a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
await fs.writeFile(outputFile.replace(/\.json$/,'-skipped.json'),JSON.stringify(rejected,null,2)+'\n');
console.log(JSON.stringify({candidates:output.length,skipped_configured:rejected.length,providers:output.reduce((out,item)=>(out[item.provider_hint]=(out[item.provider_hint]||0)+1,out),{})},null,2));
