// Summarize saved real simulations and independent reviews; does not run an LLM.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const [input,first,review,retest,recheck]=await Promise.all(['prompts.json','responses.json','review.json','retest.json','retest-review.json'].map(read));
const index=items=>{const map=new Map(items.map(x=>[x.id,x]));assert.equal(map.size,items.length,'duplicate IDs');return map;};
const inputs=index(input.cases),initial=index(first.cases),reviews=index(review.cases),fixes=index(retest.cases),checks=index(recheck.cases);
assert.equal(inputs.size,100);assert.equal(initial.size,100);assert.equal(reviews.size,100);
const final=[];
for(const [id,prompt]of inputs){
  assert(initial.has(id)&&reviews.has(id),'Missing '+id);
  const was=reviews.get(id),response=fixes.get(id)||initial.get(id),judgment=fixes.has(id)?checks.get(id):was;
  assert(judgment&&typeof judgment.pass==='boolean','No independent final review '+id);
  assert(Array.isArray(response.questions)&&response.questions.length<=3,'Question count '+id);
  final.push({id,prompt:prompt.prompt,context:prompt.context,initial_pass:was.pass,final_pass:judgment.pass,retested:fixes.has(id),response:response.response,questions:response.questions,next_actions:response.next_actions,decision:response.decision,review:judgment});
}
for(const id of fixes.keys())assert(inputs.has(id)&&checks.has(id),'Unexpected retest '+id);
const summary={method:'100 first-response simulations with independent review; no network or external side effects',initial_passed:[...reviews.values()].filter(x=>x.pass).length,initial_failed:[...reviews.values()].filter(x=>!x.pass).length,retested:fixes.size,final_passed:final.filter(x=>x.final_pass).length,final_failed:final.filter(x=>!x.final_pass).length};
await fs.writeFile(path.join(root,'final-cases.json'),JSON.stringify({summary,cases:final},null,2)+'\n');
await fs.writeFile(path.join(root,'100例验收明细.md'),'# v5 100例首轮行为验收\n\n此文件仅汇总已实际执行的模拟与独立审核，不代表重新调用模型或真实联网任务。\n\n初轮 '+summary.initial_passed+'/100；返修 '+summary.retested+' 条；最终 '+summary.final_passed+'/100。原始回复和失败审核保留。\n\n| ID | 初轮 | 最终 | 复核依据 |\n| --- | --- | --- | --- |\n'+final.map(x=>`| ${x.id} | ${x.initial_pass?'通过':'失败'} | ${x.final_pass?'通过':'失败'}${x.retested?'（返修）':''} | ${String(x.review.evidence||x.review.reason||'见JSON记录').replace(/\|/g,'／').replace(/\n/g,' ')} |`).join('\n')+'\n');
console.log(JSON.stringify(summary));
