'use strict';

const { query } = require('./database');
const { todayJalali } = require('./dateUtil');

/** برچسب فارسی انواع اقدام — منبع واحد برای last_action */
const ACTION_TYPE_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
  strategy_failure: 'شکست استراتژی',
  payment_full: 'پرداخت کامل',
  payment_partial: 'پرداخت جزئی',
};

const ASSIGN_OPERATION = 'تخصیص به مذاکره‌کننده';

function actionTypeToLabel(actionType) {
  if (!actionType) return null;
  return ACTION_TYPE_LABELS[actionType] || actionType;
}

/** آخرین اقدام اجراشده برای یک پرونده (case_actions + تخصیص) */
function resolveLastAction(caseId) {
  const map = buildLastActionMap([caseId]);
  return map[caseId] || { last_action: null, last_action_date: null };
}

/**
 * نقشه caseId → { last_action, last_action_date }
 * - آخرین رکورد case_actions
 * - اگر آخرین «تخصیص به مذاکره‌کننده» در history جدیدتر از آخرین case_action باشد → تخصیص
 */
function buildLastActionMap(caseIds) {
  const result = {};
  if (!caseIds?.length) return result;

  const idList = caseIds.map(Number).filter(Boolean);
  if (!idList.length) return result;

  const placeholders = idList.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(idList.map((id, i) => [`$id${i}`, id]));

  const execRows = query(
    `SELECT ca.case_id, ca.id, ca.action_type, ca.action_date
     FROM case_actions ca
     INNER JOIN (
       SELECT case_id, MAX(id) AS max_id
       FROM case_actions
       WHERE case_id IN (${placeholders})
       GROUP BY case_id
     ) latest ON ca.id = latest.max_id`,
    params
  );

  const assignRows = query(
    `SELECT ch.case_id, ch.id, ch.created_at
     FROM case_history ch
     INNER JOIN (
       SELECT case_id, MAX(id) AS max_id
       FROM case_history
       WHERE case_id IN (${placeholders}) AND operation = $op
       GROUP BY case_id
     ) latest ON ch.id = latest.max_id`,
    { ...params, $op: ASSIGN_OPERATION }
  );

  const execByCase = Object.fromEntries(execRows.map((r) => [r.case_id, r]));
  const assignByCase = Object.fromEntries(assignRows.map((r) => [r.case_id, r]));

  const caseDates = query(
    `SELECT id, last_action_date FROM cases WHERE id IN (${placeholders})`,
    params
  );
  const dateByCase = Object.fromEntries(caseDates.map((r) => [r.id, r.last_action_date]));

  for (const caseId of idList) {
    const exec = execByCase[caseId];
    const assign = assignByCase[caseId];

    if (assign && (!exec || assign.id > exec.id)) {
      result[caseId] = {
        last_action: ASSIGN_OPERATION,
        last_action_date: dateByCase[caseId] || todayJalali(),
      };
      continue;
    }

    if (exec) {
      result[caseId] = {
        last_action: actionTypeToLabel(exec.action_type),
        last_action_date: exec.action_date || null,
      };
      continue;
    }

    result[caseId] = { last_action: null, last_action_date: null };
  }

  return result;
}

module.exports = {
  ACTION_TYPE_LABELS,
  ASSIGN_OPERATION,
  actionTypeToLabel,
  resolveLastAction,
  buildLastActionMap,
};
