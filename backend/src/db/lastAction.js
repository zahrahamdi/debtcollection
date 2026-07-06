'use strict';

const { query } = require('./database');

/** برچسب فارسی انواع اقدام — منبع واحد */
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

function resolveLastAction(caseId) {
  const map = buildLastActionMap([caseId]);
  return map[caseId] || { last_action: null, last_action_date: null };
}

/**
 * نقشه caseId → { last_action, last_action_date }
 * آخرین رویداد از case_events (یک منبع واحد)
 */
function buildLastActionMap(caseIds) {
  const result = {};
  if (!caseIds?.length) return result;

  const idList = caseIds.map(Number).filter(Boolean);
  if (!idList.length) return result;

  const placeholders = idList.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(idList.map((id, i) => [`$id${i}`, id]));

  const rows = query(
    `SELECT case_id, label, created_at, action_type FROM (
       SELECT case_id, label, created_at, action_type,
              ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY created_at DESC, id DESC) AS rn
       FROM case_events
       WHERE case_id IN (${placeholders})
     ) ranked WHERE rn = 1`,
    params
  );

  for (const row of rows) {
    result[row.case_id] = {
      last_action: row.label || actionTypeToLabel(row.action_type),
      last_action_date: row.created_at || null,
    };
  }

  for (const caseId of idList) {
    if (!result[caseId]) {
      result[caseId] = { last_action: null, last_action_date: null };
    }
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
