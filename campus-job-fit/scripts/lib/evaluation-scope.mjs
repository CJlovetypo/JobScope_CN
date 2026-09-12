import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readJson, writeJson, workspacePath} from './io.mjs';

export const SCOPE_MODES = {sample: '实验批次', companies: '指定公司', all: '全量评估'};
export const scopeJobKey = (companyId, jobId) => JSON.stringify([companyId, String(jobId)]);

export async function screeningSummary(dir) {
  dir = workspacePath(dir);
  const run = await readJson(path.join(dir, 'run.json'));
  const companies = [], candidates = [];
  for (const company of run.companies.filter(item => item.selected)) {
    const data = await readJson(path.join(dir, 'companies', company.company_id + '.json'), null);
    const jobs = data?.jobs || [];
    const eligible = jobs.filter(job => job.evaluation_status === 'to_assess');
    companies.push({company_id: company.company_id, company: company.display_name,
      coverage: data?.coverage?.status || 'not_collected', total_jobs: jobs.length,
      to_assess: eligible.length,
      needs_verification: jobs.filter(job => ['needs_verification', 'missing_body'].includes(job.evaluation_status)).length});
    candidates.push(...eligible.map(job => ({company_id: company.company_id, job_id: String(job.job_id), title: job.title})));
  }
  return {companies, candidates, companies_selected: companies.length,
    total_to_assess: candidates.length, needs_verification: companies.reduce((sum, company) => sum + company.needs_verification, 0)};
}

export async function readEvaluationScope(dir, {required = true} = {}) {
  const scope = await readJson(path.join(workspacePath(dir), 'evaluation-scope.json'), null);
  if (!scope) {
    if (required) throw new Error('尚未确认评估范围：先展示筛选结果，请用户选择实验批次、指定公司或全量评估；明确需求后再运行 plan-assessment。');
    return null;
  }
  if (!Object.hasOwn(SCOPE_MODES, scope.mode) || !scope.confirmed_at || typeof scope.user_request !== 'string' || !scope.user_request.trim()
      || !Array.isArray(scope.company_ids) || !scope.company_ids.length
      || (scope.mode === 'sample' && (!Array.isArray(scope.jobs) || !scope.jobs.length))) {
    throw new Error('评估范围记录不完整，请根据用户明确需求重新运行 plan-assessment。');
  }
  return scope;
}

export function inEvaluationScope(scope, companyId, jobId) {
  // Legacy reports remain readable; only next-batch requires a confirmed scope.
  if (!scope) return true;
  if (scope.mode === 'all') return true;
  if (!scope.company_ids.includes(companyId)) return false;
  return scope.mode !== 'sample' || scope.jobs.some(job => scopeJobKey(job.company_id, job.job_id) === scopeJobKey(companyId, jobId));
}

export async function planAssessment(dir, {mode, only, limit, jobs, userRequest} = {}) {
  dir = workspacePath(dir);
  if (!Object.hasOwn(SCOPE_MODES, mode)) throw new Error('--mode 必须是 sample、companies 或 all');
  if (typeof userRequest !== 'string' || !userRequest.trim()) throw new Error('需要 --user-request 记录用户明确的评估需求；不能代替用户选择。');
  if (mode !== 'sample' && (limit !== undefined || jobs !== undefined)) throw new Error('只有实验批次可指定 --limit 或 --jobs');
  if (mode === 'all' && only !== undefined) throw new Error('全量评估不能使用 --only 缩小公司范围');
  const summary = await screeningSummary(dir);
  const names = only === undefined ? [] : String(only).split(',').map(value => value.trim());
  if ((mode === 'companies' && !names.length) || names.some(value => !value) || new Set(names).size !== names.length) throw new Error('--only 需要不重复的入选公司名称或 ID');
  const selected = names.length ? names.map(name => {
    const matches = summary.companies.filter(company => company.company_id === name || company.company === name);
    if (matches.length !== 1) throw new Error('--only 含未识别、未入选或有歧义的公司：' + name);
    return matches[0];
  }) : summary.companies;
  const companyIds = selected.map(company => company.company_id);
  if (!companyIds.length || new Set(companyIds).size !== companyIds.length) throw new Error('评估范围没有入选公司或包含重复公司');
  if (selected.some(company => company.coverage === 'not_collected')) throw new Error('请先 collect 完成岗位筛选，再确认评估范围');
  let candidates = summary.candidates.filter(job => companyIds.includes(job.company_id));
  if (mode === 'sample') {
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1) throw new Error('实验批次需要 --limit 正整数，按用户确认的数量执行');
    if (jobs !== undefined) {
      if (!Array.isArray(jobs) || !jobs.length || jobs.length > count) throw new Error('--jobs 必须为非空岗位键数组，数量不能超过实验批次上限');
      const keys = new Set(jobs.map(job => scopeJobKey(job.company_id, job.job_id)));
      const available = new Map(candidates.map(job => [scopeJobKey(job.company_id, job.job_id), job]));
      if (keys.size !== jobs.length || [...keys].some(key => !available.has(key))) throw new Error('--jobs 含重复、未入选或不可评估岗位');
      candidates = [...keys].map(key => available.get(key));
    } else {
      // Round-robin across companies; selection is not a personal fit rating.
      const groups = selected.map(company => candidates.filter(job => job.company_id === company.company_id));
      candidates = [];
      for (let index = 0; candidates.length < count && groups.some(group => index < group.length); index++) {
        for (const group of groups) if (group[index] && candidates.length < count) candidates.push(group[index]);
      }
    }
    if (!candidates.length) throw new Error('当前没有可用于实验批次的岗位，请先处理资料待核实或来源失败');
  }
  const scope = {schema_version: 1, mode, confirmed_at: new Date().toISOString(), user_request: userRequest.trim(),
    company_ids: mode === 'sample' ? [...new Set(candidates.map(job => job.company_id))] : companyIds,
    companies: selected.map(company => company.company),
    jobs: mode === 'sample' ? candidates.map(({company_id, job_id}) => ({company_id, job_id})) : null,
    sample_limit: mode === 'sample' ? Number(limit) : null,
    selected_jobs_at_confirmation: candidates.length, total_jobs_at_confirmation: summary.total_to_assess};
  const previous = await readEvaluationScope(dir, {required: false});
  if (previous) await writeJson(path.join(dir, 'scope-history', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json'), previous);
  await writeJson(path.join(dir, 'evaluation-scope.json'), scope);
  await fs.rm(path.join(dir, 'next-batch.json'), {force: true});
  const run = await readJson(path.join(dir, 'run.json'));
  run.status = 'evaluation_scope_confirmed';
  await writeJson(path.join(dir, 'run.json'), run);
  return scope;
}
