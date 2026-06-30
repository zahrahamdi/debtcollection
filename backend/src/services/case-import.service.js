'use strict';

/**
 * سرویس ورود پرونده از Excel — Story 4.1 PRD
 * منطق پردازش هر ردیف مشابه سینک Google Sheet است.
 */

const { query, run } = require('../db/database');
const { computeCei } = require('../db/cei');
const { toInterval } = require('../db/segmentUtil');
const { todayJalali, tomorrowJalali, isWithinAllowedWindow, calcActionStatus } = require('../db/dateUtil');

const MAX_ROWS = 1000;
const REQUIRED_DEBT_CLASS = 'سررسید گذشته';
const TERMINAL_STATUSES = ['paid', 'burned'];

// هدرهای استاندارد Excel (ترتیب پیشنهادی — Story 4.1 PRD)
const CANONICAL_EXCEL_HEADERS = [
  'نام',
  'نام خانوادگی',
  'کد ملی',
  'شماره موبایل',
  'جنسیت',
  'استان محل سکونت',
  'شهر محل سکونت',
  'شناسه اعتبار',
  'نوع اعتبار',
  'تامین‌کننده',
  'نوع ضمانت',
  'کلاس بدهی',
  'روزهای دیرکرد (DPD)',
  'مبلغ اعتبار (ریال)',
  'مطالبات غیرجاری سررسید گذشته (ریال)',
  'مبلغ جریمه (ریال)',
  'شماره اولین قسط پرداخت‌نشده',
  'تاریخ سررسید اولین قسط پرداخت‌نشده',
  'شماره آخرین قسط پرداخت‌نشده',
  'تاریخ سررسید آخرین قسط پرداخت‌نشده',
  'تعداد کل اقساط',
  'تعداد اقساط پرداخت‌نشده',
  'تاریخ آخرین پرداخت',
  'مبلغ آخرین پرداخت (ریال)',
];

// نگاشت هدر Excel (پس از نرمال‌سازی) → کلید داخلی
const HEADER_TO_FIELD = {
  'نام': 'first_name',
  'نام خانوادگی': 'last_name',
  'کد ملی': 'national_code',
  'شماره موبایل': 'mobile',
  'جنسیت': 'gender',
  'استان': 'province',
  'استان محل سکونت': 'province',
  'شهر': 'city',
  'شهر محل سکونت': 'city',
  'شناسه اعتبار': 'credit_id',
  'نوع اعتبار': 'credit_type',
  'تامین کننده': 'supplier',
  'تامین‌کننده': 'supplier',
  'نوع ضمانت': 'guarantee_type',
  'کلاس بدهی': 'debt_class',
  'روزهای دیرکرد': 'dpd',
  'مبلغ اعتبار': 'credit_amount',
  'مبلغ مطالبات غیرجاری': 'claims_amount',
  'مبلغ مطالبات غیرجاری سررسید گذشته': 'claims_amount',
  'مطالبات غیرجاری سررسید گذشته': 'claims_amount',
  'مبلغ جریمه': 'penalty_amount',
  'شماره اولین قسط پرداخت نشده': 'first_unpaid_no',
  'شماره اولین قسط پرداخت‌نشده': 'first_unpaid_no',
  'تاریخ سررسید اولین قسط': 'first_unpaid_date',
  'تاریخ سررسید اولین قسط پرداخت نشده': 'first_unpaid_date',
  'تاریخ سررسید اولین قسط پرداخت‌نشده': 'first_unpaid_date',
  'شماره آخرین قسط پرداخت نشده': 'last_unpaid_no',
  'شماره آخرین قسط پرداخت‌نشده': 'last_unpaid_no',
  'تاریخ سررسید آخرین قسط': 'last_unpaid_date',
  'تاریخ سررسید آخرین قسط پرداخت نشده': 'last_unpaid_date',
  'تاریخ سررسید آخرین قسط پرداخت‌نشده': 'last_unpaid_date',
  'تعداد کل اقساط': 'total_installments',
  'تعداد اقساط پرداخت نشده': 'unpaid_installments_count',
  'تعداد اقساط پرداخت‌نشده': 'unpaid_installments_count',
  'تاریخ آخرین پرداخت': 'last_payment_date',
  'مبلغ آخرین پرداخت': 'last_payment_amount',
};

// فیلدهای اجباری (برای پیام خطا)
const REQUIRED_FIELD_LABELS = {
  first_name: 'نام',
  last_name: 'نام خانوادگی',
  national_code: 'کد ملی',
  mobile: 'شماره موبایل',
  gender: 'جنسیت',
  province: 'استان محل سکونت',
  city: 'شهر محل سکونت',
  credit_id: 'شناسه اعتبار',
  credit_type: 'نوع اعتبار',
  supplier: 'تامین‌کننده',
  guarantee_type: 'نوع ضمانت',
  debt_class: 'کلاس بدهی',
  dpd: 'روزهای دیرکرد (DPD)',
  credit_amount: 'مبلغ اعتبار (ریال)',
  claims_amount: 'مطالبات غیرجاری سررسید گذشته (ریال)',
  penalty_amount: 'مبلغ جریمه (ریال)',
  first_unpaid_no: 'شماره اولین قسط پرداخت‌نشده',
  first_unpaid_date: 'تاریخ سررسید اولین قسط پرداخت‌نشده',
  last_unpaid_no: 'شماره آخرین قسط پرداخت‌نشده',
  last_unpaid_date: 'تاریخ سررسید آخرین قسط پرداخت‌نشده',
  total_installments: 'تعداد کل اقساط',
  unpaid_installments_count: 'تعداد اقساط پرداخت‌نشده',
  last_payment_date: 'تاریخ آخرین پرداخت',
  last_payment_amount: 'مبلغ آخرین پرداخت (ریال)',
};

const REQUIRED_FIELDS = Object.keys(REQUIRED_FIELD_LABELS);

const CREDIT_TYPE_MAP = {
  وام: 'loan',
  loan: 'loan',
  bnpl: 'bnpl',
  BNPL: 'bnpl',
  'اعتبار یک قسطه': 'single_installment',
  'اعتبار یک‌قسطه': 'single_installment',
  'اعتبار ۴ قسطه': 'four_installment',
  'اعتبار 4 قسطه': 'four_installment',
};

const GUARANTEE_MAP = {
  'بدون ضامن': 'none',
  none: 'none',
  سفته: 'promissory_note',
  'سفته / e-note': 'promissory_note',
  'e-note': 'promissory_note',
  promissory_note: 'promissory_note',
  چک: 'cheque',
  cheque: 'cheque',
};

const GENDER_MAP = {
  مرد: 'male',
  male: 'male',
  زن: 'female',
  female: 'female',
};

const formulaTypeOf = (creditType) => (creditType === 'bnpl' ? 'bnpl' : 'loan');

function getSetting(key, fallback) {
  const rows = query('SELECT value FROM settings WHERE key = $k', { $k: key });
  if (rows.length === 0) return fallback;
  return rows[0].value;
}

function activeFormula(creditType) {
  const rows = query(
    `SELECT * FROM cei_formulas WHERE credit_type = $t AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    { $t: creditType }
  );
  return rows[0] || null;
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

function maxCallCountForStrategy(strategyId) {
  if (!strategyId) return null;
  const rows = query(
    `SELECT max_repeat FROM strategy_actions
     WHERE strategy_id = $sid AND action_type = 'negotiator_call'
     ORDER BY seq DESC LIMIT 1`,
    { $sid: strategyId }
  );
  return rows[0]?.max_repeat ?? null;
}

const SMS_OR_AUTOCALL = ['warning_sms', 'threatening_sms', 'warning_autocall', 'threatening_autocall'];

function getFirstStrategyAction(strategyId) {
  if (!strategyId) return null;
  const rows = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC LIMIT 1`,
    { $sid: strategyId }
  );
  return rows[0] || null;
}

/** تاریخ اقدام بعدی اولیه: امروز، مگر اولین اکشن پیامک/تماس خودکار باشد و خارج از بازه مجاز */
function computeInitialNextActionDate(strategyId) {
  const first = getFirstStrategyAction(strategyId);
  if (!first) return todayJalali();
  if (SMS_OR_AUTOCALL.includes(first.action_type)) {
    if (!isWithinAllowedWindow(first.allowed_from, first.allowed_to)) {
      return tomorrowJalali();
    }
  }
  return todayJalali();
}

function firstStrategyActionLabel(strategyId) {
  if (!strategyId) return null;
  const rows = query(
    `SELECT action_type FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC LIMIT 1`,
    { $sid: strategyId }
  );
  if (rows.length === 0) return null;
  const labels = {
    warning_sms: 'پیامک هشدار',
    threatening_sms: 'پیامک تهدید',
    warning_autocall: 'تماس خودکار هشدار',
    threatening_autocall: 'تماس خودکار تهدید',
    negotiator_call: 'تماس مذاکره‌کننده',
  };
  return labels[rows[0].action_type] || rows[0].action_type;
}

function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .replace(/\u200c/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveFieldFromHeader(header) {
  const normalized = normalizeHeader(header);
  return HEADER_TO_FIELD[normalized] ?? HEADER_TO_FIELD[header?.trim()];
}

function parseNumber(val, fieldLabel) {
  if (val === null || val === undefined || val === '') return { ok: false, error: `فیلد ${fieldLabel} خالی است` };
  const cleaned = String(val).replace(/[,،\s]/g, '');
  const n = Number(cleaned);
  if (Number.isNaN(n)) return { ok: false, error: `فرمت فیلد ${fieldLabel} اشتباه است` };
  return { ok: true, value: n };
}

function parseInteger(val, fieldLabel) {
  const r = parseNumber(val, fieldLabel);
  if (!r.ok) return r;
  if (!Number.isInteger(r.value)) return { ok: false, error: `فرمت فیلد ${fieldLabel} اشتباه است` };
  return r;
}

function parseString(val, fieldLabel) {
  const s = val === null || val === undefined ? '' : String(val).trim();
  if (!s) return { ok: false, error: `فیلد ${fieldLabel} خالی است` };
  return { ok: true, value: s };
}

/** نرمال‌سازی موبایل ایران: همیشه ۱۱ رقم با صفر اول (مثلاً 09128898006) */
function normalizeMobile(raw) {
  let digits = String(raw).trim().replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('98')) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith('9')) {
    digits = `0${digits}`;
  }
  if (digits.length !== 11 || !digits.startsWith('09')) {
    return { ok: false, error: 'فرمت فیلد شماره موبایل اشتباه است' };
  }
  return { ok: true, value: digits };
}

function mapRow(rawRow, headerMap) {
  const mapped = {};
  for (const [header, key] of Object.entries(headerMap)) {
    mapped[key] = rawRow[header];
  }
  return mapped;
}

function validateAndParseRow(mapped, minDpd) {
  const errors = [];
  const creditId = parseString(mapped.credit_id, 'شناسه اعتبار');
  if (!creditId.ok) errors.push(creditId.error);

  for (const [key, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
    if (key === 'credit_id') continue;
    const isNumeric =
      key.includes('amount') ||
      key.includes('dpd') ||
      key.includes('_no') ||
      key.includes('installments') ||
      key.includes('count');
    const raw = mapped[key];
    const empty = raw === null || raw === undefined || String(raw).trim() === '';
    if (empty) {
      errors.push(`فیلد ${label} خالی است`);
      continue;
    }
    if (isNumeric && key !== 'last_payment_date') {
      const r = key === 'dpd' || key.includes('_no') || key.includes('installments') || key.includes('count')
        ? parseInteger(raw, label)
        : parseNumber(raw, label);
      if (!r.ok) errors.push(r.error);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, creditId: creditId.ok ? creditId.value : mapped.credit_id };
  }

  const dpd = parseInteger(mapped.dpd, 'روزهای دیرکرد');
  if (dpd.value < minDpd) {
    return {
      ok: false,
      errors: [`روزهای دیرکرد کمتر از ${minDpd} روز است`],
      creditId: creditId.value,
    };
  }

  const debtClass = String(mapped.debt_class).trim();
  if (debtClass !== REQUIRED_DEBT_CLASS) {
    return {
      ok: false,
      errors: ['کلاس بدهی این پرونده سررسید گذشته نیست'],
      creditId: creditId.value,
    };
  }

  const creditTypeRaw = String(mapped.credit_type).trim();
  const creditType = CREDIT_TYPE_MAP[creditTypeRaw];
  if (!creditType) {
    return { ok: false, errors: ['فرمت فیلد نوع اعتبار اشتباه است'], creditId: creditId.value };
  }

  const guaranteeRaw = String(mapped.guarantee_type).trim();
  const guaranteeType = GUARANTEE_MAP[guaranteeRaw];
  if (!guaranteeType) {
    return { ok: false, errors: ['فرمت فیلد نوع ضمانت اشتباه است'], creditId: creditId.value };
  }

  const genderRaw = String(mapped.gender).trim();
  const gender = GENDER_MAP[genderRaw];
  if (!gender) {
    return { ok: false, errors: ['فرمت فیلد جنسیت اشتباه است'], creditId: creditId.value };
  }

  const mobileResult = normalizeMobile(mapped.mobile);
  if (!mobileResult.ok) {
    return { ok: false, errors: [mobileResult.error], creditId: creditId.value };
  }

  const data = {
    credit_id: creditId.value,
    credit_type: creditType,
    supplier: String(mapped.supplier).trim(),
    national_code: String(mapped.national_code).trim(),
    guarantee_type: guaranteeType,
    debt_class: debtClass,
    dpd: dpd.value,
    credit_amount: parseNumber(mapped.credit_amount, 'مبلغ اعتبار').value,
    claims_amount: parseNumber(mapped.claims_amount, 'مبلغ مطالبات غیرجاری').value,
    penalty_amount: parseNumber(mapped.penalty_amount, 'مبلغ جریمه').value,
    first_unpaid_no: parseInteger(mapped.first_unpaid_no, 'شماره اولین قسط پرداخت نشده').value,
    first_unpaid_date: String(mapped.first_unpaid_date).trim(),
    last_unpaid_no: parseInteger(mapped.last_unpaid_no, 'شماره آخرین قسط پرداخت نشده').value,
    last_unpaid_date: String(mapped.last_unpaid_date).trim(),
    total_installments: parseInteger(mapped.total_installments, 'تعداد کل اقساط').value,
    overdue_installments_count: parseInteger(mapped.unpaid_installments_count, 'تعداد اقساط پرداخت نشده').value,
    last_payment_date: String(mapped.last_payment_date).trim(),
    last_payment_amount: parseNumber(mapped.last_payment_amount, 'مبلغ آخرین پرداخت').value,
    first_name: String(mapped.first_name).trim(),
    last_name: String(mapped.last_name).trim(),
    mobile: mobileResult.value,
    gender,
    province: String(mapped.province).trim(),
    city: String(mapped.city).trim(),
    outstanding_debt: parseNumber(mapped.claims_amount, 'مبلغ مطالبات غیرجاری').value,
  };

  return { ok: true, data, creditId: creditId.value };
}

function findCasesByCreditId(creditId) {
  return query(
    `SELECT * FROM cases WHERE credit_id = $cid ORDER BY id DESC`,
    { $cid: creditId }
  );
}

function upsertDebtor(data) {
  const existing = query('SELECT id FROM debtors WHERE national_code = $nc', { $nc: data.national_code });
  if (existing.length > 0) {
    const id = existing[0].id;
    run(
      `UPDATE debtors SET first_name = $fn, last_name = $ln, gender = $g, mobile = $m,
       province = $p, city = $c WHERE id = $id`,
      {
        $fn: data.first_name,
        $ln: data.last_name,
        $g: data.gender,
        $m: data.mobile,
        $p: data.province,
        $c: data.city,
        $id: id,
      }
    );
    return id;
  }

  const { lastInsertRowid } = run(
    `INSERT INTO debtors (first_name, last_name, national_code, gender, mobile, province, city)
     VALUES ($fn, $ln, $nc, $g, $m, $p, $c)`,
    {
      $fn: data.first_name,
      $ln: data.last_name,
      $nc: data.national_code,
      $g: data.gender,
      $m: data.mobile,
      $p: data.province,
      $c: data.city,
    }
  );

  run(
    `INSERT INTO phone_numbers (debtor_id, phone, source) VALUES ($did, $phone, 'digipay')`,
    { $did: lastInsertRowid, $phone: data.mobile }
  );

  return lastInsertRowid;
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

function getCaseById(caseId) {
  const rows = query('SELECT * FROM cases WHERE id = $id', { $id: caseId });
  return rows[0] || null;
}

function getStrategyById(strategyId) {
  if (!strategyId) return null;
  const rows = query('SELECT id, title FROM strategies WHERE id = $id', { $id: strategyId });
  return rows[0] || null;
}

function pickStrategyForSegment(segmentId, creditType) {
  if (!segmentId) return null;
  const formulaType = formulaTypeOf(creditType);
  const strategies = query(
    `SELECT id, title FROM strategies WHERE segment_id = $sid AND credit_type = $ct ORDER BY id ASC`,
    { $sid: segmentId, $ct: formulaType }
  );
  if (strategies.length === 0) return null;

  const abRows = query('SELECT * FROM ab_tests WHERE segment_id = $sid LIMIT 1', { $sid: segmentId });
  if (abRows.length > 0) {
    const test = abRows[0];
    const roll = Math.random() * 100;
    const chosenId = roll < test.ratio_a ? test.strategy_a_id : test.strategy_b_id;
    return getStrategyById(chosenId) || strategies[0];
  }

  return strategies[0];
}

function actionTypeToLabel(actionType) {
  const labels = {
    warning_sms: 'پیامک هشدار',
    threatening_sms: 'پیامک تهدید',
    warning_autocall: 'تماس خودکار هشدار',
    threatening_autocall: 'تماس خودکار تهدید',
    negotiator_call: 'تماس مذاکره‌کننده',
  };
  return labels[actionType] || actionType;
}

function getPerformedActionTypes(caseId) {
  const rows = query(
    `SELECT DISTINCT action_type FROM case_actions WHERE case_id = $id AND action_type IS NOT NULL`,
    { $id: caseId }
  );
  return new Set(rows.map((r) => r.action_type));
}

function firstUnperformedAction(strategyId, performedTypes) {
  const actions = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC`,
    { $sid: strategyId }
  );
  return actions.find((a) => !performedTypes.has(a.action_type)) || null;
}

/**
 * مرحله ۱ — محاسبه CEI (بخش ۵.۲ PRD)
 * @returns {{ ok: boolean, cei?: number, formulaVersion?: string, formulaType?: string }}
 */
function stepCalculateCei(caseId, caseData, ctx) {
  const formulaType = formulaTypeOf(caseData.credit_type);
  const formula = activeFormula(formulaType);
  if (!formula) {
    insertCaseHistory(
      caseId,
      caseData.debtor_id,
      'سیستم',
      'محاسبه CEI',
      ctx.caseSnapshot,
      { error: `فرمول CEI فعال برای ${formulaType} یافت نشد` }
    );
    return { ok: false };
  }

  const params = JSON.parse(formula.params);
  const { cei } = computeCei(formulaType, params, caseData);
  const formulaVersion = `v${formula.version}`;

  const statusAfterCei = ctx.isNewCase ? 'pending_strategy' : ctx.caseSnapshot.case_status;

  run(
    `UPDATE cases SET cei = $cei, cei_formula_version = $ver,
     case_status = $st, updated_at = datetime('now') WHERE id = $id`,
    { $cei: cei, $ver: formulaVersion, $st: statusAfterCei, $id: caseId }
  );

  const snapshot = { ...ctx.caseSnapshot, case_status: statusAfterCei };
  insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'محاسبه CEI', snapshot, {
    cei,
    formula_version: formulaVersion,
    cei_previous: ctx.previousCei ?? null,
  });

  return { ok: true, cei, formulaVersion, formulaType, caseSnapshot: snapshot };
}

/**
 * مرحله ۲ — تعیین سگمنت (Story 11.3 PRD)
 */
function stepAssignSegment(caseId, cei, formulaType, caseData, caseSnapshot) {
  const segment = findSegmentForCei(cei, formulaType);
  if (!segment) {
    insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تعیین سگمنت', caseSnapshot, {
      error: 'سگمنتی متناسب با CEI یافت نشد',
      cei,
      credit_type: formulaType,
    });
    return { ok: false, segment: null };
  }

  run(`UPDATE cases SET segment_id = $seg, updated_at = datetime('now') WHERE id = $id`, {
    $seg: segment.id,
    $id: caseId,
  });

  insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تعیین سگمنت', caseSnapshot, {
    segment_id: segment.id,
    segment_title: segment.title,
    cei,
  });

  return { ok: true, segment };
}

/**
 * مرحله ۳ — تخصیص استراتژی (Story 5.1 / 12.2 PRD)
 */
function stepAssignStrategy(caseId, segmentId, caseData, caseSnapshot, startActionType = null) {
  const strategy = pickStrategyForSegment(segmentId, caseData.credit_type);
  if (!strategy) {
    insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تخصیص استراتژی', caseSnapshot, {
      error: 'استراتژی فعالی برای این سگمنت یافت نشد',
      segment_id: segmentId,
    });
    return { ok: false };
  }

  let nextAction = firstStrategyActionLabel(strategy.id);
  if (startActionType) {
    nextAction = actionTypeToLabel(startActionType);
  }
  const maxCalls = maxCallCountForStrategy(strategy.id);
  const newStatus = 'pending_strategy_start';
  const nextActionDate = computeInitialNextActionDate(strategy.id);
  const snapshot = {
    ...caseSnapshot,
    case_status: newStatus,
    next_action: nextAction,
    next_action_date: nextActionDate,
  };

  run(
    `UPDATE cases SET strategy_id = $sid, case_status = $st, next_action = $na,
     next_action_date = $nad, action_status = $as, max_call_count = $mc, updated_at = datetime('now') WHERE id = $id`,
    {
      $sid: strategy.id,
      $st: newStatus,
      $na: nextAction,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
      $mc: maxCalls,
      $id: caseId,
    }
  );

  insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تخصیص استراتژی', snapshot, {
    strategy_id: strategy.id,
    strategy_title: strategy.title,
    segment_id: segmentId,
  });

  return { ok: true, strategy };
}

/**
 * منطق تغییر استراتژی پس از تغییر سگمنت — بخش ۵.۴ PRD
 */
function stepChangeStrategyOnSegmentShift(caseId, newSegmentId, caseData, caseSnapshot, previousStrategyId) {
  const strategy = pickStrategyForSegment(newSegmentId, caseData.credit_type);
  if (!strategy) {
    insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تغییر استراتژی', caseSnapshot, {
      error: 'استراتژی جدید برای سگمنت یافت نشد',
      segment_id: newSegmentId,
    });
    return { ok: false };
  }

  const performed = getPerformedActionTypes(caseId);
  const startAction = firstUnperformedAction(strategy.id, performed);
  const allActions = query(
    `SELECT action_type, seq FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC`,
    { $sid: strategy.id }
  );
  const skipped = allActions.filter((a) => performed.has(a.action_type)).map((a) => a.action_type);

  if (!startAction) {
    insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تغییر استراتژی', caseSnapshot, {
      strategy_id: strategy.id,
      strategy_title: strategy.title,
      note: 'تمام اکشن‌های استراتژی جدید قبلاً انجام شده — تا پایان استراتژی فعلی منتظر می‌مانیم',
      skipped_actions: skipped,
      previous_strategy_id: previousStrategyId,
    });
    return { ok: true, deferred: true };
  }

  run(`UPDATE cases SET case_status = 'pending_strategy', updated_at = datetime('now') WHERE id = $id`, {
    $id: caseId,
  });

  const pendingSnapshot = { ...caseSnapshot, case_status: 'pending_strategy' };
  insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'تغییر استراتژی', pendingSnapshot, {
    strategy_previous_id: previousStrategyId,
    strategy_new_id: strategy.id,
    strategy_new_title: strategy.title,
    skipped_actions: skipped,
    start_action: startAction.action_type,
    start_action_seq: startAction.seq,
  });

  return stepAssignStrategy(
    caseId,
    newSegmentId,
    caseData,
    pendingSnapshot,
    startAction.action_type
  );
}

/**
 * اجرای pipeline کامل CEI → سگمنت → استراتژی
 * فقط برای پرونده جدید یا آپدیت با افزایش مطالبات (بخش ۵.۴ PRD)
 */
function runCeiSegmentStrategyPipeline(caseId, caseData, options = {}) {
  const {
    isNewCase = false,
    previousCase = null,
    userName = 'سیستم',
  } = options;

  const caseRow = getCaseById(caseId);
  if (!caseRow) return { ok: false };

  const previousCei = previousCase?.cei ?? null;
  const previousSegmentId = previousCase?.segment_id ?? null;
  const previousClaims = previousCase?.claims_amount ?? 0;
  const newClaims = caseData.claims_amount ?? 0;

  if (!isNewCase && newClaims <= previousClaims) {
    return { ok: true, skipped: true, reason: 'claims_not_increased' };
  }

  const caseSnapshot = {
    case_status: caseRow.case_status,
    next_action: caseRow.next_action,
    next_action_date: caseRow.next_action_date,
  };

  const ceiResult = stepCalculateCei(caseId, caseData, {
    isNewCase,
    previousCei,
    caseSnapshot,
    userName,
  });
  if (!ceiResult.ok) return { ok: false, step: 'cei' };

  const segmentResult = stepAssignSegment(
    caseId,
    ceiResult.cei,
    ceiResult.formulaType,
    caseData,
    ceiResult.caseSnapshot
  );
  if (!segmentResult.ok) return { ok: false, step: 'segment' };

  const newSegmentId = segmentResult.segment.id;

  if (isNewCase) {
    stepAssignStrategy(caseId, newSegmentId, caseData, ceiResult.caseSnapshot);
    return { ok: true, cei: ceiResult.cei, segmentId: newSegmentId };
  }

  insertCaseHistory(
    caseId,
    caseData.debtor_id,
    userName,
    'به‌روزرسانی اطلاعات پرونده',
    ceiResult.caseSnapshot,
    {
      claims_previous: previousClaims,
      claims_new: newClaims,
      cei_previous: previousCei,
      cei_new: ceiResult.cei,
    }
  );

  if (previousSegmentId === newSegmentId) {
    insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'به‌روزرسانی CEI', ceiResult.caseSnapshot, {
      cei_previous: previousCei,
      cei_new: ceiResult.cei,
      formula_version: ceiResult.formulaVersion,
      note: 'سگمنت تغییر نکرد — استراتژی فعلی ادامه می‌یابد',
    });
    run(
      `UPDATE cases SET case_status = $st, updated_at = datetime('now') WHERE id = $id`,
      { $st: previousCase.case_status, $id: caseId }
    );
    return { ok: true, cei: ceiResult.cei, segmentId: newSegmentId, strategyUnchanged: true };
  }

  insertCaseHistory(caseId, caseData.debtor_id, 'سیستم', 'به‌روزرسانی CEI', ceiResult.caseSnapshot, {
    cei_previous: previousCei,
    cei_new: ceiResult.cei,
    formula_version: ceiResult.formulaVersion,
    segment_previous_id: previousSegmentId,
    segment_new_id: newSegmentId,
    segment_new_title: segmentResult.segment.title,
  });

  stepChangeStrategyOnSegmentShift(
    caseId,
    newSegmentId,
    caseData,
    ceiResult.caseSnapshot,
    previousCase.strategy_id
  );

  return { ok: true, cei: ceiResult.cei, segmentId: newSegmentId, segmentChanged: true };
}

function updateFinancialFields(caseId, data) {
  run(
    `UPDATE cases SET
      supplier = $sup, guarantee_type = $gt, debt_class = $dc, dpd = $dpd,
      credit_amount = $ca, outstanding_debt = $od, claims_amount = $cl, penalty_amount = $pa,
      first_unpaid_no = $fun, first_unpaid_date = $fud, last_unpaid_no = $lun, last_unpaid_date = $lud,
      total_installments = $ti, overdue_installments_count = $oic,
      last_payment_date = $lpd, last_payment_amount = $lpa, updated_at = datetime('now')
     WHERE id = $id`,
    {
      $sup: data.supplier,
      $gt: data.guarantee_type,
      $dc: data.debt_class,
      $dpd: data.dpd,
      $ca: data.credit_amount,
      $od: data.outstanding_debt,
      $cl: data.claims_amount,
      $pa: data.penalty_amount,
      $fun: data.first_unpaid_no,
      $fud: data.first_unpaid_date,
      $lun: data.last_unpaid_no,
      $lud: data.last_unpaid_date,
      $ti: data.total_installments,
      $oic: data.overdue_installments_count,
      $lpd: data.last_payment_date,
      $lpa: data.last_payment_amount,
      $id: caseId,
    }
  );
}

function createNewCase(data, debtorId, previousCaseId, userName) {
  const { lastInsertRowid: caseId } = run(
    `INSERT INTO cases (
      debtor_id, credit_id, credit_type, supplier, guarantee_type, debt_class, dpd,
      credit_amount, outstanding_debt, claims_amount, penalty_amount,
      case_status, action_status, previous_case_id,
      first_unpaid_no, first_unpaid_date, last_unpaid_no, last_unpaid_date,
      total_installments, overdue_installments_count, last_payment_date, last_payment_amount
    ) VALUES (
      $did, $cid, $ct, $sup, $gt, $dc, $dpd,
      $ca, $od, $cl, $pa,
      'pending_cei', 'waiting', $prev,
      $fun, $fud, $lun, $lud, $ti, $oic, $lpd, $lpa
    )`,
    {
      $did: debtorId,
      $cid: data.credit_id,
      $ct: data.credit_type,
      $sup: data.supplier,
      $gt: data.guarantee_type,
      $dc: data.debt_class,
      $dpd: data.dpd,
      $ca: data.credit_amount,
      $od: data.outstanding_debt,
      $cl: data.claims_amount,
      $pa: data.penalty_amount,
      $prev: previousCaseId,
      $fun: data.first_unpaid_no,
      $fud: data.first_unpaid_date,
      $lun: data.last_unpaid_no,
      $lud: data.last_unpaid_date,
      $ti: data.total_installments,
      $oic: data.overdue_installments_count,
      $lpd: data.last_payment_date,
      $lpa: data.last_payment_amount,
    }
  );

  const details = previousCaseId
    ? `پرونده جدید ایجاد شد؛ پرونده قبلی (شناسه ${previousCaseId}) پرداخت شده بود`
    : 'پرونده از طریق Excel ایجاد شد';

  insertCaseHistory(
    caseId,
    debtorId,
    userName || 'سیستم',
    'ایجاد پرونده',
    { case_status: 'pending_cei', next_action: 'محاسبه CEI', next_action_date: null },
    details
  );

  const caseData = { ...data, debtor_id: debtorId };
  runCeiSegmentStrategyPipeline(caseId, caseData, { isNewCase: true, userName });

  return { caseId, action: 'created' };
}

function processRow(data, userName) {
  const existingCases = findCasesByCreditId(data.credit_id);
  const debtorId = upsertDebtor(data);

  const burned = existingCases.find((c) => c.case_status === 'burned');
  if (burned) {
    throw new Error('این پرونده سوخت شده و قابل ورود مجدد نیست');
  }

  const activeCase = existingCases.find((c) => !TERMINAL_STATUSES.includes(c.case_status));

  if (activeCase) {
    if (activeCase.case_status === 'pending_legal_assignment') {
      updateFinancialFields(activeCase.id, data);
      insertCaseHistory(
        activeCase.id,
        debtorId,
        userName || 'سیستم',
        'به‌روزرسانی اطلاعات مالی پرونده',
        activeCase,
        'به‌روزرسانی از Excel — بدون تغییر CEI و استراتژی'
      );
      return { caseId: activeCase.id, action: 'updated_financial' };
    }

    updateFinancialFields(activeCase.id, data);
    const caseData = { ...data, debtor_id: debtorId };
    const pipelineResult = runCeiSegmentStrategyPipeline(activeCase.id, caseData, {
      isNewCase: false,
      previousCase: activeCase,
      userName,
    });

    if (pipelineResult.skipped) {
      insertCaseHistory(
        activeCase.id,
        debtorId,
        userName || 'سیستم',
        'به‌روزرسانی اطلاعات پرونده',
        activeCase,
        'به‌روزرسانی مالی — مطالبات افزایش نیافته، CEI و استراتژی تغییر نکرد'
      );
    }

    return { caseId: activeCase.id, action: 'updated' };
  }

  const paidCase = existingCases.find((c) => c.case_status === 'paid');
  if (paidCase) {
    return createNewCase(data, debtorId, paidCase.id, userName);
  }

  return createNewCase(data, debtorId, null, userName);
}

/**
 * پردازش ردیف‌های Excel
 * @param {Array<object>} rows — آرایه آبجکت با کلیدهای هدر فارسی
 * @param {string} userName
 * @returns {object} نتیجه عملیات
 */
function importCasesFromRows(rows, userName = 'ادمین') {
  if (rows.length > MAX_ROWS) {
    throw new Error(`حداکثر ${MAX_ROWS} ردیف در هر فایل قابل پردازش است`);
  }

  const minDpd = parseInt(getSetting('min_dpd', '61'), 10);

  const firstRow = rows[0] || {};
  const headerMap = {};
  for (const rawKey of Object.keys(firstRow)) {
    const field = resolveFieldFromHeader(rawKey);
    if (field) headerMap[normalizeHeader(rawKey)] = field;
  }

  const presentFields = new Set(Object.values(headerMap));
  const missingFields = REQUIRED_FIELDS.filter((f) => !presentFields.has(f));
  if (missingFields.length > 0) {
    const missingLabels = missingFields.map((f) => REQUIRED_FIELD_LABELS[f]);
    throw new Error(`ستون‌های اجباری یافت نشد: ${missingLabels.join('، ')}`);
  }

  const result = {
    total: rows.length,
    created: 0,
    updated: 0,
    errors: [],
    error_rows: [],
  };

  rows.forEach((rawRow, index) => {
    const rowNum = index + 2;
    const normalizedRaw = {};
    for (const [k, v] of Object.entries(rawRow)) {
      normalizedRaw[normalizeHeader(k)] = v;
    }
    const mapped = mapRow(normalizedRaw, headerMap);

    const validation = validateAndParseRow(mapped, minDpd);
    if (!validation.ok) {
      const reason = validation.errors.join('؛ ');
      result.errors.push({ row: rowNum, credit_id: validation.creditId || '—', reason });
      result.error_rows.push({ ...normalizedRaw, 'ردیف': rowNum, 'دلیل خطا': reason });
      return;
    }

    try {
      const outcome = processRow(validation.data, userName);
      if (outcome.action === 'created') result.created += 1;
      else result.updated += 1;
    } catch (err) {
      const reason = err.message || 'خطای نامشخص';
      result.errors.push({ row: rowNum, credit_id: validation.creditId, reason });
      result.error_rows.push({ ...normalizedRaw, 'ردیف': rowNum, 'دلیل خطا': reason });
    }
  });

  return result;
}

module.exports = {
  importCasesFromRows,
  HEADER_TO_FIELD,
  CANONICAL_EXCEL_HEADERS,
  REQUIRED_FIELD_LABELS,
  MAX_ROWS,
};
