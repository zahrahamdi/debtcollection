'use strict';

// ابزار مشترک اقدام‌های استراتژی (مورد استفاده در strategies و ab-tests)
const { query, run } = require('./database');

const ACTION_TYPES = [
  'warning_sms',
  'threatening_sms',
  'warning_autocall',
  'threatening_autocall',
  'negotiator_call',
];

// خواندن اقدام‌های یک استراتژی به ترتیب اجرا
function getActions(strategyId) {
  return query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $id ORDER BY seq ASC, id ASC`,
    { $id: strategyId }
  );
}

// اعتبارسنجی آرایه‌ی اقدام‌ها
function validateActions(actions) {
  if (actions === undefined) return null; // اقدام اختیاری است
  if (!Array.isArray(actions)) return 'فهرست اقدام‌ها نامعتبر است';
  for (const a of actions) {
    if (!ACTION_TYPES.includes(a.action_type)) return 'نوع اقدام نامعتبر است';
    const isSms = a.action_type === 'warning_sms' || a.action_type === 'threatening_sms';
    const isAuto = a.action_type === 'warning_autocall' || a.action_type === 'threatening_autocall';
    if ((isSms || isAuto) && !(a.body_text || '').trim()) {
      return 'متن پیامک/محتوای تماس برای این اقدام اجباری است';
    }
    if (Number(a.wait_minutes) < 0) return 'زمان انتظار نمی‌تواند منفی باشد';
  }
  return null;
}

// حذف اقدام‌های قبلی و درج مجدد با ترتیب
function replaceActions(strategyId, actions) {
  run('DELETE FROM strategy_actions WHERE strategy_id = $id', { $id: strategyId });
  if (!Array.isArray(actions)) return;
  actions.forEach((a, i) => {
    run(
      `INSERT INTO strategy_actions
        (strategy_id, seq, action_type, body_text, allowed_from, allowed_to, wait_minutes, cost, max_repeat, avg_call_duration)
       VALUES ($sid, $seq, $type, $body, $from, $to, $wait, $cost, $rep, $dur)`,
      {
        $sid: strategyId,
        $seq: i + 1,
        $type: a.action_type,
        $body: a.body_text ?? null,
        $from: a.allowed_from ?? null,
        $to: a.allowed_to ?? null,
        $wait: Number(a.wait_minutes ?? a.wait_days) || 0,
        $cost: Number(a.cost) || 0,
        $rep: a.max_repeat != null && a.max_repeat !== '' ? Number(a.max_repeat) : null,
        $dur:
          a.avg_call_duration != null && a.avg_call_duration !== ''
            ? Number(a.avg_call_duration)
            : null,
      }
    );
  });
}

module.exports = { ACTION_TYPES, getActions, validateActions, replaceActions };
