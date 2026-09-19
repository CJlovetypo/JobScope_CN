import fs from 'node:fs/promises';

const [manifestFile,outputFile]=process.argv.slice(2);
if(!manifestFile||!outputFile)throw new Error('Usage: node prepare-wps-hcmcloud-candidates.mjs static-manifest.json output.json');
const rows=JSON.parse(await fs.readFile(manifestFile,'utf8')),groups=new Map();
for(const row of rows)for(const entry of row.entry_urls||[]){
  let url;try{url=new URL(entry)}catch{continue}
  if(!/\/recruit\/?$/i.test(url.pathname))continue;
  const fragment=url.hash.replace(/^#/,'').replace(/¶ms=/,'&params=');
  const query=fragment.includes('?')?new URLSearchParams(fragment.split('?').slice(1).join('?')):new URLSearchParams();
  const contractUnit=query.get('contract_unit')||null,companyId=query.get('company_id')||null;
  const key=url.origin+'|'+(contractUnit||'all'),group=groups.get(key)||{display_name:row.display_name,company_id:row.company_id||'',category:row.category,
    provider_hint:'hcmcloud_public',tenant_hint:key,state:'ready',entry_urls:new Set(),observed_names:new Set(),discovery:{origin:url.origin,contract_unit:contractUnit,portal_company_id:companyId}};
  group.entry_urls.add(entry);group.observed_names.add(row.display_name);groups.set(key,group);
}
const output=[...groups.values()].map(group=>({...group,entry_urls:[...group.entry_urls],observed_names:[...group.observed_names]})).sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({candidates:output.length,contract_scoped:output.filter(x=>x.discovery.contract_unit).length,group_portals:output.filter(x=>!x.discovery.contract_unit).length},null,2));
