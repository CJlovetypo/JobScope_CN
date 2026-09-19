import fs from 'node:fs/promises';

const [manifestFile,registryFile,outputFile]=process.argv.slice(2);
if(!manifestFile||!registryFile||!outputFile)throw new Error('Usage: node prepare-wps-discovered-tenants.mjs discovery-manifest.json sources.json output.json');
const rows=JSON.parse(await fs.readFile(manifestFile,'utf8'));
const registry=JSON.parse(await fs.readFile(registryFile,'utf8'));
const configured=new Set();
for(const company of registry.companies)for(const source of company.recruitment_sources?.length?company.recruitment_sources:[company]){
  const cfg=source.api_config||{},tenant=source.provider==='51job_coapi'?cfg.ctmid:source.provider==='51job_xyz'?cfg.ehire_ctm_id:source.provider==='zhaopin_grace'?cfg.org_number:null;
  if(tenant)configured.add(source.provider+':'+tenant);
}
const groups=new Map();
function selectedTenants(row){
  if(row.provider_hint!=='zhaopin_grace')return row.discovered_tenants||[];
  const fromUrl=[];
  for(const entry of row.entry_urls||[]){
    const jobs=entry.match(/\/companydetail\/(?:jobs-)?(CZL?\d+)/i);if(jobs)fromUrl.push(jobs[1]);
    const cc=entry.match(/\/companydetail\/CC(\d+)/i);if(cc)fromUrl.push(`CZ${cc[1]}`);
  }
  if(fromUrl.length)return [...new Set(fromUrl)];
  // A dedicated campaign page usually carries one organization number; a
  // long list is recommendation/search data from a generic Zhaopin page.
  const found=[...new Set(row.discovered_tenants||[])];
  return found.length<=3?found:[];
}
for(const row of rows)for(const tenant of selectedTenants(row)){
  if(!/^(?:\d{5,12}|CZL?\d{7,12})$/i.test(String(tenant)))continue;
  const provider=row.provider_hint,key=provider+':'+tenant;if(configured.has(key))continue;
  const group=groups.get(key)||{display_name:row.display_name,company_id:row.company_id||'',category:row.category,provider_hint:provider,tenant_hint:String(tenant),state:'ready',entry_urls:new Set(),observed_names:new Set(),discovery:{}};
  group.observed_names.add(row.display_name);for(const url of row.entry_urls||[])group.entry_urls.add(url);groups.set(key,group);
}
const output=[...groups.values()].map(group=>({...group,entry_urls:[...group.entry_urls],observed_names:[...group.observed_names]})).sort((a,b)=>a.provider_hint.localeCompare(b.provider_hint)||a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({candidates:output.length,providers:output.reduce((out,item)=>(out[item.provider_hint]=(out[item.provider_hint]||0)+1,out),{})},null,2));
