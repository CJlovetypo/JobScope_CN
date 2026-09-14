import { createClient } from './http.mjs';

function plainText(value) {
  let text = String(value ?? '');
  for (let pass = 0; pass < 2; pass++) text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:br\b[^>]*|\/p|\/div|\/li|\/h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function normalize(data, source, rawFile) {
  const description = plainText(data.jobDesc || data.filterDesc);
  const start = description.search(/任职要求|岗位要求|Qualifications|Requirements/i);
  const requirements = start >= 0 ? description.slice(start) : '';
  const duties = start >= 0 ? description.slice(0, start) : description;
  const title = String(data.name || '');
  const cleanedTitle = title.replace(/(?:可|需|要求)?提前实习/g, '').replace(/实习经历.{0,4}(?:优先|加分)/g, '');
  const internship = /实习|intern/i.test(data.hireTypeDesc || '') || /实习生|实习岗|实习转正|intern(?:ship)?\b/i.test(cleanedTitle);
  const conflict = internship && /此岗位属于.{0,8}(?:校招|秋招|春招)?正式岗|明确.{0,8}正式校招/.test(description);
  const locationRecords = [data.workCity, data.workAddress].filter(v => typeof v === 'string' && v.trim());
  return {
    job_id: String(data.jobId), company_id: source.company_id, company_name: source.display_name, title,
    locations_raw: locationRecords, description, requirements,
    body_complete: duties.length > 30 && requirements.length > 25 && /职责|工作内容|培养方向|Responsibilities|Your role/i.test(duties),
    formal_status: conflict ? 'unknown' : internship ? 'internship' : 'unknown', open_status: 'open',
    official_url: source.primary_entry_url || null,
    job_url_kind: source.primary_entry_url ? 'official_listing' : 'unavailable',
    recruitment_evidence: {
      provider: 'xinrenxinshi', hireType: data.hireType, hireTypeDesc: data.hireTypeDesc,
      hireStatus: data.hireStatus, recruitmentType: data.recruitmentType, projectName: data.projectName,
      formal_basis: 'Full-time employment alone does not confirm campus recruitment; no unverified enum mapping is applied.',
      published_list_returned: true,
      ...(conflict ? { type_conflict: 'Structured internship type or title conflicts with explicit formal recruitment wording in this JD.' } : {}),
    },
    raw_file: rawFile,
    raw_metadata: { location_records: locationRecords, department: data.department, startTime: data.startTime, endTime: data.endTime },
  };
}

function publicJson(response, purpose) {
  if (response.record.http_status < 200 || response.record.http_status >= 300) throw new Error(`${purpose}: HTTP ${response.record.http_status}`);
  if (Number(response.data?.code) !== 0 || !response.data?.data) throw new Error(`${purpose}: expected successful public JSON`);
  return response.data.data;
}

function positiveInteger(value, fallback, ceiling) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.max(1, Math.min(Math.floor(Number(value)), ceiling)) : fallback;
}

export async function collectXinrenxinshi(source, options = {}) {
  const client = createClient({ evidenceDir: options.evidenceDir, timeoutMs: options.timeoutMs || 20000 });
  const jobs = new Map(), pageEvidence = [], detailErrors = [];
  const maxPages = positiveInteger(options.maxPages, 1000, 1000), pageSize = positiveInteger(options.pageSize, 30, 100);
  let total = null, initialTotal = null, totalChanged = false, listComplete = false, reason = 'max_pages_reached';
  try {
    const bootstrap = (source.public_bootstrap_requests || []).find(q => /ajax-gate-get-info-by-token/.test(q.url || ''));
    if (!bootstrap) throw new Error('Public portal initialization request is missing');
    const initialized = publicJson(await client.request(bootstrap, { purpose: 'public_configuration_bootstrap' }), 'bootstrap');
    if (!initialized.companyId || !initialized.portalId) throw new Error('Public portal initialization lacks companyId or portalId');
    const { companyId, portalId } = initialized;
    const origin = new URL(bootstrap.url).origin;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Xrxs-Language': 'zh', Referer: source.primary_entry_url };
    for (let page = 1; page <= maxPages; page++) {
      const body = new URLSearchParams({ companyId, portalId, page: String(page), num: String(pageSize),
        filterStr: '', projectIds: '', siteIds: '', workCityIds: '', functionIds: '' }).toString();
      const response = await client.request({ url: origin + '/recruitment/service/employee/ajax-gate-get-job-list',
        method: 'POST', headers, body }, { purpose: 'job_list' });
      const data = publicJson(response, 'list');
      if (!Array.isArray(data.data)) throw new Error('Public JSON has no supported job list');
      if (data.totalNum !== undefined && data.totalNum !== null && Number.isFinite(Number(data.totalNum)) && Number(data.totalNum) >= 0) {
        total = Number(data.totalNum);
        if (initialTotal === null) initialTotal = total; else if (initialTotal !== total) totalChanged = true;
      }
      const ids = data.data.map(item => item.jobId == null ? '' : String(item.jobId));
      const uniqueIds = new Set(ids.filter(Boolean)), added = [...uniqueIds].filter(id => !jobs.has(id));
      pageEvidence.push({ page, request_index: response.record.index, job_ids: ids, new_ids: added.length,
        overlap: ids.length - added.length, server_total: total, response_file: response.record.response_file });
      for (const item of data.data) {
        if (item.jobId == null || String(item.jobId) === '' || jobs.has(String(item.jobId))) continue;
        let job = normalize(item, source, response.record.response_file);
        if (options.mode !== 'list') {
          try {
            const detailResponse = await client.request({ url: origin + '/recruitment/service/employee/ajax-gate-get-job-detail',
              method: 'POST', headers, body: new URLSearchParams({ companyId, portalId, jobId: String(item.jobId) }).toString() }, { purpose: 'job_detail' });
            const detail = publicJson(detailResponse, 'detail');
            if (String(detail.jobId || '') !== String(item.jobId)) throw new Error('Detail JSON job ID differs from the requested list job');
            const merged = { ...item, ...detail };
            const enriched = normalize(merged, source, detailResponse.record.response_file);
            // A sparse detail response must not erase a complete JD already supplied by the list API.
            if (!job.body_complete || enriched.body_complete) job = enriched;
            else {
              const fallback = normalize({ ...merged, jobDesc: item.jobDesc, filterDesc: item.filterDesc }, source, response.record.response_file);
              fallback.raw_metadata.detail_raw_file = detailResponse.record.response_file;
              fallback.raw_metadata.body_from_list = true;
              job = fallback;
            }
          } catch (error) {
            job.detail_error = error.message;
            detailErrors.push(`${item.jobId}: ${error.message}`);
          }
        }
        jobs.set(job.job_id, job);
      }
      if (ids.some(id => !id)) { reason = 'job_list_contains_missing_ids'; break; }
      if (ids.length !== uniqueIds.size) { reason = 'duplicate_ids_within_page'; break; }
      if (ids.length && !added.length) { reason = 'repeated_page_no_new_ids'; break; }
      if (total !== null && jobs.size > total) { reason = 'more_unique_ids_than_server_total'; break; }
      if (!ids.length) {
        listComplete = !totalChanged && (total === null || jobs.size === total);
        reason = totalChanged ? 'server_total_changed_during_collection' : listComplete ? 'empty_end_page_and_unique_total_reconciled' : 'empty_page_total_mismatch';
        break;
      }
      // A one-page result gets a following-page probe; multi-page results require distinct IDs and a reconciled total.
      if (page >= 2 && total !== null && jobs.size === total) {
        listComplete = !totalChanged;
        reason = totalChanged ? 'server_total_changed_during_collection' : 'distinct_pages_and_unique_total_reconciled';
        break;
      }
    }
  } catch (error) { reason = error.message; }
  const incompleteBodies = options.mode === 'list' ? 0 : [...jobs.values()].filter(job => !job.body_complete).length;
  const limitations = [reason, ...(detailErrors.length ? [`${detailErrors.length} detail requests failed`] : []),
    ...(incompleteBodies ? [`${incompleteBodies} jobs still lack complete JD bodies`] : [])];
  return {
    company_id: source.company_id, display_name: source.display_name, checked_at: new Date().toISOString(), jobs: [...jobs.values()],
    coverage: { status: listComplete && !detailErrors.length && !incompleteBodies ? 'complete' : pageEvidence.length || jobs.size ? 'partial' : 'failed',
      pages: pageEvidence.length, server_total: total, jobs_observed: jobs.size,
      reason: limitations.join('; '), list_complete: listComplete, incomplete_bodies: incompleteBodies,
      details_failed: detailErrors.length, detail_errors: detailErrors, page_evidence: pageEvidence },
    requests: client.records,
  };
}
