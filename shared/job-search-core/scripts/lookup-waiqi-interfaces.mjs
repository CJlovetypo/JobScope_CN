import fs from 'node:fs';
const arg=process.argv.slice(2).find(x=>x.startsWith('--query='))?.slice(8)?.trim();
if(!arg)throw Error('Usage: node shared/job-search-core/scripts/lookup-waiqi-interfaces.mjs --query=公司名或Waiqi公司ID');
const load=name=>JSON.parse(fs.readFileSync(new URL('../assets/'+name,import.meta.url),'utf8'));
const companies=load('waiqi-source-candidates.json').companies.filter(c=>String(c.waiqi_company_id)===arg||[c.display_name,...c.aliases||[]].some(n=>n.toLowerCase().includes(arg.toLowerCase())));
const catalog=load('waiqi-interface-catalog.json');
console.log(JSON.stringify({catalog_updated_at:catalog.generated_at,policy:catalog.policy,companies:companies.map(c=>({waiqi_company_id:c.waiqi_company_id,display_name:c.display_name,website:c.website,source_url:c.source_url,interfaces:catalog.interfaces.filter(x=>x.waiqi_company_ids.includes(c.waiqi_company_id))}))},null,2));
