import test from 'node:test';
import assert from 'node:assert/strict';
import {researchQueue,validateReview,contentHash,buildCompanyRecords,projectCompanyRecords,campaignProgress,STATIC_FIELDS} from '../../../../../shared/job-search-core/scripts/lib/company-records.mjs';

const now='2026-09-23T01:00:00.000Z',startedAt='2026-09-23T00:00:00.000Z';
const inputs=()=>({registry:{companies:[{company_id:'a',display_name:'Synthetic',industry_tags:['internet'],primary_entry_url:'https://example.com/jobs'}]},
 business:{companies:[{company_id:'a',business_tags:['游戏'],business_summary:'旧描述',status:'verified'}]},
 ownership:{companies:[{company_id:'a',ownership_tag:'私企',status:'verified'}]},
 profiles:{companies:[{company_id:'a',workforce:{value:'8000人',status:'verified',entity:'公司',as_of:'2026-01-01',evidence:[{url:'https://example.com/report'}]}}]},
 size:{companies:[{company_id:'a',label:'小厂',ownership_tag:'国企'}]},cities:{campus:{companies:[{company_id:'a',cities:['北京'],city_coverage_complete:false}]}},reviews:{companies:[]}});
const campaign=()=>researchQueue(inputs().registry,{campaignId:'c',startedAt,vocabulary:['网络安全','游戏']});
function review() {
 const content='Synthetic provides cybersecurity products. Owned by private shareholders.';
 return {company_id:'a',campaign_id:'c',identity_reason:'Official name matches recruitment portal',
 searches:[{query:'Synthetic official company products shareholders',tool:'web.run',searched_at:now,status:'success',result_urls:['https://example.com/about']}],
 documents:[{id:'doc',url:'https://example.com/about',title:'About',content,sha256:contentHash(content),entity:'Synthetic',identity_basis:'Company name matches',fetched_at:now,tool:'web.run',read_kind:'page_body'}],
 decisions:{'tags.business':{value:['网络安全'],status:'verified',reason:'Official product disclosure',entity:'Synthetic',checked_at:now,citations:[{document_id:'doc',excerpt:'provides cybersecurity products'}]},
 'descriptions.business_summary':{value:'提供网络安全产品',status:'verified',reason:'官方产品页',entity:'Synthetic',checked_at:now,citations:[{document_id:'doc',excerpt:'provides cybersecurity products'}]}}};
}
test('structural migration never counts as fresh research and does not seed prompts with old labels',()=>{
 const data=inputs(),before=JSON.stringify(data),queue=campaign(),records=buildCompanyRecords(data,{now});
 assert.equal(JSON.stringify(data),before);assert.equal(records.companies[0].governance.fields['tags.business'].review_state,'pending');
 assert.equal(queue.companies.length,1);assert(!JSON.stringify(queue.companies).includes('游戏'));assert(!JSON.stringify(queue.companies).includes('私企'));
 assert.equal(campaignProgress(queue,data.reviews,data.cities).fully_reviewed,0);
});
test('fresh review refuses stale bodies, search snippets, unsupported terms, foreign IDs and fabricated excerpts',()=>{
 assert(validateReview(review(),campaign(),{now}));
 for(const mutate of [r=>r.company_id='b',r=>r.documents[0].fetched_at='2026-09-22',r=>r.documents[0].read_kind='search_snippet',r=>r.documents[0].content+='edited',r=>r.decisions['tags.business'].value=['新标签'],r=>r.decisions['tags.business'].citations[0].excerpt='nonexistent',r=>r.searches=[],r=>r.decisions['tags.business'].status='unknown']) {
  const row=review();mutate(row);assert.throws(()=>validateReview(row,campaign(),{now}));
 }
});
test('reviewed business is shared by matcher and report, unrelated attributes survive and size dependencies are recomputed',()=>{
 const data=inputs();data.reviews={companies:[review()]};
 const records=buildCompanyRecords(data,{now}),projected=projectCompanyRecords(records,data),row=records.companies[0];
 assert.deepEqual(projected.business.companies[0].business_tags,['网络安全']);
 assert.equal(projected.profiles.companies[0].business.value,'提供网络安全产品');
 assert.equal(projected.ownership.companies[0].ownership_tag,'私企');
 assert.equal(row.tags.organization_size,'大厂');assert.equal(projected.size.companies[0].label,'大厂');
 assert.deepEqual(row.tags.recruitment.campus.cities,['北京']);assert.equal(row.governance.recruitment.campus.city_coverage_complete,false);
 const snapshot=structuredClone(records);data.reviews.companies[0].decisions['tags.business'].value=['游戏'];
 assert.deepEqual(snapshot.companies[0].tags.business,['网络安全']);
});
test('unresolved research is distinct from untouched fields and never fabricates a positive label',()=>{
 const data=inputs(),r=review();r.decisions['tags.ownership']={value:null,status:'unresolved',reason:'没有取得控制关系证据',entity:'Synthetic',checked_at:now,citations:[]};
 assert(validateReview(r,campaign(),{now}));data.reviews={companies:[r]};
 const records=buildCompanyRecords(data,{now}),projected=projectCompanyRecords(records,data),progress=campaignProgress(campaign(),data.reviews,data.cities);
 assert.equal(projected.ownership.companies[0].ownership_tag,'待核实');assert.equal(projected.ownership.companies[0].status,'verified_unresolved');
 assert.equal(progress.searched,1);assert.equal(progress.static_complete,0);assert.equal(progress.fully_reviewed,0);assert.equal(progress.companies[0].reviewed_fields,3);
});
test('complete static research alone cannot count as all-dimensional completion; every mode needs new acquisition',()=>{
 const r=review();for(const key of STATIC_FIELDS)r.decisions[key]??={value:null,status:'unresolved',reason:'检索后未取得可靠资料',entity:'Synthetic',checked_at:now,citations:[]};
 assert(validateReview(r,campaign(),{now}));const reviews={companies:[r]};
 assert.equal(campaignProgress(campaign(),reviews).static_complete,1);assert.equal(campaignProgress(campaign(),reviews).fully_reviewed,0);
 const cities=Object.fromEntries(['campus','internship','social'].map(mode=>[mode,{companies:[{company_id:'a',last_refresh_at:now,last_refresh_status:'partial'}]}]));
 assert.equal(campaignProgress(campaign(),reviews,cities).fully_reviewed,1);
});
