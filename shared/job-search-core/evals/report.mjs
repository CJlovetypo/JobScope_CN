import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url)),pack=path.resolve(root,'../../..');
const sourcePath=path.join(pack,'docs/用户提示词模拟100例.md'),raw=await fs.readFile(sourcePath,'utf8');
const sourceHash=createHash('sha256').update(raw).digest('hex');
const cases=[...raw.matchAll(/^### (\d{3})｜([^\r\n]+)\r?\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)].map(m=>({
  id:m[1],prompt:m[3].split(/\r?\n/).filter(l=>l.startsWith('>')).map(l=>l.replace(/^>\s?/,'')).join('\n'),
  context:m[3].match(/前置上下文：([^\r\n]+)/)?.[1]||null}));
if(cases.length!==100||cases.some((c,i)=>c.id!==String(i+1).padStart(3,'0')||!c.prompt))throw Error('用例源必须完整包含001–100');
const read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const save=async(file,value,exclusive=false)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:exclusive?'wx':'w'});};
if(process.argv[2]==='extract'){
 const index=process.argv.indexOf('--out');if(index<0||!process.argv[index+1])throw Error('需要 --out 新输入目录');
 const out=path.resolve(process.argv[index+1]);
 for(const [name,start,end] of [['001-034',1,34],['035-067',35,67],['068-100',68,100]])await save(path.join(out,name+'.json'),{
   is_test:true,date:'2026-09-22',timezone:'Asia/Shanghai',source_sha256:sourceHash,
   material_state:'Only prompt text and stated context exist. No attachments, JD, reports or tool results are supplied.',
   cases:cases.filter(c=>+c.id>=start&&+c.id<=end)},true);
 console.log(JSON.stringify({cases:100,out,source_sha256:sourceHash}));
}else{
 const batches=['001-034','035-067','068-100'];
 const results=(await Promise.all(batches.map(b=>read('results/'+b+'.json')))).flat();
 const reviews=(await Promise.all(batches.map(b=>read('reviews/'+b+'.json')))).flat();
 const retests=await read('retests/behavior-r2.json'),rereviews=await read('reviews/behavior-r2.json');
 const index=(rows,name)=>{
  const out=new Map();for(const row of rows){if(!cases.some(c=>c.id===row.id)||out.has(row.id))throw Error(name+'含未知或重复编号 '+row.id);out.set(row.id,row);}return out;
 };
 const originals=index(results,'results'),originalReviews=index(reviews,'reviews'),revised=index(retests,'retests'),revisedReviews=index(rereviews,'rereviews');
 if(originals.size!==100||originalReviews.size!==100)throw Error('缺少实际首轮模拟或独立复核');
 if(revised.size!==revisedReviews.size||[...revised.keys()].some(id=>!revisedReviews.has(id)))throw Error('复测与独立复核不齐');
 const merged=cases.map(c=>{
  const result=revised.get(c.id)||originals.get(c.id),review=revisedReviews.get(c.id)||originalReviews.get(c.id);
  if(!result.actual_first_response?.trim()||!Array.isArray(result.questions)||!Array.isArray(result.independent_actions)||!result.known_conditions)throw Error('缺少真实模拟内容 '+c.id);
  if(!['pass','needs_fix'].includes(review.status)||!review.reason?.trim())throw Error('缺少独立复核依据 '+c.id);
  return {...c,round:revised.has(c.id)?2:1,result,review};
 });
 const summary={is_test:true,kind:'simulated_first_turn_behavior_with_cross_review',source_sha256:sourceHash,
  initial:{total:100,pass:reviews.filter(r=>r.status==='pass').length,needs_fix:reviews.filter(r=>r.status==='needs_fix').map(r=>r.id)},
  retested:retests.map(r=>r.id),final:{total:100,pass:merged.filter(c=>c.review.status==='pass').length,needs_fix:merged.filter(c=>c.review.status!=='pass').map(c=>c.id)},
  limitations:['Not 100 live end-to-end job searches.','No real attachments or scheduler/network mutations in behavioral runs.','Initial inputs included scenario titles; cross-review and retests excluded them as user evidence.','Summary validates recorded evidence, not semantic correctness automatically.']};
 await save(path.join(root,'final-cases.json'),{summary,cases:merged});
 const compact=s=>String(s??'').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
 const lines=['# 100例业务决策验收明细','',`首轮 ${summary.initial.pass}/100 通过；复测 ${summary.retested.join('、')}；最终 ${summary.final.pass}/100 通过。`,
  '', '这是首轮行为模拟和交叉评审；不代表100个真实在线搜索、完整匹配或调度任务。',
  '', '| 编号 | 轮次 | 结论 | 复核依据 |','| --- | --- | --- | --- |',
  ...merged.map(c=>`| ${c.id} | ${c.round} | ${c.review.status==='pass'?'通过':'需修正'} | ${compact(c.review.reason)} |`),''];
 for(const c of merged){
  lines.push(`## ${c.id}`,'',`用户：${c.prompt}`,...(c.context?['',`前置上下文：${c.context}`]:[]),'','实际模拟首答：','',c.result.actual_first_response,'',
    `补问：${c.result.questions.join('；')||'无'}`,'',`可先推进：${c.result.independent_actions.join('；')}`,'',`复核：${c.review.reason}`,'');
 }
 await save(path.join(root,'100例验收明细.md'),lines.join('\n'));
 console.log(JSON.stringify(summary));if(summary.final.needs_fix.length)process.exitCode=2;
}
