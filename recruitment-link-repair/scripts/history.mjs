import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dataset = path.join(repository, 'datasets/recruitment-links');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

// CSV exports contain embedded newlines, quotes and commas in Chinese job text.
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated CSV quoted field');
  if (row.length || field) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.some(Boolean)).map((r,i) => {
    if (r.length !== header.length) throw new Error(`CSV record ${i+2}: column mismatch`);
    return Object.fromEntries(header.map((k,j) => [k, r[j]]));
  });
}

export function inspectURL(raw) {
  let u;
  try { u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); }
  catch { return {valid_http_url: false, provider: 'unknown', host: null, tenant_hint: null}; }
  const host = u.hostname.toLowerCase(), p = u.pathname.split('/').filter(Boolean);
  let provider = 'unknown', tenant = null, site = null;
  if (/(^|\.)mokahr\.com$/.test(host)) { provider = 'moka'; tenant = p[1] || null; site = p[2] || null; }
  else if (/(^|\.)zhiye\.com$/.test(host)) { provider = 'beisen'; tenant = host; }
  else if (/(^|\.)hotjob\.cn$/.test(host)) { provider = 'hotjob'; tenant = u.searchParams.get('projectId') || host; }
  else if (/(^|\.)(feishu|larkoffice)\.cn$/.test(host) && !p.includes('base')) { provider = 'feishu'; tenant = host; site = p[0] || null; }
  else if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) {
    provider = 'workday'; const i = p.indexOf('recruiting');
    tenant = i >= 0 ? p[i+1] : host.split('.')[0];
    site = i >= 0 ? p[i+2] : p.find(x => !/^[a-z]{2}-[A-Z]{2}$/.test(x));
  } else if (/(^|\.)greenhouse\.io$/.test(host)) { provider = 'greenhouse'; tenant = p[0] === 'v1' ? p[2] : p[0]; }
  else if (host.endsWith('.oraclecloud.com')) { provider = 'oracle'; tenant = host; const i = p.indexOf('sites'); site = i >= 0 ? p[i+1] || null : null; }
  else if (/(^|\.)smartrecruiters\.com$/.test(host)) { provider = 'smartrecruiters'; tenant = p[0] === 'v1' ? p[2] : p[0]; }
  else if (/(^|\.)ajinga\.com$/.test(host)) { provider = 'ajinga'; tenant = p.includes('company') ? p.at(-1) : null; }
  else if (host === 'mp.weixin.qq.com') provider = 'wechat';
  return {valid_http_url: true, host, provider, tenant_hint: tenant || null, site_hint: site || null,
    pathname: u.pathname, query: u.search, fragment: u.hash};
}

export async function queryHistory({root = dataset, query = '', host = '', provider = '', family = '', kind = 'observations', limit = 30} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  if (!['observations','contracts'].includes(kind)) throw new Error('kind must be observations or contracts');
  const hits = [], q = query.toLowerCase(); let total = 0;
  const file = path.join(root, 'index', kind+'.jsonl');
  if (!fs.existsSync(file)) throw new Error(`Historical dataset missing: ${file}. Restore the local dataset or run recruitment-link-repair/scripts/dataset/build.mjs with original inputs present.`);
  const input = fs.createReadStream(file, 'utf8');
  const lines = readline.createInterface({input, crlfDelay: Infinity});
  for await (const line of lines) {
    const r = JSON.parse(line);
    const parts = r.url_parts || inspectURL(r.entry_url), platform = r.provider || parts.provider;
    if (family && r.family !== family || provider && platform !== provider) continue;
    if (host && parts.host !== host.toLowerCase()) continue;
    const searchable = [r.company_name, r.company_id_hint, r.company_id, r.url_original, r.entry_url, r.source_record_id,
      ...(r.waiqi_company_ids||[]), ...(r.registry_company_ids||[]), parts.tenant_hint].filter(Boolean).join('\n').toLowerCase();
    if (q && !searchable.includes(q)) continue;
    total++; if (hits.length < limit) hits.push(r);
  }
  return {total, returned: hits.length, truncated: total > hits.length, current_availability: 'not_checked', [kind]: hits};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tokens=process.argv.slice(2);
  const args = Object.fromEntries(tokens.map(s => { const i = s.indexOf('='); return [s.slice(2,i),s.slice(i+1)]; }));
  if (!Object.keys(args).length || process.argv.includes('--help')) {
    console.log('node recruitment-link-repair/scripts/history.mjs --query=公司或URL [--kind=observations|contracts] [--host=域名] [--provider=moka] [--family=wps] [--limit=30] [--root=数据集路径]');
  } else {
    try {
      if(tokens.some(s=>!/^--(query|kind|host|provider|family|limit|root)=/.test(s)))throw new Error('Unknown argument; use --name=value or --help');
      console.log(JSON.stringify(await queryHistory({...args, limit: Number(args.limit || 30)}), null, 2)); }
    catch (e) { console.error(e.message); process.exitCode = 1; }
  }
}
