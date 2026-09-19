import fs from 'node:fs/promises';
import path from 'node:path';

function contextFor(value) {
  try {
    const u=new URL(value), host=u.hostname.toLowerCase();
    const moka=u.pathname.match(/\/(?:m\/)?(?:campus_apply|campus-recruitment|social-recruitment|apply|recommendation-apply)\/([^/]+)\/(\d+)/i);
    const su=value.match(/SU[\da-f]{24}/i)?.[0]?.toLowerCase();
    if(moka)return `moka:${moka[1].toLowerCase()}`;
    if(host.endsWith('.zhiye.com'))return `beisen:${host}`;
    if(host.endsWith('.jobs.feishu.cn')||host.endsWith('.jobs.f.mioffice.cn'))return `feishu:${host}`;
    if(host.endsWith('.hotjob.cn')){
      const wt=u.pathname.match(/\/wt\/([^/]+)/i)?.[1]?.toLowerCase();
      return `hotjob:${host}${su?`:${su}`:wt?`:wt:${wt}`:''}`;
    }
  }catch{}
  return '';
}

const [candidateFile,sourceFile,outputFile]=process.argv.slice(2);
if(!candidateFile||!sourceFile||!outputFile)throw new Error('Usage: node prepare-kdocs-api-candidates.mjs candidates.json sources.json output.json');
const candidates=JSON.parse(await fs.readFile(candidateFile,'utf8'));
const current=JSON.parse(await fs.readFile(sourceFile,'utf8')).companies;
const currentContexts=new Set(current.flatMap(company=>[company,...(company.recruitment_sources||[])].flatMap(source=>[
  source.primary_entry_url,
  ...(source.validated_api_request_examples||[]).map(request=>request.url),
])).map(contextFor).filter(Boolean));

const groups=new Map();
for(const item of candidates){
  for(const entry of item.entry_urls||[]){
    const context=contextFor(entry);
    if(!context||currentContexts.has(context))continue;
    const group=groups.get(context)||{context,observed_names:new Set(),entry_urls:new Set(),categories:new Set()};
    group.observed_names.add(item.display_name);
    group.entry_urls.add(entry);
    if(item.category)group.categories.add(item.category);
    groups.set(context,group);
  }
}

function preferredName(names){
  const penalties=/补录|专场|专项|岗位|上新|合集|稀缺|剩余|热招|管培生|人才计划|研发中心|实习/i;
  return [...names].sort((a,b)=>(penalties.test(a)?1:0)-(penalties.test(b)?1:0)||a.length-b.length||a.localeCompare(b,'zh-CN'))[0];
}

const output=[...groups.values()].map(group=>({
  display_name:preferredName(group.observed_names),
  category:[...group.categories][0]||'待确认细分行业',
  entry_urls:[...group.entry_urls],
  ats_context:group.context,
  observed_names:[...group.observed_names],
  discovery_source:'wps-campus-spreadsheets-2025-2027',
})).sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.mkdir(path.dirname(outputFile),{recursive:true});
await fs.writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({current_contexts:currentContexts.size,new_contexts:output.length},null,2));
