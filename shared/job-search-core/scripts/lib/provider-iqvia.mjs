import {createClient} from './http.mjs';

// The official Next.js site sends its current job inventory in public Flight
// records. Parse serialized data only; never execute scripts from the page.
export function parseIqviaPage(html) {
  const flight=[...String(html).matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)]
    .map(m=>{try {const x=JSON.parse(m[1]);return x[0]===1&&typeof x[1]==='string'?x[1]:'';}catch{return '';}}).join('');
  // Flight also contains length-prefixed text records with embedded newlines;
  // a whole-line JSON parser would silently lose the subsequent detail record.
  const fieldValues=(name,opening)=>{
    const found=[],pattern=new RegExp('"'+name+'":\\s*\\'+opening,'g');
    for(const match of flight.matchAll(pattern)) {
      const start=match.index+match[0].length-1;let depth=0,quoted=false,escaped=false;
      for(let i=start;i<flight.length;i++) {const c=flight[i];
        if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
        if(c==='"'){quoted=true;continue;}if(c==='['||c==='{')depth++;else if(c===']'||c==='}')depth--;
        if(depth===0){try{found.push(JSON.parse(flight.slice(start,i+1)));}catch{/* Malformed serialized field. */}break;}
      }
    }return found;
  };
  const inventories=fieldValues('jobs','[').filter(a=>Array.isArray(a)&&a.every(j=>j&&typeof j.instance_id==='string'&&typeof j.job_req_id==='string'));
  const details=fieldValues('job','{').filter(j=>j?.instance_id&&j?.job_req_id);
  const jsonld=[...String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(m=>{try{const v=JSON.parse(m[1]);return Array.isArray(v)?v:[v];}catch{return [];}}).filter(x=>x?.['@type']==='JobPosting');
  return {inventories,details,jsonld};
}

const clean=s=>String(s||'').replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'')
  .replace(/&#x([\da-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(Number(x)))
  .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\n{3,}/g,'\n\n').trim();
function bodyParts(html) {
  const description=clean(html),m=/(?:^|\n)\s*(?:任职要求|岗位要求|任职资格|所需知识、技能和能力|学历和经验要求|Qualifications?|Requirements?|Minimum (?:Required )?(?:Education|Experience|Qualifications)|Required Knowledge[,\s]+Skills[^\n]*)\s*[:：]?/im.exec(description);
  const requirements=m?description.slice(m.index).trim():'';
  return {description,requirements,body_complete:!!m&&m.index>35&&requirements.length>30};
}
const address=row=>row?.job_location?.address||{};
const inScope=(row,cfg)=>row?.hiring_organization?.name===cfg.business&&address(row).country===cfg.country;
function validateConfig(source) {
  const cfg=source.api_config||{},u=new URL(source.primary_entry_url);
  if(u.origin!=='https://jobs.iqvia.com'||u.pathname!=='/en/jobs'||cfg.business!=='KUNTUO'||cfg.country!=='China'||u.searchParams.get('businesses')!==cfg.business)
    throw Error('IQVIA requires the verified official KUNTUO business scope and China country');
  return cfg;
}
export function normalizeIqviaDetail(html,row,source,record) {
  const cfg=validateConfig(source),parsed=parseIqviaPage(html),matches=parsed.details.filter(d=>d.instance_id===row.instance_id&&d.job_req_id===row.job_req_id);
  if(matches.length!==1)throw Error('IQVIA detail instance/requisition identity mismatch');
  const d=matches[0],url='https://jobs.iqvia.com/en/jobs/'+encodeURIComponent(row.instance_id);
  if(!inScope(row,cfg)||!inScope(d,cfg)||d.hiring_organization.name!==row.hiring_organization.name)throw Error('IQVIA detail employer/country scope mismatch');
  if(d.job_title!==row.job_title||address(d).city!==address(row).city)throw Error('IQVIA detail title/location mismatch');
  const lds=parsed.jsonld.filter(j=>j.identifier?.value===row.job_req_id&&j.url===url);
  if(lds.length!==1||lds[0].title!==d.job_title||lds[0].jobLocation?.address?.addressCountry!==cfg.country)throw Error('IQVIA structured detail identity mismatch');
  const ld=lds[0],parts=bodyParts(ld.description),loc=address(d);
  return {job_id:d.instance_id,company_id:source.company_id,company_name:source.display_name,title:d.job_title,...parts,
    locations_raw:[loc.city,loc.region].filter(Boolean),official_url:url,job_url_kind:'official_detail',formal_status:'unknown',
    open_status:ld.directApply===true&&/^https:\/\/iqvia\.wd1\.myworkdayjobs\.com\/.*\/job\//.test(d.application_url||'')?'open':'unknown',
    recruitment_evidence:{provider:'iqvia_public',timeType:d.employment_type,current_list_membership:true,job_req_id:d.job_req_id,hiring_organization:d.hiring_organization.name,country:loc.country},
    raw_metadata:{hiring_organization:d.hiring_organization,company_name:d.company_name,job_req_id:d.job_req_id,country:loc.country,published_at:d.date_posted},raw_file:record.response_file};
}

export async function collectIqvia(source,options={}) {
  if(source.provider!=='iqvia_public')return null;
  const cfg=validateConfig(source),client=options.client||createClient(options),jobs=[],errors=[];let rows=[],inventoryCount=0,listComplete=false,listRecord;
  try {
    const response=await client.request({url:source.primary_entry_url},{purpose:'official_scoped_job_inventory'});listRecord=response.record;
    if(response.record.http_status!==200)throw Error('IQVIA inventory HTTP '+response.record.http_status);
    const inventories=parseIqviaPage(response.text).inventories;
    if(inventories.length!==1)throw Error('IQVIA public inventory missing or ambiguous');
    const all=inventories[0];inventoryCount=all.length;
    if(new Set(all.map(j=>j.instance_id)).size!==all.length)throw Error('IQVIA duplicate instance IDs');
    rows=all.filter(row=>inScope(row,cfg));listComplete=true;
    const keyword=String(options.keyword||'').trim().toLowerCase();if(keyword)rows=rows.filter(r=>r.job_title.toLowerCase().includes(keyword));
    for(const row of rows) {
      if(!/^R\d+-\d+$/.test(row.instance_id))throw Error('IQVIA invalid instance ID');
      const url='https://jobs.iqvia.com/en/jobs/'+row.instance_id;
      const placeholder={job_id:row.instance_id,company_id:source.company_id,company_name:source.display_name,title:row.job_title,description:'',requirements:'',body_complete:false,formal_status:'unknown',open_status:'unknown',locations_raw:[address(row).city,address(row).region].filter(Boolean),official_url:url,job_url_kind:'official_detail',raw_file:listRecord.response_file,recruitment_evidence:{provider:'iqvia_public',timeType:row.employment_type,hiring_organization:row.hiring_organization.name,country:address(row).country}};
      if(options.mode==='list'||jobs.length>=(options.maxDetails??Infinity)){jobs.push({...placeholder,detail_skipped_reason:options.mode==='list'?'list_mode':'detail_limit'});continue;}
      try {const detail=await client.request({url},{purpose:'official_job_detail'});if(detail.record.http_status!==200)throw Error('IQVIA detail HTTP '+detail.record.http_status);jobs.push(normalizeIqviaDetail(detail.text,row,source,detail.record));}
      catch(error){errors.push(error.message);jobs.push({...placeholder,detail_error:error.message});}
    }
  }catch(error){errors.push(error.message);}
  const incomplete=options.mode==='list'?0:jobs.filter(j=>!j.body_complete).length;
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs,requests:client.records,
    coverage:{status:listComplete&&!errors.length&&!incomplete?'complete':jobs.length||listComplete?'partial':'failed',capability:'official_ssr_inventory_and_jsonld_detail',
      pages:listComplete?1:0,server_total:listComplete?rows.length:null,jobs_observed:jobs.length,list_complete:listComplete,collection_complete:listComplete&&!errors.length&&!incomplete,
      upstream_inventory_count:inventoryCount,scope:{business:cfg.business,country:cfg.country,filtering:'official_client_inventory_filtered_by_exact_returned_business_and_country'},
      reason:[listComplete?'public_inventory_unique_ids_reconciled':'inventory_unavailable',...errors,...incomplete?[`${incomplete} jobs lack complete JD sections`]:[]].join('; '),
      details_failed:errors.length,page_evidence:listRecord?[{response_file:listRecord.response_file,job_ids:rows.map(r=>r.instance_id),server_total:rows.length}]:[]}};
}
