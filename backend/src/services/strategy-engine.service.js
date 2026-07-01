'use strict';

const { query, run: dbRun } = require('../db/database');
const {
  todayJalali,
  nowJalaliDateTime,
  nowDatetime,
  computeNextActionDate,
  isActionDue,
  isWithinAllowedWindow,
  calcActionStatus,
  nextAllowedStartDatetime,
} = require('../db/dateUtil');
const { computeCei } = require('../db/cei');
const { toInterval } = require('../db/segmentUtil');
const { sendSms, replacePlaceholders } = require('./sms.service');
const { processDuePartialPaymentResumes } = require('./payment-import.service');

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

function getLastExecutedSeq(caseId, strategyId) {
  const markerRows = query(
    `SELECT seq FROM case_actions
     WHERE case_id = $id AND action_type = 'strategy_failure'
     ORDER BY seq DESC LIMIT 1`,
    { $id: caseId }
  );
  const afterSeq = markerRows[0]?.seq ?? 0;

  const stratActions = query(
    `SELECT seq, action_type FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC`,
    { $sid: strategyId }
  );
  if (!stratActions.length) return 0;

  const performedRows = query(
    `SELECT DISTINCT action_type FROM case_actions
     WHERE case_id = $id AND seq > $after
       AND action_type NOT IN ('payment_full', 'payment_partial', 'strategy_failure')`,
    { $id: caseId, $after: afterSeq }
  );
  const performed = new Set(performedRows.map((r) => r.action_type));

  let lastSeq = 0;
  for (const sa of stratActions) {
    if (performed.has(sa.action_type)) lastSeq = sa.seq;
    else break;
  }
  return lastSeq;
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
  // seq به‌صورت running-max ثبت می‌شود (نه seq اکشن استراتژی) تا با marker شکست استراتژی
  // هم‌راستا باشد و getLastExecutedSeq به‌درستی پیشرفت را تشخیص دهد.
  const maxSeq = query(
    'SELECT COALESCE(MAX(seq), 0) AS m FROM case_actions WHERE case_id = $id',
    { $id: caseId }
  )[0].m;
  dbRun(
    `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost)
     VALUES ($cid, $seq, $type, $body, $result, $date, $cost)`,
    {
      $cid: caseId,
      $seq: maxSeq + 1,
      $type: action.action_type,
      $body: bodyText,
      $result: result,
      $date: nowJalaliDateTime(),
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

function findDueNegotiatorResultCases() {
  const rows = query(`
    SELECT c.*, d.first_name, d.last_name, d.mobile
    FROM cases c
    JOIN debtors d ON d.id = c.debtor_id
    WHERE c.case_status = 'in_negotiation'
      AND c.strategy_id IS NOT NULL
      AND c.case_status <> 'paid'
      AND COALESCE(c.outstanding_debt, 0) > 0
  `);
  return rows.filter((c) => isActionDue(c.next_action_date));
}

function isCaseUnpaid(caseRow) {
  return caseRow.case_status !== 'paid' && Number(caseRow.outstanding_debt) > 0;
}

async function processNegotiatorResultDueCase(caseRow) {
  if (!isCaseUnpaid(caseRow)) {
    return { skipped: true, reason: 'case_paid' };
  }

  const callCount = Number(caseRow.call_count) || 0;
  const maxCalls = Number(caseRow.max_call_count) || 0;

  if (callCount < maxCalls) {
    const nextActionDate = nowDatetime();
    updateCaseFields(caseRow.id, {
      case_status: 'pending_negotiator_call',
      next_action: 'تماس مذاکره‌کننده',
      next_action_date: nextActionDate,
      action_status: calcActionStatus(nextActionDate),
    });

    const snapshot = {
      case_status: 'pending_negotiator_call',
      next_action: 'تماس مذاکره‌کننده',
      next_action_date: nextActionDate,
    };
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'بازگشت به تماس مذاکره‌کننده', snapshot, {
      call_count: callCount,
      max_call_count: maxCalls,
      note: 'سررسید تماس بعدی — تماس باقی‌مانده',
    });

    return { ok: true };
  }

  const lastSeq = getLastExecutedSeq(caseRow.id, caseRow.strategy_id);
  const nextAction = getNextStrategyAction(caseRow.strategy_id, lastSeq);

  if (nextAction) {
    return processCase(caseRow);
  }

  return completeStrategy(caseRow);
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

  const sendResult = await sendSms(caseRow.mobile, bodyText);
  if (!sendResult.ok) {
    return { skipped: true, reason: 'sms_send_failed' };
  }

  const smsResultLabel = sendResult.simulated ? 'ارسال شد (شبیه‌سازی)' : 'ارسال شد';
  const historyOperation = sendResult.simulated ? 'اجرای پیامک (شبیه‌سازی)' : 'اجرای پیامک';

  const waitMinutes = Number(action.wait_minutes) || 0;
  const nextActionObj = getNextStrategyAction(caseRow.strategy_id, action.seq);
  const nextActionDate = nextActionObj
    ? computeNextActionDate(waitMinutes, nextActionObj)
    : null;
  const newStatus = 'pending_sms_result';
  const actionLabel = ACTION_LABELS[action.action_type];
  const nextLabel = upcomingActionLabel(caseRow.strategy_id, action.seq);

  recordCaseAction(caseRow.id, action, bodyText, smsResultLabel, Number(action.cost) || 0);

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
  insertCaseHistory(caseRow.id, caseRow.debtor_id, historyOperation, snapshot, bodyText);

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
  const nextActionObj = getNextStrategyAction(caseRow.strategy_id, action.seq);
  const nextActionDate = nextActionObj
    ? computeNextActionDate(waitMinutes, nextActionObj)
    : null;
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

  // اگر پرونده از قبل مذاکره‌کننده دارد، مرحله تخصیص را رد می‌کنیم و
  // مستقیم به «در انتظار تماس مذاکره‌کننده» می‌بریم.
  if (caseRow.assigned_negotiator_id) {
    const nextActionDate = nowDatetime();

    recordCaseAction(caseRow.id, action, null, 'در انتظار تماس', 0);

    updateCaseFields(caseRow.id, {
      case_status: 'pending_negotiator_call',
      last_action: actionLabel,
      last_action_date: todayJalali(),
      next_action: 'تماس مذاکره‌کننده',
      next_action_date: nextActionDate,
      action_status: calcActionStatus(nextActionDate),
    });

    const snapshot = {
      case_status: 'pending_negotiator_call',
      next_action: 'تماس مذاکره‌کننده',
      next_action_date: nextActionDate,
    };
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'ارجاع به مذاکره‌کننده', snapshot, {
      action_type: action.action_type,
      note: 'مذاکره‌کننده از قبل تخصیص یافته — مرحله تخصیص رد شد',
    });

    return { ok: true };
  }

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
  const smsAuto = [...SMS_TYPES, ...AUTOCALL_TYPES];
  if (smsAuto.includes(first.action_type)) {
    if (!isWithinAllowedWindow(first.allowed_from, first.allowed_to)) {
      return nextAllowedStartDatetime(first.allowed_from);
    }
  }
  return nowDatetime();
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

function completeStrategy(caseRow) {
  return handleStrategyFailure(caseRow);
}

async function processCase(caseRow) {
  const lastSeq = getLastExecutedSeq(caseRow.id, caseRow.strategy_id);
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
