'use strict';

const { query, run: dbRun } = require('../db/database');
const {
  todayJalali,
  nowJalaliDateTime,
  nowDatetime,
  computeNextActionDate,
  computeNextActionDateFromWindow,
  isActionDue,
  isWithinAllowedWindow,
  calcActionStatus,
  addMinutesFromNow,
} = require('../db/dateUtil');
const { computeCei } = require('../db/cei');
const { toInterval } = require('../db/segmentUtil');
const { sendSms, replacePlaceholders } = require('./sms.service');
const { processDuePartialPaymentResumes } = require('./payment-import.service');
const { parseRepeatOnResults } = require('../db/strategyActions');

const ELIGIBLE_STATUSES = [
  'pending_strategy_start',
  'pending_strategy_continue',
  'pending_sms_result',
  'pending_sms_retry',
  'pending_autocall_result',
  'pending_autocall_retry',
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

const AUTOMATED_HISTORY_OPS = {
  warning_sms: 'ارسال پیامک هشدار',
  threatening_sms: 'ارسال پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
};

function automatedHistoryOperation(actionType, isRetry = false) {
  const base = AUTOMATED_HISTORY_OPS[actionType];
  if (!base) {
    const isSms = SMS_TYPES.includes(actionType);
    if (isRetry) return isSms ? 'ارسال ناموفق پیامک — تلاش مجدد' : 'تماس خودکار ناموفق — تلاش مجدد';
    return isSms ? 'اجرای پیامک' : 'اجرای تماس خودکار';
  }
  return isRetry ? `${base} — تلاش مجدد` : base;
}

// نتایج شبیه‌سازی‌شده (Mock) پیامک — weighted random پس از ارسال واقعی/شبیه‌سازی‌شده.
const SMS_OUTCOMES = [
  { label: 'ارسال شد', weight: 85, ok: true },
  { label: 'ارسال نشد', weight: 15, ok: false },
];

// نتایج شبیه‌سازی‌شده (Mock) تماس خودکار — weighted random.
const AUTOCALL_OUTCOMES = [
  { label: 'پاسخگو بود', weight: 40, answered: true },
  { label: 'پاسخگو نبود', weight: 40, answered: false },
  { label: 'اشغال بود', weight: 20, answered: false },
];

function pickSmsMockOutcome() {
  return weightedPick(SMS_OUTCOMES);
}

function pickAutocallMockOutcome() {
  return weightedPick(AUTOCALL_OUTCOMES);
}

let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weightedPick(list) {
  const total = list.reduce((s, o) => s + o.weight, 0);
  let roll = Math.random() * total;
  for (const o of list) {
    roll -= o.weight;
    if (roll <= 0) return o;
  }
  return list[0];
}

function insertCaseHistory(caseId, debtorId, operation, caseRow, details) {
dbRun(
    `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
     VALUES ($cid, $did, 'سیستم', $op, $st, $na, $nad, $det)`,
    {
      $cid: caseId,
      $did: debtorId,
      $op: operation,
      $st: caseRow.case_status ?? null,
      $na: caseRow.next_action ?? null,
      $nad: caseRow.next_action_date ?? null,
      $det: typeof details === 'string' ? details : JSON.stringify(details),
    }
  );
}

function getStrategyActionBySeq(strategyId, seq) {
  const rows = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid AND seq = $seq`,
    { $sid: strategyId, $seq: seq }
  );
  return rows[0] || null;
}

function getNextStrategyActionAfter(strategyId, seq) {
  const rows = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid AND seq > $seq ORDER BY seq ASC LIMIT 1`,
    { $sid: strategyId, $seq: seq }
  );
  return rows[0] || null;
}

function updateCaseFields(caseId, fields) {
  const sets = [];
  const params = { $id: caseId };
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = $${key}`);
    params[`$${key}`] = val === undefined ? null : val;
  }
  sets.push(`updated_at = datetime('now')`);
dbRun(`UPDATE cases SET ${sets.join(', ')} WHERE id = $id`, params);
}

function recordCaseAction(caseId, action, bodyText, result, cost, repeatCount = 0) {
  // seq به‌صورت running-max ثبت می‌شود (ترتیب زمانی درج) تا سابقه به ترتیب صحیح نمایش داده شود.
  const maxSeq = query(
    'SELECT COALESCE(MAX(seq), 0) AS m FROM case_actions WHERE case_id = $id',
    { $id: caseId }
  )[0].m;
  dbRun(
    `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost, repeat_count)
     VALUES ($cid, $seq, $type, $body, $result, $date, $cost, $rep)`,
    {
      $cid: caseId,
      $seq: maxSeq + 1,
      $type: action.action_type,
      $body: bodyText,
      $result: result,
      $date: nowJalaliDateTime(),
      $cost: cost,
      $rep: repeatCount,
    }
  );
}

function findDueCases() {
  const rows = query(`
    SELECT c.*, d.first_name, d.last_name, d.mobile
    FROM cases c
    JOIN debtors d ON d.id = c.debtor_id
    WHERE c.case_status IN (
        'pending_strategy_start', 'pending_strategy_continue',
        'pending_sms_result', 'pending_sms_retry',
        'pending_autocall_result', 'pending_autocall_retry'
      )
      AND c.strategy_id IS NOT NULL
  `);
  return rows.filter((c) => isActionDue(c.next_action_date));
}

function effectiveMaxCallCount(caseRow) {
  const fromCase = Number(caseRow.max_call_count);
  if (fromCase > 0) return fromCase;
  const seq = Number(caseRow.current_action_seq) || 0;
  const action = getStrategyActionBySeq(caseRow.strategy_id, seq);
  if (action?.action_type === 'negotiator_call') {
    return Number(action.max_repeat) || 3;
  }
  return 3;
}

function findDueNegotiatorResultCases() {
  const rows = query(`
    SELECT c.*, d.first_name, d.last_name, d.mobile
    FROM cases c
    JOIN debtors d ON d.id = c.debtor_id
    WHERE c.strategy_id IS NOT NULL
      AND c.case_status <> 'paid'
      AND COALESCE(c.outstanding_debt, 0) > 0
      AND (
        c.case_status = 'in_negotiation'
        OR c.case_status = 'pending_negotiator_recall'
      )
  `);
  return rows.filter((c) => {
    if (!isActionDue(c.next_action_date)) return false;
    if (c.case_status === 'in_negotiation') return true;
    const maxCalls = effectiveMaxCallCount(c);
    return (Number(c.current_action_repeat) || 0) >= maxCalls;
  });
}

function isCaseUnpaid(caseRow) {
  return caseRow.case_status !== 'paid' && Number(caseRow.outstanding_debt) > 0;
}

async function processNegotiatorResultDueCase(caseRow) {
  if (!isCaseUnpaid(caseRow)) {
    return { skipped: true, reason: 'case_paid' };
  }

  const attempts = Number(caseRow.current_action_repeat) || 0;
  const maxCalls = effectiveMaxCallCount(caseRow);
  const negSeq = Number(caseRow.current_action_seq) || 0;

  // سقف تماس‌های مذاکره پر شده → اکشن بعدی استراتژی یا شکست استراتژی
  if (maxCalls > 0 && attempts >= maxCalls) {
    const currentAction = getStrategyActionBySeq(caseRow.strategy_id, negSeq);
    const nextObj = getNextStrategyActionAfter(caseRow.strategy_id, negSeq);
    if (!nextObj) {
      return handleStrategyFailure(caseRow);
    }
    const waitNext = Number(currentAction?.wait_next_minutes) || 0;
    const nextActionDate = computeNextActionDate(waitNext, nextObj);
    const nextLabel = ACTION_LABELS[nextObj.action_type] || nextObj.action_type;
    updateCaseFields(caseRow.id, {
      case_status: 'pending_strategy_continue',
      current_action_seq: negSeq,
      current_action_repeat: 0,
      next_action: nextLabel,
      next_action_date: nextActionDate,
      action_status: calcActionStatus(nextActionDate),
    });
    insertCaseHistory(
      caseRow.id,
      caseRow.debtor_id,
      'عبور به اقدام بعدی استراتژی',
      { case_status: 'pending_strategy_continue', next_action: nextLabel, next_action_date: nextActionDate },
      { from: 'negotiator_call', to_seq: nextObj.seq, attempts, max_call_count: maxCalls }
    );
    return { ok: true };
  }

  // هنوز تماس باقی است → بازگشایی تماس مذاکره‌کننده
  const nextActionDate = nowDatetime();
  updateCaseFields(caseRow.id, {
    case_status: 'pending_negotiator_call',
    next_action: 'تماس مذاکره‌کننده',
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
  });
  insertCaseHistory(
    caseRow.id,
    caseRow.debtor_id,
    'بازگشت به تماس مذاکره‌کننده',
    { case_status: 'pending_negotiator_call', next_action: 'تماس مذاکره‌کننده', next_action_date: nextActionDate },
    { attempts, max_call_count: maxCalls, note: 'سررسید تماس بعدی — تماس باقی‌مانده' }
  );
  return { ok: true };
}

// عبور به اکشن بعدی پس از پر شدن سقف تکرار اکشن جاری (یا شکست استراتژی اگر اکشن بعدی نبود).
function advanceAfterExhaustion(caseRow, action, newCost, historyNote) {
  const actionLabel = ACTION_LABELS[action.action_type];
  const nextObj = getNextStrategyActionAfter(caseRow.strategy_id, action.seq);

  if (!nextObj) {
    // آخرین اکشن استراتژی بود و به نتیجه نرسید → شکست استراتژی
    updateCaseFields(caseRow.id, {
      last_action: actionLabel,
      last_action_date: todayJalali(),
      case_cost: newCost,
      current_action_repeat: 0,
    });
    return handleStrategyFailure(caseRow);
  }

  const waitNext = Number(action.wait_next_minutes) || 0;
  const nextActionDate = computeNextActionDate(waitNext, nextObj);
  const nextLabel = ACTION_LABELS[nextObj.action_type] || nextObj.action_type;
  updateCaseFields(caseRow.id, {
    case_status: 'pending_strategy_continue',
    current_action_seq: action.seq,
    current_action_repeat: 0,
    last_action: actionLabel,
    last_action_date: todayJalali(),
    next_action: nextLabel,
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
    case_cost: newCost,
  });
  insertCaseHistory(
    caseRow.id,
    caseRow.debtor_id,
    'عبور به اقدام بعدی استراتژی',
    { case_status: 'pending_strategy_continue', next_action: nextLabel, next_action_date: nextActionDate },
    { from_seq: action.seq, to_seq: nextObj.seq, note: historyNote }
  );
  return { ok: true };
}

// اجرای اقدام پیامک/تماس خودکار با منطق تکرار مشترک.
// max_repeat = حداکثر تعداد کل اجرای همان اقدام (نه تعداد retry اضافه).
function automatedAttemptsBefore(caseRow, action) {
  const curSeq = Number(caseRow.current_action_seq) || 0;
  if (curSeq !== Number(action.seq)) return 0;
  return Number(caseRow.current_action_repeat) || 0;
}

function advanceAfterAutomatedOutcome(caseRow, action, kind, ctx) {
  const {
    outcome,
    newCost,
    bodyText,
    cost,
    actionLabel,
    waitNext,
    attemptsMade,
  } = ctx;
  const resultStatus = kind === 'sms' ? 'pending_sms_result' : 'pending_autocall_result';
  const okHistoryOp = automatedHistoryOperation(action.action_type, false);
  const nextObj = getNextStrategyActionAfter(caseRow.strategy_id, action.seq);
  const nextActionDate = nextObj ? computeNextActionDate(waitNext, nextObj) : addMinutesFromNow(waitNext);
  const nextLabel = nextObj ? ACTION_LABELS[nextObj.action_type] || nextObj.action_type : 'شکست استراتژی';
  updateCaseFields(caseRow.id, {
    case_status: resultStatus,
    current_action_seq: action.seq,
    current_action_repeat: 0,
    last_action: actionLabel,
    last_action_date: todayJalali(),
    next_action: nextLabel,
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
    case_cost: newCost,
  });
  insertCaseHistory(
    caseRow.id,
    caseRow.debtor_id,
    okHistoryOp,
    { case_status: resultStatus, next_action: nextLabel, next_action_date: nextActionDate },
    { action_type: action.action_type, result: outcome, cost, attempt: attemptsMade }
  );
  return { ok: true };
}

function executeAutomatedAction(caseRow, action, kind, picked) {
  const outcome = picked.label;
  const bodyText = replacePlaceholders(action.body_text, {
    userName: `${caseRow.first_name} ${caseRow.last_name}`.trim(),
    claimsAmount: caseRow.claims_amount,
  });

  const actionLabel = ACTION_LABELS[action.action_type];
  const cost = Number(action.cost) || 0;
  const newCost = (Number(caseRow.case_cost) || 0) + cost;
  const maxRepeat = Number(action.max_repeat) || 3;
  const waitNext = Number(action.wait_next_minutes) || 0;
  const waitRepeat = Number(action.wait_repeat_minutes) || 0;
  const attemptsBefore = automatedAttemptsBefore(caseRow, action);
  const attemptsMade = attemptsBefore + 1;

  const retryStatus = kind === 'sms' ? 'pending_sms_retry' : 'pending_autocall_retry';
  const failHistoryOp = automatedHistoryOperation(action.action_type, true);

  const repeatOn = parseRepeatOnResults(action);
  const inRepeatList = repeatOn.includes(outcome);
  const shouldRetry = inRepeatList && attemptsMade < maxRepeat;

  recordCaseAction(caseRow.id, action, bodyText, outcome, cost, attemptsMade);

  if (shouldRetry) {
    const nextActionDate = computeNextActionDate(waitRepeat, action);
    updateCaseFields(caseRow.id, {
      case_status: retryStatus,
      current_action_seq: action.seq,
      current_action_repeat: attemptsMade,
      last_action: actionLabel,
      last_action_date: todayJalali(),
      next_action: actionLabel,
      next_action_date: nextActionDate,
      action_status: calcActionStatus(nextActionDate),
      case_cost: newCost,
    });
    insertCaseHistory(
      caseRow.id,
      caseRow.debtor_id,
      failHistoryOp,
      { case_status: retryStatus, next_action: actionLabel, next_action_date: nextActionDate },
      {
        action_type: action.action_type,
        result: outcome,
        attempt: attemptsMade,
        max_repeat: maxRepeat,
        repeat_on_results: repeatOn,
      }
    );
    return { ok: true };
  }

  if (inRepeatList && attemptsMade >= maxRepeat) {
    insertCaseHistory(
      caseRow.id,
      caseRow.debtor_id,
      failHistoryOp,
      {
        case_status: caseRow.case_status,
        next_action: actionLabel,
        next_action_date: caseRow.next_action_date ?? null,
      },
      {
        action_type: action.action_type,
        result: outcome,
        attempt: attemptsMade,
        max_repeat: maxRepeat,
        exhausted: true,
        repeat_on_results: repeatOn,
      }
    );
    return advanceAfterExhaustion(caseRow, action, newCost, `${outcome} — سقف تکرار (${maxRepeat}) پر شد`);
  }

  return advanceAfterAutomatedOutcome(caseRow, action, kind, {
    outcome,
    newCost,
    bodyText,
    cost,
    actionLabel,
    waitNext,
    attemptsMade,
  });
}

async function executeSmsAction(caseRow, action) {
  if (!isWithinAllowedWindow(action.allowed_from, action.allowed_to)) {
    const nad = computeNextActionDateFromWindow(action.allowed_from, action.allowed_to);
    updateCaseFields(caseRow.id, { next_action_date: nad, action_status: calcActionStatus(nad) });
    return { skipped: true, reason: 'outside_time_window' };
  }

  const maxRepeat = Number(action.max_repeat) || 3;
  const attemptsBefore = automatedAttemptsBefore(caseRow, action);
  if (attemptsBefore >= maxRepeat) {
    const newCost = Number(caseRow.case_cost) || 0;
    return advanceAfterExhaustion(
      caseRow,
      action,
      newCost,
      `سقف تکرار (${maxRepeat}) قبلاً پر شده — بدون ارسال مجدد`
    );
  }

  const bodyText = replacePlaceholders(action.body_text, {
    userName: `${caseRow.first_name} ${caseRow.last_name}`.trim(),
    claimsAmount: caseRow.claims_amount,
  });
  await sendSms(caseRow.mobile, bodyText);
  const picked = pickSmsMockOutcome();
  return executeAutomatedAction(caseRow, action, 'sms', picked);
}

async function executeAutocallAction(caseRow, action) {
  if (!isWithinAllowedWindow(action.allowed_from, action.allowed_to)) {
    const nad = computeNextActionDateFromWindow(action.allowed_from, action.allowed_to);
    updateCaseFields(caseRow.id, { next_action_date: nad, action_status: calcActionStatus(nad) });
    return { skipped: true, reason: 'outside_time_window' };
  }

  const maxRepeat = Number(action.max_repeat) || 3;
  const attemptsBefore = automatedAttemptsBefore(caseRow, action);
  if (attemptsBefore >= maxRepeat) {
    const newCost = Number(caseRow.case_cost) || 0;
    return advanceAfterExhaustion(
      caseRow,
      action,
      newCost,
      `سقف تکرار (${maxRepeat}) قبلاً پر شده — بدون تماس مجدد`
    );
  }

  await sleep(1000 + Math.floor(Math.random() * 2000));
  const picked = pickAutocallMockOutcome();
  return executeAutomatedAction(caseRow, action, 'autocall', picked);
}

function executeNegotiatorCallAction(caseRow, action) {
  const maxRepeat = Number(action.max_repeat) || 3;
  const common = {
    current_action_seq: action.seq,
    current_action_repeat: 0,
    max_call_count: maxRepeat,
  };

  // اگر پرونده از قبل مذاکره‌کننده دارد، مرحله تخصیص را رد می‌کنیم و
  // مستقیم به «در انتظار تماس مذاکره‌کننده» می‌بریم.
  if (caseRow.assigned_negotiator_id) {
    const nextActionDate = nowDatetime();
    updateCaseFields(caseRow.id, {
      ...common,
      case_status: 'pending_negotiator_call',
      next_action: 'تماس مذاکره‌کننده',
      next_action_date: nextActionDate,
      action_status: calcActionStatus(nextActionDate),
    });
    insertCaseHistory(
      caseRow.id,
      caseRow.debtor_id,
      'ارجاع به مذاکره‌کننده',
      { case_status: 'pending_negotiator_call', next_action: 'تماس مذاکره‌کننده', next_action_date: nextActionDate },
      { action_type: action.action_type, note: 'مذاکره‌کننده از قبل تخصیص یافته — مرحله تخصیص رد شد' }
    );
    return { ok: true };
  }

  updateCaseFields(caseRow.id, {
    ...common,
    case_status: 'pending_negotiator_assignment',
    next_action: 'تخصیص به مذاکره‌کننده',
    next_action_date: null,
    action_status: 'waiting',
  });
  insertCaseHistory(
    caseRow.id,
    caseRow.debtor_id,
    'ارجاع به مذاکره‌کننده',
    { case_status: 'pending_negotiator_assignment', next_action: 'تخصیص به مذاکره‌کننده', next_action_date: null },
    { action_type: action.action_type }
  );
  return { ok: true };
}

function formulaTypeOf(creditType) {
  return creditType === 'bnpl' ? 'bnpl' : 'loan';
}

function activeFormula(creditType) {
  const rows = query(
    `SELECT * FROM cei_formulas WHERE credit_type = $t AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    { $t: creditType }
  );
  return rows[0] || null;
}

function computeRawCeiForCase(caseRow) {
  const formulaType = formulaTypeOf(caseRow.credit_type);
  const formula = activeFormula(formulaType);
  if (!formula) return null;
  const params = JSON.parse(formula.params);
  const { cei } = computeCei(formulaType, params, caseRow);
  return cei;
}

function ceiMatchesSegment(cei, segment) {
  const { lo, hi, loInc, hiInc } = toInterval(segment.condition_type, segment.cei_x, segment.cei_y);
  if (cei < lo || cei > hi) return false;
  if (cei === lo && !loInc) return false;
  if (cei === hi && !hiInc) return false;
  return true;
}

function getSegmentsForCreditType(creditType) {
  const t = formulaTypeOf(creditType);
  return query(
    `SELECT * FROM segments WHERE credit_type = $t ORDER BY cei_x ASC, id ASC`,
    { $t: t }
  );
}

function findNextSegment(currentSegment, segments) {
  // سگمنت‌ها را بر اساس حداقل CEI مرتب می‌کنیم و دقیقاً سگمنت بلافاصله بعدی را برمی‌گردانیم.
  const sorted = [...segments].sort(
    (a, b) => Number(a.cei_x) - Number(b.cei_x) || Number(a.id) - Number(b.id)
  );
  const idx = sorted.findIndex((s) => Number(s.id) === Number(currentSegment.id));
  if (idx === -1 || idx + 1 >= sorted.length) return null;
  return sorted[idx + 1];
}

function isLastSegment(currentSegment, segments) {
  return findNextSegment(currentSegment, segments) === null;
}

function findSegmentForCei(cei, formulaCreditType) {
  const segments = getSegmentsForCreditType(formulaCreditType);
  return segments.find((s) => ceiMatchesSegment(cei, s)) || null;
}

function getStrategyById(strategyId) {
  const rows = query('SELECT id, title FROM strategies WHERE id = $id', { $id: strategyId });
  return rows[0] || null;
}

function pickStrategyForSegment(segmentId, creditType) {
  const formulaType = formulaTypeOf(creditType);
  const strategies = query(
    `SELECT id, title FROM strategies WHERE segment_id = $sid AND credit_type = $ct ORDER BY id ASC`,
    { $sid: segmentId, $ct: formulaType }
  );
  if (!strategies.length) return null;

  const abRows = query('SELECT * FROM ab_tests WHERE segment_id = $sid LIMIT 1', { $sid: segmentId });
  if (abRows.length > 0) {
    const test = abRows[0];
    const roll = Math.random() * 100;
    const chosenId = roll < test.ratio_a ? test.strategy_a_id : test.strategy_b_id;
    return getStrategyById(chosenId) || strategies[0];
  }
  return strategies[0];
}

function maxCallCountForStrategy(strategyId) {
  const row = query(
    `SELECT max_repeat FROM strategy_actions
     WHERE strategy_id = $sid AND action_type = 'negotiator_call'
     ORDER BY seq DESC LIMIT 1`,
    { $sid: strategyId }
  )[0];
  return row?.max_repeat ?? null;
}

function getFirstStrategyAction(strategyId) {
  const rows = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC LIMIT 1`,
    { $sid: strategyId }
  );
  return rows[0] || null;
}

function firstStrategyActionLabel(strategyId) {
  const first = getFirstStrategyAction(strategyId);
  if (!first) return null;
  return ACTION_LABELS[first.action_type] || first.action_type;
}

function computeInitialNextActionDate(strategyId) {
  const first = getFirstStrategyAction(strategyId);
  if (!first) return nowDatetime();
  return computeNextActionDateFromWindow(first.allowed_from, first.allowed_to);
}

function recordStrategyFailureMarker(caseId, failedStrategyTitle) {
  const maxSeq = query(
    'SELECT COALESCE(MAX(seq), 0) AS m FROM case_actions WHERE case_id = $id',
    { $id: caseId }
  )[0].m;
  dbRun(
    `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost)
     VALUES ($cid, $seq, 'strategy_failure', NULL, $res, $date, 0)`,
    {
      $cid: caseId,
      $seq: maxSeq + 1,
      $res: failedStrategyTitle || 'شکست استراتژی',
      $date: nowJalaliDateTime(),
    }
  );
}

// CEI را طوری اصلاح می‌کند که دقیقاً داخل بازه سگمنت قرار گیرد (با احتساب شمول مرزها).
function clampCeiIntoSegment(cei, segment) {
  const { lo, hi, loInc, hiInc } = toInterval(segment.condition_type, segment.cei_x, segment.cei_y);
  const EPS = 0.01;
  const minInside = loInc ? lo : round2(lo + EPS);
  const maxInside = hiInc ? hi : round2(hi - EPS);
  if (cei < minInside) return minInside;
  if (cei > maxInside) return maxInside;
  return round2(cei);
}

function proportionalCeiBoost(computedCei, currentSegment, nextSegment, prevBoost = 0) {
  const curMin = Number(currentSegment.cei_x);
  const curMax = Number(currentSegment.cei_y);
  const nextMin = Number(nextSegment.cei_x);
  const nextMax = Number(nextSegment.cei_y);
  const span = curMax - curMin;
  const positionRatio = span > 0 ? (computedCei - curMin) / span : 0;
  const clampedRatio = Math.max(0, Math.min(1, positionRatio));
  const targetCei = round2(nextMin + clampedRatio * (nextMax - nextMin));

  // CEI نهایی = هدف + boost قبلی (طبق فرمول: cei_boost += boost_جدید)
  let finalCei = round2(targetCei + Number(prevBoost));

  // تضمین اینکه CEI نهایی دقیقاً در سگمنت بعدی بیفتد، نه سگمنت دیگر.
  if (!ceiMatchesSegment(finalCei, nextSegment)) {
    finalCei = clampCeiIntoSegment(finalCei, nextSegment);
  }

  const newBoostTotal = round2(finalCei - computedCei);
  const boostNew = round2(newBoostTotal - Number(prevBoost));
  return { boostNew, newBoostTotal, finalCei, targetCei };
}

const round2 = (x) => Math.round(x * 100) / 100;

function handleStrategyFailure(caseRow) {
  if (caseRow.case_status === 'paid' || Number(caseRow.outstanding_debt) === 0) {
    return { ok: false, reason: 'case_paid' };
  }

  const failedStrategy = getStrategyById(caseRow.strategy_id);
  const failedStrategyTitle = failedStrategy?.title || '—';
  const currentSegment = caseRow.segment_id
    ? query('SELECT * FROM segments WHERE id = $id', { $id: caseRow.segment_id })[0]
    : null;

  if (!currentSegment) {
    console.warn(`[strategy-engine] پرونده ${caseRow.id}: سگمنت یافت نشد`);
    return completeStrategyLegalOnly(caseRow, failedStrategyTitle);
  }

  const segments = getSegmentsForCreditType(caseRow.credit_type);

  if (isLastSegment(currentSegment, segments)) {
    updateCaseFields(caseRow.id, {
      case_status: 'pending_legal_assignment',
      last_action: 'شکست استراتژی',
      last_action_date: todayJalali(),
      next_action: 'تخصیص به حقوقی',
      next_action_date: null,
      action_status: 'waiting',
      strategy_id: null,
      current_action_seq: 0,
      current_action_repeat: 0,
    });

    const snapshot = {
      case_status: 'pending_legal_assignment',
      next_action: 'تخصیص به حقوقی',
      next_action_date: null,
    };
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'شکست استراتژی', snapshot, {
      failed_strategy: failedStrategyTitle,
      reason: 'آخرین استراتژی این اعتبار بود',
    });
    recordStrategyFailureMarker(caseRow.id, failedStrategyTitle);
    return { ok: true, lastSegment: true };
  }

  const computedCei = computeRawCeiForCase(caseRow);
  if (computedCei === null) {
    console.warn(`[strategy-engine] پرونده ${caseRow.id}: CEI محاسبه نشد`);
    return { ok: false, reason: 'cei_calc_failed' };
  }

  const nextSegment = findNextSegment(currentSegment, segments);
  if (!nextSegment) {
    return completeStrategyLegalOnly(caseRow, failedStrategyTitle);
  }

  const prevBoost = Number(caseRow.cei_boost) || 0;
  const { boostNew, newBoostTotal, finalCei } = proportionalCeiBoost(
    computedCei,
    currentSegment,
    nextSegment,
    prevBoost
  );

  const newStrategy = pickStrategyForSegment(nextSegment.id, caseRow.credit_type);
  if (!newStrategy) {
    console.warn(`[strategy-engine] پرونده ${caseRow.id}: استراتژی برای سگمنت ${nextSegment.id} یافت نشد`);
    return { ok: false, reason: 'no_strategy_for_segment' };
  }

  const nextActionDate = computeInitialNextActionDate(newStrategy.id);
  const nextAction = firstStrategyActionLabel(newStrategy.id);
  const maxCalls = maxCallCountForStrategy(newStrategy.id);

  updateCaseFields(caseRow.id, {
    cei: finalCei,
    cei_boost: newBoostTotal,
    segment_id: nextSegment.id,
    strategy_id: newStrategy.id,
    case_status: 'pending_strategy_start',
    last_action: 'شکست استراتژی',
    last_action_date: todayJalali(),
    next_action: nextAction,
    next_action_date: nextActionDate,
    action_status: calcActionStatus(nextActionDate),
    max_call_count: maxCalls,
    current_action_seq: 0,
    current_action_repeat: 0,
  });

  recordStrategyFailureMarker(caseRow.id, failedStrategyTitle);

  const snapshot = {
    case_status: 'pending_strategy_start',
    next_action: nextAction,
    next_action_date: nextActionDate,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'شکست استراتژی', snapshot, {
    failed_strategy: failedStrategyTitle,
    computed_cei: computedCei,
    boost_added: boostNew,
    final_cei: finalCei,
    segment_previous: currentSegment.title,
    segment_new: nextSegment.title,
    strategy_new: newStrategy.title,
  });

  return { ok: true, lastSegment: false };
}

function completeStrategyLegalOnly(caseRow, failedStrategyTitle) {
  updateCaseFields(caseRow.id, {
    case_status: 'pending_legal_assignment',
    last_action: 'شکست استراتژی',
    last_action_date: todayJalali(),
    next_action: 'تخصیص به حقوقی',
    next_action_date: null,
    action_status: 'waiting',
    strategy_id: null,
    current_action_seq: 0,
    current_action_repeat: 0,
  });
  const snapshot = {
    case_status: 'pending_legal_assignment',
    next_action: 'تخصیص به حقوقی',
    next_action_date: null,
  };
  insertCaseHistory(caseRow.id, caseRow.debtor_id, 'شکست استراتژی', snapshot, {
    failed_strategy: failedStrategyTitle,
    reason: 'آخرین استراتژی این اعتبار بود',
  });
  recordStrategyFailureMarker(caseRow.id, failedStrategyTitle);
  return { ok: true, lastSegment: true };
}

async function processCase(caseRow) {
  const status = caseRow.case_status;
  const curSeq = Number(caseRow.current_action_seq) || 0;
  const isRetry = status === 'pending_sms_retry' || status === 'pending_autocall_retry';
  const isContinue = status === 'pending_strategy_continue';

  let action;
  if (isRetry) {
    action = getStrategyActionBySeq(caseRow.strategy_id, curSeq);
  } else if (isContinue || curSeq > 0) {
    action = getNextStrategyActionAfter(caseRow.strategy_id, curSeq);
  } else {
    action = getFirstStrategyAction(caseRow.strategy_id);
  }

  if (!action) {
    return handleStrategyFailure(caseRow);
  }

  if (SMS_TYPES.includes(action.action_type)) {
    return executeSmsAction(caseRow, action);
  }
  if (AUTOCALL_TYPES.includes(action.action_type)) {
    return executeAutocallAction(caseRow, action);
  }
  if (action.action_type === 'negotiator_call') {
    return executeNegotiatorCallAction(caseRow, action);
  }

  console.warn('[strategy-engine] نوع اکشن ناشناخته:', action.action_type);
  return { skipped: true, reason: 'unknown_action_type' };
}

async function run() {
  if (running) {
    console.log('[strategy-engine] اجرای قبلی هنوز در جریان است — رد شد');
    return { processed: 0, skipped: true };
  }

  running = true;
  try {
    const partialResumes = processDuePartialPaymentResumes();
    const negotiatorCases = findDueNegotiatorResultCases();
    const cases = findDueCases();
    let processed = 0;
    let skipped = 0;

    for (const caseRow of negotiatorCases) {
      try {
        const result = await processNegotiatorResultDueCase(caseRow);
        if (result.ok) processed += 1;
        else if (result.skipped) skipped += 1;
      } catch (err) {
        console.error(`[strategy-engine] خطا در پرونده مذاکره ${caseRow.id}:`, err);
      }
    }

    for (const caseRow of cases) {
      try {
        const result = await processCase(caseRow);
        if (result.ok) processed += 1;
        else if (result.skipped) skipped += 1;
      } catch (err) {
        console.error(`[strategy-engine] خطا در پرونده ${caseRow.id}:`, err);
      }
    }

    const totalDue = negotiatorCases.length + cases.length;
    if (totalDue > 0) {
      console.log(
        `[strategy-engine] ${totalDue} پرونده سررسید (${negotiatorCases.length} مذاکره، ${cases.length} استراتژی) — ${processed} اجرا، ${skipped} رد`
      );
    }

    return { processed, skipped, total: totalDue };
  } finally {
    running = false;
  }
}

module.exports = { run, ELIGIBLE_STATUSES };
