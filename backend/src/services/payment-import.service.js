'use strict';

/**
 * ورود پرداخت‌ها از Excel
 */

const XLSX = require('xlsx');
const { query, run, transaction } = require('../db/database');
const { insertCaseEvent, insertHistoryEvent } = require('../db/caseEvents');
const { computeCei, applyCeiBoost } = require('../db/cei');
const { toInterval } = require('../db/segmentUtil');
const {
  jalaliDateToDatetime,
  formatDatetime,
  calcActionStatus,
  parseActionDatetime,
  nowDatetime,
  nextAllowedStartDatetime,
  isWithinAllowedWindow,
  isActionDue,
  isJalaliPromisedOverdue,
  normalizePaymentDatetime,
  paymentDatetimeToIso,
  isPaymentDatetimeInFuture,
  dateToJalaliDateTime,
} = require('../db/dateUtil');

const MAX_ROWS = 1000;
const PARTIAL_RESUME_ACTION = 'ادامه استراتژی پس از پرداخت جزئی';
const PARTIAL_BEFORE_PROMISE_OP = 'پرداخت جزئی قبل از سررسید تعهد';

const HEADER_TO_FIELD = {
  'شناسه اعتبار': 'credit_id',
  'کد ملی': 'national_code',
  'مبلغ پرداختی به ریال': 'amount',
  'مبلغ پرداختی': 'amount',
  'تاریخ پرداخت': 'payment_date',
  'تاریخ و ساعت پرداخت': 'payment_date',
  'تاریخ و ساعت تراکنش': 'payment_date',
  'شماره تراکنش': 'transaction_id',
  'توضیحات': 'description',
};

const REQUIRED_LABELS = {
  credit_id: 'شناسه اعتبار',
  national_code: 'کد ملی',
  amount: 'مبلغ پرداختی به ریال',
  payment_date: 'تاریخ و ساعت پرداخت',
};

const ACTION_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

const SMS_OR_AUTOCALL = ['warning_sms', 'threatening_sms', 'warning_autocall', 'threatening_autocall'];

function toEnDigits(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .replace(/\u200c/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNationalCode(value) {
  return toEnDigits(value).trim().replace(/\D/g, '');
}

function coercePaymentDateValue(val) {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return dateToJalaliDateTime(val);
  }
  if (typeof val === 'number' && val > 0) {
    const dc = XLSX.SSF.parse_date_code(val);
    if (dc) {
      const dt = new Date(dc.y, dc.m - 1, dc.d, dc.H, dc.M, Math.floor(dc.S || 0));
      return dateToJalaliDateTime(dt);
    }
  }
  return val;
}

function isBlankPaymentRow(mapped, headerMap) {
  const fields = new Set(Object.values(headerMap));
  for (const field of fields) {
    const v = mapped[field];
    if (v !== null && v !== undefined && String(v).trim() !== '') return false;
  }
  return true;
}

function parseCreditId(val, label) {
  if (val === null || val === undefined || val === '') {
    return { ok: false, error: `فیلد ${label} خالی است` };
  }
  const s = toEnDigits(String(val)).trim();
  if (!s) return { ok: false, error: `فیلد ${label} خالی است` };
  return { ok: true, value: s };
}

function parseNumber(val, label) {
  if (val === null || val === undefined || val === '') {
    return { ok: false, error: `فیلد ${label} خالی است` };
  }
  const cleaned = toEnDigits(val).replace(/[,،\s]/g, '');
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, error: `فرمت فیلد ${label} اشتباه است` };
  }
  return { ok: true, value: n };
}

function parseString(val, label) {
  const s = val === null || val === undefined ? '' : toEnDigits(val).trim();
  if (!s) return { ok: false, error: `فیلد ${label} خالی است` };
  return { ok: true, value: s };
}

function getSetting(key, fallback) {
  const rows = query('SELECT value FROM settings WHERE key = $k', { $k: key });
  return rows.length ? rows[0].value : fallback;
}

function formulaTypeOf(creditType) {
  return creditType === 'bnpl' ? 'bnpl' : 'loan';
}

function activeFormula(creditType) {
  return query(
    `SELECT * FROM cei_formulas WHERE credit_type = $t AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    { $t: creditType }
  )[0];
}

function ceiMatchesSegment(cei, segment) {
  const { lo, hi, loInc, hiInc } = toInterval(segment.condition_type, segment.cei_x, segment.cei_y);
  if (cei < lo || cei > hi) return false;
  if (cei === lo && !loInc) return false;
  if (cei === hi && !hiInc) return false;
  return true;
}

function findSegmentForCei(cei, formulaCreditType) {
  const segments = query(
    `SELECT * FROM segments WHERE credit_type = $t ORDER BY cei_x ASC, id ASC`,
    { $t: formulaCreditType }
  );
  return segments.find((s) => ceiMatchesSegment(cei, s)) || null;
}

function getCaseWithDebtor(creditId) {
  const rows = query(
    `SELECT c.*, d.national_code AS debtor_national_code, d.id AS debtor_id
     FROM cases c
     JOIN debtors d ON d.id = c.debtor_id
     WHERE c.credit_id = $cid`,
    { $cid: creditId }
  );
  return rows[0] || null;
}

function paymentDatetimeFromJalali(jalaliStr) {
  const normalized = normalizePaymentDatetime(jalaliStr);
  if (!normalized) return nowDatetime();
  return paymentDatetimeToIso(normalized) || nowDatetime();
}

function addDaysToJalaliDatetime(jalaliStr, days) {
  const normalized = normalizePaymentDatetime(jalaliStr);
  if (normalized) {
    const iso = paymentDatetimeToIso(normalized);
    const dt = iso ? parseActionDatetime(iso) : null;
    if (dt) {
      dt.setDate(dt.getDate() + Number(days || 0));
      return formatDatetime(dt);
    }
  }

  const dateOnly = String(jalaliStr ?? '')
    .trim()
    .split(/\s+/)[0];
  const base = jalaliDateToDatetime(dateOnly);
  if (!base) return null;
  const d = parseActionDatetime(base);
  if (!d) return null;
  d.setDate(d.getDate() + Number(days || 0));
  return formatDatetime(d);
}

const NEGOTIATOR_CALL_LABEL = 'تماس مذاکره‌کننده';

function isInNegotiatorPhase(caseRow) {
  if (!caseRow.assigned_negotiator_id) return false;
  return ['in_negotiation', 'pending_negotiator_recall', 'pending_negotiator_call'].includes(
    caseRow.case_status
  );
}

function resolvePartialPaymentNextAction(caseRow) {
  if (isInNegotiatorPhase(caseRow)) return NEGOTIATOR_CALL_LABEL;
  return PARTIAL_RESUME_ACTION;
}

function partialPaymentGapDays() {
  return parseInt(getSetting('partial_payment_gap_days', '10'), 10);
}

function computePartialPaymentSchedule(caseRow, paymentDate) {
  const gapDays = partialPaymentGapDays();
  const nextActionDate = addDaysToJalaliDatetime(paymentDate, gapDays);
  if (!nextActionDate) {
    throw new Error('محاسبه تاریخ اقدام بعدی پس از پرداخت جزئی ناموفق بود');
  }
  return {
    gapDays,
    nextAction: resolvePartialPaymentNextAction(caseRow),
    nextActionDate,
  };
}

function formatRial(amount) {
  return `${Number(amount).toLocaleString('en-US')} ریال`;
}

function buildPaymentResultText(amount, prevClaims, newClaims) {
  return `مبلغ پرداختی: ${formatRial(amount)} · مطالبات قبلی: ${formatRial(prevClaims)} · مطالبات جدید: ${formatRial(newClaims)}`;
}

function insertCaseHistory(caseId, debtorId, userName, operation, caseRow, details) {
  insertHistoryEvent({
    case_id: caseId,
    operation,
    user_name: userName || 'سیستم',
    case_status: caseRow.case_status,
    next_action: caseRow.next_action,
    next_action_date: caseRow.next_action_date,
    details: typeof details === 'string' ? details : JSON.stringify(details),
  });
}

function logPaymentHistory(caseId, userName, operation, actionType, caseRow, historyDetails, actionDatetime) {
  const summary = buildPaymentResultText(
    historyDetails.amount,
    historyDetails.previous_claims,
    historyDetails.new_claims
  );
  insertCaseEvent({
    case_id: caseId,
    event_type: 'payment',
    action_type: actionType,
    label: operation,
    user_name: userName || 'سیستم',
    case_status: caseRow.case_status ?? null,
    next_action: caseRow.next_action ?? null,
    next_action_date: caseRow.next_action_date ?? null,
    result: summary,
    details: JSON.stringify(historyDetails),
    created_at: actionDatetime,
  });
}

function recalculateCei(caseRow, newClaims) {
  const formulaType = formulaTypeOf(caseRow.credit_type);
  const formula = activeFormula(formulaType);
  if (!formula) throw new Error('فرمول CEI فعال یافت نشد');

  const params = JSON.parse(formula.params);
  const caseData = { ...caseRow, claims_amount: newClaims };
  const { cei: computedCei } = computeCei(formulaType, params, caseData);
  const ceiBoost = Number(caseRow.cei_boost) || 0;
  const cei = applyCeiBoost(computedCei, ceiBoost);
  return { cei, computedCei, ceiBoost, formulaVersion: `v${formula.version}`, formulaType };
}

function getPerformedActionTypes(caseId) {
  const rows = query(
    `SELECT DISTINCT action_type FROM case_events
     WHERE case_id = $id AND event_type = 'action'
       AND action_type NOT IN ('payment_full', 'payment_partial')`,
    { $id: caseId }
  );
  return new Set(rows.map((r) => r.action_type));
}

function getStrategyActions(strategyId) {
  if (!strategyId) return [];
  return query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC`,
    { $sid: strategyId }
  );
}

function firstUnperformedAction(strategyId, performedTypes) {
  return getStrategyActions(strategyId).find((a) => !performedTypes.has(a.action_type)) || null;
}

function pickStrategyForSegment(segmentId, creditType) {
  const formulaType = formulaTypeOf(creditType);
  const strategies = query(
    `SELECT id, title FROM strategies WHERE segment_id = $sid AND credit_type = $ct ORDER BY id ASC`,
    { $sid: segmentId, $ct: formulaType }
  );
  return strategies[0] || null;
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

function computeInitialNextActionDate(strategyId) {
  const first = getStrategyActions(strategyId)[0];
  if (!first) return nowDatetime();
  if (SMS_OR_AUTOCALL.includes(first.action_type)) {
    if (!isWithinAllowedWindow(first.allowed_from, first.allowed_to)) {
      return nextAllowedStartDatetime(first.allowed_from);
    }
  }
  return nowDatetime();
}

function isLighterSegment(oldSeg, newSeg) {
  if (!oldSeg || !newSeg) return false;
  return Number(newSeg.cei_x) < Number(oldSeg.cei_x);
}

function assignStrategyFromStart(caseId, segmentId, creditType, caseSnapshot) {
  const strategy = pickStrategyForSegment(segmentId, creditType);
  if (!strategy) {
    throw new Error('استراتژی فعالی برای سگمنت یافت نشد');
  }

  const first = getStrategyActions(strategy.id)[0];
  const nextAction = first ? ACTION_LABELS[first.action_type] || first.action_type : null;
  const nextActionDate = computeInitialNextActionDate(strategy.id);
  const maxCalls = maxCallCountForStrategy(strategy.id);

  run(
    `UPDATE cases SET strategy_id = $sid, case_status = 'pending_strategy_start',
     next_action = $na, next_action_date = $nad, action_status = $as,
     max_call_count = $mc, current_action_seq = 0, current_action_repeat = 0,
     updated_at = datetime('now') WHERE id = $id`,
    {
      $sid: strategy.id,
      $na: nextAction,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
      $mc: maxCalls,
      $id: caseId,
    }
  );

  return {
    ...caseSnapshot,
    case_status: 'pending_strategy_start',
    next_action: nextAction,
    next_action_date: nextActionDate,
    strategy_id: strategy.id,
    strategy_title: strategy.title,
  };
}

function continueCurrentStrategy(caseId, strategyId, caseSnapshot) {
  const performed = getPerformedActionTypes(caseId);
  const next = firstUnperformedAction(strategyId, performed);
  const nextActionDate = nowDatetime();

  if (next) {
    const nextLabel = ACTION_LABELS[next.action_type] || next.action_type;
    run(
      `UPDATE cases SET case_status = 'pending_strategy_start', next_action = $na,
       next_action_date = $nad, action_status = $as, updated_at = datetime('now') WHERE id = $id`,
      {
        $na: nextLabel,
        $nad: nextActionDate,
        $as: calcActionStatus(nextActionDate),
        $id: caseId,
      }
    );
    return { ...caseSnapshot, case_status: 'pending_strategy_start', next_action: nextLabel, next_action_date: nextActionDate };
  }

  const first = getStrategyActions(strategyId)[0];
  const nextLabel = first ? ACTION_LABELS[first.action_type] || first.action_type : null;
  const nad = computeInitialNextActionDate(strategyId);
  run(
    `UPDATE cases SET case_status = 'pending_strategy_start', next_action = $na,
     next_action_date = $nad, action_status = $as, updated_at = datetime('now') WHERE id = $id`,
    {
      $na: nextLabel,
      $nad: nad,
      $as: calcActionStatus(nad),
      $id: caseId,
    }
  );
  return { ...caseSnapshot, case_status: 'pending_strategy_start', next_action: nextLabel, next_action_date: nad };
}

function resumePartialPaymentCase(caseRow, meta) {
  const oldSeg = meta.previous_segment_id
    ? query('SELECT * FROM segments WHERE id = $id', { $id: meta.previous_segment_id })[0]
    : null;
  const newSeg = meta.new_segment_id
    ? query('SELECT * FROM segments WHERE id = $id', { $id: meta.new_segment_id })[0]
    : null;

  const snapshot = {
    case_status: caseRow.case_status,
    next_action: caseRow.next_action,
    next_action_date: caseRow.next_action_date,
  };

  let resultSnapshot;
  if (meta.previous_segment_id === meta.new_segment_id) {
    resultSnapshot = continueCurrentStrategy(caseRow.id, caseRow.strategy_id, snapshot);
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'سیستم', 'ادامه استراتژی پس از پرداخت جزئی', resultSnapshot, {
      note: 'سگمنت تغییر نکرد — ادامه یا بازشروع استراتژی فعلی',
    });
  } else if (isLighterSegment(oldSeg, newSeg)) {
    resultSnapshot = assignStrategyFromStart(caseRow.id, meta.new_segment_id, caseRow.credit_type, snapshot);
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'سیستم', 'تغییر استراتژی پس از پرداخت جزئی', resultSnapshot, {
      note: 'سگمنت سبک‌تر شد — استراتژی جدید از ابتدا',
      segment_new_id: meta.new_segment_id,
      segment_new_title: newSeg?.title,
      strategy_id: resultSnapshot.strategy_id ?? null,
    });
  } else {
    resultSnapshot = assignStrategyFromStart(caseRow.id, meta.new_segment_id, caseRow.credit_type, snapshot);
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'سیستم', 'تغییر استراتژی پس از پرداخت جزئی', resultSnapshot, {
      note: 'سگمنت تغییر کرد — استراتژی جدید از ابتدا',
      segment_new_id: meta.new_segment_id,
      segment_new_title: newSeg?.title,
      strategy_id: resultSnapshot.strategy_id ?? null,
    });
  }

  return resultSnapshot;
}

function processPendingPromisesOnPayment(caseRow, paymentAmount, userName, caseSnapshot) {
  const openPromises = query(
    `SELECT * FROM promises WHERE case_id = $id AND status IN ('pending', 'broken') ORDER BY id ASC`,
    { $id: caseRow.id }
  );

  for (const p of openPromises) {
    if (paymentAmount < Number(p.amount)) continue;

    run(`UPDATE promises SET status = 'fulfilled' WHERE id = $pid`, { $pid: p.id });
    const details = `تاریخ سررسید: ${p.promised_datetime} · مبلغ تعهد: ${formatRial(p.amount)}`;
    insertCaseHistory(caseRow.id, caseRow.debtor_id, userName, 'انجام تعهد پرداخت', caseSnapshot, details);
  }
}

function processFullPayment(caseRow, amount, paymentDate, userName, extras = {}) {
  const prevClaims = Number(caseRow.claims_amount) || 0;
  const prevPenalty = Number(caseRow.penalty_amount) || 0;
  const prevOutstanding = Number(caseRow.outstanding_debt) || 0;
  const newOutstanding = Math.max(0, prevOutstanding - prevClaims);
  const actionDatetime = paymentDatetimeFromJalali(paymentDate);

  run(
    `UPDATE cases SET claims_amount = 0, penalty_amount = 0, outstanding_debt = $out,
     case_status = 'paid', next_action = NULL, next_action_date = NULL, action_status = 'waiting',
     last_payment_date = $lpd, last_payment_amount = $lpa,
     updated_at = datetime('now') WHERE id = $id`,
    {
      $out: newOutstanding,
      $lpd: paymentDate,
      $lpa: amount,
      $id: caseRow.id,
    }
  );

  run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES ($cid, $amt, $pd, 'full')`,
    { $cid: caseRow.id, $amt: amount, $pd: paymentDate }
  );

  const updated = {
    case_status: 'paid',
    next_action: null,
    next_action_date: null,
  };

  const historyDetails = {
    amount,
    previous_claims: prevClaims,
    new_claims: 0,
    previous_penalty: prevPenalty,
    new_penalty: 0,
    previous_outstanding: prevOutstanding,
    new_outstanding: newOutstanding,
    transaction_id: extras.transaction_id || null,
    description: extras.description || null,
  };

  logPaymentHistory(caseRow.id, userName, 'پرداخت کامل بدهی', 'payment_full', updated, historyDetails, actionDatetime);
  processPendingPromisesOnPayment(caseRow, amount, userName, updated);
  return { payment_type: 'full', previous_claims: prevClaims, new_claims: 0 };
}

function getActivePendingPromise(caseId) {
  return query(
    `SELECT * FROM promises WHERE case_id = $id AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    { $id: caseId }
  )[0] || null;
}

function processPartialPaymentBeforePromiseDue(caseRow, amount, paymentDate, userName, extras, pendingPromise) {
  const prevClaims = Number(caseRow.claims_amount) || 0;
  const newClaims = prevClaims - amount;
  const previousNextAction = caseRow.next_action;
  const previousNextActionDate = caseRow.next_action_date;

  const { cei, formulaVersion } = recalculateCei(caseRow, newClaims);
  const formulaType = formulaTypeOf(caseRow.credit_type);
  const newSegment = findSegmentForCei(cei, formulaType);
  if (!newSegment) {
    throw new Error('سگمنتی متناسب با CEI جدید یافت نشد');
  }

  const { gapDays, nextAction, nextActionDate } = computePartialPaymentSchedule(caseRow, paymentDate);
  const actionDatetime = paymentDatetimeFromJalali(paymentDate);
  const resultText = buildPaymentResultText(amount, prevClaims, newClaims);
  const newOutstanding = Math.max(0, (Number(caseRow.outstanding_debt) || 0) - amount);

  run(
    `UPDATE cases SET claims_amount = $claims, outstanding_debt = $out, cei = $cei,
     cei_formula_version = $ver, segment_id = $seg,
     last_payment_date = $lpd, last_payment_amount = $lpa,
     next_action = $na, next_action_date = $nad, action_status = $as,
     updated_at = datetime('now') WHERE id = $id`,
    {
      $claims: newClaims,
      $out: newOutstanding,
      $cei: cei,
      $ver: formulaVersion,
      $seg: newSegment.id,
      $lpd: paymentDate,
      $lpa: amount,
      $na: nextAction,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
      $id: caseRow.id,
    }
  );

  run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES ($cid, $amt, $pd, 'partial')`,
    { $cid: caseRow.id, $amt: amount, $pd: paymentDate }
  );

  const updated = {
    case_status: caseRow.case_status,
    next_action: nextAction,
    next_action_date: nextActionDate,
  };

  const historyDetails = {
    amount,
    previous_claims: prevClaims,
    new_claims: newClaims,
    transaction_id: extras.transaction_id || null,
    description: extras.description || null,
    promise_datetime: pendingPromise.promised_datetime,
    promise_amount: Number(pendingPromise.amount),
    previous_next_action: previousNextAction,
    previous_next_action_date: previousNextActionDate,
    gap_days: gapDays,
  };

  logPaymentHistory(
    caseRow.id,
    userName,
    PARTIAL_BEFORE_PROMISE_OP,
    'payment_partial',
    updated,
    historyDetails,
    actionDatetime
  );

  return {
    payment_type: 'partial',
    previous_claims: prevClaims,
    new_claims: newClaims,
    cei,
    segment_id: newSegment.id,
    before_promise_due: true,
  };
}

function processPartialPayment(caseRow, amount, paymentDate, userName, extras = {}) {
  const pendingPromise = getActivePendingPromise(caseRow.id);
  if (
    pendingPromise &&
    amount < Number(pendingPromise.amount) &&
    !isJalaliPromisedOverdue(pendingPromise.promised_datetime)
  ) {
    return processPartialPaymentBeforePromiseDue(
      caseRow,
      amount,
      paymentDate,
      userName,
      extras,
      pendingPromise
    );
  }

  const prevClaims = Number(caseRow.claims_amount) || 0;
  const newClaims = prevClaims - amount;
  const previousSegmentId = caseRow.segment_id;

  const { cei, formulaVersion } = recalculateCei(caseRow, newClaims);
  const formulaType = formulaTypeOf(caseRow.credit_type);
  const newSegment = findSegmentForCei(cei, formulaType);
  if (!newSegment) {
    throw new Error('سگمنتی متناسب با CEI جدید یافت نشد');
  }

  const { gapDays, nextAction, nextActionDate } = computePartialPaymentSchedule(caseRow, paymentDate);
  const inNegotiatorPhase = isInNegotiatorPhase(caseRow);
  const actionDatetime = paymentDatetimeFromJalali(paymentDate);
  const resultText = buildPaymentResultText(amount, prevClaims, newClaims);

  const newOutstanding = Math.max(0, (Number(caseRow.outstanding_debt) || 0) - amount);

  run(
    `UPDATE cases SET claims_amount = $claims, outstanding_debt = $out, cei = $cei,
     cei_formula_version = $ver, segment_id = $seg,
     last_payment_date = $lpd, last_payment_amount = $lpa,
     next_action = $na, next_action_date = $nad, action_status = $as,
     updated_at = datetime('now') WHERE id = $id`,
    {
      $claims: newClaims,
      $out: newOutstanding,
      $cei: cei,
      $ver: formulaVersion,
      $seg: newSegment.id,
      $lpd: paymentDate,
      $lpa: amount,
      $na: nextAction,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
      $id: caseRow.id,
    }
  );

  run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES ($cid, $amt, $pd, 'partial')`,
    { $cid: caseRow.id, $amt: amount, $pd: paymentDate }
  );

  const updated = {
    case_status: caseRow.case_status,
    next_action: nextAction,
    next_action_date: nextActionDate,
  };

  const resumeMeta = {
    previous_segment_id: previousSegmentId,
    new_segment_id: newSegment.id,
    previous_cei: caseRow.cei,
    new_cei: cei,
    gap_days: gapDays,
  };

  const historyDetails = {
    amount,
    previous_claims: prevClaims,
    new_claims: newClaims,
    transaction_id: extras.transaction_id || null,
    description: extras.description || null,
    ...resumeMeta,
  };

  logPaymentHistory(
    caseRow.id,
    userName,
    'پرداخت جزئی بدهی',
    'payment_partial',
    updated,
    historyDetails,
    actionDatetime
  );
  processPendingPromisesOnPayment(caseRow, amount, userName, updated);

  if (!inNegotiatorPhase && isActionDue(nextActionDate)) {
    const refreshed = query('SELECT * FROM cases WHERE id = $id', { $id: caseRow.id })[0];
    resumePartialPaymentCase(refreshed, resumeMeta);
  }

  return { payment_type: 'partial', previous_claims: prevClaims, new_claims: newClaims, cei, segment_id: newSegment.id };
}

function validatePaymentRow(mapped) {
  const errors = [];
  const creditId = parseCreditId(mapped.credit_id, REQUIRED_LABELS.credit_id);
  const nationalCodeRaw = parseString(mapped.national_code, REQUIRED_LABELS.national_code);
  const amount = parseNumber(mapped.amount, REQUIRED_LABELS.amount);
  const paymentDate = parseString(
    coercePaymentDateValue(mapped.payment_date),
    REQUIRED_LABELS.payment_date
  );

  if (!creditId.ok) errors.push(creditId.error);
  if (!nationalCodeRaw.ok) errors.push(nationalCodeRaw.error);
  if (!amount.ok) errors.push(amount.error);
  if (!paymentDate.ok) errors.push(paymentDate.error);

  const nationalCode = nationalCodeRaw.ok ? normalizeNationalCode(nationalCodeRaw.value) : '';
  if (nationalCodeRaw.ok && nationalCode.length !== 10) {
    errors.push('کد ملی باید ۱۰ رقم باشد');
  }

  if (errors.length) {
    return { ok: false, errors, credit_id: mapped.credit_id || '—' };
  }

  const normalizedPaymentDate = normalizePaymentDatetime(paymentDate.value);
  if (!normalizedPaymentDate) {
    errors.push('فرمت تاریخ و ساعت پرداخت نامعتبر است (YYYY/MM/DD HH:mm)');
  } else if (isPaymentDatetimeInFuture(paymentDate.value)) {
    errors.push('تاریخ و ساعت پرداخت نمی‌تواند در آینده باشد');
  }

  if (amount.value <= 0) {
    errors.push('مبلغ پرداختی باید بزرگ‌تر از صفر باشد');
  }

  if (errors.length) {
    return { ok: false, errors, credit_id: creditId.value };
  }

  return {
    ok: true,
    data: {
      credit_id: creditId.value,
      national_code: nationalCode,
      amount: amount.value,
      payment_date: normalizedPaymentDate || paymentDate.value,
      transaction_id: mapped.transaction_id ? String(mapped.transaction_id).trim() : null,
      description: mapped.description ? String(mapped.description).trim() : null,
    },
  };
}

function processPaymentRow(data, userName) {
  const caseRow = getCaseWithDebtor(data.credit_id);
  if (!caseRow) {
    throw new Error('شناسه اعتبار در سیستم یافت نشد');
  }

  if (normalizeNationalCode(caseRow.debtor_national_code) !== normalizeNationalCode(data.national_code)) {
    throw new Error('کد ملی با پرونده مطابقت ندارد');
  }

  if (caseRow.case_status === 'paid') {
    throw new Error('پرونده قبلاً پرداخت شده است');
  }

  if (caseRow.case_status === 'burned') {
    throw new Error('پرونده سوخت شده است');
  }

  const prevClaims = Number(caseRow.claims_amount) || 0;
  if (data.amount > prevClaims) {
    throw new Error('مبلغ پرداختی بیشتر از مطالبات پرونده است');
  }

  const extras = {
    transaction_id: data.transaction_id,
    description: data.description,
  };

  if (data.amount >= prevClaims) {
    return processFullPayment(caseRow, data.amount, data.payment_date, userName, extras);
  }

  return processPartialPayment(caseRow, data.amount, data.payment_date, userName, extras);
}

function importPaymentsFromRows(rows, userName = 'ادمین') {
  if (rows.length > MAX_ROWS) {
    throw new Error(`حداکثر ${MAX_ROWS} ردیف در هر فایل قابل پردازش است`);
  }

  const firstRow = rows[0] || {};
  const headerMap = {};
  for (const rawKey of Object.keys(firstRow)) {
    const normalized = normalizeHeader(rawKey);
    const field = HEADER_TO_FIELD[normalized] ?? HEADER_TO_FIELD[rawKey?.trim()];
    if (field) headerMap[normalized] = field;
  }

  const requiredFields = Object.keys(REQUIRED_LABELS);
  const present = new Set(Object.values(headerMap));
  const missing = requiredFields.filter((f) => !present.has(f));
  if (missing.length) {
    throw new Error(`ستون‌های اجباری یافت نشد: ${missing.map((f) => REQUIRED_LABELS[f]).join('، ')}`);
  }

  const result = {
    total: 0,
    success_count: 0,
    fail_count: 0,
    full_count: 0,
    partial_count: 0,
    errors: [],
    error_rows: [],
  };

  rows.forEach((rawRow, index) => {
    const rowNum = index + 2;
    const normalizedRaw = {};
    for (const [k, v] of Object.entries(rawRow)) {
      normalizedRaw[normalizeHeader(k)] = v;
    }

    const mapped = {};
    for (const [header, field] of Object.entries(headerMap)) {
      mapped[field] = normalizedRaw[header];
    }

    if (isBlankPaymentRow(mapped, headerMap)) return;

    result.total += 1;

    const validation = validatePaymentRow(mapped);
    if (!validation.ok) {
      const reason = validation.errors.join('؛ ');
      result.errors.push({ row: rowNum, credit_id: validation.credit_id, reason });
      result.error_rows.push({ ...normalizedRaw, ردیف: rowNum, 'دلیل خطا': reason });
      result.fail_count += 1;
      return;
    }

    try {
      transaction(() => {
        const outcome = processPaymentRow(validation.data, userName);
        result.success_count += 1;
        if (outcome.payment_type === 'full') result.full_count += 1;
        else result.partial_count += 1;
      });
    } catch (err) {
      const reason = err.message || 'خطای نامشخص';
      result.errors.push({ row: rowNum, credit_id: validation.data.credit_id, reason });
      result.error_rows.push({ ...normalizedRaw, ردیف: rowNum, 'دلیل خطا': reason });
      result.fail_count += 1;
    }
  });

  return result;
}

/** اجرای از سرگیری استراتژی پس از فاصله پرداخت جزئی — توسط موتور استراتژی فراخوانی می‌شود */
function processDuePartialPaymentResumes() {
  const rows = query(
    `SELECT * FROM cases
     WHERE case_status NOT IN ('paid', 'burned')
       AND next_action = $na
       AND next_action_date IS NOT NULL`,
    { $na: PARTIAL_RESUME_ACTION }
  );

  let processed = 0;
  for (const caseRow of rows) {
    if (!isActionDue(caseRow.next_action_date)) continue;

    const hist = query(
      `SELECT details FROM case_events
       WHERE case_id = $id AND label = 'پرداخت جزئی بدهی'
       ORDER BY id DESC LIMIT 1`,
      { $id: caseRow.id }
    )[0];

    if (!hist?.details) continue;

    let meta;
    try {
      meta = JSON.parse(hist.details);
    } catch {
      continue;
    }

    resumePartialPaymentCase(caseRow, meta);
    processed += 1;
  }

  return processed;
}

module.exports = {
  importPaymentsFromRows,
  processDuePartialPaymentResumes,
  MAX_ROWS,
  PARTIAL_RESUME_ACTION,
};
