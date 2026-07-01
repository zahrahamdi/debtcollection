'use strict';

/**
 * حذف پرونده‌های CR-6001…6016 (و بدهکاران مرتبط) + زهرا حمدی قدیمی
 * درج ۱۶ پرونده هر کدام با بدهکار تصادفی جدا
 * اجرا: npm run seed-zahra
 */

const { initDatabase, getDb, persist, query, run } = require('../src/db/database');
const { deleteDebtorByMobile } = require('../src/services/debtor-cleanup.service');
const {
  formatDatetime,
  calcActionStatus,
  jalaliDateToDatetime,
  gregorianToJalali,
  formatJalali,
} = require('../src/db/dateUtil');

const CREDIT_IDS = Array.from({ length: 16 }, (_, i) => `CR-${6001 + i}`);

const SMS = {
  warning: 'بدهکار گرامی، قسط معوق شما سررسید شده است. لطفاً نسبت به پرداخت اقدام کنید.',
  warningDigipay: 'بدهی معوق شما در دیجی‌پی سررسید شده است.',
  threatening: 'اخطار نهایی پرداخت بدهی معوق. در صورت عدم پرداخت پرونده به حقوقی ارجاع می‌شود.',
  bnpl: 'یادآوری بدهی معوق BNPL دیجی‌کالا.',
};

const AUTOCALL = {
  warning: 'تماس خودکار: یادآوری پرداخت بدهی معوق دیجی‌پی.',
  threatening: 'تماس خودکار تهدید: اخطار ارجاع به حقوقی.',
};

const NEGOTIATOR_NAMES = { 1: 'زهرا حمیدی', 2: 'علی رضایی', 3: 'سارا محمدی' };
const CALL_COST = 1750000;

const RANDOM_DEBTORS = [
  { first_name: 'امیر', last_name: 'ستاری', national_code: '6012345001', gender: 'male', mobile: '09126001001', province: 'تهران', city: 'تهران' },
  { first_name: 'نرگس', last_name: 'جعفری', national_code: '6012345002', gender: 'female', mobile: '09126002002', province: 'اصفهان', city: 'اصفهان' },
  { first_name: 'پویا', last_name: 'میرزایی', national_code: '6012345003', gender: 'male', mobile: '09126003003', province: 'فارس', city: 'شیراز' },
  { first_name: 'الهام', last_name: 'رحیمی', national_code: '6012345004', gender: 'female', mobile: '09126004004', province: 'خراسان رضوی', city: 'مشهد' },
  { first_name: 'سینا', last_name: 'کاظمی', national_code: '6012345005', gender: 'male', mobile: '09126005005', province: 'البرز', city: 'کرج' },
  { first_name: 'مهرنوش', last_name: 'قاسمی', national_code: '6012345006', gender: 'female', mobile: '09126006006', province: 'گیلان', city: 'رشت' },
  { first_name: 'بابک', last_name: 'نادری', national_code: '6012345007', gender: 'male', mobile: '09126007007', province: 'آذربایجان شرقی', city: 'تبریز' },
  { first_name: 'شیدا', last_name: 'افشار', national_code: '6012345008', gender: 'female', mobile: '09126008008', province: 'خوزستان', city: 'اهواز' },
  { first_name: 'کاوه', last_name: 'یزدانی', national_code: '6012345009', gender: 'male', mobile: '09126009009', province: 'یزد', city: 'یزد' },
  { first_name: 'ریحانه', last_name: 'ملکی', national_code: '6012345010', gender: 'female', mobile: '09126010010', province: 'قم', city: 'قم' },
  { first_name: 'فرهاد', last_name: 'شریفی', national_code: '6012345011', gender: 'male', mobile: '09126011011', province: 'مازندران', city: 'ساری' },
  { first_name: 'نگار', last_name: 'طباطبایی', national_code: '6012345012', gender: 'female', mobile: '09126012012', province: 'تهران', city: 'ری' },
  { first_name: 'آرمان', last_name: 'فلاح', national_code: '6012345013', gender: 'male', mobile: '09126013013', province: 'همدان', city: 'همدان' },
  { first_name: 'پریسا', last_name: 'بهرامی', national_code: '6012345014', gender: 'female', mobile: '09126014014', province: 'کرمان', city: 'کرمان' },
  { first_name: 'مهدی', last_name: 'زارع', national_code: '6012345015', gender: 'male', mobile: '09126015015', province: 'بوشهر', city: 'بوشهر' },
  { first_name: 'سپیده', last_name: 'انصاری', national_code: '6012345016', gender: 'female', mobile: '09126016016', province: 'زنجان', city: 'زنجان' },
];

function daysAgoDatetime(days, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return formatDatetime(d);
}

function dueTodayDatetime() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (d.getTime() > Date.now()) {
    d.setDate(d.getDate() - 1);
    d.setHours(23, 0, 0, 0);
  }
  return formatDatetime(d);
}

function jalaliDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return formatJalali(j.year, j.month, j.day);
}

function jalaliNextAction(jy, jm, jd) {
  const dt = jalaliDateToDatetime(`${jy}/${jm}/${jd}`);
  return { date: dt, status: calcActionStatus(dt) };
}

function insertCase(db, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  db.run(`INSERT INTO cases (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]));
}

function deleteDebtorIfOrphan(debtorId) {
  const left = query('SELECT id FROM cases WHERE debtor_id = $d LIMIT 1', { $d: debtorId });
  if (left.length === 0) {
    run('DELETE FROM phone_numbers WHERE debtor_id = $d', { $d: debtorId });
    run('DELETE FROM addresses WHERE debtor_id = $d', { $d: debtorId });
    run('DELETE FROM debtors WHERE id = $d', { $d: debtorId });
  }
}

function purgeCreditSeries() {
  for (const creditId of CREDIT_IDS) {
    const rows = query('SELECT id, debtor_id FROM cases WHERE credit_id = $c', { $c: creditId });
    for (const row of rows) {
      run('DELETE FROM cases WHERE id = $id', { $id: row.id });
      deleteDebtorIfOrphan(row.debtor_id);
    }
  }
}

function insertDebtor(db, d) {
  db.run(
    `INSERT INTO debtors (first_name, last_name, national_code, gender, mobile, province, city, customer_rank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.first_name, d.last_name, d.national_code, d.gender, d.mobile, d.province, d.city, 'B']
  );
  const debtorId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  db.run('INSERT INTO phone_numbers (debtor_id, phone, source) VALUES (?, ?, ?)', [
    debtorId,
    d.mobile,
    'digipay',
  ]);
  return debtorId;
}

function insertAction(db, caseId, [seq, actionType, bodyText, result, actionDate, cost, callStatus, nextCallDate]) {
  db.run(
    `INSERT INTO case_actions
      (case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [caseId, seq, actionType, bodyText, result, actionDate, cost, callStatus, nextCallDate]
  );
}

function insertHistory(db, caseId, debtorId, [userName, operation, caseStatus, nextAction, nextActionDate, details]) {
  db.run(
    `INSERT INTO case_history
      (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [caseId, debtorId, userName, operation, caseStatus, nextAction, nextActionDate, details]
  );
}

function strategy2Prelude() {
  return [
    [1, 'warning_sms', SMS.warningDigipay, 'عدم پرداخت', jalaliDaysAgo(14), 5000, null, null],
    [2, 'threatening_sms', SMS.threatening, 'عدم پرداخت', jalaliDaysAgo(10), 5000, null, null],
  ];
}

function strategy3Prelude() {
  return [
    [1, 'threatening_sms', SMS.threatening, 'عدم پرداخت', jalaliDaysAgo(45), 5000, null, null],
    [2, 'threatening_autocall', AUTOCALL.threatening, 'پاسخگو نبود', jalaliDaysAgo(30), 90000, null, null],
  ];
}

function strategy1Prelude() {
  return [
    [1, 'warning_sms', SMS.warning, 'عدم پرداخت', jalaliDaysAgo(8), 5000, null, null],
    [2, 'warning_autocall', AUTOCALL.warning, 'پاسخگو نبود', jalaliDaysAgo(3), 90000, null, null],
  ];
}

function completedNoAnswerCall(seq, daysAgo, nextCallDaysAgo) {
  const nextDate = jalaliDaysAgo(nextCallDaysAgo);
  return [
    seq,
    'negotiator_call',
    null,
    `وضعیت تماس: پاسخگو نبود · تماس بعدی: ${nextDate}`,
    jalaliDaysAgo(daysAgo),
    CALL_COST,
    'پاسخگو نبود',
    nextDate,
  ];
}

function pendingNegotiatorCall(seq, daysAgo) {
  return [seq, 'negotiator_call', null, null, jalaliDaysAgo(daysAgo), 0, null, null];
}

function deathCall(seq, daysAgo) {
  return [
    seq,
    'negotiator_call',
    null,
    'وضعیت تماس: پاسخگو بود · دلیل عدم پرداخت: فوت کاربر',
    jalaliDaysAgo(daysAgo),
    CALL_COST,
    'پاسخگو بود',
    null,
  ];
}

/** سابقه اقدامات متناسب با وضعیت و استراتژی هر پرونده */
function buildActionsForCase(def) {
  const { credit_id: cid, call_count: cc = 0 } = def;

  if (cid >= 'CR-6001' && cid <= 'CR-6006') {
    const actions = strategy2Prelude();
    let seq = 3;
    const completedPattern = {
      'CR-6001': [],
      'CR-6002': [[8, 6]],
      'CR-6003': [[7, 5]],
      'CR-6004': [[12, 10], [8, 6]],
      'CR-6005': [[11, 9], [7, 5]],
      'CR-6006': [[14, 12], [10, 8], [8, 6]],
    };
    for (const [daysAgo, nextDays] of completedPattern[cid] || []) {
      actions.push(completedNoAnswerCall(seq++, daysAgo, nextDays));
    }
    const pendingDays = {
      'CR-6001': 2,
      'CR-6002': 1,
      'CR-6003': 3,
      'CR-6004': 5,
      'CR-6005': 4,
      'CR-6006': 7,
    };
    actions.push(pendingNegotiatorCall(seq, pendingDays[cid]));
    if (actions.filter((a) => a[1] === 'negotiator_call' && a[6]).length !== cc) {
      console.warn(`[seed-cr6000] ${cid}: call_count=${cc} با تعداد تماس‌های ثبت‌شده هم‌خوان نیست`);
    }
    return actions;
  }

  if (cid === 'CR-6007') {
    const actions = strategy3Prelude();
    actions.push(completedNoAnswerCall(3, 25, 20));
    actions.push(completedNoAnswerCall(4, 20, 16));
    actions.push(completedNoAnswerCall(5, 16, 13));
    actions.push(completedNoAnswerCall(6, 13, 11));
    actions.push(completedNoAnswerCall(7, 11, 10));
    actions.push(deathCall(8, 10));
    return actions;
  }

  if (cid === 'CR-6008') {
    const actions = strategy3Prelude();
    actions.push(completedNoAnswerCall(3, 22, 18));
    actions.push(completedNoAnswerCall(4, 18, 14));
    actions.push(completedNoAnswerCall(5, 14, 11));
    actions.push(completedNoAnswerCall(6, 11, 9));
    actions.push(deathCall(7, 8));
    return actions;
  }

  if (cid === 'CR-6009') {
    return [
      ...strategy2Prelude(),
      completedNoAnswerCall(3, 25, 20),
      completedNoAnswerCall(4, 20, 15),
      [
        5,
        'negotiator_call',
        null,
        'وضعیت تماس: پاسخگو بود · تصمیم به پرداخت: دارد · تعهد: 410000000 ریال در ' +
          jalaliDaysAgo(10),
        jalaliDaysAgo(15),
        CALL_COST,
        'پاسخگو بود',
        jalaliDaysAgo(10),
      ],
      [6, 'payment_full', null, 'تسویه کامل — ۴۱۰٬۰۰۰٬۰۰۰ ریال', jalaliDaysAgo(5), 0, null, null],
    ];
  }

  if (cid === 'CR-6010') {
    return [
      ...strategy2Prelude(),
      completedNoAnswerCall(3, 22, 18),
      [
        4,
        'negotiator_call',
        null,
        'وضعیت تماس: پاسخگو بود · تصمیم به پرداخت: دارد · تعهد: 395000000 ریال در ' +
          jalaliDaysAgo(14),
        jalaliDaysAgo(18),
        CALL_COST,
        'پاسخگو بود',
        jalaliDaysAgo(14),
      ],
      [5, 'payment_full', null, 'تسویه کامل — ۳۹۵٬۰۰۰٬۰۰۰ ریال', jalaliDaysAgo(12), 0, null, null],
    ];
  }

  if (cid === 'CR-6011') {
    return [[1, 'warning_sms', SMS.warning, 'عدم پرداخت', jalaliDaysAgo(1), 5000, null, null]];
  }

  if (cid === 'CR-6012') {
    return [[1, 'threatening_sms', SMS.bnpl, 'عدم پرداخت', jalaliDaysAgo(2), 5000, null, null]];
  }

  if (cid === 'CR-6013') {
    return [
      [1, 'warning_sms', SMS.warning, 'عدم پرداخت', jalaliDaysAgo(5), 5000, null, null],
      [2, 'warning_autocall', AUTOCALL.warning, 'پاسخگو نبود', jalaliDaysAgo(0), 90000, null, null],
    ];
  }

  if (cid === 'CR-6014') {
    return [
      [1, 'warning_sms', SMS.warning, 'عدم پرداخت', jalaliDaysAgo(6), 5000, null, null],
      [2, 'warning_autocall', AUTOCALL.warning, 'پاسخگو نبود', jalaliDaysAgo(1), 90000, null, null],
    ];
  }

  if (cid === 'CR-6015' || cid === 'CR-6016') {
    const days = cid === 'CR-6015' ? 3 : 4;
    return [
      [1, 'warning_sms', SMS.warning, 'عدم پرداخت', jalaliDaysAgo(days + 4), 5000, null, null],
      [2, 'warning_autocall', AUTOCALL.warning, 'پاسخگو نبود', jalaliDaysAgo(days + 1), 90000, null, null],
      [3, 'negotiator_call', null, 'در انتظار تخصیص', jalaliDaysAgo(days), 0, null, null],
    ];
  }

  return [];
}

function buildHistoryForCase(def, dueToday, overdue2, tir20, tir15) {
  const { credit_id: cid, assigned_negotiator_id: negId, case_status: st } = def;
  const negName = negId ? NEGOTIATOR_NAMES[negId] : null;
  const rows = [['سیستم', 'ایجاد پرونده', 'pending_cei', 'محاسبه CEI', null, 'پرونده تست CR-6000']];

  if (cid <= 'CR-6010' || cid.startsWith('CR-601')) {
    rows.push([
      'سیستم',
      'تخصیص استراتژی',
      'pending_strategy_start',
      def.next_action || 'پیامک هشدار',
      null,
      `استراتژی ${def.strategy_id}`,
    ]);
  }

  if (cid >= 'CR-6001' && cid <= 'CR-6006') {
    rows.push(['سیستم', 'اجرای پیامک', 'pending_sms_result', 'پیامک تهدید', null, 'دو پیامک اجرا شد']);
    rows.push([
      negName,
      'تخصیص به مذاکره‌کننده',
      'pending_negotiator_call',
      'تماس مذاکره‌کننده',
      def.next_action_date,
      `مذاکره‌کننده: ${negName}`,
    ]);
    if ((def.call_count || 0) > 0) {
      rows.push([
        negName,
        'ثبت خروجی تماس',
        'in_negotiation',
        'تماس مذاکره‌کننده',
        def.next_action_date,
        'وضعیت تماس: پاسخگو نبود',
      ]);
    }
    rows.push([
      negName,
      'تماس مذاکره‌کننده',
      st,
      def.next_action,
      def.next_action_date,
      'در انتظار ثبت خروجی تماس',
    ]);
    return rows;
  }

  if (cid === 'CR-6007' || cid === 'CR-6008') {
    rows.push(['سیستم', 'اجرای پیامک', 'pending_sms_result', 'تماس خودکار تهدید', null, '']);
    rows.push([
      negName,
      'تخصیص به مذاکره‌کننده',
      'pending_negotiator_call',
      'تماس مذاکره‌کننده',
      null,
      `مذاکره‌کننده: ${negName}`,
    ]);
    rows.push([
      negName,
      'ثبت خروجی تماس',
      'in_negotiation',
      null,
      null,
      'دلیل عدم پرداخت: فوت کاربر',
    ]);
    rows.push([
      negName,
      'سوخت پرونده — فوت کاربر',
      'burned',
      null,
      null,
      'پرونده به دلیل فوت کاربر سوخت شد و استراتژی متوقف گردید.',
    ]);
    return rows;
  }

  if (cid === 'CR-6009' || cid === 'CR-6010') {
    rows.push(['سیستم', 'اجرای پیامک', 'pending_sms_result', 'تماس مذاکره‌کننده', null, '']);
    rows.push([
      'سیستم',
      'ثبت پرداخت کامل',
      'paid',
      null,
      null,
      `تسویه کامل — ${def.last_payment_amount?.toLocaleString('fa-IR')} ریال`,
    ]);
    return rows;
  }

  if (cid === 'CR-6011') {
    rows.push(['سیستم', 'اجرای پیامک', st, 'تماس خودکار هشدار', tir20.date, 'پیامک هشدار ارسال شد']);
    return rows;
  }

  if (cid === 'CR-6012') {
    rows.push(['سیستم', 'اجرای پیامک', st, 'تماس مذاکره‌کننده', tir20.date, 'پیامک BNPL ارسال شد']);
    return rows;
  }

  if (cid === 'CR-6013' || cid === 'CR-6014') {
    rows.push(['سیستم', 'اجرای پیامک', 'pending_sms_result', 'تماس خودکار هشدار', null, '']);
    rows.push([
      'سیستم',
      'اجرای تماس خودکار',
      st,
      def.next_action,
      def.next_action_date,
      'نتیجه: پاسخگو نبود',
    ]);
    return rows;
  }

  if (cid === 'CR-6015' || cid === 'CR-6016') {
    rows.push(['سیستم', 'اجرای پیامک', 'pending_sms_result', 'تماس خودکار هشدار', null, '']);
    rows.push(['سیستم', 'اجرای تماس خودکار', 'pending_autocall_result', 'تماس مذاکره‌کننده', null, '']);
    rows.push([
      'سیستم',
      'ارجاع به مذاکره‌کننده',
      st,
      def.next_action,
      def.next_action_date,
      'تمام اقدام‌های خودکار انجام شد',
    ]);
    return rows;
  }

  return rows;
}

function main() {
  const db = getDb();

  deleteDebtorByMobile('09128898006');
  purgeCreditSeries();
  console.log('[seed-cr6000] پرونده‌های CR-6001…6016 قبلی (در صورت وجود) پاک شدند');

  const debtorIds = RANDOM_DEBTORS.map((d) => insertDebtor(db, d));

  const tir20 = jalaliNextAction(1405, 4, 20);
  const tir15 = jalaliNextAction(1405, 4, 15);
  const dueToday = dueTodayDatetime();
  const overdue2 = daysAgoDatetime(2);
  const overdue5 = daysAgoDatetime(5);

  const caseBase = () => ({
    credit_type: 'loan',
    supplier: 'بانک ملت',
    guarantee_type: 'none',
    debt_class: 'معوق',
    dpd: 72,
    credit_amount: 500000000,
    penalty_amount: 8000000,
    cei_formula_version: 'v1',
    case_cost: 95000,
    max_call_count: 5,
    first_unpaid_no: 3,
    first_unpaid_date: jalaliDaysAgo(90),
    last_unpaid_no: 6,
    last_unpaid_date: jalaliDaysAgo(30),
    total_installments: 12,
    overdue_installments_count: 3,
    previous_case_id: null,
  });

  const caseDefs = [
    { credit_id: 'CR-6001', outstanding_debt: 300000000, claims_amount: 300000000, assigned_negotiator_id: 1, case_status: 'in_negotiation', last_action: 'تخصیص به مذاکره‌کننده', last_action_date: jalaliDaysAgo(2), next_action: 'تماس مذاکره‌کننده', next_action_date: dueToday, action_status: calcActionStatus(dueToday), cei: 38.5, segment_id: 2, strategy_id: 2, call_count: 0, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6002', outstanding_debt: 285000000, claims_amount: 285000000, assigned_negotiator_id: 1, case_status: 'in_negotiation', last_action: 'تخصیص به مذاکره‌کننده', last_action_date: jalaliDaysAgo(1), next_action: 'تماس مذاکره‌کننده', next_action_date: dueToday, action_status: calcActionStatus(dueToday), cei: 37.2, segment_id: 2, strategy_id: 2, call_count: 1, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6003', outstanding_debt: 270000000, claims_amount: 270000000, assigned_negotiator_id: 2, case_status: 'in_negotiation', last_action: 'ثبت خروجی تماس', last_action_date: jalaliDaysAgo(3), next_action: 'تماس مذاکره‌کننده', next_action_date: dueToday, action_status: calcActionStatus(dueToday), cei: 36.0, segment_id: 2, strategy_id: 2, call_count: 1, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6004', outstanding_debt: 310000000, claims_amount: 310000000, assigned_negotiator_id: 1, case_status: 'in_negotiation', last_action: 'تماس مذاکره‌کننده', last_action_date: jalaliDaysAgo(5), next_action: 'تماس مذاکره‌کننده', next_action_date: overdue2, action_status: calcActionStatus(overdue2), cei: 39.1, segment_id: 2, strategy_id: 2, call_count: 2, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6005', outstanding_debt: 295000000, claims_amount: 295000000, assigned_negotiator_id: 2, case_status: 'in_negotiation', last_action: 'تماس مذاکره‌کننده', last_action_date: jalaliDaysAgo(4), next_action: 'تماس مذاکره‌کننده', next_action_date: overdue5, action_status: calcActionStatus(overdue5), cei: 38.0, segment_id: 2, strategy_id: 2, call_count: 2, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6006', outstanding_debt: 280000000, claims_amount: 280000000, assigned_negotiator_id: 1, case_status: 'in_negotiation', last_action: 'تماس مذاکره‌کننده', last_action_date: jalaliDaysAgo(7), next_action: 'تماس مذاکره‌کننده', next_action_date: overdue5, action_status: calcActionStatus(overdue5), cei: 37.5, segment_id: 2, strategy_id: 2, call_count: 3, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6007', outstanding_debt: 340000000, claims_amount: 340000000, assigned_negotiator_id: 2, case_status: 'burned', last_action: 'سوخت پرونده — فوت کاربر', last_action_date: jalaliDaysAgo(10), next_action: null, next_action_date: null, action_status: 'waiting', cei: 68.5, segment_id: 3, strategy_id: 3, call_count: 5, last_payment_date: jalaliDaysAgo(150), last_payment_amount: 30000000 },
    { credit_id: 'CR-6008', outstanding_debt: 320000000, claims_amount: 320000000, assigned_negotiator_id: 1, case_status: 'burned', last_action: 'سوخت پرونده — فوت کاربر', last_action_date: jalaliDaysAgo(8), next_action: null, next_action_date: null, action_status: 'waiting', cei: 65.0, segment_id: 3, strategy_id: 3, call_count: 4, last_payment_date: jalaliDaysAgo(120), last_payment_amount: 25000000 },
    { credit_id: 'CR-6009', outstanding_debt: 0, claims_amount: 0, assigned_negotiator_id: null, case_status: 'paid', last_action: 'ثبت پرداخت کامل', last_action_date: jalaliDaysAgo(5), next_action: null, next_action_date: null, action_status: 'waiting', cei: 44.0, segment_id: 2, strategy_id: 2, call_count: 3, last_payment_date: jalaliDaysAgo(5), last_payment_amount: 410000000 },
    { credit_id: 'CR-6010', outstanding_debt: 0, claims_amount: 0, assigned_negotiator_id: null, case_status: 'paid', last_action: 'ثبت پرداخت کامل', last_action_date: jalaliDaysAgo(12), next_action: null, next_action_date: null, action_status: 'waiting', cei: 42.0, segment_id: 2, strategy_id: 2, call_count: 2, last_payment_date: jalaliDaysAgo(12), last_payment_amount: 395000000 },
    { credit_id: 'CR-6011', outstanding_debt: 120000000, claims_amount: 120000000, assigned_negotiator_id: null, case_status: 'pending_sms_result', last_action: 'اجرای پیامک', last_action_date: jalaliDaysAgo(1), next_action: 'تماس خودکار هشدار', next_action_date: tir20.date, action_status: tir20.status, cei: 28.5, segment_id: 1, strategy_id: 1, call_count: 0, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6012', credit_type: 'bnpl', supplier: 'دیجی‌کالا', outstanding_debt: 65000000, claims_amount: 65000000, credit_amount: 80000000, assigned_negotiator_id: null, case_status: 'pending_sms_result', last_action: 'اجرای پیامک', last_action_date: jalaliDaysAgo(2), next_action: 'تماس مذاکره‌کننده', next_action_date: tir20.date, action_status: tir20.status, cei: 35.0, segment_id: 4, strategy_id: 4, call_count: 0, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6013', outstanding_debt: 50000000, claims_amount: 50000000, credit_amount: 200000000, assigned_negotiator_id: null, case_status: 'pending_autocall_result', last_action: 'تماس خودکار هشدار', last_action_date: jalaliDaysAgo(0), next_action: 'تماس مذاکره‌کننده', next_action_date: tir15.date, action_status: tir15.status, cei: 29.6, segment_id: 1, strategy_id: 1, call_count: 0, last_payment_date: jalaliDaysAgo(120), last_payment_amount: 15000000 },
    { credit_id: 'CR-6014', outstanding_debt: 48000000, claims_amount: 48000000, credit_amount: 180000000, assigned_negotiator_id: null, case_status: 'pending_autocall_result', last_action: 'تماس خودکار هشدار', last_action_date: jalaliDaysAgo(1), next_action: 'تماس مذاکره‌کننده', next_action_date: tir15.date, action_status: tir15.status, cei: 28.8, segment_id: 1, strategy_id: 1, call_count: 0, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6015', outstanding_debt: 90000000, claims_amount: 90000000, credit_amount: 150000000, assigned_negotiator_id: null, case_status: 'pending_negotiator_assignment', last_action: 'ارجاع به مذاکره‌کننده', last_action_date: jalaliDaysAgo(1), next_action: 'تخصیص به مذاکره‌کننده', next_action_date: dueToday, action_status: calcActionStatus(dueToday), cei: 32.0, segment_id: 1, strategy_id: 1, call_count: 0, last_payment_date: null, last_payment_amount: null },
    { credit_id: 'CR-6016', outstanding_debt: 78000000, claims_amount: 78000000, credit_amount: 140000000, assigned_negotiator_id: null, case_status: 'pending_negotiator_assignment', last_action: 'ارجاع به مذاکره‌کننده', last_action_date: jalaliDaysAgo(2), next_action: 'تخصیص به مذاکره‌کننده', next_action_date: overdue2, action_status: calcActionStatus(overdue2), cei: 31.2, segment_id: 1, strategy_id: 1, call_count: 0, last_payment_date: null, last_payment_amount: null },
  ];

  caseDefs.forEach((def, i) => {
    insertCase(db, { ...caseBase(), ...def, debtor_id: debtorIds[i] });
  });

  const caseIdByCredit = {};
  for (const def of caseDefs) {
    const row = query('SELECT id FROM cases WHERE credit_id = $c', { $c: def.credit_id })[0];
    caseIdByCredit[def.credit_id] = row.id;
  }

  caseDefs.forEach((def, i) => {
    const caseId = caseIdByCredit[def.credit_id];
    const debtorId = debtorIds[i];

    for (const action of buildActionsForCase(def)) {
      insertAction(db, caseId, action);
    }

    for (const h of buildHistoryForCase(def, dueToday, overdue2, tir20, tir15)) {
      insertHistory(db, caseId, debtorId, h);
    }

    if (def.case_status === 'paid' && def.last_payment_amount) {
      db.run(
        `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES (?, ?, ?, ?)`,
        [caseId, def.last_payment_amount, def.last_payment_date, 'full']
      );
    }
  });

  persist();

  console.log('\n[seed-cr6000] ۱۶ پرونده با بدهکاران جدا ایجاد شد:\n');
  caseDefs.forEach((def, i) => {
    const d = RANDOM_DEBTORS[i];
    console.log(
      `  ${def.credit_id} | ${d.first_name} ${d.last_name} | ${d.mobile} | ${d.national_code} | ${def.case_status}`
    );
  });
  console.log('\n  تست پرداخت جزئی → CR-6002 (نرگس جعفری، 6012345002)');
  console.log('  تست افزایش مطالبات → CR-6013 (آرمان فلاح، 6012345013)');
}

initDatabase()
  .then(main)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
