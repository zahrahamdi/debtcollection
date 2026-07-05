-- =====================================================================
-- DigiPay Debt Collection — Database Schema (Demo Skeleton)
-- بر اساس PRD-DigiPay. در این مرحله فقط جداول اصلی مورد نیاز دمو تعریف
-- شده‌اند. منطق‌های پیچیده (CEI، استراتژی، آپلود Excel، پرداخت) بعداً
-- اضافه می‌شوند؛ اما ستون‌های لازم برای آن‌ها از همین ابتدا در نظر گرفته شده.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- احراز هویت و سطوح دسترسی (RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT    NOT NULL,
  last_name     TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     INTEGER NOT NULL,
  role_id     INTEGER NOT NULL,
  assigned_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource    TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  description TEXT,
  UNIQUE(resource, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

-- ---------------------------------------------------------------------
-- مذاکره‌کنندگان (Negotiators)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS negotiators (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER REFERENCES users(id),
  name             TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active',      -- active | inactive
  cooperation_type TEXT    NOT NULL DEFAULT 'internal',    -- internal | outsourced
  capacity         INTEGER NOT NULL DEFAULT 0,             -- ظرفیت کاری
  hourly_wage      INTEGER NOT NULL DEFAULT 0,             -- حقوق ساعتی (ریال)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- بدهکاران (Debtors)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS debtors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  national_code TEXT NOT NULL UNIQUE,                      -- کد ملی
  gender        TEXT,                                      -- male | female
  mobile        TEXT,                                      -- شماره موبایل اصلی
  province      TEXT,                                      -- استان محل سکونت
  city          TEXT,                                      -- شهر محل سکونت
  customer_rank TEXT,                                      -- رتبه مشتری (منبع بعداً مشخص می‌شود)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- شماره‌های تماس بدهکار (با منبع)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phone_numbers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  debtor_id  INTEGER NOT NULL,
  phone      TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'manual',            -- digipay | digikala | inquiry | manual
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (debtor_id) REFERENCES debtors(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- آدرس‌های بدهکار (با منبع)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  debtor_id   INTEGER NOT NULL,
  address     TEXT    NOT NULL,
  postal_code TEXT,
  source      TEXT    NOT NULL DEFAULT 'manual',           -- digipay | digikala | inquiry | manual
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (debtor_id) REFERENCES debtors(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- سگمنت‌ها (Segments) — بر اساس شرط CEI (Story 11.3 PRD)
-- شرط می‌تواند یکی از این پنج حالت باشد:
--   between (بین x و y) | lt (کمتر از x) | lte (کمتر مساوی x)
--   gt (بیشتر از x) | gte (بیشتر مساوی x)
-- ---------------------------------------------------------------------
-- قرارداد مرز: «between» یعنی X ≤ CEI < Y (سر پایین شامل، سر بالا غیرشامل)
CREATE TABLE IF NOT EXISTS segments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  credit_type    TEXT    NOT NULL DEFAULT 'loan',          -- loan | bnpl
  condition_type TEXT    NOT NULL DEFAULT 'between',       -- between | lt | lte | gt | gte
  cei_x          REAL,                                     -- مقدار اول شرط
  cei_y          REAL,                                     -- مقدار دوم (فقط برای between)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- استراتژی‌ها (Strategies)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  credit_type TEXT    NOT NULL DEFAULT 'loan',             -- loan | bnpl
  segment_id  INTEGER,
  created_by  TEXT,                                        -- ایجادکننده
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- اکشن‌های استراتژی (Story 12.2 PRD) — به ترتیب اجرا (seq)
-- انواع: warning_sms | threatening_sms | warning_autocall | threatening_autocall | negotiator_call
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_actions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id        INTEGER NOT NULL,
  seq                INTEGER NOT NULL DEFAULT 0,           -- ترتیب اجرا
  action_type        TEXT    NOT NULL,
  body_text          TEXT,                                 -- متن پیامک یا محتوای تماس (SMS/Autocall)
  allowed_from       TEXT,                                 -- شروع بازه زمانی مجاز (HH:MM)
  allowed_to         TEXT,                                 -- پایان بازه زمانی مجاز (HH:MM)
  wait_next_minutes  INTEGER NOT NULL DEFAULT 0,           -- فاصله قبل از اکشن بعدی (دقیقه)
  wait_repeat_minutes INTEGER NOT NULL DEFAULT 60,         -- فاصله بین تکرار همان اکشن (دقیقه)
  cost               INTEGER NOT NULL DEFAULT 0,           -- هزینه هر پیامک/تماس (برای تماس مذاکره‌کننده محاسبه‌شونده)
  max_repeat         INTEGER NOT NULL DEFAULT 3,           -- حداکثر تکرار همان اکشن (برای همه انواع اکشن)
  repeat_on_results  TEXT,                                 -- JSON array — نتایجی که باعث تکرار همان اقدام می‌شوند
  avg_call_duration  INTEGER,                              -- میانگین مدت تماس به دقیقه (فقط Negotiator Call)
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_actions ON strategy_actions(strategy_id, seq);

-- ---------------------------------------------------------------------
-- سناریوهای A/B Test (Story 12.3 PRD)
-- دو استراتژی در یک سگمنت با نرخ توزیع که مجموعشان باید ۱۰۰٪ باشد.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ab_tests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  credit_type   TEXT    NOT NULL DEFAULT 'loan',
  segment_id    INTEGER,
  strategy_a_id INTEGER NOT NULL,
  ratio_a       INTEGER NOT NULL DEFAULT 50,
  strategy_b_id INTEGER NOT NULL,
  ratio_b       INTEGER NOT NULL DEFAULT 50,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (segment_id)    REFERENCES segments(id)   ON DELETE SET NULL,
  FOREIGN KEY (strategy_a_id) REFERENCES strategies(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_b_id) REFERENCES strategies(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- پرونده‌ها (Cases)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  debtor_id          INTEGER NOT NULL,
  credit_id          TEXT    NOT NULL,                     -- شناسه اعتبار
  credit_type        TEXT    NOT NULL DEFAULT 'loan',      -- loan | single_installment | four_installment | bnpl
  supplier           TEXT,                                 -- تامین‌کننده
  guarantee_type     TEXT,                                 -- none | promissory_note | cheque
  debt_class         TEXT,                                 -- کلاس بدهی
  dpd                INTEGER NOT NULL DEFAULT 0,           -- روزهای دیرکرد
  credit_amount      INTEGER NOT NULL DEFAULT 0,           -- مبلغ اعتبار (ریال)
  outstanding_debt   INTEGER NOT NULL DEFAULT 0,           -- بدهی غیرجاری پرداخت‌نشده
  claims_amount      INTEGER NOT NULL DEFAULT 0,           -- مطالبات (مبلغ کل غیرجاری)
  penalty_amount     INTEGER NOT NULL DEFAULT 0,           -- جریمه انباشته

  assigned_negotiator_id INTEGER,                          -- مسئول پرونده
  case_status        TEXT    NOT NULL DEFAULT 'pending_cei',-- وضعیت پرونده (به جدول وضعیت‌ها رجوع شود)
  last_action        TEXT,                                 -- آخرین اقدام انجام‌شده
  last_action_date   TEXT,
  next_action        TEXT,                                 -- اقدام بعدی
  next_action_date   TEXT,                                 -- تاریخ اقدام بعدی (شمسی)
  action_status      TEXT    NOT NULL DEFAULT 'waiting',   -- waiting | due_today | overdue

  cei                REAL,                                 -- CEI نهایی (محاسبه‌شده + cei_boost)
  cei_boost          REAL    NOT NULL DEFAULT 0,           -- مجموع افزایش CEI از شکست استراتژی
  cei_formula_version TEXT,                                -- نسخه فرمول CEI استفاده‌شده
  segment_id         INTEGER,
  strategy_id        INTEGER,
  case_cost          INTEGER NOT NULL DEFAULT 0,           -- هزینه پرونده (مجموع هزینه اکشن‌ها)

  call_count         INTEGER NOT NULL DEFAULT 0,           -- تعداد تماس‌های انجام‌شده
  max_call_count     INTEGER,                              -- حداکثر تماس مجاز (= max_repeat اکشن مذاکره)
  current_action_seq INTEGER NOT NULL DEFAULT 0,           -- seq اکشن استراتژی در حال اجرا
  current_action_repeat INTEGER NOT NULL DEFAULT 0,        -- تعداد تلاش‌های انجام‌شده روی اکشن جاری
  previous_case_id   INTEGER,                              -- لینک به پرونده قبلی (پرداخت‌شده)

  -- خلاصه اقساط (از فایل Excel/Sheet — بخش ۴ PRD)
  first_unpaid_no    INTEGER,                              -- شماره اولین قسط پرداخت‌نشده
  first_unpaid_date  TEXT,                                 -- تاریخ سررسید اولین قسط پرداخت‌نشده
  last_unpaid_no     INTEGER,                              -- شماره آخرین قسط پرداخت‌نشده
  last_unpaid_date   TEXT,                                 -- تاریخ سررسید آخرین قسط پرداخت‌نشده
  total_installments INTEGER,                              -- تعداد کل اقساط
  overdue_installments_count INTEGER,                      -- تعداد اقساط سررسید گذشته
  last_payment_date  TEXT,                                 -- تاریخ آخرین پرداخت
  last_payment_amount INTEGER,                             -- مبلغ آخرین پرداخت

  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (debtor_id)              REFERENCES debtors(id)     ON DELETE CASCADE,
  FOREIGN KEY (assigned_negotiator_id) REFERENCES negotiators(id) ON DELETE SET NULL,
  FOREIGN KEY (segment_id)             REFERENCES segments(id)    ON DELETE SET NULL,
  FOREIGN KEY (strategy_id)            REFERENCES strategies(id)  ON DELETE SET NULL,
  FOREIGN KEY (previous_case_id)       REFERENCES cases(id)       ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- اقساط (Installments)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS installments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id            INTEGER NOT NULL,
  installment_number INTEGER NOT NULL,                     -- شماره قسط
  due_date           TEXT,                                 -- تاریخ سررسید (شمسی)
  amount             INTEGER NOT NULL DEFAULT 0,           -- مبلغ قسط
  penalty_balance    INTEGER NOT NULL DEFAULT 0,           -- مانده جریمه قابل پرداخت
  fee                INTEGER NOT NULL DEFAULT 0,           -- کارمزد
  status             TEXT,                                 -- وضعیت قسط
  payment_status     TEXT    NOT NULL DEFAULT 'unpaid',    -- unpaid | paid
  payment_date       TEXT,                                 -- تاریخ پرداخت
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- پرداخت‌ها (Payments)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL,
  amount       INTEGER NOT NULL DEFAULT 0,
  payment_date TEXT,                                       -- تاریخ پرداخت (شمسی)
  payment_type TEXT    NOT NULL DEFAULT 'partial',         -- full | partial
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- تاریخچه تغییرات پرونده (Audit Trail)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id          INTEGER NOT NULL,
  debtor_id        INTEGER,
  user_name        TEXT,                                   -- نام کاربر انجام‌دهنده (یا «سیستم»)
  operation        TEXT    NOT NULL,                       -- نام عملیات
  case_status      TEXT,                                   -- وضعیت پرونده در آن لحظه
  next_action      TEXT,
  next_action_date TEXT,
  details          TEXT,                                   -- جزئیات (JSON یا متن)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE CASCADE,
  FOREIGN KEY (debtor_id) REFERENCES debtors(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- سابقه اقدامات اجراشده روی پرونده (Action History — بخش ۳.۲ PRD)
-- ترتیب اجرا در استراتژی با ستون seq نگه داشته می‌شود.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL,
  seq         INTEGER NOT NULL DEFAULT 0,                  -- ترتیب اجرا
  action_type TEXT    NOT NULL,                            -- warning_sms | threatening_sms | warning_autocall | threatening_autocall | negotiator_call
  body_text   TEXT,                                        -- متن پیامک یا متن تماس
  result      TEXT,                                        -- نتیجه اقدام
  action_date TEXT,                                        -- تاریخ انجام
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),  -- زمان ثبت (برای resolve last_action)
  cost        INTEGER NOT NULL DEFAULT 0,                  -- هزینه اکشن
  repeat_count INTEGER NOT NULL DEFAULT 0,                 -- تعداد تکرار این اکشن تا این تلاش
  -- فیلدهای خروجی تماس مذاکره‌کننده (در صورت وجود)
  call_status TEXT,                                        -- پاسخگو بود / پاسخگو نبود / ناسزا گفت
  next_call_date TEXT,                                     -- زمان تماس بعدی
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- تعهدات پرداخت (Promise to Pay — بخش ۵.۸ PRD)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL,
  promised_datetime TEXT,                                  -- تاریخ و ساعت سررسید (YYYY/MM/DD HH:mm)
  amount       INTEGER NOT NULL DEFAULT 0,                 -- مبلغ تعهد
  status       TEXT    NOT NULL DEFAULT 'pending',         -- pending | fulfilled | broken
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- فایل‌های پرونده (تصویر چک، قرارداد و سایر مستندات)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,                             -- نام نمایشی فایل
  file_type  TEXT,                                         -- cheque | contract | other
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- تنظیمات عمومی (Settings) — key/value
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------------
-- تاریخچه تغییرات تنظیمات (بخش ۱۱.۱ و ۱۱.۴ PRD)
-- برای هر تغییر: مقدار قبلی، مقدار جدید و نام کاربر نگهداری می‌شود.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  user_name  TEXT,
  changed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- نسخه‌های فرمول CEI (Story 11.2 و بخش ۵.۲/۵.۳ PRD)
-- هر نوع اعتبار (وام/BNPL) فرمول و نسخه‌بندی مستقل دارد. با هر ذخیره نسخه
-- جدید ساخته و نسخه قبلی غیرفعال می‌شود، اما در تاریخچه باقی می‌ماند.
-- params به صورت JSON نگهداری می‌شود.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cei_formulas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_type TEXT    NOT NULL,                          -- loan | bnpl
  version     INTEGER NOT NULL,
  params      TEXT    NOT NULL,                          -- JSON پارامترها
  is_active   INTEGER NOT NULL DEFAULT 1,
  change_note TEXT,                                      -- تغییرات نسبت به نسخه قبل
  user_name   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cei_formulas_type ON cei_formulas(credit_type, is_active);

-- ---------------------------------------------------------------------
-- عملیات گروهی (Bulk Operations — Story 10.1 PRD)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_operations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name      TEXT    NOT NULL,
  operation_type TEXT    NOT NULL,                         -- upload_cases | upload_payments | bulk_assign | bulk_reassign
  total_count    INTEGER NOT NULL DEFAULT 0,
  success_count  INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'processing',  -- processing | success | partial | failed
  error_report   TEXT,                                   -- JSON: { errors: [...], error_rows: [...] }
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bulk_ops_user ON bulk_operations(user_name, created_at);

-- ---------------------------------------------------------------------
-- ایندکس‌ها
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cases_debtor       ON cases(debtor_id);
CREATE INDEX IF NOT EXISTS idx_cases_status        ON cases(case_status);
CREATE INDEX IF NOT EXISTS idx_cases_negotiator    ON cases(assigned_negotiator_id);
CREATE INDEX IF NOT EXISTS idx_phones_debtor       ON phone_numbers(debtor_id);
CREATE INDEX IF NOT EXISTS idx_addresses_debtor    ON addresses(debtor_id);
CREATE INDEX IF NOT EXISTS idx_installments_case   ON installments(case_id);
CREATE INDEX IF NOT EXISTS idx_payments_case       ON payments(case_id);
CREATE INDEX IF NOT EXISTS idx_history_case        ON case_history(case_id);
CREATE INDEX IF NOT EXISTS idx_actions_case        ON case_actions(case_id);
CREATE INDEX IF NOT EXISTS idx_promises_case       ON promises(case_id);
CREATE INDEX IF NOT EXISTS idx_files_case          ON case_files(case_id);
