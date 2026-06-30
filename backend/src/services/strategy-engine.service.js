'use strict';

const { query, run: dbRun } = require('../db/database');
const {
  todayJalali,
  jalaliDateAfterMinutes,
  isActionDue,
  isWithinAllowedWindow,
  calcActionStatus,
} = require('../db/dateUtil');
const { sendSms, replacePlaceholders } = require('./sms.service');

const ELIGIBLE_STATUSES = [
  'pending_strategy_start',
  'pending_sms_result',
  'pending_autocall_result',
];

const SMS_TYPES = ['warning_sms', 'threatening_sms'];
const AUTOCALL_TYPES = ['warning_autocall', 'threatening_autocall'];

const ACTION_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

const AUTOCALL_OUTCOMES = [
  { label: 'پاسخ داده و لینک دریافت کرد', weight: 20 },
  { label: 'پاسخ داده اما اقدامی انجام نداد', weight: 15 },
  { label: 'پاسخگو نبود', weight: 30 },
  { label: 'خط اشغال بود', weight: 10 },
  { label: 'خطای اپراتور', weight: 5 },
  { label: 'شماره موجود نیست', weight: 5 },
  { label: 'پیغامگیر', weight: 5 },
  { label: 'پاسخ داده اما تماس را قطع کرد', weight: 10 },
];

let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickAutocallOutcome() {
  const total = AUTOCALL_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of AUTOCALL_OUTCOMES) {
    roll -= o.weight;
    if (roll <= 0) return o.label;
  }
  return AUTOCALL_OUTCOMES[0].label;
}

function insertCaseHistory(caseId, debtorId, operation, caseRow, details) {
dbRun(
    `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
     VALUES ($cid, $did, 'سیستم', $op, $st, $na, $nad, $det)`,
    {
      $cid: caseId,
      $did: debtorId,
      $op: operation,
      $st: caseRow.case_status,
      $na: caseRow.next_action,
      $nad: caseRow.next_action_date,
      $det: typeof details === 'string' ? details : JSON.stringify(details),
    }
  );
}

function getLastExecutedSeq(caseId) {
  const rows = query(
    `SELECT MAX(seq) AS max_seq FROM case_actions WHERE case_id = $id`,
    { $id: caseId }
  );
  return rows[0]?.max_seq ?? 0;
}

function getNextStrategyAction(strategyId, lastSeq) {
  const nextSeq = lastSeq > 0 ? lastSeq + 1 : 1;
  const rows = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid AND seq = $seq`,
    { $sid: strategyId, $seq: nextSeq }
  );
  return rows[0] || null;
}

function updateCaseFields(caseId, fields) {
  const sets = [];
  const params = { $id: caseId };
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = $${key}`);
    params[`$${key}`] = val;
  }
  sets.push(`updated_at = datetime('now')`);
dbRun(`UPDATE cases SET ${sets.join(', ')} WHERE id = $id`, params);
}

function recordCaseAction(caseId, action, bodyText, result, cost) {
dbRun(
    `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost)
     VALUES ($cid, $seq, $type, $body, $result, $date, $cost)`,
    {
      $cid: caseId,
      $seq: action.seq,
      $type: action.action_type,
      $body: bodyText,
      $result: result,
      $date: todayJalali(),
      $cost: cost,
    }
  );
}

function findDueCases() {
  const rows = query(`
    SELECT c.*, d.first_name, d.last_name, d.mobile
    FROM cases c
    JOIN debtors d ON d.id = c.debtor_id
    WHERE c.case_status IN ('pending_strategy_start', 'pending_sms_result', 'pending_autocall_result')
      AND c.strategy_id IS NOT NULL
  `);
  return rows.filter((c) => isActionDue(c.next_action_date));
}

function upcomingActionLabel(strategyId, afterSeq) {
  const next = getNextStrategyAction(strategyId, afterSeq);
  if (!next) return 'تخصیص به حقوقی';
  return ACTION_LABELS[next.action_type] || next.action_type;
}

async function executeSmsAction(caseRow, action) {
  if (!isWithinAllowedWindow(action.allowed_from, action.allowed_to)) {
    return { skipped: true, reason: 'outside_time_window' };
  }

  const userName = `${caseRow.first_name} ${caseRow.last_name}`.trim();
  const bodyText = replacePlaceholders(action.body_text, {
    userName,
    claimsAmount: caseRow.claims_amount,
  });

  const sent = await sendSms(caseRow.mobile, bodyText);
  if (!sent) {
    return { skipped: true, reason: 'sms_send_failed' };
  }

  const waitMinutes = Number(action.wait_minutes) || 0;
  const nextActionDate = jalaliDateAfterMinutes(waitMinutes);
  const newStatus = 'pending_sms_result';
  const actionLabel = ACTION_LABELS[action.action_type];
  const nextLabel = upcomingActionLabel(caseRow.strategy_id, action.seq);

  recordCaseAction(caseRow.id, action, bodyText, 'ارسال شد', Number(action.cost) || 0);

  const newCost = (Number(caseRow.case_cost) || 0) + (Number(action.cost) || 0);
  updateCaseFields(caseRow.id, {
    case_status: newStatus,
    last_action: actionLabel,
    last_action_date: todayJalali(),
    next_action: nextLabel,
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
    case_cost: newCost,
  });

  const snapshot = {
    case_status: newStatus,
    next_action: nextLabel,
    next_action_date: nextActionDate,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'اجرای پیامک', snapshot, {
    action_type: action.action_type,
    body: bodyText,
    cost: action.cost,
  });

  return { ok: true };
}

async function executeAutocallAction(caseRow, action) {
  if (!isWithinAllowedWindow(action.allowed_from, action.allowed_to)) {
    return { skipped: true, reason: 'outside_time_window' };
  }

  await sleep(1000 + Math.floor(Math.random() * 2000));

  const outcome = pickAutocallOutcome();
  const bodyText = replacePlaceholders(action.body_text, {
    userName: `${caseRow.first_name} ${caseRow.last_name}`.trim(),
    claimsAmount: caseRow.claims_amount,
  });

  const waitMinutes = Number(action.wait_minutes) || 0;
  const nextActionDate = jalaliDateAfterMinutes(waitMinutes);
  const newStatus = 'pending_autocall_result';
  const actionLabel = ACTION_LABELS[action.action_type];
  const nextLabel = upcomingActionLabel(caseRow.strategy_id, action.seq);

  recordCaseAction(caseRow.id, action, bodyText, outcome, Number(action.cost) || 0);

  const newCost = (Number(caseRow.case_cost) || 0) + (Number(action.cost) || 0);
  updateCaseFields(caseRow.id, {
    case_status: newStatus,
    last_action: actionLabel,
    last_action_date: todayJalali(),
    next_action: nextLabel,
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
    case_cost: newCost,
  });

  const snapshot = {
    case_status: newStatus,
    next_action: nextLabel,
    next_action_date: nextActionDate,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'اجرای تماس خودکار', snapshot, {
    action_type: action.action_type,
    result: outcome,
    cost: action.cost,
  });

  return { ok: true };
}

function executeNegotiatorCallAction(caseRow, action) {
  const actionLabel = ACTION_LABELS.negotiator_call;
  const newStatus = 'pending_negotiator_assignment';

  recordCaseAction(caseRow.id, action, null, 'در انتظار تخصیص', 0);

  updateCaseFields(caseRow.id, {
    case_status: newStatus,
    last_action: actionLabel,
    last_action_date: todayJalali(),
    next_action: 'تخصیص به مذاکره‌کننده',
    next_action_date: null,
    action_status: 'waiting',
  });

  const snapshot = {
    case_status: newStatus,
    next_action: 'تخصیص به مذاکره‌کننده',
    next_action_date: null,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'ارجاع به مذاکره‌کننده', snapshot, {
    action_type: action.action_type,
  });

  return { ok: true };
}

function completeStrategy(caseRow) {
  const newStatus = 'pending_legal_assignment';
  updateCaseFields(caseRow.id, {
    case_status: newStatus,
    last_action: 'پایان استراتژی',
    last_action_date: todayJalali(),
    next_action: 'تخصیص به حقوقی',
    next_action_date: null,
    action_status: 'waiting',
  });

  const snapshot = {
    case_status: newStatus,
    next_action: 'تخصیص به حقوقی',
    next_action_date: null,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'پایان استراتژی', snapshot, {
    note: 'تمام اقدام‌های استراتژی اجرا شد',
  });

  return { ok: true };
}

async function processCase(caseRow) {
  const lastSeq = getLastExecutedSeq(caseRow.id);
  const nextAction = getNextStrategyAction(caseRow.strategy_id, lastSeq);

  if (!nextAction) {
    return completeStrategy(caseRow);
  }

  if (SMS_TYPES.includes(nextAction.action_type)) {
    return executeSmsAction(caseRow, nextAction);
  }
  if (AUTOCALL_TYPES.includes(nextAction.action_type)) {
    return executeAutocallAction(caseRow, nextAction);
  }
  if (nextAction.action_type === 'negotiator_call') {
    return executeNegotiatorCallAction(caseRow, nextAction);
  }

  console.warn('[strategy-engine] نوع اکشن ناشناخته:', nextAction.action_type);
  return { skipped: true, reason: 'unknown_action_type' };
}

async function run() {
  if (running) {
    console.log('[strategy-engine] اجرای قبلی هنوز در جریان است — رد شد');
    return { processed: 0, skipped: true };
  }

  running = true;
  try {
    const cases = findDueCases();
    let processed = 0;
    let skipped = 0;

    for (const caseRow of cases) {
      try {
        const result = await processCase(caseRow);
        if (result.ok) processed += 1;
        else if (result.skipped) skipped += 1;
      } catch (err) {
        console.error(`[strategy-engine] خطا در پرونده ${caseRow.id}:`, err);
      }
    }

    if (cases.length > 0) {
      console.log(
        `[strategy-engine] ${cases.length} پرونده سررسید — ${processed} اجرا، ${skipped} رد`
      );
    }

    return { processed, skipped, total: cases.length };
  } finally {
    running = false;
  }
}

module.exports = { run, ELIGIBLE_STATUSES };
