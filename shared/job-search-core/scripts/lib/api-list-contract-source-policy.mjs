import {isIndividualJobRoute} from './career-link-scope.mjs';
import {requestMatchesSource} from './public-list-source-policy.mjs';

export const API_LIST_CONTRACT_STATUS='verified_api_list_contract';
const providers=new Set(['workday','oracle_recruiting','smartrecruiters','greenhouse','ashby','tupu360','beisen','moka','feishu','hotjob']);
const present=value=>typeof value==='string'&&value.trim().length>0;
const sha=value=>typeof value==='string'&&/^[a-f\d]{64}$/i.test(value);

export function apiListContractCandidateProblem(candidate){
  const verification=candidate?.source_verification,contract=verification?.api_list_contract,identity=candidate?.identity_verification;
  if(candidate?.verification_status!==API_LIST_CONTRACT_STATUS||candidate?.admitted!==true)return 'API list contract source not explicitly admitted';
  if(!providers.has(candidate.provider))return 'provider has no reviewed list-contract runtime';
  if(identity?.identity_verified!==true||!present(identity.official_name)||!present(identity.evidence_file)||!present(identity.basis))return 'missing reviewed employer identity';
  if(verification?.complete_jd_samples!==0||!present(verification?.proof_directory)||!present(verification?.identity_basis))return 'invalid API list-contract evidence scope';
  if(!contract||contract.anonymous!==true||contract.endpoint_verified!==true||!Number.isSafeInteger(contract.jobs_observed)||contract.jobs_observed<0||typeof contract.list_complete!=='boolean')return 'missing reviewed anonymous API list contract';
  if(!Array.isArray(contract.request_evidence)||!contract.request_evidence.length)return 'missing successful API list request evidence';
  for(const request of contract.request_evidence){let url;try{url=new URL(request.url);}catch{return 'invalid API list request URL';}
    if(url.username||url.password||isIndividualJobRoute(request.url)||!requestMatchesSource(candidate,url))return 'API list request scope mismatch';
    if(request.http_status!==200||request.anonymous_session_from_scratch!==true||request.response_is_json!==true||!present(request.response_file)||!sha(request.response_sha256))return 'missing successful immutable API list evidence';
    if(Object.keys(request.headers||{}).some(key=>/authorization|cookie/i.test(key)))return 'API list request contains credentials';
  }
  return null;
}
