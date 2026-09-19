import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './lib/http.mjs';

const output = path.resolve(process.argv[2] || 'internet-campus-job-fit/artifacts/wps-campus-sources-20260919/deep-api-review/round3-static-discovery');
await fs.mkdir(output, { recursive: true });

const candidates = [
  ['中信证券', 'https://careers.citics.com/campus/branch/'],
  ['九机', 'https://m.9ji.com/job/school?from=wechat'],
  ['畅唐网络', 'https://campus.ct108.com/'],
  ['海南交规院', 'https://job.ihnhr.com/company/jobs?id=10685392028336822'],
  ['事业单位公开招聘平台', 'https://www.sydwgkzp.cn/mohrss/index.html#/login'],
  ['网易游戏雷火', 'https://leihuo.163.com/campus/#/full'],
  ['中国医学科学院', 'https://job.pumc.edu.cn/job/index.html#/?companyCode=1010'],
  ['中国中铁', 'https://zhr.crec.cn/zhaopin/#/webLogin?pkQrCode=571&pkCompany=11000000&pkOrg=11000000'],
  ['中建八局', 'https://job.cscec8b.com.cn/8bfz'],
  ['浙江建投', 'https://hr.cnzgc.com/'],
];

const unique = values => [...new Set(values.filter(Boolean))];
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);

function resources(html, base) {
  const out = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!/\.m?js(?:[?#]|$)/i.test(match[2])) continue;
    try { out.push(new URL(match[2], base).href); } catch { /* ignore */ }
  }
  return unique(out);
}

function scan(text, base) {
  const strings = [];
  const patterns = [
    /["'`]((?:https?:)?\/\/[^"'`\s\\]{4,300})["'`]/gi,
    /["'`]((?:\/(?:api|gateway|openapi|recruit|hr|job|position|campus|zp)[^"'`\s\\]{1,260}))["'`]/gi,
    /(?:baseURL|baseUrl|BASE_URL|apiHost|apiUrl|requestUrl)\s*[:=]\s*["'`]([^"'`]{2,260})["'`]/gi,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (!/(api|job|position|post|recruit|career|campus|hr|zp|affiche|apply|school)/i.test(value)) continue;
    try { strings.push(new URL(value, base).href); } catch { strings.push(value); }
  }
  const routeWindows = [];
  for (const match of text.matchAll(/.{0,180}(?:GetPostSelectFyList|jobs\/v\d|hr-basic-recruit|jobAPI\.aspx|CampusPostData|position\/|recruitType|positionNo).{0,260}/gi)) {
    routeWindows.push(match[0].replace(/\s+/g, ' ').slice(0, 480));
    if (routeWindows.length >= 150) break;
  }
  return { endpoints: unique(strings).slice(0, 1000), route_windows: unique(routeWindows).slice(0, 250) };
}

async function inspect([company, entry]) {
  const dir = path.join(output, `${company}-${hash(entry)}`);
  await fs.mkdir(dir, { recursive: true });
  const client = createClient({ evidenceDir: path.join(dir, 'http'), timeoutMs: 25000 });
  const result = { company, entry, checked_at: new Date().toISOString(), attempts: [], scripts: [], endpoints: [], route_windows: [] };
  try {
    const page = await client.request({ url: entry, headers: { Accept: 'text/html,application/xhtml+xml,*/*' } }, { purpose: 'round3_public_recruitment_page' });
    result.page = { status: page.record.http_status, final_url: page.url, content_type: page.record.content_type, response_file: page.record.response_file };
    result.attempts.push(result.page);
    if (page.record.http_status === 200) {
      const first = scan(page.text, page.url);
      result.endpoints.push(...first.endpoints); result.route_windows.push(...first.route_windows);
      const scripts = resources(page.text, page.url).slice(0, 35);
      for (const script of scripts) {
        try {
          const response = await client.request({ url: script, headers: { Referer: page.url, Accept: '*/*' } }, { purpose: 'round3_frontend_bundle' });
          const item = { url: script, status: response.record.http_status, response_file: response.record.response_file, bytes: Buffer.byteLength(response.text) };
          result.scripts.push(item);
          if (response.record.http_status === 200) {
            const found = scan(response.text, script);
            result.endpoints.push(...found.endpoints); result.route_windows.push(...found.route_windows);
          }
        } catch (error) { result.scripts.push({ url: script, error: error.message }); }
      }
    }
  } catch (error) { result.error = error.message; result.attempts.push({ url: entry, error: error.message }); }
  result.endpoints = unique(result.endpoints).sort();
  result.route_windows = unique(result.route_windows);
  await fs.writeFile(path.join(dir, 'discovery.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ company, page: result.page?.status || result.error, scripts: result.scripts.length, endpoints: result.endpoints.length, windows: result.route_windows.length }));
  return result;
}

const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < candidates.length) results.push(await inspect(candidates[cursor++]));
}));
results.sort((a, b) => a.company.localeCompare(b.company, 'zh-CN'));
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ reviewed: results.length, pages_ok: results.filter(x => x.page?.status === 200).length, endpoints: results.reduce((n, x) => n + x.endpoints.length, 0) }, null, 2));
