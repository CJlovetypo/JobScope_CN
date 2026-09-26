import {publishPublicRecords} from './lib/public-company-data.mjs';
import {ARCHIVE_FILE,REVIEWS_FILE,API_LABELS_FILE,INTERNAL_RECORDS_FILE,RESEARCH_ROOT,RAW_ROOT,resolveResearchRecord} from '../maintenance-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CORE_ROOT,PACK_ROOT} from '../runtime-context.mjs';
import {loadCompanyInputs,buildCompanyRecords,projectCompanyRecords,researchQueue,validateReview,campaignProgress,REVIEW_FILE,indexById,mergePublishedReview} from './lib/company-records.mjs';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function save(p,value,{exclusive=false,compact=false}={}) {
  await fs.mkdir(path.dirname(p),{recursive:true});
  const body=JSON.stringify(value,null,compact?0:2)+'\n';
  if(exclusive)return fs.writeFile(p,body,{flag:'wx'});
  const tmp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,body);await fs.rename(tmp,p);
}
function artifactPath(p) {
  const root=path.join(PACK_ROOT,'job-search/artifacts'),full=path.resolve(p),rel=path.relative(root,full);
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('复核工作目录必须位于 job-search/artifacts');
  return full;
}
async function documentsFromFiles(review,root) {
  const copy=structuredClone(review);
  for(const doc of copy.documents||[])if(doc.content_file) {
    const p=path.resolve(root,doc.content_file),rel=path.relative(root,p);
    if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('正文文件必须位于本轮工作目录');
    doc.content=await fs.readFile(p,'utf8');delete doc.content_file;
  }
  return copy;
}
export async function main(argv=process.argv.slice(2)) {
  const [command,...args]=argv,opts={};
  for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('参数必须为 --key value');const key=args[i].slice(2);if(Object.hasOwn(opts,key))throw Error('重复参数 '+key);opts[key]=args[++i];}
  if(!command||command==='help'){console.log('公司画像维护：init --campaign ID --out job-search/artifacts/目录；export --out 画像.json；next --work 目录 [--limit 4]；record --work 目录 --file 复核记录.json；status --work 目录；publish --work 目录。init全量重审，不继承旧核实结论；record仅接受本轮联网证据；日常求职不调用。');return;}
  const inputs=await loadCompanyInputs({includeResearch:['export','publish'].includes(command)});
  if(command==='export') {
    const file=opts.out?artifactPath(opts.out):INTERNAL_RECORDS_FILE;
    const result=buildCompanyRecords(inputs);await save(file,result,{compact:true});console.log(JSON.stringify({file,companies:result.companies.length,operation:'structural_export_not_reverification'}));return;
  }
  if(command==='init') {
    if(!opts.campaign||!opts.out)throw Error('init需要 --campaign 与 --out');
    const root=artifactPath(opts.out),vocabulary=inputs.business.companies.flatMap(c=>c.business_tags||[]);
    const campaign=researchQueue(inputs.registry,{campaignId:opts.campaign,vocabulary});
    await save(path.join(root,'campaign.json'),campaign,{exclusive:true});
    await save(path.join(root,'baseline.json'),inputs,{exclusive:true});
    console.log(JSON.stringify({work:root,companies:campaign.companies.length,searched:0,reviewed:0}));return;
  }
  if(!opts.work)throw Error('需要 --work');
  const root=artifactPath(opts.work),campaign=await read(path.join(root,'campaign.json'));
  const dir=path.join(root,'reviews');await fs.mkdir(dir,{recursive:true});
  const reviews={companies:await Promise.all((await fs.readdir(dir)).filter(f=>f.endsWith('.json')).sort().map(f=>read(path.join(dir,f))))};
  if(command==='record') {
    if(!opts.file)throw Error('record需要 --file');
    let record=await documentsFromFiles(await read(path.resolve(opts.file)),root);
    const existing=reviews.companies.find(r=>r.company_id===record.company_id);
    if(existing) {
      if(record.campaign_id!==existing.campaign_id)throw Error('不能跨批次合并');
      const docs=new Map(existing.documents.map(d=>[d.id,d]));
      for(const d of record.documents||[]) {if(docs.has(d.id)&&JSON.stringify(docs.get(d.id))!==JSON.stringify(d))throw Error('证据ID已存在且内容不同');docs.set(d.id,d);}
      for(const [key,value] of Object.entries(record.decisions||{}))if(existing.decisions[key]&&JSON.stringify(existing.decisions[key])!==JSON.stringify(value))throw Error('字段已有不同结论，请新建修订批次');
      record={...existing,...record,searches:[...existing.searches,...record.searches],documents:[...docs.values()],decisions:{...existing.decisions,...record.decisions}};
    }
    validateReview(record,campaign);
    const file=path.join(dir,record.company_id+'.json');
    await save(path.join(root,'submissions',record.company_id+'-'+randomUUID()+'.json'),record,{exclusive:true});
    await save(file,record);console.log(JSON.stringify({file,company_id:record.company_id,fields:Object.keys(record.decisions).length}));return;
  }
  const progress=campaignProgress(campaign,reviews,inputs.cities);
  if(command==='next') {
    const limit=Number(opts.limit||4);if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('limit必须为1-100');
    // No labels/descriptions/evidence from the old baseline are sent to the researcher.
    const pending=progress.companies.filter(c=>!c.static_complete).slice(0,limit);
    console.log(JSON.stringify({campaign_id:campaign.campaign_id,started_at:campaign.started_at,required_fields:campaign.required_fields,
      companies:pending.map(({company_id,display_name,aliases,recruitment_urls,reviewed_fields})=>({company_id,display_name,aliases,recruitment_urls,reviewed_fields}))}));return;
  }
  if(command==='status') {
    await save(path.join(root,'progress.json'),progress);
    const {companies,...summary}=progress;console.log(JSON.stringify(summary));return;
  }
  if(command==='publish') {
    const {assertMaintenanceInputs}=await import('../maintenance-paths.mjs');await assertMaintenanceInputs();
    for(const review of reviews.companies)validateReview(review,campaign);
    const known=new Set(inputs.registry.companies.map(c=>c.company_id));
    if(reviews.companies.some(c=>!known.has(c.company_id)))throw Error('主体已不在当前主档，不能发布');
    const previous=indexById(inputs.reviews);
    for(const review of reviews.companies) {
      const old=previous.get(review.company_id);
      if(old&&JSON.stringify(old)===JSON.stringify(review))continue;
      previous.set(review.company_id,mergePublishedReview(old,review));
    }
    const next={schema_version:1,updated_at:new Date().toISOString(),companies:[...previous.values()]};
    buildCompanyRecords({...inputs,reviews:next});
    await save(path.join(root,'published-before-'+randomUUID()+'.json'),inputs.reviews,{exclusive:true});
    await save(REVIEW_FILE,next);
    const records=buildCompanyRecords({...inputs,reviews:next});
    await save(INTERNAL_RECORDS_FILE,records,{compact:true});
    await publishPublicRecords(records,projectCompanyRecords(records,inputs));
    await save(path.join(root,'progress.json'),progress);
    const {companies,...summary}=progress;console.log(JSON.stringify({published:reviews.companies.length,...summary}));return;
  }
  throw Error('未知公司画像命令：'+command);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
