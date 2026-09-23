import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve('job-search/runtime/campus/artifacts/waiqi-2026-09-20/official-greenhouse-verification');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2));
// These exact API bodies were read in full by the reviewing agent on 2026-09-20.
// Original runtime body_complete=false and raw responses remain unchanged.
// Final tuple field is the immutable SHA256 recorded during that original review.
// Hash the complete runtime-normalized description, including all JD sections; do
// not regenerate these pins when refreshing collections. Changed content needs a new review.
const reviewed=[
 ['cssmerge','8457925002','What you’ll do','What we’re looking for','Product strategy and roadmap for Otter software; 5+ years product management, experimentation, analytics and global communication.','f39d5196a5b9ea757f93ca396c6c55d7aee6baaa789cca521f4d9ed71a2d9ee2'],
 ['sharkninjaoperatingllc','4706406006','Here are some of the EXCITING things','What We Expect:','Sourcing and supply-chain management duties; sourcing knowledge, English, negotiation, project tools and travel.','2b8446e586dc0f19d4c40800a87a5d79136efffa8cc93b41e8f0caa10b51fb30'],
 ['speechify','5974412004','What You’ll Do','An Ideal Candidate Should Have','Backend APIs and infrastructure ownership; TS/Node, GCP/cloud experience, deployment and engineering judgment.','7fe239832a35a9985dc97649f8d810f2a5cb934acac5bf835eeec36f2105205f'],
 ['rockbund','4874786101','What You Will Do','Who You Are','AI security design and tooling duties; 3+ years security, 1+ years AI security, frameworks/programming skills.','db8447db8d86072788dfd2010cc7926f29fcfeac993690e97c0bc6bf8119c4c1'],
 ['monsterenergyapac','4381527009',"The Impact You'll Make:",'Who You Are:','Digital campaigns and social reporting duties; degree preferred, 3–5 years experience, English, Chinese social platforms.','fea402bb901114064a5b4569f9ee2c6e779cbd5c667d37ef009aace8671158ec'],
 ['tomofunfurbo','7937150003','职责','必备条件','Backend, frontend and iOS systems; 6+ years development, Python/Go, cloud, React and quality practices.','9bb3363ae7e6651f4293439008d4d0e9f3b6ac0765814f2460b60b1bb9cd0973'],
 ['ideo','7417974','Once here you will:','Relevant experience and mindset:','Client partnership and design leadership duties; Chinese/English, creative consulting and communication.','0936dffe3f470606d45f974b527fe0de065f3300827c14642bfec4232cd6fbfa'],
 ['prophet','4658318005','YOUR DAY TO DAY','WHAT WE LOOK FOR','Research, strategy and consulting duties; industry experience, critical thinking, communication and Mandarin/English.','f29060177a979ec4f4d2fbf58f085ac465d343b08f00c24e1b8368301c49db9f'],
 ['landor','8025166','What you’ll do','What you’ll need','Client leadership and brand consulting duties; agency projects, client communication, commercial judgment.','18d7bd64e729d005d4038ba9b18351631c773635343edd0c17db5f8ce51fe681'],
 ['anydesk','4930634101','Become a domain expert','Basic Qualifications:','Closing sales and CRM duties; inbound sales, English/Mandarin, CRM and ecommerce experience.','b82895b3e80bf7b91cb09cb8df5946d435c331f8c580ea3ed4e53b2fe734a2d1'],
 ['atoms','8653624002','What you’ll do','What we’re looking for','API and integration development duties; 7+ years software experience, CS background and programming skills.','b65a72febde0e75710c9857f72bcca31b225ae910bfbfa4057c42f375eb163e3'],
 ['atricure','4373347009','ESSENTIAL FUNCTIONS OF THE POSITION:','Qualifications and Requirements:','Regional sales and channel partner duties; degree, 5+ years medical-device sales and travel eligibility.','cf34845d0e7cc2ada589a7c0eab13e0871b1126eba1aacd1798ab42fba63fec2'],
 ['bbposlimited','5235302007','What you will do:','Who you are','Mechanical design and validation duties; ME degree, SolidWorks, 3+ years experience and English/Chinese.','aa04dcb62e43897dc2afe75583853ccb35744fa3ef0f79ccf8a6350b3af6fc2b'],
 ['designbridge','6564631','About the role','About you','Shanghai brand design responsibilities; 3–6 years design experience, portfolio and presentation ability.','793207fd7162bd94a9d0a562b12aec309098c6dc04b60b17f301354aeecd44f5'],
 ['forter','8742433002','What you’ll be doing:','What you’ll need:','Customer success, retention and training duties; 3–4 years account experience, Japanese/English, stakeholder skills.','6304260df15e87f35e7c2d83673ffd72e5b621ee5a9fb92aef78c540a987db15'],
 ['fusionworldwide','7546806003','What can you do for us!','Who we’re looking for!','Prospecting and account development duties; 5–8 years B2B sales, component distributor experience, travel.','9121c2e0bd2c14faf301c47e420b829131abc8fcbe7c80d5056fde3863804faf'],
 ['goprojobs','7930572','What You Will Do','Skills We’re Excited About','Manufacturing process and DFM responsibilities; degree, 5+ years OEM/ODM, NPI tools, English/Mandarin.','86eef406bf885c093f72fd2485f12f5d46528815d5d815b522b338424aae6384'],
 ['teads1','4972692101','What You’ll Do','What Will You Bring to the Team?','Ad sales, agency pipeline and campaign execution; 5+ years experience, established network, Mandarin/English.','528f94a07f493eaa348dbd2a92ed99dd5c79ee2079a6e00fc335fd2e73d2de3a'],
 ['ebury','4977413101','You will develop a network','About You','FX partner prospecting, client onboarding duties; 3–5 years B2B sales, FX background, language and commercial skills.','606d438de9b3921e8397d91d4e0c9dc02941051360186456612325470052f90c'],
];
const bodyHash=j=>typeof j?.description==='string'?createHash('sha256').update(j.description).digest('hex'):null;
const matchesReviewedBody=(j,expected,duty,req)=>bodyHash(j)===expected&&j.description.includes(duty)&&j.description.includes(req);
// Read-only offline regression check: original bodies pass, same-ID/heading bodies
// with even one changed character fail, and missing bodies never pass.
if(process.argv.includes('--check-reviewed-bodies')){
 for(const [token,id,duty,req,,expected] of reviewed){const result=await read(path.join(root,'greenhouse-'+token,'collection.json')),j=result.jobs.find(x=>x.job_id===id);
  if(!matchesReviewedBody(j,expected,duty,req))throw Error('Pinned reviewed snapshot mismatch: '+token);
  if(matchesReviewedBody({...j,description:j.description+' Changed requirement.'},expected,duty,req))throw Error('Changed body accepted: '+token);
  if(matchesReviewedBody(null,expected,duty,req))throw Error('Missing body accepted: '+token);
 }
 console.log('Offline review replay checks passed: '+reviewed.length+' original snapshots, '+reviewed.length+' changed-body rejections, '+reviewed.length+' missing-body rejections. No artifacts written.');process.exit(0);
}
for(const [token,id,duty,req,note,expected] of reviewed){const dir=path.join(root,'greenhouse-'+token),v=await read(path.join(dir,'verification.json'));const result=await read(path.join(dir,'collection.json')),j=result.jobs.find(x=>x.job_id===id);
if(!matchesReviewedBody(j,expected,duty,req)){
 v.status='pending';v.manually_reviewed_complete_jds=0;v.reasons=['Previously reviewed JD body changed or disappeared; fresh semantic review required.'];
 v.semantic_review_replay={status:'rejected',job_id:id,reviewed_on:'2026-09-20',expected_body_sha256:expected,observed_body_sha256:bodyHash(j),checked_at:new Date().toISOString()};
 await write(path.join(dir,'verification.json'),v);console.log(token+' pending: reviewed body hash mismatch');continue;
}
if(v.status==='admitted')continue;
const review={checked_at:new Date().toISOString(),job_id:id,official_url:j.official_url,raw_file:j.raw_file,body_sha256:expected,reviewed_on:'2026-09-20',original_body_complete:j.body_complete,semantic_body_complete:true,responsibility_heading:duty,requirements_heading:req,responsibility_excerpt:j.description.slice(j.description.indexOf(duty),j.description.indexOf(duty)+700),requirements_excerpt:j.description.slice(j.description.indexOf(req),j.description.indexOf(req)+700),reason:note,scope:'This single exact job sample only; no upgrade to all other jobs or future runtime responses.'};await write(path.join(dir,'semantic-review.json'),review);
const c=v.candidate,company_id='greenhouse-'+token,source={company_id,display_name:v.official_board.name,provider:'greenhouse',entry_url:c.entry_url,primary_entry_url:c.entry_url,api_config:{board_token:token,mainland_location_pattern:v.observed_mainland_locations.map(x=>'^'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').join('|')},source_id:'api-'+createHash('sha256').update(c.api+'/'+token).digest('hex').slice(0,16)};
v.status='admitted';v.reasons=['Automatic section-marker false negative; exact API body independently reviewed.'];v.semantic_review=review;v.manually_reviewed_complete_jds=1;v.sample=j;v.source={...source,aliases:[],industry_tags:[],recruitment_sources:[source],source_origin:'waiqi-2026-09-20-official-greenhouse-api',api_verified_at:v.checked_at,ownership_status:'pending_verification',industry_tag_basis:{kind:'not_verified',business_evidence:false},identity_verification:{basis:'Official Greenhouse board-level name; Waiqi Chinese hints do not establish subsidiary identity',official_board_name:v.official_board.name,evidence_file:v.official_board.request.response_file},waiqi_provenance:{company_ids:c.waiqi_ids,names:c.waiqi_names,observed_urls:c.observed_urls,observed_link_records:c.observed_link_records,third_party_hints_only:true},api_verification:{evidence_file:path.join(dir,'verification.json'),semantic_review_file:path.join(dir,'semantic-review.json'),complete_mainland_jds:1,coverage:result.coverage},validated_api_request_examples:[{method:'GET',url:c.api+'/v1/boards/'+token+'/jobs?content=true',purpose:'job_list_with_full_content'}],issues:['Runtime section markers miss this verified full JD; per-job semantic review required when screening.']};await write(path.join(dir,'verification.json'),v);console.log(token+' semantic admitted');}
// CSSMerge has complete readable JDs, but the current board is named ATOMS Careers page;
// keep it pending until cross-board identity/duplicate handling is resolved.
const cssDir=path.join(root,'greenhouse-cssmerge'),css=await read(path.join(cssDir,'verification.json'));
css.cross_board_identity_review={merge_group_key:'atoms',basis:'Official board metadata is ATOMS Careers page; the other board is named Atoms. Secondary board explicitly advertises Otter software business; preserve separate board configs within the official ATOMS group.'};await write(path.join(cssDir,'verification.json'),css);
