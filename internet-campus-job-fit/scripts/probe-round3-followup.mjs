import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const outDir = path.resolve(process.argv[2] || 'internet-campus-job-fit/artifacts/wps-campus-sources-20260919/deep-api-review/round3-followup-probes');
await fs.mkdir(outDir, { recursive: true });

const results = [];
const short = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === 'string' && item.length > 1200) return `${item.slice(0, 1200)}…`;
  if (Array.isArray(item) && item.length > 5) return [...item.slice(0, 5), { _omitted: item.length - 5 }];
  return item;
}));

async function probe(name, url, options = {}) {
  const started = Date.now();
  const headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0', ...(options.headers || {}) };
  let body = options.body;
  if (body && !(body instanceof URLSearchParams) && typeof body !== 'string') {
    headers['Content-Type'] ||= 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { ...options, headers, body, redirect: 'follow' });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const record = { name, url: response.url, status: response.status, content_type: response.headers.get('content-type'), elapsed_ms: Date.now() - started, data: short(data) };
  results.push(record);
  await fs.writeFile(path.join(outDir, `${name}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ name, status: record.status, type: record.content_type, keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [], preview: typeof data === 'string' ? data.slice(0, 140) : undefined }));
  return data;
}

// PUMC: the public page sets companyCode as dept and defaults type to 2.
for (const base of ['https://job.pumc.edu.cn/api/hr', 'https://job.pumc.edu.cn/api/hr/']) {
  const suffix = base.endsWith('/') ? '/recruit-title/findAfootTitle' : '/recruit-title/findAfootTitle';
  await probe(`pumc-title-${base.endsWith('/') ? 'double' : 'single'}`, base + suffix, {
    method: 'POST', body: { currentPage: 1, pageSize: 100, type: '2', dept: '1010' },
    headers: { Referer: 'https://job.pumc.edu.cn/job/index.html?companyCode=1010' },
  }).catch(error => console.log(JSON.stringify({ name: 'pumc', error: error.message })));
}

// CITICS: inspect current branch detail using every field returned by the list.
const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Referer: 'https://careers.citics.com/campus/branch/' };
const citicsList = await probe('citics-branch-current', 'https://global-kong.citics.com/api/v1/recruit/getPositionList', {
  method: 'POST', headers: formHeaders, body: new URLSearchParams({ sysNo: 'CSE001', recruitType: '08', deptype: 'Branch', pageSize: '100', pageNo: '1' }),
});
const branch = citicsList?.positionList?.[0];
if (branch) {
  for (const params of [
    { sysNo: 'CSE001', recruitType: '08', deptype: 'Branch', positionNo: branch.positionNo, deptNo: branch.deptNo },
    { sysNo: 'CSE001', recruitType: '08', positionNo: branch.positionNo, deptNo: branch.deptNo },
    { sysNo: 'CSE001', recruitType: '08', deptype: 'Branch', positionNo: branch.positionNo },
  ]) await probe(`citics-detail-${results.length}`, 'https://global-kong.citics.com/api/v1/recruit/getPositionInfo', { method: 'POST', headers: formHeaders, body: new URLSearchParams(params) });
}
for (const [name, params] of [
  ['hq', { recruitType: '08', deptype: 'Headquarter', batchId: '63', practice: '0' }],
  ['operations', { recruitType: '08', deptype: 'Headquarter', batchId: '64', practice: '13' }],
  ['competition', { recruitType: '08', deptype: 'Headquarter', batchId: '59', practice: '0', isShow: '1' }],
]) await probe(`citics-${name}`, 'https://global-kong.citics.com/api/v1/recruit/getPositionList', { method: 'POST', headers: formHeaders, body: new URLSearchParams({ sysNo: 'CSE001', pageSize: '100', pageNo: '1', ...params }) });

// China Railway: enumerate every company represented in the official tree.
const crecHeaders = { clientId: 'crechr', appId: '5549', tenantId: 'crechr', Referer: 'https://zhr.crec.cn/zhaopin/' };
const tree = await probe('crec-company-tree', 'https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/companyTree', { headers: crecHeaders });
const companies = [];
const visit = value => {
  if (!value || typeof value !== 'object') return;
  if (value.pkCompany && value.companyName) companies.push({ pkCompany: String(value.pkCompany), pkOrg: String(value.pkOrg || ''), companyName: value.companyName, companyRegion: value.companyRegion, contactsAddress: value.contactsAddress });
  if (Array.isArray(value)) value.forEach(visit);
  else Object.values(value).forEach(visit);
};
visit(tree?.data);
const uniqueCompanies = [...new Map(companies.map(item => [item.pkCompany, item])).values()];
const active = [];
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < uniqueCompanies.length) {
    const company = uniqueCompanies[cursor++];
    const query = new URLSearchParams({ pageSize: '1000', pageNum: '1', workType: '10271001', pkCompany: company.pkCompany });
    try {
      const response = await fetch(`https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/postPage?${query}`, { headers: { ...crecHeaders, Accept: 'application/json' } });
      const json = await response.json();
      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.records) ? json.data.records : [];
      if (rows.length) active.push({ ...company, rows });
    } catch (error) { active.push({ ...company, error: error.message, rows: [] }); }
  }
}));
active.sort((a, b) => a.companyName.localeCompare(b.companyName, 'zh-CN'));
await fs.writeFile(path.join(outDir, 'crec-active-companies.json'), JSON.stringify({ company_count: uniqueCompanies.length, active_count: active.filter(x => x.rows.length).length, job_count: active.reduce((n, x) => n + x.rows.length, 0), active }, null, 2) + '\n');
console.log(JSON.stringify({ name: 'crec-enumeration', company_count: uniqueCompanies.length, active_count: active.filter(x => x.rows.length).length, job_count: active.reduce((n, x) => n + x.rows.length, 0) }));
const firstCrec = active.find(x => x.rows.length)?.rows[0];
const crecId = firstCrec?.postId || firstCrec?.id || firstCrec?.pkPost;
if (crecId) await probe('crec-first-detail', `https://zhr.crec.cn/api/hr-basic-recruit/webPage/info/postInfo?postId=${encodeURIComponent(crecId)}`, { headers: crecHeaders });

// IGuopin public API signature copied from the public frontend bundle.
function signedHeaders(method, apiPath) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  const secret = 'cu4&dYe*feF8t$E9m';
  const bucket = Math.floor(timestamp / 180);
  const inner = crypto.createHmac('sha256', secret).update(`${new Date(timestamp * 1000).toISOString().slice(0, 10).replaceAll('-', '')}:${bucket}`).digest('hex');
  const canonical = [timestamp, nonce, method.toUpperCase(), apiPath, 'pc'].join('|');
  const sign = crypto.createHmac('sha256', inner).update(canonical).digest('hex');
  return { Device: 'pc', Version: '5.2.300', Subsite: 'ihnhr', Sign: sign, T: String(timestamp), Nonce: nonce, Origin: 'https://job.ihnhr.com', Referer: 'https://job.ihnhr.com/' };
}
const igPath = '/api/jobs/v3/list';
for (const [name, body] of [
  ['snake', { company_id: '10685392028336822', page: 1, per_page: 100 }],
  ['snake-size', { company_id: '10685392028336822', page: 1, page_size: 100 }],
  ['camel', { company_id: '10685392028336822', current_page: 1, page_size: 100 }],
]) await probe(`ihnhr-${name}`, `https://gp-api.iguopin.com${igPath}`, { method: 'POST', headers: signedHeaders('post', igPath), body });

// Public institution portal: preserve both likely bases and known campaign IDs.
for (const base of ['https://www.sydwgkzp.cn/mohrss/', 'https://www.sydwgkzp.cn/']) for (const viewId of ['a6cbb6953e5e4d80a039e6f4a6f98a5f', 'de0beda4c2984f0f98827a83fd819dce']) {
  await probe(`sydw-${base.includes('/mohrss/') ? 'mohrss' : 'root'}-${viewId.slice(0, 6)}`, new URL('api/Affiche/GetPostSelectFyList', base).href, { method: 'POST', body: { PageIndex: 1, PageSize: 100, ViewId: viewId } });
}

await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(results, null, 2) + '\n');
