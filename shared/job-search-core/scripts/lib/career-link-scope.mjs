/** Conservative boundary for company/interface discovery, not a general URL classifier. */
export function isIndividualJobRoute(url){
  const u=new URL(url);
  if(/\/api\/v1\/search\/job\/posts$|\/api\/Jobad\/GetJobAdPageList$|\/api\/outer\/ats-apply\/website\/jobs\/v2$|\/listPosition\/[^/]+$|\/hcmRestApi\/resources\/.*recruitingCEJobRequisitions$|\/wday\/cxs\/[^/]+\/[^/]+\/jobs$/.test(u.pathname))return false;
  return /\/(?:job|jobdetail|job-detail-new|position\/detail|m\/position)\/|\/jobs\/(?:\d+|detail)(?:[/.]|$)|jobreqcareerpvt/i.test(u.pathname)
    ||[...u.searchParams.keys()].some(k=>/^(?:jobid|job_id|positionid|requisitionid)$/i.test(k));
}
