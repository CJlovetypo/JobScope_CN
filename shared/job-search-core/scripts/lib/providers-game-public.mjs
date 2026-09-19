import { createClient } from './http.mjs';
// Public official game recruitment APIs, verified with anonymous HTTP.
const SUPPORTED = new Set(['game4399', 'duoyi', 'ubisoft_cn', 'igg']);
const reqMarker = /(?:任职|岗位|职位|招聘|基本)(?:资格|要求|条件)|Qualifications|Requirements|What you bring|Who you are/i;
function clean(v) { return String(v ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\n{3,}/g,'\n\n').trim(); }
function parts(d, r='') { const description=clean(d), explicit=clean(r), marker=description.match(reqMarker), requirements=explicit || (marker?description.slice(marker.index):''); return {description,requirements,body_complete:description.length>35&&requirements.length>20}; }
function intern(title) { return /^实习|实习(?:生|转正|工程师|开发|算法|设计|产品|岗位|岗|助理)|转正实习|(?:^|[-—_/（(【［\[\s])实习(?:[-—_/）)】］\]\s]|$)|intern(?:ship)?\b/i.test(String(title||'').replace(/(?:需|可|要求|接受)?提前实习/g,'')); }
function makeJob(source,row,{id,title,locations=[],description,requirements='',formal='unknown',open='unknown',url,record,evidence={},metadata={}}) { return {job_id:String(id),company_id:source.company_id,company_name:source.display_name,title:String(title),locations_raw:locations.filter(Boolean),...parts(description,requirements),formal_status:intern(title)?'internship':formal,open_status:open,official_url:url,job_url_kind:'official_detail',raw_file:record.response_file,recruitment_evidence:{provider:source.provider,...evidence},raw_metadata:metadata}; }
function json(res) { if(res.record.http_status!==200||res.data===null)throw new Error(`Expected HTTP 200 JSON: ${res.url} (${res.record.http_status})`);return res.data; }
function query(source,purpose) { const q=source.validated_api_request_examples?.find(q=>q.purpose===purpose);if(!q)throw new Error(`Missing ${purpose} request template`);return structuredClone(q); }
export function supportsPublicGame(source) { return SUPPORTED.has(source.provider); }
export async function collectPublicGame(source, options={}) {
  if(!supportsPublicGame(source))return null;
  const client=options.client || createClient(options),jobs=[],pageEvidence=[],issues=[];let serverTotal=null,pages=0,complete=false;
  async function get(q,purpose){return client.request(q,{purpose});}
  try {
    if(source.provider==='game4399') {
      const q=query(source,'list'),r=await get(q,'list_with_full_job_bodies'),d=json(r);if(Number(d.code)!==200||!Array.isArray(d.data?.list))throw new Error('Unexpected 4399 job-list envelope');
      const rows=d.data.list;serverTotal=rows.length;pages=1;complete=true;pageEvidence.push({page:1,count:rows.length,record:r.record.response_file,termination:'official frontend consumes whole array and filters locally; no pagination request'});
      for(const row of rows)jobs.push(makeJob(source,row,{id:row.jobID,title:row.jobName,locations:[row.workCity],description:row.jobDesc,requirements:row.requirement,formal:row.applicationTypeName==='全职'?'formal':/实习/.test(row.applicationTypeName)?'internship':'unknown',open:'open',url:source.primary_entry_url.split('?')[0]+'?jobType='+encodeURIComponent(row.jobTypeID)+'&jobID='+encodeURIComponent(row.jobID),record:r.record,evidence:{campus_context:true,query_type:1,query_applicationType:1,applicationTypeName:row.applicationTypeName,open_basis:'Current official published campus jobList',route_basis:source.route_evidence_url},metadata:{jobTypeID:row.jobTypeID,application_url:row.jobUrl}}));
    } else if(source.provider==='duoyi') {
      const seen=new Set(),limit=options.pageSize||20,maxPages=options.maxPages||100;let ended=false;
      for(let page=1;page<=maxPages;page++) {
        const q=query(source,'list'),u=new URL(q.url);u.searchParams.set('pageIndex',page);u.searchParams.set('pageSize',limit);q.url=u.href;
        const r=await get(q,'campus_list_page'),d=json(r);if(Number(d.code)!==0||!Array.isArray(d.data?.list))throw new Error('Unexpected Duoyi page envelope');
        const rows=d.data.list;pages++;serverTotal=Number(d.data.total);let added=0;pageEvidence.push({page,count:rows.length,server_total:serverTotal,record:r.record.response_file});
        for(const row of rows) {
          if(seen.has(String(row.id)))continue;seen.add(String(row.id));added++;
          let value=row,record=r.record,detailVerified=false,detailError=null;
          // List canDelivery=false is a placeholder: the public detail/check API can return true for the same job.
          // Always resolve this status before adding any formal job to the active city index, including list mode.
          try {const dq=query(source,'detail');dq.url=dq.url.replace('{job_id}',encodeURIComponent(row.id));const detail=await get(dq,'public_job_detail_and_open_status');const dd=json(detail);if(Number(dd.code)!==0||String(dd.data?.id)!==String(row.id))throw new Error('Duoyi detail ID mismatch');value={...row,...dd.data};record=detail.record;detailVerified=true;}catch(e){detailError=e.message;issues.push('detail '+row.id+': '+e.message);}
          const nature=value.outerNature||[],formal=nature.some(v=>/实习|intern/i.test(v))?'internship':value.category==='SCHOOL'&&nature.some(v=>/^(正式|全职)$/.test(v))?'formal':'unknown';
          const open=detailVerified&&typeof value.canDelivery==='boolean'?(value.canDelivery?'open':'closed'):'unknown';
          jobs.push(makeJob(source,value,{id:value.id,title:value.name,locations:value.workPlaces||[],description:value.jobResponsibility,requirements:value.jobRequirements,formal,open,url:source.primary_entry_url.split('#')[0]+'#/position-detail/'+encodeURIComponent(value.id),record,evidence:{campus_context:value.category==='SCHOOL',category:value.category,outerNature:nature,list_canDelivery:row.canDelivery,detail_canDelivery:detailVerified?value.canDelivery:null,detail_verified:detailVerified,detail_error:detailError,open_basis:'Public detail canDelivery; published frontend shows apply versus 敬请期待后续招聘'},metadata:{published_at:value.publishDate,job_category:value.outerType,salary_range:value.salaryRange,list_raw_file:r.record.response_file}}));
        }
        if(seen.size===serverTotal){complete=true;ended=true;break;}
        if(!rows.length||!added){issues.push('Ended before unique IDs reconcile server total');ended=true;break;}
      }
      if(!ended)issues.push('max_pages_reached');if(issues.length)complete=false;
    } else if(source.provider==='ubisoft_cn') {
      const r=await get(query(source,'list'),'official_job_list_with_full_bodies'),d=json(r);if(!Array.isArray(d.data?.items))throw new Error('Unexpected Ubisoft job-list envelope');const rows=d.data.items;pages=1;serverTotal=Number(d.data.total);complete=d.data.isLastBatch===true&&rows.length===serverTotal;pageEvidence.push({page:1,count:rows.length,server_total:serverTotal,isLastBatch:d.data.isLastBatch,nextBatchId:d.data.nextBatchId,record:r.record.response_file});if(!complete)issues.push('Official wrapper returned a partial batch; continuation is not advertised by the current public frontend');
      for(const row of rows) {const type=String(row.category),formal=type==='1'?'social':type==='3'?'internship':'unknown';const end=row.endTime?Date.parse(row.endTime+'+08:00'):NaN;const open=row.isDeleted||Number(row.status)!==1||Number.isFinite(end)&&end<Date.now()?'closed':'open';jobs.push(makeJob(source,row,{id:row.jobAdId,title:row.jobAdName,locations:[({3100:'上海',5101:'成都'})[row.locId]],description:row.duty,requirements:row.require,formal,open,url:source.primary_entry_url.split('?')[0]+'?id='+encodeURIComponent(row.jobAdIntId),record:r.record,evidence:{campus_context:type==='2',category:type,kind:row.kind,status:row.status,isDeleted:row.isDeleted,endTime:row.endTime,category_mapping_basis:'Official career_result select job-type: 1 社会招聘 / 2 校园招聘 / 3 实习招聘; unmapped campus commitment stays unknown'},metadata:{jobAdIntId:row.jobAdIntId,locId:row.locId,published_at:row.postDate}}));}
    } else if(source.provider==='igg') {
      const placesRes=await get(query(source,'locations'),'public_job_location_dictionary'),places=json(placesRes);if(!Array.isArray(places.data))throw new Error('Unexpected IGG location dictionary');const map=new Map(places.data.map(x=>[String(x.value),x.label]));
      const r=await get(query(source,'list'),'official_job_list_with_full_bodies'),d=json(r);if(Number(d.error?.code)!==0||!Array.isArray(d.data))throw new Error('Unexpected IGG job-list envelope');const rows=d.data;serverTotal=rows.length;pages=1;complete=true;pageEvidence.push({page:1,count:rows.length,record:r.record.response_file,termination:'Public careers frontend gets one full array and filters locally'});
      for(const row of rows)jobs.push(makeJob(source,row,{id:row.job_id,title:row.name_lang?.cn||row.job_name,locations:String(row.job_work_place||'').split(',').map(x=>map.get(x)).filter(Boolean),description:row.info_lang?.cn||row.info_lang?.en,formal:/实习|intern/i.test(row.job_type_text||'')?'internship':'unknown',open:'open',url:'https://cn-jobs.igg.com/public/careers-info.html?id='+encodeURIComponent(row.job_id),record:r.record,evidence:{campus_context:null,job_type:row.job_type,job_type_text:row.job_type_text,formal_basis:'Full-time alone does not establish campus recruitment',open_basis:'Current official published list',locations_dictionary_file:placesRes.record.response_file},metadata:{published_at:row.update_time,job_category:row.job_class_text}}));
    }
  } catch(e) {issues.push(e.message);complete=false;}
  const unique=[...new Map(jobs.map(j=>[j.job_id,j])).values()];if(unique.length!==jobs.length){complete=false;issues.push('Duplicate IDs in API response');}
  const requiredIncomplete=unique.filter(j=>j.formal_status==='formal'&&j.open_status==='open'&&!j.body_complete).length;if(requiredIncomplete){complete=false;issues.push(`${requiredIncomplete} formal open jobs lack a complete body`);}
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:unique,requests:client.records,coverage:{status:complete?'complete':unique.length?'partial':'failed',pages,server_total:serverTotal,jobs_observed:unique.length,reason:issues.length?issues.join('; '):'unique_ids_reconcile_current_public_list',contexts:[source.primary_entry_url],page_evidence:pageEvidence}};
}
