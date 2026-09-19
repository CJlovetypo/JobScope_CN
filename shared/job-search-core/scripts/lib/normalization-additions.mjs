// Suggested narrow additions, grounded in this review's saved public API bodies.
export function smartRecruitersOpenStatus(d,fromPublishedList=false){
 if(d.active===false||String(d.visibility||'').toUpperCase()==='INTERNAL')return 'closed';
 if(d.active===true&&String(d.visibility||'').toUpperCase()==='PUBLIC')return 'open';
 if(fromPublishedList&&d.postingUrl)return 'open';
 return 'unknown';
}
// Existing requirement headings remain first choice. These are additional explicit
// requirement headings actually seen at MMC, Baker Hughes and HSF/Kewei.
export function additionalRequirements(description){
 const re=/(?:^|\n)\s*(?:What you need to have\s*[:：]?|Who Can Apply\s*[:：]?|To be successful in this role(?: you will)?\s*[:：]?|Penultimate year LLM student\b)/im;
 const m=re.exec(description||'');if(!m||m.index<35)return null;const requirements=description.slice(m.index).trim();if(requirements.length<30)return null;return{requirements,body_complete:true,requirement_boundary:m[0].trim()};
}
