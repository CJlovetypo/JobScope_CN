// A waiting caller must retry this decision after waking: a later 429 or another
// caller may have moved the next usable slot while it slept.
export function requestSlot(now, nextRequest, cooldownUntil, interval) {
  const waitMs = Math.max(0, nextRequest - now, cooldownUntil - now);
  return {waitMs, nextRequest: waitMs ? nextRequest : now + interval};
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet programs can ignore leading whitespace before a formula.
  if (/^\s*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

// Waiqi sometimes prefixes an otherwise real URL with “链接请在微信端打开:”.
// Preserve the original field and extraction note; never discard such links.
export function recruitmentLink(value) {
  const raw=String(value??'').trim();if(!raw)return {url:null,raw:null,normalization:'empty'};
  const explicit=raw.match(/https?:\/\/[^\s<>"\u3000]+/i)?.[0];
  let candidate=explicit,normalization=explicit===raw?'unchanged':'extracted_explicit_url';
  if(!candidate&&/^[a-z\d][a-z\d.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)){candidate='https://'+raw;normalization='assumed_https_for_bare_domain';}
  if(!candidate)return {url:null,raw,normalization:'non_url_recruitment_instruction'};
  if(raw.includes('](')&&candidate.endsWith(')'))candidate=candidate.slice(0,-1);
  try{const u=new URL(candidate);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();return {url:u.href,raw,normalization};}catch{return {url:null,raw,normalization:'invalid_url'};}
}
