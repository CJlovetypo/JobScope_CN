// Ability and interest are separate evidence-based judgments. This matrix only
// combines those judgments; it never evaluates a JD or infers user preferences.
import {isV5,v5ActionProblem} from './assessment-v5.mjs';
export const ASSESSMENT_VERSION = 5;
export const ABILITY_LEVELS = Object.freeze({high: '高', medium: '中', low: '低', unknown: '不确定'});
export const INTEREST_LEVELS = Object.freeze({aligned: '高', explore: '中', conflict: '低', unknown: '待确认'});
export const MATCH_TIER_NAMES = Object.freeze({high: '双向高匹配', conditional: '双向有条件匹配', low: '当前匹配不足', unknown: '信息待确认'});
export const MATCH_MATRIX = Object.freeze({
  high: Object.freeze({aligned: 'high', explore: 'conditional', conflict: 'low', unknown: 'unknown'}),
  medium: Object.freeze({aligned: 'conditional', explore: 'conditional', conflict: 'low', unknown: 'unknown'}),
  low: Object.freeze({aligned: 'low', explore: 'low', conflict: 'low', unknown: 'low'}),
  unknown: Object.freeze({aligned: 'unknown', explore: 'unknown', conflict: 'low', unknown: 'unknown'}),
});

export function deriveMatchTier(ability, interest) {
  if (!Object.hasOwn(MATCH_MATRIX, ability) || !Object.hasOwn(INTEREST_LEVELS, interest)) throw new Error('能力或意愿字段无效');
  return MATCH_MATRIX[ability][interest];
}

export const ACTION_NAMES = Object.freeze({apply: '可以投递', prepare: '投递前准备', hold: '暂不建议投递',clarify:'补资料后判断'});
const hasText = value => typeof value === 'string' && value.trim().length > 0;

export function interestProblem(review) {
  const checks = review.interest_checks;
  if (!Array.isArray(checks)) return '缺少独立意愿对照 interest_checks；没有明确偏好时使用空数组并保留 unknown';
  for (const item of checks) {
    if (!item || !['must', 'prefer', 'open'].includes(item.importance) || !['met', 'partial', 'conflict', 'unknown'].includes(item.status) || !hasText(item.preference) || !hasText(item.user_basis) || !hasText(item.job_basis)) return 'interest_checks 缺少偏好、用户依据、岗位依据或有效重要性／满足状态';
  }
  if (review.interest !== 'unknown' && !checks.length) return '非 unknown 意愿须有用户偏好与岗位供给对照';
  if (checks.some(item => item.importance === 'must' && item.status === 'conflict') && review.interest !== 'conflict') return '明确不可妥协的意愿冲突不能被其他偏好抵消';
  if (review.interest === 'aligned' && !checks.some(item => item.status === 'met')) return '高意愿缺少已满足的明确偏好';
  if (review.interest === 'aligned' && checks.some(item => item.importance === 'must' && item.status !== 'met')) return '关键意愿条件尚未确认满足，不能判高意愿';
  return null;
}

// Priority orders the next action, not desirability. Reject contradictory actions;
// never silently lower a priority based on ability, interest, or company labels.
export function actionProblem(review) {
  const v5Problem=v5ActionProblem(review);if(v5Problem)return v5Problem;
  if(!isV5(review)&&review.next_action==='clarify')return 'clarify属于v5判断，新建运行阅读全文重评后使用；不能给旧结果补动作';
  if (!Object.hasOwn(ACTION_NAMES, review.next_action)) return '缺少有效 next_action：apply/prepare/hold；资料不完整的岗位应留在待核实与未评估表，不使用 verify 作为正式评估动作';
  if (!hasText(review.priority_reason)) return '缺少独立行动排序依据 priority_reason';
  if (review.priority === 'high' && !hasText(review.timing_evidence)) return '高优先须有 timing_evidence，说明真实时间窗口或阻塞下一步的事项';
  if (review.next_action === 'hold' && review.priority !== 'low') return '暂缓行动应为低优先';
  if (review.eligibility === 'ineligible' && (review.next_action !== 'hold' || review.priority !== 'low')) return '届别或学历明确不匹配时，无论能力与意愿如何，下一步都必须为低优先暂缓';
  if (review.interest === 'conflict' && (review.next_action !== 'hold' || review.priority !== 'low')) return '个人意愿明确冲突时，下一步必须为低优先暂缓';
  if (review.ability === 'low' && (review.next_action !== 'hold' || review.priority !== 'low')) return '核心能力匹配度为低时，下一步必须为低优先暂缓';
  if (review.next_action === 'apply' && (review.eligibility !== 'eligible' || ['conflict', 'unknown'].includes(review.interest))) return '资格未确认符合或意愿冲突／未知时，下一步不能直接投递；正式评估应改为投递前准备或暂不建议投递，资料不完整则留在待核实与未评估表';
  return null;
}
