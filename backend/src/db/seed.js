'use strict';

/**
 * Seed داده نمونه فارسی برای دمو.
 * ------------------------------------------------------------------
 * این اسکریپت دیتابیس را مقداردهی کرده، جداول را خالی می‌کند و سپس
 * داده نمونه (مذاکره‌کننده، بدهکار، شماره تماس، سگمنت، استراتژی، پرونده،
 * اقساط) را درج می‌کند. در پایان دیتابیس روی database.sqlite ذخیره می‌شود.
 *
 * اجرا:  npm run seed
 */

const { initDatabase, getDb, persist } = require('./database');
const { DEFAULT_LOAN_PARAMS, DEFAULT_BNPL_PARAMS } = require('./cei');

function seed() {
  const db = getDb();

  // پاک‌سازی جداول (ترتیب به دلیل foreign key مهم است)
  db.run(`
    DELETE FROM cei_formulas;
    DELETE FROM case_files;
    DELETE FROM promises;
    DELETE FROM case_actions;
    DELETE FROM case_history;
    DELETE FROM payments;
    DELETE FROM installments;
    DELETE FROM cases;
    DELETE FROM strategy_actions;
    DELETE FROM strategies;
    DELETE FROM segments;
    DELETE FROM addresses;
    DELETE FROM phone_numbers;
    DELETE FROM debtors;
    DELETE FROM negotiators;
    DELETE FROM settings;
    DELETE FROM sqlite_sequence;
  `);

  // -------------------- تنظیمات عمومی --------------------
  const settings = [
    ['min_dpd', '61'],                 // حداقل روزهای دیرکرد برای ایجاد پرونده
    ['promise_to_pay_max_days', '10'], // سقف مهلت تعهد پرداخت
    ['partial_payment_gap_days', '10'],// فاصله پرداخت جزئی
    ['loan_cap', '1000000000'],        // سقف وام برای محاسبه CEI
    ['bnpl_cap', '100000000'],         // سقف BNPL برای محاسبه CEI
  ];
  for (const [key, value] of settings) {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  // -------------------- نسخه اولیه فرمول CEI (وام و BNPL) --------------------
  db.run(
    `INSERT INTO cei_formulas (credit_type, version, params, is_active, change_note, user_name)
     VALUES (?, ?, ?, 1, ?, ?)`,
    ['loan', 1, JSON.stringify(DEFAULT_LOAN_PARAMS), 'نسخه اولیه', 'سیستم']
  );
  db.run(
    `INSERT INTO cei_formulas (credit_type, version, params, is_active, change_note, user_name)
     VALUES (?, ?, ?, 1, ?, ?)`,
    ['bnpl', 1, JSON.stringify(DEFAULT_BNPL_PARAMS), 'نسخه اولیه', 'سیستم']
  );

  // -------------------- مذاکره‌کنندگان --------------------
  const negotiators = [
    // name, status, cooperation_type, capacity, hourly_wage(ریال)
    ['زهرا حمیدی', 'active', 'internal', 50, 1500000],
    ['علی رضایی', 'active', 'internal', 40, 1300000],
    ['سارا محمدی', 'active', 'outsourced', 30, 1100000],
  ];
  for (const n of negotiators) {
    db.run(
      `INSERT INTO negotiators (name, status, cooperation_type, capacity, hourly_wage)
       VALUES (?, ?, ?, ?, ?)`,
      n
    );
  }

  // -------------------- سگمنت‌ها --------------------
  // title, credit_type, condition_type, cei_x, cei_y
  const segments = [
    ['سبک', 'loan', 'between', 0, 30],
    ['متوسط', 'loan', 'between', 30, 60],
    ['سنگین', 'loan', 'between', 60, 100],
    ['سبک', 'bnpl', 'between', 0, 40],
    ['سنگین', 'bnpl', 'between', 40, 100],
  ];
  for (const s of segments) {
    db.run(
      `INSERT INTO segments (title, credit_type, condition_type, cei_x, cei_y) VALUES (?, ?, ?, ?, ?)`,
      s
    );
  }

  // -------------------- استراتژی‌ها --------------------
  // title, credit_type, segment_id, created_by
  const strategies = [
    ['استراتژی سبک وام', 'loan', 1, 'زهرا حمیدی'],
    ['استراتژی متوسط وام', 'loan', 2, 'زهرا حمیدی'],
    ['استراتژی سنگین وام', 'loan', 3, 'علی رضایی'],
    ['استراتژی سبک BNPL', 'bnpl', 4, 'زهرا حمیدی'],
    ['استراتژی سنگین BNPL', 'bnpl', 5, 'علی رضایی'],
  ];
  for (const st of strategies) {
    db.run(
      `INSERT INTO strategies (title, credit_type, segment_id, created_by) VALUES (?, ?, ?, ?)`,
      st
    );
  }

  // -------------------- اکشن‌های استراتژی --------------------
  // strategy_id, seq, action_type, body_text, allowed_from, allowed_to, wait_minutes, cost, max_repeat, avg_call_duration
  const strategyActions = [
    // استراتژی سبک وام (id 1) — wait_minutes: ۳ روز = ۴۳۲۰ دقیقه
    [1, 1, 'warning_sms', 'بدهکار گرامی، قسط معوق شما سررسید شده است. لطفاً نسبت به پرداخت اقدام کنید. {لینک_پرداخت}', '09:00', '18:00', 4320, 5000, null, null],
    [1, 2, 'warning_autocall', 'تماس خودکار: یادآوری پرداخت بدهی معوق دیجی‌پی.', '10:00', '17:00', 4320, 90000, null, null],
    [1, 3, 'negotiator_call', null, '09:00', '20:00', 2880, 0, 3, 5],
    // استراتژی متوسط وام (id 2)
    [2, 1, 'warning_sms', '{نام_کاربر} عزیز، مبلغ {مبلغ_مطالبات} ریال بدهی معوق دارید.', '09:00', '18:00', 2880, 5000, null, null],
    [2, 2, 'threatening_sms', 'در صورت عدم پرداخت، پرونده به حقوقی ارجاع می‌شود. {لینک_پرداخت}', '09:00', '18:00', 2880, 5000, null, null],
    [2, 3, 'negotiator_call', null, '09:00', '20:00', 4320, 0, 5, 7],
    // استراتژی سنگین وام (id 3)
    [3, 1, 'threatening_sms', 'اخطار نهایی پرداخت بدهی معوق. {لینک_پرداخت}', '08:00', '20:00', 1440, 5000, null, null],
    [3, 2, 'threatening_autocall', 'تماس خودکار تهدید: اخطار ارجاع به حقوقی.', '09:00', '18:00', 2880, 90000, null, null],
    [3, 3, 'negotiator_call', null, '08:00', '21:00', 2880, 0, 5, 10],
  ];
  for (const a of strategyActions) {
    db.run(
      `INSERT INTO strategy_actions
        (strategy_id, seq, action_type, body_text, allowed_from, allowed_to, wait_minutes, cost, max_repeat, avg_call_duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a
    );
  }

  // -------------------- بدهکاران --------------------
  const debtors = [
    // first_name, last_name, national_code, gender, mobile, province, city, customer_rank
    ['محمد', 'احمدی', '0012345678', 'male', '09121110011', 'تهران', 'تهران', 'B'],
    ['فاطمه', 'کریمی', '0023456789', 'female', '09122220022', 'اصفهان', 'اصفهان', 'A'],
    ['رضا', 'حسینی', '0034567890', 'male', '09123330033', 'فارس', 'شیراز', 'C'],
    ['مریم', 'نوری', '0045678901', 'female', '09124440044', 'خراسان رضوی', 'مشهد', 'B'],
    ['حسین', 'موسوی', '0056789012', 'male', '09125550055', 'آذربایجان شرقی', 'تبریز', 'C'],
  ];
  for (const d of debtors) {
    db.run(
      `INSERT INTO debtors (first_name, last_name, national_code, gender, mobile, province, city, customer_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      d
    );
  }

  // -------------------- شماره‌های تماس --------------------
  const phones = [
    // debtor_id, phone, source
    [1, '09121110011', 'digipay'],
    [1, '09121110099', 'manual'],
    [2, '09122220022', 'digikala'],
    [3, '09123330033', 'inquiry'],
    [4, '09124440044', 'digipay'],
    [5, '09125550055', 'digipay'],
  ];
  for (const p of phones) {
    db.run('INSERT INTO phone_numbers (debtor_id, phone, source) VALUES (?, ?, ?)', p);
  }

  // -------------------- آدرس‌ها --------------------
  const addresses = [
    // debtor_id, address, postal_code, source
    [1, 'تهران، خیابان ولیعصر، کوچه بهار، پلاک ۱۲', '1234567890', 'digipay'],
    [2, 'اصفهان، خیابان چهارباغ، پلاک ۴۵', '8134567890', 'digikala'],
    [3, 'شیراز، بلوار زند، پلاک ۷', '7134567890', 'manual'],
  ];
  for (const a of addresses) {
    db.run(
      'INSERT INTO addresses (debtor_id, address, postal_code, source) VALUES (?, ?, ?, ?)',
      a
    );
  }

  // -------------------- پرونده‌ها --------------------
  // ستون‌ها به ترتیب درج (نگاشت در پایین):
  const caseColumns = [
    'debtor_id', 'credit_id', 'credit_type', 'supplier', 'guarantee_type', 'debt_class', 'dpd',
    'credit_amount', 'outstanding_debt', 'claims_amount', 'penalty_amount',
    'assigned_negotiator_id', 'case_status', 'last_action', 'last_action_date',
    'next_action', 'next_action_date', 'action_status',
    'cei', 'cei_formula_version', 'segment_id', 'strategy_id', 'case_cost', 'call_count', 'max_call_count',
    'first_unpaid_no', 'first_unpaid_date', 'last_unpaid_no', 'last_unpaid_date',
    'total_installments', 'overdue_installments_count', 'last_payment_date', 'last_payment_amount',
    'previous_case_id',
  ];
  const cases = [
    // CR-1001 — در مرحله مذاکره‌کننده (دکمه ثبت خروجی تماس فعال)
    [1, 'CR-1001', 'loan', 'بانک تجارت', 'cheque', 'معوق', 75,
      500000000, 320000000, 320000000, 18000000,
      1, 'in_negotiation', 'تماس خودکار هشدار', '1404/07/02',
      'تماس مذاکره‌کننده', '1404/07/05', 'due_today',
      42.5, 'v1', 2, 2, 1450000, 1, 5,
      3, '1404/05/01', 6, '1404/08/01', 12, 3, '1404/04/15', 40000000, null],

    // CR-1002 — BNPL، در انتظار تخصیص مذاکره‌کننده
    [2, 'CR-1002', 'bnpl', 'دیجی‌کالا', 'none', 'مشکوک‌الوصول', 90,
      80000000, 65000000, 65000000, 4000000,
      2, 'pending_negotiator_assignment', 'تماس خودکار هشدار', '1404/07/01',
      'تخصیص مذاکره‌کننده', '1404/07/03', 'overdue',
      58.0, 'v1', 5, 5, 320000, 0, 5,
      2, '1404/05/15', 4, '1404/07/15', 4, 2, null, null, null],

    // CR-1003 — در انتظار تخصیص به حقوقی
    [3, 'CR-1003', 'loan', 'بانک ملت', 'promissory_note', 'مشکوک‌الوصول', 120,
      900000000, 780000000, 780000000, 55000000,
      1, 'pending_legal_assignment', 'تماس مذاکره‌کننده', '1404/06/28',
      'ارجاع به حقوقی', '1404/07/01', 'overdue',
      81.3, 'v1', 3, 3, 6800000, 5, 5,
      8, '1404/03/01', 14, '1404/09/01', 18, 6, '1404/02/20', 50000000, null],

    // CR-1004 — در انتظار شروع استراتژی
    [4, 'CR-1004', 'four_installment', 'بانک ملت', 'none', 'سررسید گذشته', 64,
      200000000, 90000000, 90000000, 6000000,
      3, 'pending_strategy_start', 'پیامک هشدار', '1404/07/04',
      'پیامک تهدید', '1404/07/08', 'waiting',
      22.0, 'v1', 1, 1, 50000, 0, 5,
      2, '1404/06/01', 3, '1404/07/01', 4, 2, null, null, null],

    // CR-1005 — پرداخت شده
    [5, 'CR-1005', 'loan', 'بانک ملت', 'cheque', 'تسویه شده', 100,
      600000000, 0, 0, 0,
      null, 'paid', 'ثبت پرداخت کامل', '1404/06/20',
      null, null, 'waiting',
      50.0, 'v1', 2, 2, 2100000, 2, 5,
      null, null, null, null, 10, 0, '1404/06/20', 600000000, null],

    // CR-1006 — پرونده دوم برای بدهکار شماره ۱ (محمد احمدی) جهت نمایش «پرونده‌های دیگر بدهکار»
    [1, 'CR-1006', 'single_installment', 'دیجی‌کالا', 'none', 'سررسید گذشته', 68,
      150000000, 120000000, 120000000, 9000000,
      null, 'pending_strategy_start', 'پیامک هشدار', '1404/07/03',
      'تماس خودکار هشدار', '1404/07/09', 'waiting',
      31.0, 'v1', 2, 2, 50000, 0, 5,
      1, '1404/06/10', 1, '1404/06/10', 1, 1, null, null, null],
  ];
  for (const c of cases) {
    const placeholders = caseColumns.map(() => '?').join(', ');
    db.run(`INSERT INTO cases (${caseColumns.join(', ')}) VALUES (${placeholders})`, c);
  }

  // -------------------- اقساط نمونه (برای پرونده اول) --------------------
  const installments = [
    // case_id, installment_number, due_date, amount, penalty_balance, fee, status, payment_status, payment_date
    [1, 3, '1404/05/01', 40000000, 2000000, 500000, 'سررسید گذشته', 'unpaid', null],
    [1, 4, '1404/06/01', 40000000, 1500000, 500000, 'سررسید گذشته', 'unpaid', null],
    [1, 5, '1404/07/01', 40000000, 0, 500000, 'جاری', 'unpaid', null],
    [3, 8, '1404/04/01', 90000000, 8000000, 800000, 'سررسید گذشته', 'unpaid', null],
  ];
  for (const ins of installments) {
    db.run(
      `INSERT INTO installments (
        case_id, installment_number, due_date, amount, penalty_balance, fee, status, payment_status, payment_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ins
    );
  }

  // -------------------- پرداخت نمونه --------------------
  db.run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES (?, ?, ?, ?)`,
    [5, 600000000, '1404/06/20', 'full']
  );

  // -------------------- تاریخچه نمونه --------------------
  db.run(
    `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, 1, 'سیستم', 'ایجاد پرونده', 'pending_cei', 'محاسبه CEI', '1404/06/25', 'پرونده از طریق Excel ایجاد شد']
  );

  // -------------------- سابقه اقدامات روی پرونده --------------------
  // case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date
  const actions = [
    // پرونده ۱ — زنجیره کامل تا تماس مذاکره‌کننده
    [1, 1, 'warning_sms', 'بدهکار گرامی، بدهی معوق شما در دیجی‌پی سررسید شده است. لطفاً نسبت به پرداخت اقدام کنید.', 'عدم پرداخت', '1404/06/20', 5000, null, null],
    [1, 2, 'threatening_sms', 'در صورت عدم پرداخت، پرونده شما جهت پیگیری حقوقی ارجاع خواهد شد.', 'عدم پرداخت', '1404/06/25', 5000, null, null],
    [1, 3, 'warning_autocall', 'تماس خودکار: یادآوری پرداخت بدهی معوق دیجی‌پی.', 'پاسخ داده شد - عدم پرداخت', '1404/07/02', 90000, null, null],
    [1, 4, 'negotiator_call', null, 'پاسخگو بود - تعهد پرداخت ثبت شد', '1404/07/03', 1350000, 'پاسخگو بود', '1404/07/12'],

    // پرونده ۳ — به حقوقی رسیده، تماس‌های متعدد
    [3, 1, 'warning_sms', 'یادآوری بدهی معوق.', 'عدم پرداخت', '1404/06/10', 5000, null, null],
    [3, 2, 'threatening_sms', 'اخطار ارجاع به حقوقی.', 'عدم پرداخت', '1404/06/15', 5000, null, null],
    [3, 3, 'warning_autocall', 'تماس خودکار هشدار.', 'بی‌پاسخ', '1404/06/20', 90000, null, null],
    [3, 4, 'threatening_autocall', 'تماس خودکار تهدید.', 'پاسخ داده شد', '1404/06/24', 90000, null, null],
    [3, 5, 'negotiator_call', null, 'پاسخگو نبود', '1404/06/28', 1350000, 'پاسخگو نبود', '1404/07/02'],

    // پرونده ۴ — فقط پیامک هشدار
    [4, 1, 'warning_sms', 'یادآوری پرداخت قسط معوق.', 'عدم پرداخت', '1404/07/04', 5000, null, null],

    // پرونده ۶ — فقط پیامک هشدار
    [6, 1, 'warning_sms', 'یادآوری بدهی معوق دیجی‌کالا.', 'عدم پرداخت', '1404/07/03', 5000, null, null],
  ];
  for (const a of actions) {
    db.run(
      `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a
    );
  }

  // -------------------- تعهدات پرداخت --------------------
  // case_id, promised_date, amount, status
  const promises = [
    [1, '1404/07/12', 100000000, 'pending'],   // تعهد فعال
    [3, '1404/06/15', 200000000, 'broken'],    // تعهد نقض‌شده
    [3, '1404/06/01', 150000000, 'broken'],    // تعهد نقض‌شده دوم
  ];
  for (const p of promises) {
    db.run(
      `INSERT INTO promises (case_id, promised_date, amount, status) VALUES (?, ?, ?, ?)`,
      p
    );
  }

  // -------------------- فایل‌های پرونده --------------------
  const files = [
    [1, 'تصویر چک - CR-1001.jpg', 'cheque'],
    [1, 'قرارداد تسهیلات.pdf', 'contract'],
    [3, 'سفته - CR-1003.jpg', 'other'],
  ];
  for (const f of files) {
    db.run('INSERT INTO case_files (case_id, name, file_type) VALUES (?, ?, ?)', f);
  }

  persist();
  console.log('[seed] داده نمونه با موفقیت درج و در database.sqlite ذخیره شد.');
}

async function run() {
  await initDatabase();
  seed();
}

run().catch((err) => {
  console.error('[seed] خطا:', err);
  process.exit(1);
});
