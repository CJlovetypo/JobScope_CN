import fs from 'node:fs/promises';
import path from 'node:path';
import {keywordRequestProof,keywordNegativeComplete,keywordAuditCandidates} from './keyword-audit-proof.mjs';

/** Re-evaluate saved observations using today's proof rules, without network access. */
export async function replayKeywordAudit({folder,provider,key},cached) {
 const result={...cached,status:'parameter_candidate',reason:'cached_evidence_missing_or_invalid',proof:null};
 try {
  const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name+'.json'),'utf8'));
  const baseline=await read('baseline');
  if(!Array.isArray(baseline?.jobs))return result;
  if(!baseline.jobs.length){result.reason='baseline_empty_or_unavailable';return result;}
  const [positive,negative]=await Promise.all(['positive','negative'].map(read));
  if(![positive,negative].every(r=>Array.isArray(r?.jobs)))return result;
  const sample=baseline.jobs.find(j=>typeof j.title==='string'&&j.title.trim()&&j.job_id!=null&&String(j.job_id));
  if(!sample){result.reason='baseline_empty_or_unavailable';return result;}
  const candidates=keywordAuditCandidates(sample.title);
  const keyword=cached.proof?.positive_keyword||candidates[0];
  if(!candidates.includes(keyword))return result;
  const absentKeyword='zzNoRecruitmentMatch_'+key.slice(0,16);
  const positiveMatch=positive.jobs.some(j=>j.job_id!=null&&String(j.job_id)===String(sample.job_id));
  const negativeComplete=keywordNegativeComplete(provider,negative);
  const requestProof=keywordRequestProof(provider,baseline,positive,negative,keyword,absentKeyword);
  result.proof={baseline_job_id:sample.job_id,positive_keyword:keyword,positive_match:positiveMatch,positive_count:positive.jobs.length,negative_keyword:absentKeyword,negative_count:negative.jobs.length,negative_complete:negativeComplete,scope_limitation:negative.coverage?.direction?.limitation||null,...requestProof};
  const verified=positiveMatch&&negative.jobs.length===0&&negativeComplete&&requestProof.keyword_sent&&requestProof.same_list_routes;
  result.status=verified?'verified_native_keyword':'parameter_candidate';
  result.reason=verified?'positive_id_retained_and_unique_negative_returns_empty':'filter_not_proven';
 }catch(error){result.reason=error.code==='ENOENT'?'cached_evidence_missing':error instanceof SyntaxError?'cached_evidence_invalid_json':'cached_evidence_unreadable_or_invalid';}
 return result;
}
