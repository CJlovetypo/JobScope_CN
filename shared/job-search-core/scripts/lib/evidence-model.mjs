import {createHash} from 'node:crypto';
import {isV5,v5EvidenceProblem} from './assessment-v5.mjs';

const hasText = value => typeof value === 'string' && value.trim().length > 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const evidenceKinds = new Set(['resume', 'self_description', 'user_clarification']);
const claimTypes = new Set(['objective_experience', 'objective_achievement', 'self_assessment', 'preference']);
const objectiveClaims = new Set(['objective_experience', 'objective_achievement']);
const experienceTypes = new Set(['internship', 'employment', 'research_project', 'course_project', 'personal_project', 'other', 'none']);
const requirementTypes = new Set(['core', 'supporting', 'bonus', 'eligibility']);
const supportTypes = new Set(['direct', 'transferable', 'unsupported']);
const evidenceStrengths = new Set(['strong', 'moderate', 'weak', 'none']);
const workExperienceTypes = new Set(['internship', 'employment']);
const relevanceRelations = new Set(['same', 'adjacent', 'different', 'unknown']);

// Profiles are JSON data. Canonicalize object keys recursively while preserving
// array order and every logical field, including evidence text and preferences.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

/** Return the SHA-256 of the complete, key-order-independent JSON profile. */
export function profileFingerprint(profile) {
  return createHash('sha256').update(JSON.stringify(canonicalize(profile))).digest('hex');
}

/** Return the first profile evidence schema problem, or null. Never infer claims from their source. */
export function profileEvidenceProblem(profile) {
  if (!isObject(profile) || !Array.isArray(profile.evidence) || !profile.evidence.length&&!isV5(profile)) return '个人画像缺少非空 evidence 证据数组';
  const ids = new Set();
  const experienceTypeById = new Map();
  for (const [index, evidence] of profile.evidence.entries()) {
    if (!isObject(evidence)) return `个人画像第 ${index + 1} 条证据必须为对象`;
    if (!hasText(evidence.id)) return `个人画像第 ${index + 1} 条证据缺少有效 id`;
    if (ids.has(evidence.id)) return '个人画像证据 ID 重复：' + evidence.id;
    ids.add(evidence.id);
    if (!hasText(evidence.text) || !hasText(evidence.source)) return '个人画像证据 ' + evidence.id + ' 缺少非空 text 或 source';
    if (!evidenceKinds.has(evidence.kind)) return '个人画像证据 ' + evidence.id + ' 的 kind 无效；来源与客观性须分开记录';
    if (!claimTypes.has(evidence.claim_type)) return '个人画像证据 ' + evidence.id + ' 缺少有效 claim_type；须区分客观经历、客观成就、自评与偏好';
    if (!experienceTypes.has(evidence.experience_type)) return '个人画像证据 ' + evidence.id + ' 缺少有效 experience_type';
    if (objectiveClaims.has(evidence.claim_type)) {
      if (evidence.experience_type === 'none' || !hasText(evidence.experience_id)) return '个人画像客观证据 ' + evidence.id + ' 必须有实际 experience_type 与非空 experience_id';
    } else if (evidence.experience_id != null && !hasText(evidence.experience_id)) {
      return '个人画像证据 ' + evidence.id + ' 的 experience_id 必须为非空字符串或 null';
    }
    if (hasText(evidence.experience_id) && evidence.experience_type !== 'none') {
      const knownType = experienceTypeById.get(evidence.experience_id);
      if (knownType && knownType !== evidence.experience_type) return '个人画像同一 experience_id 的 experience_type 不一致：' + evidence.experience_id;
      experienceTypeById.set(evidence.experience_id, evidence.experience_type);
    }
  }
  return null;
}

// These declarations describe distinct relevance dimensions. They are not
// scores: even "different" in one dimension does not determine ability.
function experienceRelevanceProblem(review, evidenceById, referencedWorkIds) {
  const relevance = review.experience_relevance;
  if (relevance === undefined && !referencedWorkIds.size) return null;
  if (!Array.isArray(relevance)) return '引用实习或工作客观证据时须提供 experience_relevance 数组，分别说明行业、部门业务与岗位职能的对口关系';
  const workIds = new Set([...evidenceById.values()]
    .filter(evidence => objectiveClaims.has(evidence.claim_type) && workExperienceTypes.has(evidence.experience_type))
    .map(evidence => evidence.experience_id));
  const seen = new Set();
  for (const item of relevance) {
    if (!isObject(item) || !hasText(item.experience_id)) return 'experience_relevance 每项须有非空 experience_id';
    if (!workIds.has(item.experience_id)) return 'experience_relevance 引用了不存在或非实习/工作客观经历的 experience_id：' + item.experience_id;
    if (seen.has(item.experience_id)) return 'experience_relevance 的 experience_id 重复：' + item.experience_id;
    seen.add(item.experience_id);
    for (const field of ['industry_relation', 'business_relation', 'role_relation']) {
      if (!relevanceRelations.has(item[field])) return 'experience_relevance 的 ' + field + ' 无效；须分别填写 same/adjacent/different/unknown';
    }
    if (!hasText(item.explanation)) return 'experience_relevance 缺少非空 explanation；须解释三个维度的事实依据与限制';
  }
  for (const id of referencedWorkIds) {
    if (!seen.has(id)) return 'experience_relevance 缺少已引用实习或工作经历的三维对口判断：' + id;
  }
  return null;
}

/**
 * Validate declared evidence comparisons after the general JD/review checks.
 * Returns the first problem, or null; does not score, count internships, infer
 * relevance from titles, or verify the model's semantic reading of evidence.
 */
export function abilityEvidenceProblem(review, profile) {
  const v5Problem=v5EvidenceProblem(review,profile);if(v5Problem)return v5Problem;
  if (!isObject(review) || !hasText(review.ability_reason)) return '能力判断缺少非空 ability_reason；须解释证据质量、对口程度与核心覆盖';
  const profileProblem = profileEvidenceProblem(profile);
  if (profileProblem) return profileProblem;
  if (!Array.isArray(review.comparisons) || !review.comparisons.length) return '缺少 JD 与个人证据对照';
  const evidenceById = new Map(profile.evidence.map(evidence => [evidence.id, evidence]));
  const referencedWorkIds = new Set();
  const core = [];
  let hasObjectiveAbilitySupport = false;
  for (const [index, comparison] of review.comparisons.entries()) {
    const label = `第 ${index + 1} 项 JD 对照`;
    if (!isObject(comparison)) return label + ' 必须为对象';
    if (!requirementTypes.has(comparison.requirement_type)) return label + ' 缺少有效 requirement_type；须区分核心、支持、加分与资格要求';
    if (!supportTypes.has(comparison.support)) return label + ' 缺少有效 support';
    if (!evidenceStrengths.has(comparison.evidence_strength)) return label + ' 缺少有效 evidence_strength';
    if (!Array.isArray(comparison.profile_evidence_ids)) return label + ' 的个人证据 ID 必须为数组';
    for (const id of comparison.profile_evidence_ids) {
      if (!hasText(id) || !evidenceById.has(id)) return '引用了不存在的个人证据 ' + String(id);
      const evidence = evidenceById.get(id);
      if (objectiveClaims.has(evidence.claim_type) && workExperienceTypes.has(evidence.experience_type)) referencedWorkIds.add(evidence.experience_id);
    }
    if (comparison.support === 'unsupported') {
      if (comparison.evidence_strength !== 'none') return label + ' 标为 unsupported 时 evidence_strength 必须为 none';
    } else if (!comparison.profile_evidence_ids.length || comparison.evidence_strength === 'none') {
      return label + ' 的 direct/transferable 支持须引用已有证据，且 evidence_strength 不能为 none';
    }
    const hasObjective = comparison.profile_evidence_ids.some(id => objectiveClaims.has(evidenceById.get(id).claim_type));
    if (['strong', 'moderate'].includes(comparison.evidence_strength) && !hasObjective) return label + ' 的 strong/moderate 必须有客观经历或客观成就，不能仅凭自评或偏好';
    if (['core', 'supporting'].includes(comparison.requirement_type) && comparison.support !== 'unsupported'
      && ['strong', 'moderate'].includes(comparison.evidence_strength) && hasObjective) hasObjectiveAbilitySupport = true;
    if (comparison.requirement_type === 'core') core.push(comparison);
  }
  const relevanceProblem = experienceRelevanceProblem(review, evidenceById, referencedWorkIds);
  if (relevanceProblem) return relevanceProblem;
  if (!core.length) return '能力评估至少须有一项 core 核心要求；eligibility 资格条件不能代替核心能力覆盖';
  if (['high', 'medium'].includes(review.ability) && !hasObjectiveAbilitySupport) return '高或中能力判断必须有核心或支持要求的 strong/moderate 客观经历或成就支持，不能仅凭自评、偏好、加分项、毕业资格或 weak 头衔证据';
  if (review.ability === 'high') {
    if (!core.some(comparison => comparison.support === 'direct' && comparison.evidence_strength === 'strong')) return '高能力判断至少须有一项核心要求获得 direct + strong 证据支持';
    if (core.some(comparison => comparison.support !== 'direct' || !['strong', 'moderate'].includes(comparison.evidence_strength))) return '高能力判断的全部核心要求须有 direct 且 strong/moderate 支持；核心缺口不能评高';
  }
  return null;
}
