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

/** نتایج مجاز برای تکرار — برچسب فارسی (همان مقادیر Mock / call_status) */
const REPEAT_RESULTS_BY_TYPE = {
  warning_sms: ['ارسال شد', 'ارسال نشد'],
  threatening_sms: ['ارسال شد', 'ارسال نشد'],
  warning_autocall: ['پاسخگو بود', 'پاسخگو نبود', 'اشغال بود'],
  threatening_autocall: ['پاسخگو بود', 'پاسخگو نبود', 'اشغال بود'],
  negotiator_call: ['پاسخگو بود', 'پاسخگو نبود', 'ناسزا گفت'],
};

function parseRepeatOnResults(action) {
  const raw = action?.repeat_on_results;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function serializeRepeatOnResults(raw) {
  const list = Array.isArray(raw) ? raw.filter(Boolean) : parseRepeatOnResults({ repeat_on_results: raw });
  return JSON.stringify(list);
}

// خواندن اقدام‌های یک استراتژی به ترتیب اجرا
function getActions(strategyId) {
  return query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $id ORDER BY seq ASC, id ASC`,
    { $id: strategyId }
  );
}

function validateRepeatOnResults(action) {
  const allowed = REPEAT_RESULTS_BY_TYPE[action.action_type];
  if (!allowed) return null;
  const list = parseRepeatOnResults(action);
  for (const label of list) {
    if (!allowed.includes(label)) {
      return `نتیجه «${label}» برای نوع اقدام ${action.action_type} مجاز نیست`;
    }
  }
  return null;
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
    const waitNext = a.wait_next_minutes ?? a.wait_minutes;
    if (Number(waitNext) < 0) return 'فاصله قبل از اقدام بعدی نمی‌تواند منفی باشد';
    if (a.wait_repeat_minutes != null && a.wait_repeat_minutes !== '' && Number(a.wait_repeat_minutes) < 0) {
      return 'فاصله بین تکرار نمی‌تواند منفی باشد';
    }
    if (a.max_repeat != null && a.max_repeat !== '' && Number(a.max_repeat) < 1) {
      return 'حداکثر تکرار باید حداقل ۱ باشد';
    }
    const repeatErr = validateRepeatOnResults(a);
    if (repeatErr) return repeatErr;
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
        (strategy_id, seq, action_type, body_text, allowed_from, allowed_to,
         wait_next_minutes, wait_repeat_minutes, cost, max_repeat, repeat_on_results, avg_call_duration)
       VALUES ($sid, $seq, $type, $body, $from, $to, $waitNext, $waitRepeat, $cost, $rep, $repeatOn, $dur)`,
      {
        $sid: strategyId,
        $seq: i + 1,
        $type: a.action_type,
        $body: a.body_text ?? null,
        $from: a.allowed_from ?? null,
        $to: a.allowed_to ?? null,
        $waitNext: Number(a.wait_next_minutes ?? a.wait_minutes ?? a.wait_days) || 0,
        $waitRepeat:
          a.wait_repeat_minutes != null && a.wait_repeat_minutes !== ''
            ? Number(a.wait_repeat_minutes)
            : 60,
        $cost: Number(a.cost) || 0,
        $rep: a.max_repeat != null && a.max_repeat !== '' ? Number(a.max_repeat) : 3,
        $repeatOn: serializeRepeatOnResults(a.repeat_on_results),
        $dur:
          a.avg_call_duration != null && a.avg_call_duration !== ''
            ? Number(a.avg_call_duration)
            : null,
      }
    );
  });
}

module.exports = {
  ACTION_TYPES,
  REPEAT_RESULTS_BY_TYPE,
  getActions,
  validateActions,
  replaceActions,
  parseRepeatOnResults,
  serializeRepeatOnResults,
};
