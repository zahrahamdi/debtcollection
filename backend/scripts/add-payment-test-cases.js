'use strict';

/**
 * افزودن دو پرونده تستی وام برای آزمایش «بارگذاری پرداخت‌ها»:
 *   CR-7001 → وضعیت «در انتظار نتیجه تماس مذاکره‌کننده» (in_negotiation) → پرداخت جزئی
 *   CR-7002 → وضعیت «در انتظار نتیجه پیامک» (pending_sms_result) → پرداخت کامل
 *
 * همچنین فایل Excel آماده‌ی بارگذاری پرداخت‌ها را در backend/payment-import-test.xlsx می‌سازد.
 * این اسکریپت به ساختار داده‌ها دست نمی‌زند؛ فقط ردیف اضافه می‌کند و idempotent است.
 *
 * اجرا: npm run add-payment-test
 */

const path = require('path');
const XLSX = require('xlsx');
const { initDatabase, getDb, persist, query, run } = require('../src/db/database');
const { formatDatetime, todayJalali, nowJalaliDateTime, calcActionStatus } = require('../src/db/dateUtil');

const CREDIT_IDS = ['CR-7001', 'CR-7002'];

const DEBTORS = {
  'CR-7001': {
    first_name: 'مریم',
    last_name: 'کریمی',
    national_code: '7012345001',
    gender: 'female',
    mobile: '09127001001',
    province: 'تهران',
    city: 'تهران',
  },
  'CR-7002': {
    first_name: 'رضا',
    last_name: 'موسوی',
    national_code: '7012345002',
    gender: 'male',
    mobile: '09127002002',
    province: 'اصفهان',
    city: 'اصفهان',
  },
};

function futureDatetime(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return formatDatetime(d);
}

function deleteExisting() {
  for (const creditId of CREDIT_IDS) {
    const rows = query('SELECT id, debtor_id FROM cases WHERE credit_id = $c', { $c: creditId });
    for (const row of rows) {
      run('DELETE FROM case_actions WHERE case_id = $id', { $id: row.id });
      run('DELETE FROM case_history WHERE case_id = $id', { $id: row.id });
      run('DELETE FROM payments WHERE case_id = $id', { $id: row.id });
      run('DELETE FROM promises WHERE case_id = $id', { $id: row.id });
      run('DELETE FROM cases WHERE id = $id', { $id: row.id });
      const left = query('SELECT id FROM cases WHERE debtor_id = $d LIMIT 1', { $d: row.debtor_id });
      if (left.length === 0) {
        run('DELETE FROM phone_numbers WHERE debtor_id = $d', { $d: row.debtor_id });
        run('DELETE FROM addresses WHERE debtor_id = $d', { $d: row.debtor_id });
        run('DELETE FROM debtors WHERE id = $d', { $d: row.debtor_id });
      }
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

function insertCase(db, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  db.run(`INSERT INTO cases (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]));
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

function insertAction(db, caseId, [seq, actionType, bodyText, result, actionDate, cost, callStatus, nextCallDate]) {
  db.run(
    `INSERT INTO case_actions
      (case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [caseId, seq, actionType, bodyText, result, actionDate, cost, callStatus, nextCallDate]
  );
}

async function main() {
  await initDatabase();
  const db = getDb();

  // سگمنت متوسط وام (30–60) و استراتژی آن (اکشن اول = پیامک)
  const segment = query(
    `SELECT * FROM segments WHERE credit_type = 'loan' AND cei_x <= 45 AND cei_y >= 45 ORDER BY cei_x DESC LIMIT 1`
  )[0];
  if (!segment) throw new Error('سگمنت وام مناسب یافت نشد — ابتدا seed اجرا شود (npm run seed).');

  const strategy = query(
    `SELECT * FROM strategies WHERE credit_type = 'loan' AND segment_id = $sid ORDER BY id ASC LIMIT 1`,
    { $sid: segment.id }
  )[0];
  if (!strategy) throw new Error('استراتژی وام برای سگمنت یافت نشد — ابتدا seed اجرا شود.');

  const maxRepeatRow = query(
    `SELECT max_repeat FROM strategy_actions
     WHERE strategy_id = $sid AND action_type = 'negotiator_call' ORDER BY seq DESC LIMIT 1`,
    { $sid: strategy.id }
  )[0];
  const maxCalls = Number(maxRepeatRow?.max_repeat) || 5;

  const negotiator = query(`SELECT id FROM negotiators WHERE status = 'active' ORDER BY id ASC LIMIT 1`)[0];
  const negotiatorId = negotiator?.id || null;

  deleteExisting();

  const futureNad = futureDatetime(2); // آینده تا ورکر پرونده را زودتر پردازش نکند
  const nowJ = nowJalaliDateTime();

  // ---------- CR-7001: در انتظار نتیجه تماس مذاکره‌کننده → پرداخت جزئی ----------
  const debtorA = insertDebtor(db, DEBTORS['CR-7001']);
  const caseAId = insertCase(db, {
    debtor_id: debtorA,
    credit_id: 'CR-7001',
    credit_type: 'loan',
    supplier: 'بانک ملت',
    guarantee_type: 'cheque',
    debt_class: 'معوق',
    dpd: 60,
    credit_amount: 300000000,
    outstanding_debt: 200000000,
    claims_amount: 200000000,
    penalty_amount: 10000000,
    assigned_negotiator_id: negotiatorId,
    case_status: 'in_negotiation',
    last_action: 'تماس مذاکره‌کننده',
    last_action_date: todayJalali(),
    next_action: 'تماس مذاکره‌کننده',
    next_action_date: futureNad,
    action_status: calcActionStatus(futureNad),
    cei: 45,
    cei_boost: 0,
    cei_formula_version: 'v1',
    segment_id: segment.id,
    strategy_id: strategy.id,
    call_count: 1,
    max_call_count: maxCalls,
    total_installments: 12,
    overdue_installments_count: 4,
  });
  insertAction(db, caseAId, [1, 'warning_sms', 'بدهکار گرامی، قسط معوق شما سررسید شده است.', 'عدم پرداخت', nowJ, 5000, null, null]);
  insertAction(db, caseAId, [2, 'negotiator_call', null, 'وضعیت تماس: پاسخگو بود · تصمیم به پرداخت: نامشخص', nowJ, 1750000, 'پاسخگو بود', null]);

  // ---------- CR-7002: در انتظار نتیجه پیامک → پرداخت کامل ----------
  const debtorB = insertDebtor(db, DEBTORS['CR-7002']);
  const caseBId = insertCase(db, {
    debtor_id: debtorB,
    credit_id: 'CR-7002',
    credit_type: 'loan',
    supplier: 'بانک تجارت',
    guarantee_type: 'promissory_note',
    debt_class: 'معوق',
    dpd: 45,
    credit_amount: 200000000,
    outstanding_debt: 120000000,
    claims_amount: 120000000,
    penalty_amount: 5000000,
    assigned_negotiator_id: null,
    case_status: 'pending_sms_result',
    last_action: 'پیامک هشدار',
    last_action_date: todayJalali(),
    next_action: 'تماس خودکار هشدار',
    next_action_date: futureNad,
    action_status: calcActionStatus(futureNad),
    cei: 45,
    cei_boost: 0,
    cei_formula_version: 'v1',
    segment_id: segment.id,
    strategy_id: strategy.id,
    call_count: 0,
    max_call_count: maxCalls,
    total_installments: 10,
    overdue_installments_count: 3,
  });
  insertAction(db, caseBId, [1, 'warning_sms', '{نام_کاربر} عزیز، مبلغ {مبلغ_مطالبات} ریال بدهی معوق دارید.', 'ارسال شد', nowJ, 5000, null, null]);

  persist();

  // ---------- ساخت فایل Excel بارگذاری پرداخت‌ها ----------
  const payDate = todayJalali();
  const sheetRows = [
    {
      'شناسه اعتبار': 'CR-7001',
      'کد ملی': DEBTORS['CR-7001'].national_code,
      'مبلغ پرداختی به ریال': 60000000, // < مطالبات (۲۰۰٬۰۰۰٬۰۰۰) → پرداخت جزئی
      'تاریخ پرداخت': payDate,
      'شماره تراکنش': 'TXN-7001',
      'توضیحات': 'پرداخت جزئی آزمایشی',
    },
    {
      'شناسه اعتبار': 'CR-7002',
      'کد ملی': DEBTORS['CR-7002'].national_code,
      'مبلغ پرداختی به ریال': 120000000, // = مطالبات (۱۲۰٬۰۰۰٬۰۰۰) → پرداخت کامل
      'تاریخ پرداخت': payDate,
      'شماره تراکنش': 'TXN-7002',
      'توضیحات': 'پرداخت کامل آزمایشی',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sheetRows, {
    header: ['شناسه اعتبار', 'کد ملی', 'مبلغ پرداختی به ریال', 'تاریخ پرداخت', 'شماره تراکنش', 'توضیحات'],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'payments');
  const outPath = path.join(__dirname, '..', 'payment-import-test.xlsx');
  XLSX.writeFile(wb, outPath);

  console.log('[add-payment-test] پرونده‌ها اضافه شدند:');
  console.log(`  • CR-7001 (${DEBTORS['CR-7001'].national_code}) — in_negotiation — مطالبات ۲۰۰٬۰۰۰٬۰۰۰ → پرداخت جزئی ۶۰٬۰۰۰٬۰۰۰`);
  console.log(`  • CR-7002 (${DEBTORS['CR-7002'].national_code}) — pending_sms_result — مطالبات ۱۲۰٬۰۰۰٬۰۰۰ → پرداخت کامل ۱۲۰٬۰۰۰٬۰۰۰`);
  console.log(`[add-payment-test] فایل بارگذاری پرداخت: ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[add-payment-test] خطا:', err);
  process.exit(1);
});
