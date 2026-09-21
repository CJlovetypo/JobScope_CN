export const PUBLIC_LIST_STATUS='verified_public_list_only';
import {isIndividualJobRoute} from './career-link-scope.mjs';
const supported=new Set(['jobs2web_public','ajinga_public','workday','oracle_recruiting','smartrecruiters','greenhouse','ashby','tupu360','moseeker_public','phenom_public','eightfold_public','avature_public','beisen','moka','feishu','hotjob']);

export function requestMatchesSource(c,u){
  const a=c.api_config||{};
  if(c.provider==='jobs2web_public')return u.origin===a.origin&&['/search/','/tile-search-results/'].includes(u.pathname)&&u.searchParams.get('optionsFacetsDD_country')==='CN';
  if(c.provider==='ajinga_public')return u.origin==='https://www.ajinga.com'&&u.pathname==='/django_rest/job-list/'&&u.searchParams.get('company_id')===String(a.company_id);
  if(c.provider==='workday')return u.origin===a.origin&&u.pathname===`/wday/cxs/${a.tenant}/${a.site}/jobs`;
  if(c.provider==='oracle_recruiting')return u.origin===a.origin&&/\/hcmRestApi\/resources\/.*recruitingCEJobRequisitions$/.test(u.pathname)&&decodeURIComponent(u.searchParams.get('finder')||'').includes('siteNumber='+a.site+',');
  if(c.provider==='smartrecruiters')return u.origin==='https://api.smartrecruiters.com'&&u.pathname===`/v1/companies/${a.company_identifier}/postings`;
  if(c.provider==='greenhouse')return /^(?:https:\/\/boards-api\.greenhouse\.io|https:\/\/boards-api\.eu\.greenhouse\.io)$/.test(u.origin)&&u.pathname===`/v1/boards/${a.board_token}/jobs`;
  if(c.provider==='ashby')return u.origin==='https://api.ashbyhq.com'&&u.pathname===`/posting-api/job-board/${encodeURIComponent(a.board_token)}`;
  if(c.provider==='tupu360')return u.origin===a.origin&&u.pathname==='/positionData/listInfo'&&['SOCIALRECRUITMENT','CAMPUSRECRUITMENT','INTERNSHIPRECRUITMENT'].includes(u.searchParams.get('type'));
  if(c.provider==='moseeker_public')return u.origin==='https://www.moseeker.com'&&u.pathname===`/positions/index/cid/${a.company_id}`&&/^\d+$/.test(u.searchParams.get('pageNum')||'1');
  if(c.provider==='phenom_public')return u.origin===a.origin&&u.pathname==='/widgets';
  if(c.provider==='eightfold_public')return u.origin===a.origin&&u.pathname==='/api/pcsx/search'&&(!a.domain||u.searchParams.get('domain')===a.domain)&&u.searchParams.get('location')==='China';
  if(c.provider==='avature_public')return u.origin===a.origin&&u.pathname.replace(/\/$/,'')===String(a.search_path||'').replace(/\/$/,'')&&u.searchParams.has('jobOffset');
  const allowed=(c.validated_api_request_examples||[]).filter(q=>/job_list/.test(q.purpose||'job_list')).map(q=>{try{const x=new URL(q.url);return x.origin+x.pathname;}catch{return null;}});
  return allowed.includes(u.origin+u.pathname);
}

// A list-only source is usable for discovery but never proves a complete JD.
export function publicListCandidateProblem(c){
  const v=c.source_verification,proof=v?.public_list_capability,id=c.identity_verification;
  if(!supported.has(c.provider))return 'provider has no reviewed public-list-only runtime';
  if(c.verification_status!==PUBLIC_LIST_STATUS||c.admitted!==true)return 'public-list source not explicitly admitted';
  if(id?.identity_verified!==true||!id.official_name||!id.evidence_file||!id.basis)return 'missing reviewed employer identity';
  if(v?.complete_jd_samples!==0||!v.proof_directory||!v.identity_basis)return 'invalid public-list evidence scope';
  if(!proof||proof.anonymous!==true||proof.list_complete!==true||!Number.isSafeInteger(proof.jobs_observed)||proof.jobs_observed<0||proof.jobs_observed!==v.observed_jobs)return 'unreconciled public list';
  if(!Array.isArray(proof.request_evidence)||!proof.request_evidence.length)return 'missing public list requests';
  for(const r of proof.request_evidence){
    let u;try{u=new URL(r.url);}catch{return 'invalid public list URL';}
    if(u.username||u.password||isIndividualJobRoute(u.href)||!requestMatchesSource(c,u))return 'public list request scope mismatch';
    if(r.http_status!==200||r.anonymous_session_from_scratch!==true||!r.response_file||!/^[a-f\d]{64}$/i.test(r.response_sha256||''))return 'missing successful immutable public list evidence';
    if(Object.keys(r.headers||{}).some(k=>/authorization|cookie/i.test(k)))return 'public list request contains credentials';
  }
  if(c.provider==='ajinga_public'){
    const p=proof.company_profile;
    if(!/^\d+$/.test(String(c.api_config?.company_id||''))||!/^\d+$/.test(String(c.api_config?.root_company_id||'')))return 'invalid AJINGA company configuration';
    if(!p||String(p.company_id)!==String(c.api_config?.company_id)||String(p.root_company_id)!==String(c.api_config?.root_company_id)||!p.root_company_name||p.http_status!==200||p.anonymous_session_from_scratch!==true||!p.response_file||!/^[a-f\d]{64}$/i.test(p.response_sha256||''))return 'missing verified AJINGA company profile';
  }
  return null;
}
