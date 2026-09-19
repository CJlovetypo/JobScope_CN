import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {workspacePath} from './lib/io.mjs';
import {readSourceRegistry} from '../../shared/job-search-core/registry.mjs';

const exec=promisify(execFile),args=process.argv.slice(2),flags={};for(let i=0;i<args.length;i+=2)flags[args[i].replace(/^--/,'')]=args[i+1];
const url=new URL(flags.url||'https://scnk2250sha0.feishu.cn/base/DseGb8ZeQannZ1sAp8pcLB03n7e?table=tblvEJMJ94E439wt&view=vewX9bEODr');
const out=workspacePath(path.resolve(flags.out||'internet-campus-job-fit/artifacts/feishu-source-expansion-20260919'));
const runner=process.env.LARK_CLI_RUNNER||path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'npm/node_modules/@larksuite/cli/scripts/run.js');
const call=async args=>{const r=await exec(process.execPath,[runner,'base',...args,'--as','user'],{windowsHide:true,maxBuffer:32e6});const value=JSON.parse(r.stdout);if(!value.ok)throw Error(JSON.stringify(value.error||value));return value;};
const save=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};
const resolved=await call(['+url-resolve','--url',url.href]);await save(path.join(out,'resolved.json'),resolved);
const base=resolved.data.base_token,table=resolved.data.table_id,view=url.searchParams.get('view');
if(!base||!table)throw Error('Cannot resolve base/table');
const projection=['公司名称','申请链接','公告链接','公司简介','工作城市','公司标签','招聘岗位（选岗建议）','录入时间','截止时间'];
const records=[],seen=new Set();let offset=0,pages=0;
while(true){
 const file=path.join(out,'pages',String(offset)+'.json');let response;
 try{response=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;response=await call(['+record-list','--base-token',base,'--table-id',table,...view?['--view-id',view]:[],'--limit','200','--offset',String(offset),'--format','json',...projection.flatMap(f=>['--field-id',f])]);await save(file,response);}
 const data=response.data,rows=data.data,ids=data.record_id_list;
 if(!Array.isArray(rows)||!Array.isArray(ids)||rows.length!==ids.length)throw Error('Unexpected record matrix');
 let added=0;rows.forEach((row,index)=>{if(seen.has(ids[index]))return;seen.add(ids[index]);added++;records.push({record_id:ids[index],fields:Object.fromEntries(data.fields.map((f,i)=>[f,row[i]]))});});
 pages++;console.log(JSON.stringify({pages,records:records.length,has_more:data.has_more}));
 if(!data.has_more)break;if(!rows.length||!added)throw Error('Pagination stalled; refusing complete export');offset+=rows.length;
}
const entries=[],companies=new Map(),decode=s=>s.replaceAll('&amp;','&');
for(const record of records){const company=String(record.fields['公司名称']||'').trim();if(!company)continue;
 const c=companies.get(company)||{display_name:company,record_ids:[],entry_urls:[],hints:[]};c.record_ids.push(record.record_id);
 for(const field of ['申请链接','公告链接'])for(const match of String(record.fields[field]||'').matchAll(/https?:\/\/[^\s<>"'\]\[)（），。；]+/g)){
  const link=decode(match[0]);try{const u=new URL(link);if(u.username||u.password)continue;}catch{continue;}
  entries.push({company,record_id:record.record_id,field,url:link});c.entry_urls.push(link);
 }
 c.hints.push({record_id:record.record_id,description:record.fields['公司简介'],tags:record.fields['公司标签'],cities:record.fields['工作城市'],roles:record.fields['招聘岗位（选岗建议）']});companies.set(company,c);
}
const registry=await readSourceRegistry();const normalized=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const aliases=new Map();for(const c of registry.companies)for(const name of [c.display_name,...c.aliases||[]]){const key=normalized(name);if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(c.company_id);}
const candidates=[...companies.values()].map(c=>{const hits=[...aliases.get(normalized(c.display_name))||[]];return {...c,entry_urls:[...new Set(c.entry_urls)],company_id:hits.length===1?hits[0]:'company-'+createHash('sha256').update(c.display_name).digest('hex').slice(0,12),existing_company_ids:hits,identity_status:hits.length===1?'known_alias':hits.length>1?'ambiguous':'unverified'};});
await save(path.join(out,'records.json'),{source_url:url.href,exported_at:new Date().toISOString(),complete:true,pages,records});
await save(path.join(out,'link-occurrences.json'),entries);await save(path.join(out,'candidates.json'),candidates);
const summary={source_url:url.href,checked_at:new Date().toISOString(),complete:true,pages,records:records.length,companies:candidates.length,link_occurrences:entries.length,unique_links:new Set(entries.map(e=>e.url)).size,matched_existing_companies:candidates.filter(c=>c.identity_status==='known_alias').length,hosts:Object.fromEntries([...new Set(entries.map(e=>new URL(e.url).hostname))].map(host=>[host,entries.filter(e=>new URL(e.url).hostname===host).length]).sort((a,b)=>b[1]-a[1]))};
await save(path.join(out,'summary.json'),summary);console.log(JSON.stringify(summary));
