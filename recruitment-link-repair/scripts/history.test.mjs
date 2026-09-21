import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseCSV,inspectURL,queryHistory} from './history.mjs';

test('CSV preserves multiline Chinese text, quotes, commas and URL fragments',()=>{
  const rows=parseCSV('\uFEFFcompany,note,url\r\n甲公司,"职责一\n职责""二,三","https://a.test/#/jobs?id=1&org=2"\r\n');
  assert.deepEqual(rows,[{company:'甲公司',note:'职责一\n职责"二,三',url:'https://a.test/#/jobs?id=1&org=2'}]);
  assert.throws(()=>parseCSV('a,b\nx'),/column mismatch/);
  assert.throws(()=>parseCSV('a\n"oops'),/Unterminated/);
});

test('URL hints retain route identity and do not accept lookalike platform hosts',()=>{
  const raw='https://app.mokahr.com/campus-recruitment/acme/123#/jobs?department%5B0%5D=42';
  const u=inspectURL(raw); assert.equal(u.tenant_hint,'acme');assert.equal(u.site_hint,'123');
  assert.equal(u.fragment,'#/jobs?department%5B0%5D=42');
  assert.equal(inspectURL('https://wd3.myworkdaysite.com/recruiting/acme/China').tenant_hint,'acme');
  assert.equal(inspectURL('https://wd3.myworkdaysite.com/recruiting/acme/China').site_hint,'China');
  assert.equal(inspectURL('https://acme.oraclecloud.com/').site_hint,null);
  assert.equal(inspectURL('https://app.mokahr.com.evil.test/campus-recruitment/acme/123').provider,'unknown');
  assert.equal(inspectURL('javascript:alert(1)').valid_http_url,false);
});

test('history returns exact host matches, preserves repeated evidence and reports truncation without upgrading capability',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'recruitment-history-test-'));
  try{
    fs.mkdirSync(path.join(root,'index'));
    const base={company_name:'测试公司',company_id_hint:'company-x',family:'wps',url_original:'https://a.test/#/campus',url_parts:inspectURL('https://a.test/#/campus'),evidence_level:'third_party_link_observed'};
    const file=path.join(root,'index/observations.jsonl');
    const text=[{...base,source_record_id:'1'},{...base,source_record_id:'2'},{...base,url_parts:inspectURL('https://a.test.evil.test')}].map(r=>JSON.stringify(r)).join('\n');
    fs.writeFileSync(file,text);
    const result=await queryHistory({root,query:'测试',host:'A.TEST',limit:1});
    assert.equal(result.total,2);assert.equal(result.returned,1);assert.equal(result.truncated,true);
    assert.equal(result.current_availability,'not_checked');assert.equal(result.observations[0].evidence_level,'third_party_link_observed');
    assert.equal(fs.readFileSync(file,'utf8'),text);
    await assert.rejects(queryHistory({root,limit:0}),/positive integer/);
    await assert.rejects(queryHistory({root,kind:'../outside'}),/kind must/);
    fs.writeFileSync(path.join(root,'index/contracts.jsonl'),JSON.stringify({family:'waiqi_interface',provider:'jobs2web',entry_url:'https://b.test/search/',waiqi_company_ids:[23774],status:'entrance_only'})+'\n');
    const contracts=await queryHistory({root,kind:'contracts',query:'23774'});
    assert.equal(contracts.total,1);assert.equal(contracts.contracts[0].status,'entrance_only');
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('recruitment-history-test-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
