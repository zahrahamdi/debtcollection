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
const { formatDatetime, calcActionStatus, gregorianToJalali, formatJalali } = require('./dateUtil');

/** تاریخ/ساعت n روز قبل — برای next_action_date معوق */
function daysAgoDatetime(days, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return formatDatetime(d);
}

/** امروز ساعت گذشته — برای next_action_date نوبت امروز */
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
  // strategy_id, seq, action_type, body_text, allowed_from, allowed_to,
  // wait_next_minutes, wait_repeat_minutes, cost, max_repeat, avg_call_duration
  const defaultRepeatOnResults = (actionType) => {
    if (actionType === 'warning_sms' || actionType === 'threatening_sms') {
      return '["ارسال نشد"]';
    }
    if (actionType === 'warning_autocall' || actionType === 'threatening_autocall') {
      return '["پاسخگو نبود","اشغال بود"]';
    }
    if (actionType === 'negotiator_call') return '["پاسخگو نبود"]';
    return '[]';
  };
  const strategyActions = [
    // استراتژی سبک وام (id 1) — wait_next_minutes: ۳ روز = ۴۳۲۰ دقیقه
    [1, 1, 'warning_sms', 'بدهکار گرامی، قسط معوق شما سررسید شده است. لطفاً نسبت به پرداخت اقدام کنید. {لینک_پرداخت}', '09:00', '18:00', 4320, 60, 5000, 3, null],
    [1, 2, 'warning_autocall', 'تماس خودکار: یادآوری پرداخت بدهی معوق دیجی‌پی.', '10:00', '17:00', 4320, 60, 90000, 3, null],
    [1, 3, 'negotiator_call', null, '09:00', '20:00', 2880, 60, 0, 3, 5],
    // استراتژی متوسط وام (id 2)
    [2, 1, 'warning_sms', '{نام_کاربر} عزیز، مبلغ {مبلغ_مطالبات} ریال بدهی معوق دارید.', '09:00', '18:00', 2880, 60, 5000, 3, null],
    [2, 2, 'threatening_sms', 'در صورت عدم پرداخت، پرونده به حقوقی ارجاع می‌شود. {لینک_پرداخت}', '09:00', '18:00', 2880, 60, 5000, 3, null],
    [2, 3, 'negotiator_call', null, '09:00', '20:00', 4320, 60, 0, 5, 7],
    // استراتژی سنگین وام (id 3)
    [3, 1, 'threatening_sms', 'اخطار نهایی پرداخت بدهی معوق. {لینک_پرداخت}', '08:00', '20:00', 1440, 60, 5000, 3, null],
    [3, 2, 'threatening_autocall', 'تماس خودکار تهدید: اخطار ارجاع به حقوقی.', '09:00', '18:00', 2880, 60, 90000, 3, null],
    [3, 3, 'negotiator_call', null, '08:00', '21:00', 2880, 60, 0, 5, 10],
    // استراتژی سبک BNPL (id 4)
    [4, 1, 'threatening_sms', 'یادآوری بدهی معوق BNPL. {لینک_پرداخت}', '09:00', '18:00', 2880, 60, 5000, 3, null],
    [4, 2, 'negotiator_call', null, '09:00', '20:00', 4320, 60, 0, 5, 5],
    // استراتژی سنگین BNPL (id 5)
    [5, 1, 'threatening_sms', 'اخطار پرداخت بدهی BNPL. {لینک_پرداخت}', '08:00', '20:00', 1440, 60, 5000, 3, null],
    [5, 2, 'negotiator_call', null, '09:00', '20:00', 2880, 60, 0, 5, 7],
  ];
  for (const a of strategyActions) {
    db.run(
      `INSERT INTO strategy_actions
        (strategy_id, seq, action_type, body_text, allowed_from, allowed_to,
         wait_next_minutes, wait_repeat_minutes, cost, max_repeat, repeat_on_results, avg_call_duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...a, defaultRepeatOnResults(a[2])]
    );
  }

  // -------------------- بدهکاران --------------------
  const debtors = [
    ['محمد', 'احمدی', '0012345678', 'male', '09121110011', 'تهران', 'تهران', 'B'],
    ['فاطمه', 'کریمی', '0023456789', 'female', '09122220022', 'اصفهان', 'اصفهان', 'A'],
    ['رضا', 'حسینی', '0034567890', 'male', '09123330033', 'فارس', 'شیراز', 'C'],
    ['مریم', 'نوری', '0045678901', 'female', '09124440044', 'خراسان رضوی', 'مشهد', 'B'],
    ['حسین', 'موسوی', '0056789012', 'male', '09125550055', 'آذربایجان شرقی', 'تبریز', 'A'],
    ['امیر', 'راد', '0067890123', 'male', '09126660066', 'گیلان', 'رشت', 'C'],
    ['داریوش', 'نیکزاد', '0078901234', 'male', '09127770077', 'تهران', 'تهران', 'B'],
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
    [1, '09121110011', 'digipay'],
    [2, '09122220022', 'digikala'],
    [3, '09123330033', 'inquiry'],
    [4, '09124440044', 'digipay'],
    [5, '09125550055', 'digipay'],
    [6, '09126660066', 'digipay'],
    [7, '09127770077', 'digipay'],
  ];
  for (const p of phones) {
    db.run('INSERT INTO phone_numbers (debtor_id, phone, source) VALUES (?, ?, ?)', p);
  }

  // -------------------- آدرس‌ها --------------------
  const addresses = [
    [1, 'تهران، خیابان ولیعصر، کوچه بهار، پلاک ۱۲', '1234567890', 'digipay'],
    [2, 'اصفهان، خیابان چهارباغ، پلاک ۴۵', '8134567890', 'digikala'],
    [3, 'شیراز، بلوار زند، پلاک ۷', '7134567890', 'manual'],
    [4, 'مشهد، بلوار وکیل‌آباد، پلاک ۲۲', '9134567890', 'digipay'],
    [5, 'تبریز، خیابان امام، پلاک ۸', '5134567890', 'digipay'],
    [6, 'رشت، میدان شهرداری، پلاک ۳', '4134567890', 'manual'],
    [7, 'تهران، سعادت‌آباد، بلوار پاکنژاد، پلاک ۵۵', '1998765432', 'digipay'],
  ];
  for (const a of addresses) {
    db.run(
      'INSERT INTO addresses (debtor_id, address, postal_code, source) VALUES (?, ?, ?, ?)',
      a
    );
  }

  // -------------------- پرونده‌ها --------------------
  const dueToday = dueTodayDatetime();
  const overdue2d = daysAgoDatetime(2);
  const overdue5d = daysAgoDatetime(5);

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
    [1, 'CR-2001', 'loan', 'بانک تجارت', 'cheque', 'معوق', 78,
      500000000, 285000000, 285000000, 15000000,
      1, 'in_negotiation', 'تخصیص به مذاکره‌کننده', jalaliDaysAgo(2),
      'تماس مذاکره‌کننده', dueToday, calcActionStatus(dueToday),
      38.2, 'v1', 2, 2, 95000, 0, 5,
      4, jalaliDaysAgo(90), 7, jalaliDaysAgo(30), 12, 3, jalaliDaysAgo(120), 35000000, null],

    [2, 'CR-2002', 'bnpl', 'دیجی‌کالا', 'none', 'مشکوک‌الوصول', 92,
      85000000, 62000000, 62000000, 3200000,
      2, 'in_negotiation', 'تخصیص به مذاکره‌کننده', jalaliDaysAgo(1),
      'تماس مذاکره‌کننده', dueToday, calcActionStatus(dueToday),
      55.0, 'v1', 5, 5, 50000, 0, 5,
      2, jalaliDaysAgo(60), 3, jalaliDaysAgo(15), 4, 2, null, null, null],

    [3, 'CR-2003', 'loan', 'بانک ملت', 'promissory_note', 'مشکوک‌الوصول', 115,
      750000000, 610000000, 610000000, 42000000,
      1, 'in_negotiation', 'تخصیص به مذاکره‌کننده', jalaliDaysAgo(4),
      'تماس مذاکره‌کننده', overdue2d, calcActionStatus(overdue2d),
      72.8, 'v1', 3, 3, 185000, 0, 5,
      6, jalaliDaysAgo(150), 10, jalaliDaysAgo(45), 18, 5, jalaliDaysAgo(180), 45000000, null],

    [4, 'CR-2004', 'bnpl', 'دیجی‌کالا', 'none', 'معوق', 88,
      95000000, 78000000, 78000000, 5100000,
      3, 'in_negotiation', 'تخصیص به مذاکره‌کننده', jalaliDaysAgo(3),
      'تماس مذاکره‌کننده', overdue5d, calcActionStatus(overdue5d),
      61.4, 'v1', 5, 5, 95000, 0, 5,
      1, jalaliDaysAgo(75), 4, jalaliDaysAgo(20), 4, 3, jalaliDaysAgo(100), 12000000, null],

    [5, 'CR-2005', 'loan', 'بانک ملت', 'cheque', 'تسویه شده', 0,
      420000000, 0, 0, 0,
      null, 'paid', 'ثبت پرداخت کامل', jalaliDaysAgo(10),
      null, null, 'waiting',
      44.0, 'v1', 2, 2, 1890000, 3, 5,
      null, null, null, null, 10, 0, jalaliDaysAgo(10), 420000000, null],

    [6, 'CR-2006', 'loan', 'بانک تجارت', 'cheque', 'مشکوک‌الوصول', 130,
      380000000, 340000000, 340000000, 28000000,
      2, 'burned', 'تماس مذاکره‌کننده', jalaliDaysAgo(7),
      null, null, 'waiting',
      68.5, 'v1', 3, null, 2740000, 2, 5,
      5, jalaliDaysAgo(200), 9, jalaliDaysAgo(60), 12, 4, jalaliDaysAgo(150), 30000000, null],

    // CR-3001 — تست افزایش مطالبات / تغییر CEI (وام سبک → متوسط، در انتظار نتیجه تماس خودکار)
    [7, 'CR-3001', 'loan', 'بانک ملت', 'none', 'معوق', 65,
      200000000, 50000000, 50000000, 2500000,
      null, 'pending_autocall_result', 'تماس خودکار هشدار', jalaliDaysAgo(0),
      'تماس مذاکره‌کننده', dueToday, calcActionStatus(dueToday),
      29.6, 'v1', 1, 1, 95000, 0, 5,
      3, jalaliDaysAgo(90), 5, jalaliDaysAgo(30), 10, 3, jalaliDaysAgo(120), 15000000, null],
  ];
  for (const c of cases) {
    const placeholders = caseColumns.map(() => '?').join(', ');
    db.run(`INSERT INTO cases (${caseColumns.join(', ')}) VALUES (${placeholders})`, c);
  }

  // -------------------- اقساط --------------------
  const installments = [
    [1, 4, jalaliDaysAgo(90), 38000000, 1800000, 500000, 'سررسید گذشته', 'unpaid', null],
    [1, 5, jalaliDaysAgo(60), 38000000, 1200000, 500000, 'سررسید گذشته', 'unpaid', null],
    [1, 6, jalaliDaysAgo(30), 38000000, 600000, 500000, 'سررسید گذشته', 'unpaid', null],
    [2, 2, jalaliDaysAgo(60), 18000000, 900000, 0, 'سررسید گذشته', 'unpaid', null],
    [2, 3, jalaliDaysAgo(15), 18000000, 400000, 0, 'سررسید گذشته', 'unpaid', null],
    [3, 6, jalaliDaysAgo(150), 72000000, 6000000, 800000, 'سررسید گذشته', 'unpaid', null],
    [3, 7, jalaliDaysAgo(90), 72000000, 4500000, 800000, 'سررسید گذشته', 'unpaid', null],
    [4, 1, jalaliDaysAgo(75), 22000000, 1100000, 0, 'سررسید گذشته', 'unpaid', null],
    [4, 2, jalaliDaysAgo(45), 22000000, 800000, 0, 'سررسید گذشته', 'unpaid', null],
    [6, 5, jalaliDaysAgo(200), 35000000, 5000000, 500000, 'سررسید گذشته', 'unpaid', null],
    [7, 3, jalaliDaysAgo(90), 20000000, 1000000, 300000, 'سررسید گذشته', 'unpaid', null],
    [7, 4, jalaliDaysAgo(60), 20000000, 800000, 300000, 'سررسید گذشته', 'unpaid', null],
    [7, 5, jalaliDaysAgo(30), 20000000, 500000, 300000, 'سررسید گذشته', 'unpaid', null],
  ];
  for (const ins of installments) {
    db.run(
      `INSERT INTO installments (
        case_id, installment_number, due_date, amount, penalty_balance, fee, status, payment_status, payment_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ins
    );
  }

  db.run(
    `INSERT INTO payments (case_id, amount, payment_date, payment_type) VALUES (?, ?, ?, ?)`,
    [5, 420000000, jalaliDaysAgo(10), 'full']
  );

  const histories = [
    [1, 1, 'سیستم', 'ایجاد پرونده', 'pending_cei', 'محاسبه CEI', null, 'پرونده از طریق Excel ایجاد شد'],
    [1, 1, 'زهرا حمیدی', 'تخصیص به مذاکره‌کننده', 'pending_negotiator_call', 'تماس مذاکره‌کننده', dueToday, 'مذاکره‌کننده: زهرا حمیدی'],
    [2, 2, 'علی رضایی', 'تخصیص به مذاکره‌کننده', 'pending_negotiator_call', 'تماس مذاکره‌کننده', dueToday, 'مذاکره‌کننده: علی رضایی'],
    [3, 3, 'زهرا حمیدی', 'تخصیص به مذاکره‌کننده', 'pending_negotiator_call', 'تماس مذاکره‌کننده', overdue2d, 'مذاکره‌کننده: زهرا حمیدی'],
    [4, 4, 'سارا محمدی', 'تخصیص به مذاکره‌کننده', 'pending_negotiator_call', 'تماس مذاکره‌کننده', overdue5d, 'مذاکره‌کننده: سارا محمدی'],
    [5, 5, 'سیستم', 'ثبت پرداخت کامل', 'paid', null, null, 'تسویه کامل بدهی — ۴۲۰٬۰۰۰٬۰۰۰ ریال'],
    [6, 6, 'علی رضایی', 'ثبت خروجی تماس', 'in_negotiation', 'تماس مذاکره‌کننده', null, 'دلیل عدم پرداخت: فوت کاربر'],
    [6, 6, 'علی رضایی', 'سوخت پرونده — فوت کاربر', 'burned', null, null, 'پرونده به دلیل فوت کاربر سوخت شد و استراتژی متوقف گردید.'],
    [7, 7, 'سیستم', 'ایجاد پرونده', 'pending_cei', 'محاسبه CEI', null, 'پرونده تست افزایش مطالبات'],
    [7, 7, 'سیستم', 'تخصیص استراتژی', 'pending_strategy_start', 'پیامک هشدار', null, 'استراتژی سبک وام'],
    [7, 7, 'سیستم', 'اجرای تماس خودکار', 'pending_autocall_result', 'تماس مذاکره‌کننده', dueToday, 'نتیجه: پاسخگو نبود'],
  ];
  for (const h of histories) {
    db.run(
      `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      h
    );
  }

  const sms1 = 'بدهکار گرامی، قسط معوق شما سررسید شده است. لطفاً نسبت به پرداخت اقدام کنید.';
  const sms2 = 'بدهی معوق شما در دیجی‌پی سررسید شده است.';
  const sms3 = 'اخطار نهایی پرداخت بدهی معوق. در صورت عدم پرداخت پرونده به حقوقی ارجاع می‌شود.';
  const autocall = 'تماس خودکار: یادآوری پرداخت بدهی معوق دیجی‌پی.';

  const actions = [
    [1, 1, 'warning_sms', sms2, 'عدم پرداخت', jalaliDaysAgo(14), 5000, null, null],
    [1, 2, 'threatening_sms', sms3, 'عدم پرداخت', jalaliDaysAgo(10), 5000, null, null],
    [1, 3, 'warning_autocall', autocall, 'پاسخگو نبود', jalaliDaysAgo(5), 90000, null, null],
    [1, 4, 'negotiator_call', null, null, jalaliDaysAgo(2), 0, null, null],

    [2, 1, 'threatening_sms', 'یادآوری بدهی معوق BNPL دیجی‌کالا.', 'عدم پرداخت', jalaliDaysAgo(12), 5000, null, null],
    [2, 2, 'negotiator_call', null, null, jalaliDaysAgo(1), 0, null, null],

    [3, 1, 'threatening_sms', sms3, 'عدم پرداخت', jalaliDaysAgo(20), 5000, null, null],
    [3, 2, 'threatening_autocall', 'تماس خودکار تهدید: اخطار ارجاع به حقوقی.', 'پاسخگو نبود', jalaliDaysAgo(12), 90000, null, null],
    [3, 3, 'negotiator_call', null, null, jalaliDaysAgo(4), 0, null, null],

    [4, 1, 'threatening_sms', 'اخطار پرداخت بدهی BNPL.', 'عدم پرداخت', jalaliDaysAgo(15), 5000, null, null],
    [4, 2, 'negotiator_call', null, null, jalaliDaysAgo(3), 0, null, null],

    [5, 1, 'warning_sms', sms1, 'عدم پرداخت', jalaliDaysAgo(45), 5000, null, null],
    [5, 2, 'warning_autocall', autocall, 'پاسخ داده شد', jalaliDaysAgo(30), 90000, null, null],
    [5, 3, 'negotiator_call', null, 'تعهد پرداخت — انجام شد', jalaliDaysAgo(15), 1750000, 'پاسخگو بود', jalaliDaysAgo(10)],

    [6, 1, 'warning_sms', sms1, 'عدم پرداخت', jalaliDaysAgo(30), 5000, null, null],
    [6, 2, 'threatening_autocall', autocall, 'پاسخگو نبود', jalaliDaysAgo(20), 90000, null, null],
    [6, 3, 'negotiator_call', null, 'فوت کاربر', jalaliDaysAgo(7), 1750000, 'پاسخگو بود', null],
    [6, 4, 'negotiator_call', null, 'فوت کاربر — تأیید شده', jalaliDaysAgo(7), 1750000, 'پاسخگو بود', null],

    [7, 1, 'warning_sms', sms1, 'عدم پرداخت', jalaliDaysAgo(5), 5000, null, null],
    [7, 2, 'warning_autocall', autocall, 'پاسخگو نبود', jalaliDaysAgo(0), 90000, null, null],
  ];
  for (const a of actions) {
    db.run(
      `INSERT INTO case_actions (case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a
    );
  }

  // -------------------- تعهدات پرداخت --------------------
  const promises = [
    [5, jalaliDaysAgo(12), 420000000, 'fulfilled'],
  ];
  for (const p of promises) {
    db.run(
      `INSERT INTO promises (case_id, promised_date, amount, status) VALUES (?, ?, ?, ?)`,
      p
    );
  }

  // -------------------- فایل‌های پرونده --------------------
  const files = [
    [1, 'تصویر چک - CR-2001.jpg', 'cheque'],
    [1, 'قرارداد تسهیلات.pdf', 'contract'],
    [3, 'سفته - CR-2003.jpg', 'other'],
    [5, 'رسید پرداخت - CR-2005.pdf', 'other'],
  ];
  for (const f of files) {
    db.run('INSERT INTO case_files (case_id, name, file_type) VALUES (?, ?, ?)', f);
  }

  persist();
  console.log('[seed] ۷ پرونده ماک درج شد:');
  console.log('  • ۴ پرونده in_negotiation (۲ نوبت امروز، ۲ معوق)');
  console.log('  • ۱ پرونده paid (CR-2005)');
  console.log('  • ۱ پرونده burned (CR-2006)');
  console.log('  • ۱ پرونده تست CEI (CR-3001 — pending_autocall_result، وام سبک)');
  console.log('[seed] داده در database.sqlite ذخیره شد.');
}

async function run() {
  await initDatabase();
  seed();
}

run().catch((err) => {
  console.error('[seed] خطا:', err);
  process.exit(1);
});
