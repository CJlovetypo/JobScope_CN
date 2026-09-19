import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectCommon} from './lib/providers-common.mjs';
import {collectInternational} from './lib/providers-international.mjs';
import {collectMidea} from './lib/providers-appliances.mjs';
import {collectOemPublic} from './lib/providers-oem.mjs';
import {collectHardwareDirect} from './lib/provider-hardware-direct.mjs';
import {collectHuawei} from './lib/provider-huawei.mjs';
import {collectLenovo} from './lib/provider-lenovo.mjs';
import {collectCvte} from './lib/provider-cvte.mjs';
import {collectUgreen} from './lib/provider-ugreen.mjs';
export const skillRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dispatch={moka:collectCommon,beisen:collectCommon,feishu:collectCommon,hotjob:collectCommon,workday:collectInternational,smartrecruiters:collectInternational,midea:collectMidea,huawei:collectHuawei,lenovo:collectLenovo,cvte:collectCvte,ugreen:collectUgreen,gree:collectHardwareDirect,dahua:collectHardwareDirect,hikvision:collectHardwareDirect,tplink:collectHardwareDirect,byd_public:collectOemPublic,lixiang_public:collectOemPublic,sinotruk_public:collectOemPublic,aion_public:collectOemPublic};
export const supportedProviders=Object.keys(dispatch);
const json=async(f,v)=>{await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,JSON.stringify(v,null,2)+'\n');};
export async function collectSource(source,options){if(!dispatch[source.provider])throw Error('Unsupported provider '+source.provider);const result=await dispatch[source.provider](source,options);const incomplete=result.jobs.filter(j=>!j.body_complete||!j.official_url).length;if(incomplete&&result.coverage.status==='complete'){result.coverage.status='partial';result.coverage.body_review_incomplete=incomplete;result.coverage.reason+='; '+incomplete+' observed jobs have incomplete or unresolved JD sections';}return result;}
export async function collectCompany(company,out,options={}){
 const dir=path.resolve(out);if(dir!==skillRoot&&!dir.startsWith(skillRoot+path.sep))throw Error('Output must remain inside this skill folder');await fs.mkdir(dir,{recursive:true});
 const sources=[],jobs=new Map();
 for(const source of company.recruitment_sources){const sd=path.join(dir,source.source_id);await fs.mkdir(sd,{recursive:true});try{
   const result=await collectSource(source,{mode:'full',maxPages:1000,pageSize:50,timeoutMs:20000,...options,evidenceDir:path.join(sd,'http')});await json(path.join(sd,'result.json'),result);
   sources.push({source_id:source.source_id,provider:source.provider,coverage:result.coverage,result_file:path.join(sd,'result.json')});
   for(const j of result.jobs){const k=source.provider+':'+j.job_id,old=jobs.get(k);if(!old||(!old.body_complete&&j.body_complete)||(j.formal_status==='formal'&&old.formal_status!=='formal'))jobs.set(k,{...j,source_provider:source.provider});}
 }catch(error){sources.push({source_id:source.source_id,provider:source.provider,coverage:{status:'failed',reason:error.message}});}}
 const all=[...jobs.values()],result={company_id:company.company_id,display_name:company.display_name,checked_at:new Date().toISOString(),sources,jobs:all,counts:{observed:all.length,full_jds:all.filter(j=>j.body_complete&&j.official_url).length,formal_open_full_jds:all.filter(j=>j.body_complete&&j.official_url&&j.formal_status==='formal'&&j.open_status==='open').length},coverage_status:sources.every(s=>s.coverage.status==='complete')?'complete':all.length?'partial':'failed'};await json(path.join(dir,'result.json'),result);return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [command,...args]=process.argv.slice(2),registry=JSON.parse(await fs.readFile(path.join(skillRoot,'assets/sources.json'),'utf8'));
 if(command==='list'){console.log(registry.companies.map(c=>`${c.display_name}\t${c.company_id}\t${c.recruitment_sources.map(s=>s.provider).join(',')}\t正式完整JD ${c.observed_counts.formal_open_full_jds}`).join('\n'));}
 else if(command==='collect'){const value=k=>args.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3),name=value('company');if(!name)throw Error('Use collect --company=公司名或ID [--max-pages=N] [--out=本skill内目录]');const company=registry.companies.find(c=>c.company_id===name||c.display_name===name||c.aliases.includes(name));if(!company)throw Error('Company is not in the verified registry: '+name);
 const maxPages=Number(value('max-pages')||1000);if(!Number.isInteger(maxPages)||maxPages<1)throw Error('max-pages must be a positive integer');const out=value('out')||path.join(skillRoot,'artifacts/runs',new Date().toISOString().replace(/[:.]/g,'-'),company.company_id);const result=await collectCompany(company,out,{maxPages});console.log(JSON.stringify({company:company.display_name,counts:result.counts,coverage:result.coverage_status,result:path.join(path.resolve(out),'result.json')},null,2));
 }else throw Error('Usage: node scripts/sources.mjs list | collect --company=公司名');
}
