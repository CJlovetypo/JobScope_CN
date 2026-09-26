import {nativeKeywordParameter} from './targeted-search.mjs';

// A bounded location query can be complete without proving country-wide coverage.
// Do not erase missing-direction limitations or accept an empty set of queried facets.
export function keywordNegativeComplete(provider,result){
 if(!Array.isArray(result?.jobs)||result.jobs.length)return false;
 const coverage=result.coverage||{};
 if(coverage.direction?.limitation){
  const contexts=coverage.contexts;
  return ['moka','feishu'].includes(provider)&&coverage.collection_complete===true&&Array.isArray(contexts)&&contexts.length>0&&contexts.every(c=>c.status==='complete'&&c.list_complete===true&&c.server_total===0&&Array.isArray(c.page_evidence)&&c.page_evidence.length>0&&c.page_evidence.every(p=>p.server_total===0&&Array.isArray(p.job_ids)&&p.job_ids.length===0));
 }
 if(coverage.status==='complete')return true;
 if(provider!=='workday'||coverage.status!=='partial'||coverage.list_complete!==true)return false;
 const groups=coverage.location_filter,pages=coverage.page_evidence;
 if(!Array.isArray(groups)||!groups.length||!Array.isArray(pages)||!pages.length)return false;
 if(!groups.every(g=>g.list_complete===true&&g.server_total===0&&Array.isArray(g.values)&&g.values.length))return false;
 if(!pages.every(p=>p.server_total===0&&Array.isArray(p.job_ids)&&p.job_ids.length===0))return false;
 const calls=(result.requests||[]).filter(r=>r.purpose==='location_filtered_job_list');
 if(calls.length!==groups.length||pages.length!==groups.length||!calls.every(r=>r.http_status>=200&&r.http_status<300&&!r.error))return false;
 return groups.every(g=>pages.some(p=>p.query_field===g.field)&&calls.some(r=>{
  const values=r.body?.appliedFacets?.[g.field];
  return Array.isArray(values)&&JSON.stringify([...values].sort())===JSON.stringify(g.values.map(v=>v.id).sort());
 }));
}

// Require successful outgoing list requests, not just a locally filtered result.
export function keywordRequestProof(provider, baseline, positive, negative, keyword, absentKeyword) {
 const parameter=nativeKeywordParameter(provider);
 const lists=result=>(result.requests||[]).filter(r=>['job_list','location_filtered_job_list',...(provider==='51job_xyz'?['job_list_with_full_JD']:[]),...(provider==='huatie_public'?['public_job_list_with_full_bodies']:[])].includes(r.purpose));
 const groups=[lists(baseline),lists(positive),lists(negative)];
 const sent=groups.every((records,i)=>records.length>0&&records.every(r=>r.http_status>=200&&r.http_status<300&&(provider==='huatie_public'?new URL(r.final_url||r.url).searchParams.get(parameter):r.body?.[parameter])===['',keyword,absentKeyword][i]));
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
 const routes=records=>JSON.stringify([...new Set(records.map(r=>{
  const body={...r.body};delete body[parameter];delete body.offset;delete body.PageIndex;delete body.pageIndex;
  // XYZ signs each request using the query and timestamp; employer/channel fields remain compared.
  if(provider==='51job_xyz'){delete body.sign;delete body.timestamp;}
  const headers=Object.fromEntries(Object.entries(r.headers||{}).map(([key,value])=>[key.toLowerCase(),value]).filter(([key])=>['website-path','portal-channel','x-site-id','x-tenant-id','tenant-id','origin','referer'].includes(key)));
  let url=r.final_url||r.url;
  if(provider==='huatie_public'){const u=new URL(url);u.searchParams.delete(parameter);u.searchParams.delete('current');u.searchParams.sort();url=u.href;}
  return JSON.stringify(canonical({url,method:r.method,headers,body}));
 }))].sort());
 return {keyword_sent:sent,same_list_routes:groups.every(r=>routes(r)===routes(groups[0]))};
}

// Alternatives use only words observed in the baseline title, never invented terms.
export function keywordAuditCandidates(title){
 const original=String(title).trim().slice(0,60);
 const words=String(title).replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/).filter(Boolean);
 return [...new Set([original,words.slice(0,3).join(' '),words.slice(0,2).join(' ')].filter(Boolean))];
}
