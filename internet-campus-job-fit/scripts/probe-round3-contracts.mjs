import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from './lib/http.mjs';

const output = path.resolve(process.argv[2] || 'internet-campus-job-fit/artifacts/wps-campus-sources-20260919/deep-api-review/round3-contract-probes');
await fs.mkdir(output, { recursive: true });

const probes = [
  { name: 'ct108-posts', bootstrap: 'https://campus.ct108.com/', request: { url: 'https://campus.ct108.com/api/campusrecruit/CampusPostData?code=e6592c5f7b4984988332c98afe32731d', method: 'POST' } },
  { name: '9ji-legacy-list', bootstrap: 'https://m.9ji.com/job/school', request: { url: 'https://m.9ji.com/api/jobAPI.aspx?act=getJobs&page=1&pageSize=100' } },
  { name: '9ji-cloud-list', bootstrap: 'https://m.9ji.com/job/school', request: { url: 'https://m.9ji.com/cloudapi_nc/org_service/api/hrRecruitmentStation/mobile-station-page?xservicename=oa-org&pageNum=1&pageSize=100' } },
  { name: 'ihnhr-list-snake', bootstrap: 'https://job.ihnhr.com/company/jobs?id=10685392028336822', request: { url: 'https://job.ihnhr.com/api/jobs/v3/list', method: 'POST', body: { company_id: '10685392028336822', page: 1, page_size: 100 } } },
  { name: 'ihnhr-list-camel', bootstrap: 'https://job.ihnhr.com/company/jobs?id=10685392028336822', request: { url: 'https://job.ihnhr.com/api/jobs/v3/list', method: 'POST', body: { companyId: '10685392028336822', pageNum: 1, pageSize: 100 } } },
  { name: 'sydw-posts', bootstrap: 'https://www.sydwgkzp.cn/mohrss/index.html', request: { url: 'https://www.sydwgkzp.cn/api/Affiche/GetPostSelectFyList', method: 'POST', body: { pageIndex: 1, pageSize: 100 } } },
  { name: 'leihuo-api-root', bootstrap: 'https://leihuo.163.com/campus/', request: { url: 'https://xiaozhao.leihuo.netease.com/api/' } },
  { name: 'leihuo-position-root', bootstrap: 'https://leihuo.163.com/campus/', request: { url: 'https://hr.163.com/api/hr163/position/' } },
  { name: 'pumc-title-get', bootstrap: 'https://job.pumc.edu.cn/job/index.html', request: { url: 'https://job.pumc.edu.cn/api/hr/recruit-title/findAfootTitle' } },
  { name: 'pumc-title-post', bootstrap: 'https://job.pumc.edu.cn/job/index.html', request: { url: 'https://job.pumc.edu.cn/api/hr/recruit-title/findAfootTitle', method: 'POST', body: {} } },
  { name: 'crec-tree', bootstrap: 'https://zhr.crec.cn/zhaopin/', request: { url: 'https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/companyTree', headers: { clientId: 'crechr', appId: '5549', tenantId: 'crechr' } } },
  { name: 'crec-campus-all', bootstrap: 'https://zhr.crec.cn/zhaopin/', request: { url: 'https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/postPage?pageSize=1000&pageNum=1&workType=10271001', headers: { clientId: 'crechr', appId: '5549', tenantId: 'crechr' } } },
  { name: 'cscec8b-names', bootstrap: 'https://job.cscec8b.com.cn/8bfz', request: { url: 'https://job.cscec8b.com.cn/cscec8b/81/names.json' } },
  { name: 'citics-branch-list', bootstrap: 'https://careers.citics.com/campus/branch/', request: { url: 'https://global-kong.citics.com/api/v1/recruit/getPositionList', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ sysNo: 'CSE001', recruitType: '08', deptype: 'Branch', pageSize: '100', pageNo: '1' }) } },
  { name: 'citics-hq-list', bootstrap: 'https://careers.citics.com/campus/headquarters/', request: { url: 'https://global-kong.citics.com/api/v1/recruit/getPositionList', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ sysNo: 'CSE001', recruitType: '08', deptype: 'Headquarter', batchId: '63', practice: '0', pageSize: '100', pageNo: '1' }) } },
  { name: 'citics-detail', bootstrap: 'https://careers.citics.com/campus/branch/', request: { url: 'https://global-kong.citics.com/api/v1/recruit/getPositionInfo', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ sysNo: 'CSE001', recruitType: '08', deptype: 'Branch', positionNo: '5264', deptNo: '640', batchId: '53', practice: '0', source: 'pc' }) } },
];

const summarize = value => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return String(value).slice(0, 500);
  if (Array.isArray(value)) return { type: 'array', length: value.length, sample: value.slice(0, 2) };
  const keys = Object.keys(value);
  const summary = { type: 'object', keys: keys.slice(0, 50) };
  for (const key of keys) {
    const item = value[key];
    if (Array.isArray(item)) summary[key] = { length: item.length, sample: item.slice(0, 2) };
    else if (item && typeof item === 'object') summary[key] = { keys: Object.keys(item).slice(0, 30) };
    else summary[key] = typeof item === 'string' ? item.slice(0, 500) : item;
  }
  return summary;
};

const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < probes.length) {
    const probe = probes[cursor++];
    const dir = path.join(output, probe.name);
    const client = createClient({ evidenceDir: path.join(dir, 'http'), timeoutMs: 30000 });
    const result = { name: probe.name, checked_at: new Date().toISOString() };
    try {
      const boot = await client.request({ url: probe.bootstrap, headers: { Accept: 'text/html,*/*' } }, { purpose: 'public_recruitment_bootstrap' });
      result.bootstrap = { status: boot.record.http_status, final_url: boot.url, response_file: boot.record.response_file };
      const response = await client.request(probe.request, { purpose: 'round3_candidate_job_api' });
      result.response = { status: response.record.http_status, final_url: response.url, content_type: response.record.content_type, response_file: response.record.response_file, is_json: response.record.response_is_json };
      result.summary = summarize(response.data ?? response.text);
    } catch (error) { result.error = error.message; result.record = error.record || null; }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    results.push(result);
    console.log(JSON.stringify({ name: result.name, status: result.response?.status, json: result.response?.is_json, error: result.error, keys: result.summary?.keys, length: result.summary?.length }));
  }
}));
results.sort((a, b) => a.name.localeCompare(b.name));
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2) + '\n');
