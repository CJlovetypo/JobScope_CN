import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '../../../../shared/job-search-core/scripts/lib/http.mjs';
import {recruitmentLink} from '../../../../shared/job-search-core/scripts/lib/waiqi-utils.mjs';
import {collectRecovered} from '../../../../shared/job-search-core/scripts/lib/providers-recovered.mjs';
const root=path.resolve('job-search/runtime/campus/artifacts/waiqi-2026-09-20'),out=path.join(root,'official-greenhouse-verification');
await fs.mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2));
const registry=(await read('shared/job-search-core/assets/sources.json')).companies;
const normalize=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const known=new Map(); for(const c of registry)for(const s of c.recruitment_sources?.length?c.recruitment_sources:[c])if(s.provider==='greenhouse')known.set((s.api_config.api_origin||'https://boards-api.greenhouse.io')+'/'+s.api_config.board_token,c);
const candidates=new Map();
for(const f of await fs.readdir(path.join(root,'positions'))){let data;try{data=await read(path.join(root,'positions',f));}catch{continue;}for(const p of data.data||[]){let u;const link=recruitmentLink(p.outsideUrl);if(!link.url)continue;try{u=new URL(link.url);}catch{continue;}if(!/(^|\.)(greenhouse\.io|lever\.co)$/.test(u.hostname))continue;const token=u.pathname.split('/').filter(Boolean)[0];if(!token)continue;const provider=u.hostname.endsWith('lever.co')?'lever':'greenhouse',api=provider==='greenhouse'?'https://boards-api.greenhouse.io':'https://api.lever.co',key=api+'/'+token;
let c=candidates.get(key);if(!c)candidates.set(key,c={provider,token,api,entry_url:u.origin+'/'+token,observed_urls:[],observed_link_records:[],waiqi_ids:[],waiqi_names:[]});if(!c.observed_urls.includes(u.href))c.observed_urls.push(u.href);if(!c.observed_link_records.some(x=>x.raw===link.raw))c.observed_link_records.push(link);if(!c.waiqi_ids.includes(f.replace('.json','')))c.waiqi_ids.push(f.replace('.json',''));if(!c.waiqi_names.includes(p.companyName))c.waiqi_names.push(p.companyName);
}}
const mainland=/\b(?:Shanghai|Beijing|Shenzhen|Guangzhou|Hangzhou|Chengdu|Suzhou|Nanjing|Wuhan|Tianjin|Xiamen|Ningbo|Dongguan|Zhuhai|Qingdao|Dalian|Wuxi|Foshan|Chongqing|Changsha|Hefei|Xi'an|Xian|Kunshan|China Mainland|Mainland China)\b|上海|北京|深圳|广州|杭州|成都|苏州|南京|武汉|天津|厦门|宁波|东莞|珠海|青岛|大连|无锡|佛山|重庆|长沙|合肥|西安/i;
let cursor=0;const results=[];await Promise.all(Array.from({length:3},async()=>{for(;;){const c=[...candidates.values()][cursor++];if(!c)return;const dir=path.join(out,c.provider+'-'+(c.api.includes('.eu.')?'eu-':'')+c.token);await fs.mkdir(dir,{recursive:true});let prior;try{prior=await read(path.join(dir,'verification.json'));}catch{}if(prior&&!process.argv.includes('--refresh')&&!(process.argv.includes('--retry-failed')&&prior.reasons?.some(x=>/fetch failed|timeout/.test(x)))){prior.candidate=c;if(prior.source?.waiqi_provenance)Object.assign(prior.source.waiqi_provenance,{company_ids:c.waiqi_ids,names:c.waiqi_names,observed_urls:c.observed_urls,observed_link_records:c.observed_link_records});await write(path.join(dir,'verification.json'),prior);results.push(prior);continue;}const v={candidate:c,checked_at:new Date().toISOString(),status:'pending',reasons:[]};const client=createClient({evidenceDir:path.join(dir,'http'),timeoutMs:22000});
try{if(c.provider==='lever'){v.reasons.push('No Lever collector is implemented; configuration not admitted.');}else if(known.has(c.api+'/'+c.token)){v.status='existing';v.company_id=known.get(c.api+'/'+c.token).company_id;}else{
const b=await client.request({url:c.api+'/v1/boards/'+encodeURIComponent(c.token)},{purpose:'official_board_identity'});const name=b.data?.name;
const list=await client.request({url:c.api+'/v1/boards/'+encodeURIComponent(c.token)+'/jobs?content=true'},{purpose:'job_list_with_full_content'});
if(b.record.http_status!==200||!name)throw Error('Official board name unavailable');if(!Array.isArray(list.data?.jobs))throw Error('No public JSON job list');
v.official_board={name,content:b.data.content,request:b.record};v.global_jobs=list.data.jobs.length;
const mainlandRows=list.data.jobs.filter(j=>mainland.test(j.location?.name||''));const locs=[...new Set(mainlandRows.map(j=>j.location.name))];v.observed_mainland_locations=locs;
if(!locs.length)throw Error('No explicitly mainland city jobs in current public board');
const pattern=locs.map(x=>'^'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|');
const officialNorm=normalize(name);const match=registry.filter(x=>[x.display_name,...x.aliases||[]].some(n=>normalize(n)===officialNorm));
const id=match.length===1?match[0].company_id:'greenhouse-'+(c.api.includes('.eu.')?'eu-':'')+c.token;
const source={company_id:id,display_name:name,provider:'greenhouse',entry_url:c.entry_url,primary_entry_url:c.entry_url,api_config:{board_token:c.token,mainland_location_pattern:pattern,...c.api.includes('.eu.')?{api_origin:c.api}:{}},source_id:'api-'+createHash('sha256').update(c.api+'/'+c.token).digest('hex').slice(0,16)};
// Reuse the existing runtime normalizer and collection contract while avoiding duplicate HTTP.
const cachedClient={records:client.records,request:async(q,meta)=>q.url===list.record.url?list:client.request(q,meta)};
const result=await collectRecovered(source,{mode:'full',client:cachedClient});await write(path.join(dir,'collection.json'),result);
const sample=result.jobs.find(j=>j.body_complete&&j.job_id&&j.official_url);v.mainland_jobs=result.jobs.length;v.complete_jds=result.jobs.filter(j=>j.body_complete).length;v.coverage=result.coverage;
if(!sample)throw Error('No complete mainland JD passes runtime responsibility/requirement review');
const names=[...new Set(mainlandRows.map(j=>j.company_name).filter(Boolean))];v.returned_company_names=names;
v.sample={job_id:sample.job_id,title:sample.title,official_url:sample.official_url,description:sample.description,requirements:sample.requirements,raw_file:sample.raw_file};
v.status='admitted';v.source={...source,aliases:[],industry_tags:match.length===1?match[0].industry_tags:[],recruitment_sources:[source],source_origin:'waiqi-2026-09-20-official-greenhouse-api',api_verified_at:v.checked_at,ownership_status:'pending_verification',industry_tag_basis:{kind:'not_verified',business_evidence:false},identity_verification:{basis:'Official Greenhouse board metadata name; source uses board-level identity rather than Waiqi subsidiary hint',official_board_name:name,evidence_file:b.record.response_file,returned_company_names:names},waiqi_provenance:{company_ids:c.waiqi_ids,names:c.waiqi_names,observed_urls:c.observed_urls,observed_link_records:c.observed_link_records,third_party_hints_only:true},api_verification:{evidence_file:path.join(dir,'verification.json'),complete_mainland_jds:v.complete_jds,coverage:result.coverage},validated_api_request_examples:[{method:'GET',url:list.record.url,purpose:'job_list_with_full_content'}]};
}}catch(e){v.reasons.push(e.message);}v.requests=client.records;await write(path.join(dir,'verification.json'),v);results.push(v);console.log(c.token+': '+v.status+' '+(v.complete_jds||0)+' '+v.reasons.join('; '));}}));
results.sort((a,b)=>a.candidate.token.localeCompare(b.candidate.token));await write(path.join(out,'admitted.json'),results.filter(v=>v.status==='admitted').map(v=>v.source));await write(path.join(out,'pending.json'),results.filter(v=>v.status!=='admitted'));await write(path.join(out,'summary.json'),{checked_at:new Date().toISOString(),candidates:candidates.size,admitted:results.filter(v=>v.status==='admitted').length,pending:results.filter(v=>v.status==='pending').length,existing:results.filter(v=>v.status==='existing').length,complete_mainland_jds:results.reduce((n,v)=>n+(v.complete_jds||0)+(v.manually_reviewed_complete_jds||0),0),manually_reviewed_complete_jds:results.reduce((n,v)=>n+(v.manually_reviewed_complete_jds||0),0)});console.log(await fs.readFile(path.join(out,'summary.json'),'utf8'));


