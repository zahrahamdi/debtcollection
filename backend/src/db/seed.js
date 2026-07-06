'use strict';

/**
 * Seed داده نمونه فارسی برای دمو.
 * ------------------------------------------------------------------
 * این اسکریپت دیتابیس را مقداردهی کرده، جداول را خالی می‌کند و سپس
 * داده نمونه (کاربران، نقش‌ها، CEI، سگمنت، استراتژی، مذاکره‌کننده) را درج می‌کند.
 * پرونده و بدهکار در seed درج نمی‌شوند — از import Excel یا پنل استفاده کنید.
 *
 * اجرا:  npm run seed
 */

const bcrypt = require('bcryptjs');
const { initDatabase, getDb, persist } = require('./database');
const { DEFAULT_LOAN_PARAMS, DEFAULT_BNPL_PARAMS } = require('./cei');

const PERMISSIONS = [
  ['cases', 'view'], ['cases', 'assign'], ['cases', 'reassign'], ['cases', 'export'],
  ['debtors', 'view'], ['debtors', 'add_phone'],
  ['strategies', 'view'], ['strategies', 'create'], ['strategies', 'edit'], ['strategies', 'delete'],
  ['negotiators', 'view'], ['negotiators', 'create'], ['negotiators', 'edit'],
  ['bulk_operations', 'view'], ['bulk_operations', 'upload'],
  ['admin_panel', 'view'], ['admin_panel', 'edit'],
  ['reports', 'view'],
  ['installments', 'view'],
  ['history', 'view'],
  ['call_outcome', 'create'],
  ['google_sheet_sync', 'execute'],
];

const NEGOTIATOR_PERMISSIONS = [
  ['cases', 'view'], ['cases', 'assign'],
  ['debtors', 'view'], ['debtors', 'add_phone'],
  ['installments', 'view'],
  ['history', 'view'],
  ['call_outcome', 'create'],
];

function seedAuth(db) {
  db.run(`INSERT INTO roles (name, description) VALUES ('admin', 'مدیر وصول مطالبات')`);
  db.run(`INSERT INTO roles (name, description) VALUES ('negotiator', 'مذاکره‌کننده')`);

  for (const [resource, action] of PERMISSIONS) {
    db.run('INSERT INTO permissions (resource, action) VALUES (?, ?)', [resource, action]);
  }

  const adminRoleId = 1;
  const negotiatorRoleId = 2;
  const permRows = db.exec('SELECT id, resource, action FROM permissions')[0];
  if (permRows) {
    for (const row of permRows.values) {
      db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
        adminRoleId,
        row[0],
      ]);
    }
    for (const [resource, action] of NEGOTIATOR_PERMISSIONS) {
      const pid = permRows.values.find((r) => r[1] === resource && r[2] === action)?.[0];
      if (pid) {
        db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
          negotiatorRoleId,
          pid,
        ]);
      }
    }
  }

  const passwordHash = bcrypt.hashSync('Admin@1234', 10);
  db.run(
    `INSERT INTO users (first_name, last_name, username, email, password_hash, is_super_admin)
     VALUES (?, ?, ?, ?, ?, 1)`,
    ['زهرا', 'حمیدی', 'zahra.hamdi', 'zahra@digipay.ir', passwordHash]
  );
  db.run('INSERT INTO user_roles (user_id, role_id) VALUES (1, 1)');
  return 1;
}

function seed() {
  const db = getDb();

  // پاک‌سازی جداول (ترتیب به دلیل foreign key مهم است)
  db.run(`
    DELETE FROM cei_formulas;
    DELETE FROM case_files;
    DELETE FROM promises;
    DELETE FROM case_events;
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
    DELETE FROM role_permissions;
    DELETE FROM user_roles;
    DELETE FROM permissions;
    DELETE FROM roles;
    DELETE FROM users;
    DELETE FROM settings;
    DELETE FROM sqlite_sequence;
  `);

  const adminUserId = seedAuth(db);

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
    // user_id, name, status, cooperation_type, capacity, hourly_wage(ریال)
    [adminUserId, 'زهرا حمیدی', 'active', 'internal', 50, 1500000],
    [null, 'علی رضایی', 'active', 'internal', 40, 1300000],
    [null, 'سارا محمدی', 'active', 'outsourced', 30, 1100000],
  ];
  for (const n of negotiators) {
    db.run(
      `INSERT INTO negotiators (user_id, name, status, cooperation_type, capacity, hourly_wage)
       VALUES (?, ?, ?, ?, ?, ?)`,
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

  persist();
  console.log('[seed] داده پایه درج شد (بدون پرونده/بدهکار).');
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
