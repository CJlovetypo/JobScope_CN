import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeJobLocations} from './locations.mjs';
import {plainJobText} from './providers-global.mjs';

export function normalizeIvvaJob(row,source) {
  const description=plainJobText(row.positionDesc),marker=description.match(/任职要求|岗位要求|职位要求|任职资格|我们重点寻找|Qualifications|Requirements/i);
  const requirements=marker?description.slice(marker.index):'';
  let formal='unknown';
  if(/实习|intern/i.test(row.positionNature||'')||/实习生|intern(?:ship)?\b/i.test(row.positionName||''))formal='internship';
  else if(Number(row.isSchoolRecruit)===1&&/^(全职|正式)$/.test(row.positionNature||''))formal='formal';
  else if(row.isSchoolRecruit===0&&row.positionNature==='全职')formal='social';
  const entry=new URL(source.primary_entry_url);entry.pathname=entry.pathname.replace(/[^/]+$/,row._portal_token);
  entry.hash='/positionDetail?positionId='+encodeURIComponent(row.positionId)+'&wt=1';
  const job={job_id:String(row.positionId),company_id:source.company_id,company_name:source.display_name,title:row.positionName,
    description,requirements,body_complete:description.length>50&&requirements.length>20,locations_raw:row.workingPlace?[row.workingPlace]:[],
    formal_status:formal,open_status:row.recruitStatus===1?'open':row.recruitStatus==null?'unknown':'closed',
    official_url:entry.href,job_url_kind:'official_detail',raw_file:row._raw_file,
    recruitment_evidence:{provider:'ivva',isSchoolRecruit:row.isSchoolRecruit,positionNature:row.positionNature,recruitStatus:row.recruitStatus},
    raw_metadata:{updated_at:row.updateTime}};
  const loc=normalizeJobLocations(job);return {...job,cities:loc.cities,location_unknown:loc.unknown,location_special:loc.special,location_unresolved:loc.unresolved};
}

export function normalizeIvvaResult(data,source) {
  const jobs=data.rows.map(row=>normalizeIvvaJob(row,source)),coverage={...data.coverage};
  const incomplete=jobs.filter(j=>!j.body_complete).map(j=>j.job_id);
  if(incomplete.length){coverage.status=coverage.status==='failed'?'failed':'partial';coverage.missing_body_ids=incomplete;coverage.reason+='; missing_full_jd_body';}
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs,requests:data.requests,coverage};
}

export async function collectIvva(source,options={}) {
  const python=options.python||process.env.CAMPUS_JOB_FIT_PYTHON||process.env.PYTHON||'python';
  const helper=fileURLToPath(new URL('./ivva_public.py',import.meta.url));
  const evidenceDir=options.evidenceDir||path.resolve(path.dirname(helper),'../../artifacts/ivva-'+Date.now());
  const data=await new Promise((resolve,reject)=>{
    const child=spawn(python,['-B','-X','utf8',helper],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',e=>reject(new Error('IVVA requires Python 3; set CAMPUS_JOB_FIT_PYTHON to the available runtime: '+e.message)));
    child.on('close',(code,signal)=>{try{if(code!==0)throw Error(`IVVA Python reader failed (exit=${code}, signal=${signal||'none'}): ${stderr.trim().slice(0,500)||'No diagnostic output; check Python 3 and CAMPUS_JOB_FIT_PYTHON (Windows Store aliases are not a Python runtime).'}`);resolve(JSON.parse(stdout));}catch(e){reject(e);}});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({source,options:{evidenceDir,maxPages:options.maxPages||1000,timeoutMs:options.timeoutMs||20000}}));
  });
  return normalizeIvvaResult(data,source);
}
