'use strict';

/**
 * ورود پرداخت‌ها از Excel
 */

const { query, run } = require('../db/database');
const { computeCei, applyCeiBoost } = require('../db/cei');
const { toInterval } = require('../db/segmentUtil');
const {
  daysDiffFromToday,
  jalaliDateToDatetime,
  formatDatetime,
  calcActionStatus,
  parseActionDatetime,
  nowDatetime,
  nextAllowedStartDatetime,
  isWithinAllowedWindow,
  isActionDue,
} = require('../db/dateUtil');

const MAX_ROWS = 1000;
const PARTIAL_RESUME_ACTION = 'ادامه استراتژی پس از پرداخت جزئی';

const HEADER_TO_FIELD = {
  'شناسه اعتبار': 'credit_id',
  'کد ملی': 'national_code',
  'مبلغ پرداختی به ریال': 'amount',
  'مبلغ پرداختی': 'amount',
  'تاریخ پرداخت': 'payment_date',
  'شماره تراکنش': 'transaction_id',
  'توضیحات': 'description',
};

const REQUIRED_LABELS = {
  credit_id: 'شناسه اعتبار',
  national_code: 'کد ملی',
  amount: 'مبلغ پرداختی به ریال',
  payment_date: 'تاریخ پرداخت',
};

const ACTION_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

const SMS_OR_AUTOCALL = ['warning_sms', 'threatening_sms', 'warning_autocall', 'threatening_autocall'];

function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .replace(/\u200c/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNationalCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\D/g, '');
}

function parseNumber(val, label) {
  if (val === null || val === undefined || val === '') {
    return { ok: false, error: `فیلد ${label} خالی است` };
  }
  const cleaned = String(val).replace(/[,،\s]/g, '');
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, error: `فرمت فیلد ${label} اشتباه است` };
  }
  return { ok: true, value: n };
}

function parseString(val, label) {
  const s = val === null || val === undefined ? '' : String(val).trim();
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
  const base = jalaliDateToDatetime(jalaliStr);
  if (!base) return nowDatetime();
  const parsed = parseActionDatetime(base);
  const now = new Date();
  return formatDatetime(
    new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())
  );
}

function addDaysToJalaliDatetime(jalaliStr, days) {
  const base = jalaliDateToDatetime(jalaliStr);
  if (!base) return null;
  const d = parseActionDatetime(base);
  d.setDate(d.getDate() + Number(days || 0));
  return formatDatetime(d);
}

function formatRial(amount) {
  return `${Number(amount).toLocaleString('en-US')} ریال`;
}

function buildPaymentResultText(amount, prevClaims, newClaims) {
  return `مبلغ پرداختی: ${formatRial(amount)} · مطالبات قبلی: ${formatRial(prevClaims)} · مطالبات جدید: ${formatRial(newClaims)}`;
}

function insertCaseHistory(caseId, debtorId, userName, operation, caseRow, details) {
  run(
    `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
     VALUES ($cid, $did, $user, $op, $st, $na, $nad, $det)`,
    {
      $cid: caseId,
      $did: debtorId,
      $user: userName || 'سیستم',
      $op: operation,
      $st: caseRow.case_status,
      $na: caseRow.next_action,
      $nad: caseRow.next_action_date,
      $det: typeof details === 'string' ? details : JSON.stringify(details),
    }
  );
}

function insertPaymentAction(caseId, actionType, resultText, actionDatetime, cost = 0) {
  const maxSeq = query(
    'SELECT COALESCE(MAX(seq), 0) AS m FROM case_actions WHERE case_id = $id',
    { $id: caseId }
  )[0].m;

  run(
    `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost)
     VALUES ($cid, $seq, $type, NULL, $res, $date, $cost)`,
    {
      $cid: caseId,
      $seq: maxSeq + 1,
      $type: actionType,
      $res: resultText,
      $date: actionDatetime,
      $cost: cost,
    }
  );
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
    `SELECT DISTINCT action_type FROM case_actions
     WHERE case_id = $id AND action_type NOT IN ('payment_full', 'payment_partial')`,
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
      segment_new_title: newSeg?.title,
    });
  } else {
    resultSnapshot = assignStrategyFromStart(caseRow.id, meta.new_segment_id, caseRow.credit_type, snapshot);
    insertCaseHistory(caseRow.id, caseRow.debtor_id, 'سیستم', 'تغییر استراتژی پس از پرداخت جزئی', resultSnapshot, {
      note: 'سگمنت تغییر کرد — استراتژی جدید از ابتدا',
      segment_new_title: newSeg?.title,
    });
  }

  return resultSnapshot;
}

function processFullPayment(caseRow, amount, paymentDate, userName, extras = {}) {
  const prevClaims = Number(caseRow.claims_amount) || 0;
  const actionDatetime = paymentDatetimeFromJalali(paymentDate);
  const resultText = buildPaymentResultText(amount, prevClaims, 0);

  run(
    `UPDATE cases SET claims_amount = 0, outstanding_debt = 0, case_status = 'paid',
     next_action = NULL, next_action_date = NULL, action_status = 'waiting',
     strategy_id = NULL, last_payment_date = $lpd, last_payment_amount = $lpa,
     updated_at = datetime('now') WHERE id = $id`,
    {
      $lpd: paymentDate,
      $lpa: amount,
      $id: caseRow.id,
    }
  );

  run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES ($cid, $amt, $pd, 'full')`,
    { $cid: caseRow.id, $amt: amount, $pd: paymentDate }
  );

  insertPaymentAction(caseRow.id, 'payment_full', resultText, actionDatetime);

  const updated = {
    case_status: 'paid',
    next_action: null,
    next_action_date: null,
  };

  const historyDetails = {
    amount,
    previous_claims: prevClaims,
    new_claims: 0,
    transaction_id: extras.transaction_id || null,
    description: extras.description || null,
  };

  insertCaseHistory(caseRow.id, caseRow.debtor_id, userName, 'پرداخت کامل بدهی', updated, historyDetails);
  return { payment_type: 'full', previous_claims: prevClaims, new_claims: 0 };
}

function processPartialPayment(caseRow, amount, paymentDate, userName, extras = {}) {
  const prevClaims = Number(caseRow.claims_amount) || 0;
  const newClaims = prevClaims - amount;
  const previousSegmentId = caseRow.segment_id;

  const { cei, formulaVersion } = recalculateCei(caseRow, newClaims);
  const formulaType = formulaTypeOf(caseRow.credit_type);
  const newSegment = findSegmentForCei(cei, formulaType);
  if (!newSegment) {
    throw new Error('سگمنتی متناسب با CEI جدید یافت نشد');
  }

  const gapDays = parseInt(getSetting('partial_payment_gap_days', '10'), 10);
  const nextActionDate = addDaysToJalaliDatetime(paymentDate, gapDays);
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
      $na: PARTIAL_RESUME_ACTION,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
      $id: caseRow.id,
    }
  );

  run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES ($cid, $amt, $pd, 'partial')`,
    { $cid: caseRow.id, $amt: amount, $pd: paymentDate }
  );

  insertPaymentAction(caseRow.id, 'payment_partial', resultText, actionDatetime);

  const updated = {
    case_status: caseRow.case_status,
    next_action: PARTIAL_RESUME_ACTION,
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

  insertCaseHistory(caseRow.id, caseRow.debtor_id, userName, 'پرداخت جزئی بدهی', updated, historyDetails);

  if (isActionDue(nextActionDate)) {
    const refreshed = query('SELECT * FROM cases WHERE id = $id', { $id: caseRow.id })[0];
    resumePartialPaymentCase(refreshed, resumeMeta);
  }

  return { payment_type: 'partial', previous_claims: prevClaims, new_claims: newClaims, cei, segment_id: newSegment.id };
}

function validatePaymentRow(mapped) {
  const errors = [];
  const creditId = parseString(mapped.credit_id, REQUIRED_LABELS.credit_id);
  const nationalCode = parseString(mapped.national_code, REQUIRED_LABELS.national_code);
  const amount = parseNumber(mapped.amount, REQUIRED_LABELS.amount);
  const paymentDate = parseString(mapped.payment_date, REQUIRED_LABELS.payment_date);

  if (!creditId.ok) errors.push(creditId.error);
  if (!nationalCode.ok) errors.push(nationalCode.error);
  if (!amount.ok) errors.push(amount.error);
  if (!paymentDate.ok) errors.push(paymentDate.error);

  if (errors.length) {
    return { ok: false, errors, credit_id: mapped.credit_id || '—' };
  }

  const diff = daysDiffFromToday(paymentDate.value);
  if (diff === null) {
    errors.push('فرمت تاریخ پرداخت نامعتبر است (YYYY/MM/DD)');
  } else if (diff > 0) {
    errors.push('تاریخ پرداخت نمی‌تواند در آینده باشد');
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
      national_code: nationalCode.value,
      amount: amount.value,
      payment_date: paymentDate.value,
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
    total: rows.length,
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

    const validation = validatePaymentRow(mapped);
    if (!validation.ok) {
      const reason = validation.errors.join('؛ ');
      result.errors.push({ row: rowNum, credit_id: validation.credit_id, reason });
      result.error_rows.push({ ...normalizedRaw, ردیف: rowNum, 'دلیل خطا': reason });
      result.fail_count += 1;
      return;
    }

    try {
      const outcome = processPaymentRow(validation.data, userName);
      result.success_count += 1;
      if (outcome.payment_type === 'full') result.full_count += 1;
      else result.partial_count += 1;
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
      `SELECT details FROM case_history
       WHERE case_id = $id AND operation = 'پرداخت جزئی بدهی'
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
