import {createHash} from 'node:crypto';
export function jobFingerprint(job) {
 return createHash('sha256').update(JSON.stringify({job_id:String(job.job_id),title:job.title,description:job.description||'',requirements:job.requirements||'',locations:job.locations_raw||[],formal_status:job.formal_status,open_status:job.open_status,recruitment_evidence:job.recruitment_evidence||{}})).digest('hex');
}
export function safeJobId(id) {const value=String(id);return /^[A-Za-z0-9_-]+$/.test(value)?value:createHash('sha256').update(value).digest('hex').slice(0,20);}
