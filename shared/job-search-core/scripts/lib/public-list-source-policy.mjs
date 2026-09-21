export const PUBLIC_LIST_STATUS='verified_public_list_only';

// A list-only source is usable for discovery but never proves a complete JD.
export function publicListCandidateProblem(c){
  const v=c.source_verification,proof=v?.public_list_capability,id=c.identity_verification;
  if(!['jobs2web_public','ajinga_public'].includes(c.provider))return 'provider has no reviewed public-list-only runtime';
  if(c.verification_status!==PUBLIC_LIST_STATUS||c.admitted!==true)return 'public-list source not explicitly admitted';
  if(id?.identity_verified!==true||!id.official_name||!id.evidence_file||!id.basis)return 'missing reviewed employer identity';
  if(v?.complete_jd_samples!==0||!v.proof_directory||!v.identity_basis)return 'invalid public-list evidence scope';
  if(!proof||proof.anonymous!==true||proof.list_complete!==true||!Number.isSafeInteger(proof.jobs_observed)||proof.jobs_observed<1||proof.jobs_observed!==v.observed_jobs)return 'unreconciled public list';
  if(!Array.isArray(proof.request_evidence)||!proof.request_evidence.length)return 'missing public list requests';
  for(const r of proof.request_evidence){
    let u;try{u=new URL(r.url);}catch{return 'invalid public list URL';}
    if(u.username||u.password)return 'public list request scope mismatch';
    if(c.provider==='jobs2web_public'&&(u.origin!==c.api_config?.origin||!['/search/','/tile-search-results/'].includes(u.pathname)||u.searchParams.get('optionsFacetsDD_country')!=='CN'))return 'public list request scope mismatch';
    if(c.provider==='ajinga_public'&&(u.origin!=='https://www.ajinga.com'||u.pathname!=='/django_rest/job-list/'||u.searchParams.get('company_id')!==String(c.api_config?.company_id)))return 'public list request scope mismatch';
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
