import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {runtimeContext} from '../../runtime-context.mjs';
import { createHash, randomUUID } from 'node:crypto';

const skillRoot = runtimeContext().skillRoot;
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sensitiveHeader = /^(cookie|authorization|proxy-authorization|set-cookie)$/i;
const dynamicHeader = /csrf|xsrf/i;

function safeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !sensitiveHeader.test(key))
    .map(([key, value]) => [key, dynamicHeader.test(key) ? '<from fresh anonymous bootstrap>' : value]));
}

function safeBody(body) {
  if (!body || typeof body !== 'object') return body ?? null;
  if (Array.isArray(body)) return body.map(safeBody);
  return Object.fromEntries(Object.entries(body).map(([key, value]) =>
    [key, /^(authorization|cookie|password|secret|access_token|refresh_token)$/i.test(key) ? '<redacted>' : safeBody(value)]));
}

class AnonymousCookies {
  constructor() { this.items = new Map(); }

  receive(url, values) {
    const u = new URL(url);
    for (const value of values) {
      const [pair, ...attributes] = value.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const item = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: u.hostname,
        path: u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1) || '/', hostOnly: true, secure: false, expires: Infinity };
      let maxAge = null;
      for (const attribute of attributes) {
        const index = attribute.indexOf('=');
        const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
        const val = index < 0 ? '' : attribute.slice(index + 1).trim();
        if (key === 'domain') { item.domain = val.replace(/^\./, '').toLowerCase(); item.hostOnly = false; }
        if (key === 'path' && val.startsWith('/')) item.path = val;
        if (key === 'secure') item.secure = true;
        if (key === 'max-age' && /^-?\d+$/.test(val)) maxAge = Number(val);
        if (key === 'expires') { const expiry = Date.parse(val); if (Number.isFinite(expiry)) item.expires = expiry; }
      }
      if (maxAge !== null) item.expires = Date.now() + maxAge * 1000;
      // A response cannot set cookies on an unrelated host or a bare suffix.
      if (item.domain !== u.hostname && (!u.hostname.endsWith('.' + item.domain) || !item.domain.includes('.'))) continue;
      const key = `${item.domain}\n${item.path}\n${item.name}`;
      if (item.expires <= Date.now()) this.items.delete(key); else this.items.set(key, item);
    }
  }

  matching(url) {
    const u = new URL(url);
    return [...this.items.values()].filter(c => c.expires > Date.now()
      && (c.hostOnly ? u.hostname === c.domain : u.hostname === c.domain || u.hostname.endsWith('.' + c.domain))
      && (!c.secure || u.protocol === 'https:')
      && (u.pathname === c.path || u.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')))
      .sort((a, b) => b.path.length - a.path.length);
  }

  header(url) { return this.matching(url).map(c => `${c.name}=${c.value}`).join('; '); }
  value(name, url) { return this.matching(url).find(c => c.name === name)?.value ?? null; }
}

/** Fresh anonymous HTTP only. Cookie values never enter persisted request records. */
export function createClient({ evidenceDir, timeoutMs = 20000 } = {}) {
  const session = randomUUID().slice(0, 12);
  const directory = path.resolve(evidenceDir || path.join(skillRoot, 'artifacts/runs', `http-${Date.now()}-${session}`));
  const jar = new AnonymousCookies();
  const records = [];
  return {
    records,
    cookieValue(name, url) { return jar.value(name, url); },
    setCookie(name, value, url, { sourceRecord } = {}) {
      if (!records.includes(sourceRecord) || sourceRecord.http_status !== 200 || !/bootstrap|init|csrf/i.test(sourceRecord.purpose)) {
        throw new Error('Anonymous cookie initialization requires a successful public bootstrap record from this client');
      }
      const u = new URL(url);
      if (u.origin !== new URL(sourceRecord.final_url || sourceRecord.url).origin) throw new Error('Public cookie initialization must stay on its response origin');
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[;\r\n]/.test(value)) throw new Error('Invalid cookie name/value');
      jar.receive(u.href, [`${name}=${value}; Path=/${u.protocol === 'https:' ? '; Secure' : ''}`]);
      (sourceRecord.anonymous_cookie_derivations ||= []).push({ name, target_origin: u.origin, value_saved: false });
    },
    async request({ url, method = 'GET', headers = {}, body = null }, { purpose = 'public_api' } = {}) {
      const target = new URL(url);
      if (!['https:', 'http:'].includes(target.protocol)) throw new Error('HTTP(S) URL required');
      if (target.username || target.password) throw new Error('Personal credentials are not supported');
      if (Object.keys(headers).some(key => sensitiveHeader.test(key))) throw new Error('Imported Cookie/Authorization headers are not allowed');
      method = method.toUpperCase();
      if (!['GET', 'POST'].includes(method)) throw new Error('Only read-only GET/POST API queries are supported');
      const initialHeaders = new Headers({ 'User-Agent': userAgent, Accept: 'application/json, text/plain, */*' });
      for (const [key, value] of Object.entries(headers)) initialHeaders.set(key, value);
      const requestHeaders = Object.fromEntries(initialHeaders);
      let encoded = body;
      if (body instanceof URLSearchParams) encoded = body.toString();
      else if (body !== null && typeof body === 'object') {
        encoded = JSON.stringify(body);
        if (!Object.keys(requestHeaders).some(k => k.toLowerCase() === 'content-type')) requestHeaders['Content-Type'] = 'application/json';
      }
      const record = { index: records.length, method, url: target.href, headers: safeHeaders(requestHeaders),
        body: body instanceof URLSearchParams ? body.toString() : safeBody(body), purpose,
        checked_at: new Date().toISOString(), anonymous_session_from_scratch: true,
        cookie_policy: 'Fresh HTTP response cookies only; values omitted. Replay public bootstrap in the same new anonymous session.' };
      records.push(record);
      const started = Date.now();
      try {
        let current = target.href, currentMethod = method, currentBody = encoded;
        let response;
        const signal = AbortSignal.timeout(Math.max(1, timeoutMs));
        const redirects = [];
        for (let hop = 0; hop <= 8; hop++) {
          const outgoing = { ...requestHeaders };
          // Caller-provided CSRF headers apply only to the original origin.
          if (new URL(current).origin !== target.origin) for (const key of Object.keys(outgoing)) if (dynamicHeader.test(key)) delete outgoing[key];
          const cookie = jar.header(current);
          if (cookie) outgoing.Cookie = cookie;
          response = await fetch(current, { method: currentMethod, headers: outgoing,
            body: currentMethod === 'GET' ? undefined : currentBody, redirect: 'manual', signal });
          jar.receive(current, response.headers.getSetCookie?.() || []);
          if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) break;
          const next = new URL(response.headers.get('location'), current);
          if (!['https:', 'http:'].includes(next.protocol)) throw new Error('Unsupported redirect protocol');
          redirects.push({ url: current, status: response.status, next_url: next.href });
          await response.body?.cancel();
          if (response.status === 303 || ([301, 302].includes(response.status) && currentMethod === 'POST')) { currentMethod = 'GET'; currentBody = null; }
          current = next.href;
          if (hop === 8) throw new Error('Too many redirects');
        }
        const raw = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || '';
        const charset = contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g, '') || 'utf-8';
        let text;
        try { text = new TextDecoder(charset).decode(raw); } catch { text = raw.toString('utf8'); }
        let data = null;
        try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { /* A bootstrap may legitimately be HTML. */ }
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${session}-${String(record.index + 1).padStart(5, '0')}.${data === null ? 'txt' : 'json'}`);
        await writeFile(file, raw);
        Object.assign(record, { http_status: response.status, final_url: current, content_type: contentType,
          response_file: file, response_is_json: data !== null, response_sha256: createHash('sha256').update(raw).digest('hex'),
          elapsed_ms: Date.now() - started, redirects });
        return { data, text, url: current, headers: Object.fromEntries([...response.headers].filter(([key]) => !sensitiveHeader.test(key))), record };
      } catch (error) {
        Object.assign(record, { error: error.message, elapsed_ms: Date.now() - started });
        error.record = record;
        throw error;
      }
    },
  };
}

export async function saveDecoded(record, data) {
  if (!record?.response_file) throw new Error('Cannot associate decoded JSON without its original response');
  const file = record.response_file.replace(/\.[^.]+$/, '-decoded.json');
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  record.decoded_response_file = file;
  record.decoding = 'AES-CBC using key in the public API envelope and IV in current anonymous public Moka init-data';
  return file;
}
