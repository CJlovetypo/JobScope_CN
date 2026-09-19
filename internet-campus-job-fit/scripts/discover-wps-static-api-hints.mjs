import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from './lib/http.mjs';
import {workspacePath} from './lib/io.mjs';

const [inputFile,outputArg,...flags]=process.argv.slice(2);
if(!inputFile||!outputArg)throw new Error('Usage: node discover-wps-static-api-hints.mjs candidates.json output-dir [--providers=51job_coapi,51job_xyz,zhaopin_grace] [--concurrency=8]');
const input=JSON.parse(await fs.readFile(inputFile,'utf8'));
const output=workspacePath(path.resolve(outputArg));await fs.mkdir(output,{recursive:true});
const value=(name,fallback)=>flags.find(flag=>flag.startsWith(`--${name}=`))?.split('=').slice(1).join('=')||fallback;
const providers=new Set(value('providers','51job_coapi,51job_xyz,zhaopin_grace').split(',').filter(Boolean));
const concurrency=Number(value('concurrency','8')),maxScripts=Number(value('max-scripts','4'));
const items=input.filter(item=>item.state==='needs_discovery'&&providers.has(item.provider_hint));
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const uniq=values=>[...new Set(values.filter(Boolean))];
const scan=(text,base)=>{
  const ctmids=uniq([...text.matchAll(/(?:ehire\s*)?ctm(?:id)?["'\s:=?&%]*(\d{5,12})/gi)].map(match=>match[1]));
  // Zhaopin pages commonly expose the public recruitment identity through
  // zpStatConfig.page.companyid, companyNumber or orgNumber(s).  Keep the
  // match tied to the value token: looking dozens of bytes past `orgNumbers`
  // also captures unrelated KA tracking IDs from minified bundles.
  const orgNumbers=uniq([...text.matchAll(/(?:orgNumbers?|companyNumber|companyid)\s*["']?\s*[:=]\s*["']?((?:CZL?\d{7,12})|(?:\d{6,12}))/gi)].map(match=>match[1]));
  const companyIds=uniq([...text.matchAll(/companyId[^\w]{0,12}["']?(\d{3,20})/gi)].map(match=>match[1]));
  const apiPaths=uniq([...text.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+|\/(?:api|openapi|recruit-api|ats-candidate-api|hcmRestApi|wday\/cxs|recruit)[^"'`\s]{2,240}))["'`]/gi)]
    .map(match=>match[1]).filter(value=>/job|position|post|recruit|career|vacan|hiring|apply/i.test(value)).map(value=>{try{return new URL(value,base).href}catch{return value}})).slice(0,100);
  const absolutePlatforms=uniq([...text.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)].map(match=>match[0]).filter(value=>/myworkdayjobs|smartrecruiters|greenhouse|lever\.co|oraclecloud|51job|zhaopin|nowcoder|mokahr|zhiye|hotjob|jobs\.feishu/i.test(value))).slice(0,100);
  return {ctmids,orgNumbers,companyIds,apiPaths,absolutePlatforms};
};
function mergeHints(target,hints){for(const key of Object.keys(hints))target[key]=uniq([...(target[key]||[]),...hints[key]]).slice(0,200);}
function scriptUrls(html,base){const links=[];for(const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)){try{links.push(new URL(match[2],base).href)}catch{}}return uniq(links).sort((a,b)=>score(b)-score(a));}
function score(url){return (/config|setting|main|app|index|career|job|recruit/i.test(url)?4:0)+(/chunk|bundle/i.test(url)?2:0)-(/jquery|vendor|polyfill|analytics|captcha/i.test(url)?5:0);}
const rows=[];let cursor=0;
await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<items.length){const item=items[cursor++],dir=path.join(output,hash(item.provider_hint+item.display_name+item.entry_urls.join('|')));await fs.mkdir(dir,{recursive:true});const client=createClient({evidenceDir:path.join(dir,'http'),timeoutMs:15000});const hints={ctmids:[],orgNumbers:[],companyIds:[],apiPaths:[],absolutePlatforms:[]},attempts=[];
  for(const entry of item.entry_urls.slice(0,3)){
    try{const response=await client.request({url:entry,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'}},{purpose:'recruitment_page_static_discovery'});attempts.push({entry,http_status:response.record.http_status,final_url:response.url,response_file:response.record.response_file});if(response.record.http_status!==200)continue;mergeHints(hints,scan(response.text,response.url));
      if((item.provider_hint.startsWith('51job')&&!hints.ctmids.length)||(item.provider_hint==='zhaopin_grace'&&!hints.orgNumbers.length)||(item.provider_hint==='custom_page'&&!hints.apiPaths.length)){
        for(const script of scriptUrls(response.text,response.url).slice(0,maxScripts)){try{const js=await client.request({url:script,headers:{Referer:response.url}},{purpose:'frontend_bundle_api_discovery'});if(js.record.http_status===200)mergeHints(hints,scan(js.text,script));attempts.push({entry:script,http_status:js.record.http_status,final_url:js.url,response_file:js.record.response_file});}catch(error){attempts.push({entry:script,error:error.message});}}
      }
    }catch(error){attempts.push({entry,error:error.message});}
  }
  let discoveredProvider=item.provider_hint,tenants=[];
  if(item.provider_hint.startsWith('51job'))tenants=hints.ctmids;
  else if(item.provider_hint==='zhaopin_grace')tenants=hints.orgNumbers;
  const row={...item,checked_at:new Date().toISOString(),attempts,hints,discovered_provider:discoveredProvider,discovered_tenants:tenants,state:tenants.length?'tenant_discovered':attempts.some(attempt=>attempt.http_status===200)?'page_read_no_tenant':'unreachable'};rows.push(row);await fs.writeFile(path.join(dir,'discovery.json'),JSON.stringify(row,null,2)+'\n');console.log(JSON.stringify({name:item.display_name,provider:item.provider_hint,state:row.state,tenants,apis:hints.apiPaths.length,platforms:hints.absolutePlatforms.length}));
}}));
rows.sort((a,b)=>a.provider_hint.localeCompare(b.provider_hint)||a.display_name.localeCompare(b.display_name,'zh-CN'));
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({reviewed:rows.length,tenant_discovered:rows.filter(row=>row.state==='tenant_discovered').length,api_hints:rows.filter(row=>row.hints.apiPaths.length).length},null,2));
