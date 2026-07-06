'use strict';

/**
 * لایه اتصال دیتابیس با sql.js
 * ------------------------------------------------------------------
 * چون نصب better-sqlite3 روی ویندوز با خطا مواجه شد، برای نسخه دمو از
 * sql.js (SQLite کامپایل‌شده به WebAssembly) استفاده می‌کنیم.
 *
 * رفتار:
 *   - در شروع برنامه، اگر فایل database.sqlite وجود داشت آن را load می‌کنیم.
 *   - اگر وجود نداشت، دیتابیس جدید می‌سازیم و schema.sql را اجرا می‌کنیم.
 *   - بعد از هر عملیات write باید persist() صدا زده شود تا دیتابیس دوباره
 *     روی فایل database.sqlite ذخیره گردد.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { nowDatetime } = require('./dateUtil');

// مسیر فایل دیتابیس در ریشه پوشه backend
const DB_FILE = path.join(__dirname, '..', '..', 'database.sqlite');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

let SQL = null; // ماژول sql.js (پس از init)
let db = null;  // نمونه دیتابیس فعال
let inTransaction = false;

/**
 * مقداردهی اولیه دیتابیس. باید یک‌بار در شروع برنامه await شود.
 * @returns {Promise<object>} نمونه دیتابیس sql.js
 */
async function initDatabase() {
  if (db) return db;

  // بارگذاری موتور sql.js و فایل wasm آن از داخل node_modules
  SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
  });

  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');

  if (fs.existsSync(DB_FILE)) {
    // فایل موجود است → آن را load می‌کنیم
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    // اجرای schema به‌صورت idempotent (همه CREATE ... IF NOT EXISTS هستند)
    // تا جدول‌های جدید بدون پاک‌شدن داده‌های موجود اضافه شوند (migration سبک).
    db.run(schema);
    migrateSchema(db);
    persist();
    console.log('[db] دیتابیس موجود بارگذاری و schema همگام‌سازی شد.');
  } else {
    // فایل وجود ندارد → دیتابیس جدید می‌سازیم و schema را اجرا می‌کنیم
    db = new SQL.Database();
    db.run(schema);
    migrateSchema(db);
    persist();
    console.log('[db] دیتابیس جدید ساخته و schema.sql اجرا شد.');
  }

  return db;
}

/** migration سبک برای دیتابیس‌های موجود */
function migrateSchema(database) {
  const info = database.exec('PRAGMA table_info(strategy_actions)');
  if (!info.length) return;

  const colNames = info[0].values.map((row) => row[1]);
  if (colNames.includes('wait_days') && !colNames.includes('wait_minutes')) {
    database.run(
      'ALTER TABLE strategy_actions ADD COLUMN wait_minutes INTEGER NOT NULL DEFAULT 0'
    );
    database.run(
      'UPDATE strategy_actions SET wait_minutes = COALESCE(wait_days, 0) * 1440'
    );
    console.log('[db] migration: wait_days → wait_minutes (مقدار × ۱۴۴۰)');
  }

  // wait_minutes → wait_next_minutes (ستون جدید ساخته و مقدار کپی می‌شود)
  if (!colNames.includes('wait_next_minutes')) {
    database.run('ALTER TABLE strategy_actions ADD COLUMN wait_next_minutes INTEGER NOT NULL DEFAULT 0');
    if (colNames.includes('wait_minutes')) {
      database.run('UPDATE strategy_actions SET wait_next_minutes = COALESCE(wait_minutes, 0)');
    }
    console.log('[db] migration: strategy_actions.wait_next_minutes added');
  }
  if (!colNames.includes('wait_repeat_minutes')) {
    database.run('ALTER TABLE strategy_actions ADD COLUMN wait_repeat_minutes INTEGER NOT NULL DEFAULT 60');
    console.log('[db] migration: strategy_actions.wait_repeat_minutes added');
  }
  // max_repeat باید روی همه انواع اکشن مقدار داشته باشد (پیش‌فرض ۳)
  if (!colNames.includes('max_repeat')) {
    database.run('ALTER TABLE strategy_actions ADD COLUMN max_repeat INTEGER NOT NULL DEFAULT 3');
    console.log('[db] migration: strategy_actions.max_repeat added');
  }
  database.run('UPDATE strategy_actions SET max_repeat = 3 WHERE max_repeat IS NULL OR max_repeat = 0');

  if (!colNames.includes('repeat_on_results')) {
    database.run('ALTER TABLE strategy_actions ADD COLUMN repeat_on_results TEXT');
    database.run(
      `UPDATE strategy_actions SET repeat_on_results = '["ارسال نشد"]'
       WHERE action_type IN ('warning_sms', 'threatening_sms')`
    );
    database.run(
      `UPDATE strategy_actions SET repeat_on_results = '["پاسخگو نبود","اشغال بود"]'
       WHERE action_type IN ('warning_autocall', 'threatening_autocall')`
    );
    database.run(
      `UPDATE strategy_actions SET repeat_on_results = '["پاسخگو نبود"]'
       WHERE action_type = 'negotiator_call'`
    );
    console.log('[db] migration: strategy_actions.repeat_on_results added');
  }

  migrateRepairEmptyRepeatOnResults(database);

  const casesInfo = database.exec('PRAGMA table_info(cases)');
  if (casesInfo.length) {
    const caseCols = casesInfo[0].values.map((row) => row[1]);
    if (!caseCols.includes('cei_boost')) {
      database.run('ALTER TABLE cases ADD COLUMN cei_boost REAL NOT NULL DEFAULT 0');
      console.log('[db] migration: cases.cei_boost added');
    }
    if (!caseCols.includes('current_action_seq')) {
      database.run('ALTER TABLE cases ADD COLUMN current_action_seq INTEGER NOT NULL DEFAULT 0');
      console.log('[db] migration: cases.current_action_seq added');
    }
    if (!caseCols.includes('current_action_repeat')) {
      database.run('ALTER TABLE cases ADD COLUMN current_action_repeat INTEGER NOT NULL DEFAULT 0');
      console.log('[db] migration: cases.current_action_repeat added');
    }
  }

  const actionsInfo = database.exec('PRAGMA table_info(case_actions)');
  if (actionsInfo.length) {
    const actionCols = actionsInfo[0].values.map((row) => row[1]);
    if (!actionCols.includes('repeat_count')) {
      database.run('ALTER TABLE case_actions ADD COLUMN repeat_count INTEGER NOT NULL DEFAULT 0');
      console.log('[db] migration: case_actions.repeat_count added');
    }
    if (!actionCols.includes('created_at')) {
      database.run('ALTER TABLE case_actions ADD COLUMN created_at TEXT');
      const maxRow = database.exec('SELECT MAX(id) AS max_id FROM case_actions');
      const maxId = maxRow[0]?.values[0]?.[0] ?? 0;
      database.run(
        `UPDATE case_actions SET created_at = datetime('now', '-' || (${maxId} - id) || ' seconds')`
      );
      console.log('[db] migration: case_actions.created_at added');
    }
  }

  const promisesInfo = database.exec('PRAGMA table_info(promises)');
  if (promisesInfo.length) {
    const promiseCols = promisesInfo[0].values.map((row) => row[1]);
    if (promiseCols.includes('promised_date') && !promiseCols.includes('promised_datetime')) {
      database.run('ALTER TABLE promises RENAME COLUMN promised_date TO promised_datetime');
      database.run(
        `UPDATE promises SET promised_datetime = promised_datetime || ' 23:59'
         WHERE promised_datetime NOT LIKE '% %'`
      );
      console.log('[db] migration: promises.promised_date → promised_datetime');
    }

    repairPromisedDatetimeFromHistory(database);
  }

  const negInfo = database.exec('PRAGMA table_info(negotiators)');
  if (negInfo.length) {
    const negCols = negInfo[0].values.map((row) => row[1]);
    if (!negCols.includes('user_id')) {
      database.run('ALTER TABLE negotiators ADD COLUMN user_id INTEGER REFERENCES users(id)');
      console.log('[db] migration: negotiators.user_id added');
    }
  }

  const usersInfo = database.exec('PRAGMA table_info(users)');
  if (usersInfo.length) {
    const userCols = usersInfo[0].values.map((row) => row[1]);
    if (!userCols.includes('is_super_admin')) {
      database.run('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0');
      console.log('[db] migration: users.is_super_admin added');
    }
  }

  migrateInstallmentsColumns(database);
  migrateCaseEventsIdColumn(database);
  migrateCaseEventsData(database);
  migrateUtcTimestampsToTehran(database);
  repairPaidCaseStrategyIds(database);
  migrateUtcTimestampsToTehranV2(database);
  migrateDedupeStrategyFailureHistory(database);
  migrateFulfillBrokenPromisesOnPaidCases(database);
}

function resolveStrategyIdFromHistory(database, caseId) {
  const rows = database.exec(
    `SELECT label, details FROM case_events WHERE case_id = ${caseId} ORDER BY id ASC`
  );
  if (!rows.length || !rows[0].values.length) return null;

  let strategyId = null;
  for (const [label, detailsRaw] of rows[0].values) {
    if (!detailsRaw) continue;
    let details;
    try {
      details = JSON.parse(detailsRaw);
    } catch {
      continue;
    }

    if (label === 'تخصیص استراتژی' && details.strategy_id) {
      strategyId = Number(details.strategy_id) || strategyId;
    } else if (label === 'به‌روزرسانی CEI و استراتژی' && details.strategy_new_id) {
      strategyId = Number(details.strategy_new_id) || strategyId;
    } else if (label === 'شکست استراتژی' && details.strategy_new) {
      const title = String(details.strategy_new).replace(/'/g, "''");
      const found = database.exec(
        `SELECT id FROM strategies WHERE title = '${title}' LIMIT 1`
      );
      if (found.length && found[0].values.length) {
        strategyId = found[0].values[0][0];
      }
    }
  }
  return strategyId;
}

function repairPaidCaseStrategyIds(database) {
  const v2Flag = database.exec("SELECT value FROM settings WHERE key = 'repair_strategy_id_v2'");
  if (v2Flag.length && v2Flag[0].values.length) return;

  const caseRows = database.exec(`SELECT id, strategy_id FROM cases`);
  if (!caseRows.length || !caseRows[0].values.length) {
    database.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('repair_strategy_id_v2', '1')`
    );
    return;
  }

  let repaired = 0;
  for (const [caseId, currentSid] of caseRows[0].values) {
    const resolved = resolveStrategyIdFromHistory(database, caseId);
    if (!resolved) continue;
    if (Number(currentSid) === Number(resolved)) continue;
    database.run(`UPDATE cases SET strategy_id = ${resolved} WHERE id = ${caseId}`);
    repaired += 1;
  }

  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('repair_strategy_id_v2', '1')`
  );
  if (repaired > 0) {
    console.log(`[db] migration: corrected strategy_id on ${repaired} case(s) from history`);
  }
}

function migrateRepairEmptyRepeatOnResults(database) {
  const flag = database.exec(
    "SELECT value FROM settings WHERE key = 'repair_empty_repeat_on_results'"
  );
  if (flag.length && flag[0].values.length) return;

  database.run(
    `UPDATE strategy_actions SET repeat_on_results = '["ارسال نشد"]'
     WHERE action_type IN ('warning_sms', 'threatening_sms')
       AND (repeat_on_results IS NULL OR TRIM(repeat_on_results) IN ('', '[]'))`
  );
  database.run(
    `UPDATE strategy_actions SET repeat_on_results = '["پاسخگو نبود","اشغال بود"]'
     WHERE action_type IN ('warning_autocall', 'threatening_autocall')
       AND (repeat_on_results IS NULL OR TRIM(repeat_on_results) IN ('', '[]'))`
  );
  database.run(
    `UPDATE strategy_actions SET repeat_on_results = '["پاسخگو نبود"]'
     WHERE action_type = 'negotiator_call'
       AND (repeat_on_results IS NULL OR TRIM(repeat_on_results) IN ('', '[]'))`
  );
  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('repair_empty_repeat_on_results', '1')`
  );
  console.log('[db] migration: repaired empty strategy_actions.repeat_on_results');
}

function migrateUtcTimestampsToTehranV2(database) {
  const flag = database.exec("SELECT value FROM settings WHERE key = 'tz_utc_to_tehran_v2'");
  if (flag.length && flag[0].values.length) return;

  const tables = [
    { table: 'strategies', cols: ['created_at', 'updated_at'] },
    { table: 'cases', cols: ['created_at'] },
    { table: 'segments', cols: ['created_at'] },
    { table: 'negotiators', cols: ['created_at'] },
    { table: 'settings_history', cols: ['changed_at'] },
    { table: 'cei_formula_versions', cols: ['created_at'] },
    { table: 'promises', cols: ['created_at'] },
    { table: 'payments', cols: ['created_at'] },
    { table: 'case_files', cols: ['created_at'] },
    { table: 'users', cols: ['created_at'] },
  ];

  for (const { table, cols } of tables) {
    const exists = database.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
    );
    if (!exists.length || !exists[0].values.length) continue;
    const info = database.exec(`PRAGMA table_info(${table})`);
    const tableCols = info[0]?.values.map((row) => row[1]) ?? [];
    for (const col of cols) {
      if (!tableCols.includes(col)) continue;
      database.run(
        `UPDATE ${table} SET ${col} = datetime(${col}, '+3 hours', '+30 minutes')
         WHERE ${col} GLOB '????-??-?? ??:??:*'`
      );
    }
  }

  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('tz_utc_to_tehran_v2', '1')`
  );
  console.log('[db] migration: additional UTC timestamps shifted to Asia/Tehran (+3:30)');
}

function migrateDedupeStrategyFailureHistory(database) {
  const flag = database.exec(
    "SELECT value FROM settings WHERE key = 'dedupe_strategy_failure_history_v1'"
  );
  if (flag.length && flag[0].values.length) return;

  database.run(
    `DELETE FROM case_events
     WHERE event_type <> 'action'
       AND label = 'شکست استراتژی'
       AND case_id IN (
         SELECT case_id FROM case_events WHERE action_type = 'strategy_failure'
       )`
  );

  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('dedupe_strategy_failure_history_v1', '1')`
  );
  console.log('[db] migration: removed duplicate strategy-failure history rows');
}

function migrateFulfillBrokenPromisesOnPaidCases(database) {
  const flag = database.exec(
    "SELECT value FROM settings WHERE key = 'fulfill_broken_promises_on_paid_v1'"
  );
  if (flag.length && flag[0].values.length) return;

  database.run(
    `UPDATE promises SET status = 'fulfilled'
     WHERE status = 'broken'
       AND case_id IN (SELECT id FROM cases WHERE case_status = 'paid')`
  );

  database.run(
    `UPDATE promises SET status = 'fulfilled'
     WHERE status = 'broken'
       AND id IN (
         SELECT p.id FROM promises p
         INNER JOIN payments pay ON pay.case_id = p.case_id
         WHERE pay.amount >= p.amount
       )`
  );

  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('fulfill_broken_promises_on_paid_v1', '1')`
  );
  console.log('[db] migration: fulfilled broken promises on paid/satisfied cases');
}

function migrateUtcTimestampsToTehran(database) {
  const flag = database.exec("SELECT value FROM settings WHERE key = 'tz_utc_to_tehran_v1'");
  if (flag.length && flag[0].values.length) return;

  const tables = [
    { table: 'case_events', col: 'created_at' },
    { table: 'cases', col: 'updated_at' },
    { table: 'bulk_operations', col: 'created_at' },
    { table: 'bulk_operations', col: 'completed_at' },
  ];

  for (const { table, col } of tables) {
    const exists = database.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
    );
    if (!exists.length || !exists[0].values.length) continue;
    const info = database.exec(`PRAGMA table_info(${table})`);
    const cols = info[0]?.values.map((row) => row[1]) ?? [];
    if (!cols.includes(col)) continue;
    database.run(
      `UPDATE ${table} SET ${col} = datetime(${col}, '+3 hours', '+30 minutes')
       WHERE ${col} GLOB '????-??-?? ??:??:*'`
    );
  }

  database.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('tz_utc_to_tehran_v1', '1')`
  );
  console.log('[db] migration: UTC timestamps shifted to Asia/Tehran (+3:30)');
}

function migrateInstallmentsColumns(database) {
  const instInfo = database.exec('PRAGMA table_info(installments)');
  if (!instInfo.length) return;
  const cols = instInfo[0].values.map((row) => row[1]);
  const addCol = (name, ddl) => {
    if (!cols.includes(name)) {
      database.run(`ALTER TABLE installments ADD COLUMN ${ddl}`);
      console.log(`[db] migration: installments.${name} added`);
    }
  };
  addCol('penalty_waiver', 'penalty_waiver INTEGER NOT NULL DEFAULT 0');
  addCol('bank_settlement', 'bank_settlement INTEGER NOT NULL DEFAULT 0');
  addCol('guarantee_withdrawal', 'guarantee_withdrawal INTEGER NOT NULL DEFAULT 0');
  addCol('debt_class', "debt_class TEXT NOT NULL DEFAULT ''");
}

function migrateCaseEventsIdColumn(database) {
  const hasTable = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='case_events'"
  );
  if (!hasTable.length || !hasTable[0].values.length) return;

  const info = database.exec('PRAGMA table_info(case_events)');
  const cols = info[0]?.values.map((row) => row[1]) ?? [];
  if (cols.includes('id')) return;

  console.log('[db] migration: rebuilding case_events with id column');

  database.run(`
    CREATE TABLE case_events_mig (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id          INTEGER NOT NULL,
      event_type       TEXT    NOT NULL,
      action_type      TEXT,
      label            TEXT    NOT NULL,
      result           TEXT,
      details          TEXT,
      user_name        TEXT    NOT NULL DEFAULT 'سیستم',
      seq              INTEGER,
      repeat_count     INTEGER NOT NULL DEFAULT 0,
      cost             INTEGER NOT NULL DEFAULT 0,
      next_action      TEXT,
      next_action_date TEXT,
      case_status      TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )
  `);

  database.run(`
    INSERT INTO case_events_mig
      (case_id, event_type, action_type, label, result, details, user_name, seq, repeat_count, cost,
       next_action, next_action_date, case_status, created_at)
    SELECT
      case_id,
      event_type,
      action_type,
      COALESCE(label, ''),
      result,
      details,
      COALESCE(user_name, 'سیستم'),
      seq,
      COALESCE(repeat_count, 0),
      COALESCE(cost, 0),
      next_action,
      next_action_date,
      case_status,
      COALESCE(created_at, datetime('now'))
    FROM case_events
    ORDER BY rowid ASC
  `);

  database.run('DROP TABLE case_events');
  database.run('ALTER TABLE case_events_mig RENAME TO case_events');
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_case_events_case_id ON case_events(case_id, created_at)'
  );
  console.log('[db] migration: case_events.id column added');
}

function migrateCaseEventsData(database) {
  const hasTable = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='case_events'"
  );
  if (!hasTable.length || !hasTable[0].values.length) return;

  const existing = database.exec('SELECT COUNT(*) AS c FROM case_events')[0]?.values[0]?.[0] ?? 0;
  if (existing > 0) return;

  const actionCount =
    database.exec('SELECT COUNT(*) AS c FROM case_actions')[0]?.values[0]?.[0] ?? 0;
  const historyCount =
    database.exec('SELECT COUNT(*) AS c FROM case_history')[0]?.values[0]?.[0] ?? 0;
  if (actionCount === 0 && historyCount === 0) return;

  console.log('[db] migration: copying case_actions + case_history → case_events');

  database.run(`
    INSERT INTO case_events
      (case_id, event_type, action_type, label, result, details, user_name, seq, repeat_count, cost, created_at)
    SELECT
      case_id,
      'action',
      action_type,
      CASE action_type
        WHEN 'warning_sms' THEN 'پیامک هشدار'
        WHEN 'threatening_sms' THEN 'پیامک تهدید'
        WHEN 'warning_autocall' THEN 'تماس خودکار هشدار'
        WHEN 'threatening_autocall' THEN 'تماس خودکار تهدید'
        WHEN 'negotiator_call' THEN 'تماس مذاکره‌کننده'
        WHEN 'strategy_failure' THEN 'شکست استراتژی'
        WHEN 'payment_full' THEN 'پرداخت کامل'
        WHEN 'payment_partial' THEN 'پرداخت جزئی'
        ELSE action_type
      END,
      result,
      COALESCE(body_text, call_status),
      'سیستم',
      seq,
      repeat_count,
      cost,
      COALESCE(created_at, action_date, datetime('now'))
    FROM case_actions
  `);

  database.run(`
    INSERT INTO case_events
      (case_id, event_type, label, details, user_name, case_status, next_action, next_action_date, created_at)
    SELECT
      case_id,
      CASE operation
        WHEN 'تخصیص به مذاکره‌کننده' THEN 'assignment'
        WHEN 'تخصیص مجدد' THEN 'assignment'
        WHEN 'ثبت خروجی تماس' THEN 'call_outcome'
        WHEN 'پرداخت کامل بدهی' THEN 'payment'
        WHEN 'پرداخت جزئی بدهی' THEN 'payment'
        ELSE 'system'
      END,
      operation,
      details,
      COALESCE(user_name, 'سیستم'),
      case_status,
      next_action,
      next_action_date,
      COALESCE(created_at, datetime('now'))
    FROM case_history
  `);

  console.log('[db] migration: case_events populated');
}

/** تعهدات pending با 23:59 پیش‌فرض migration — بازیابی از تاریخچه ثبت تماس */
function repairPromisedDatetimeFromHistory(database) {
  const rows = database.exec(
    `SELECT p.id, p.case_id FROM promises p
     WHERE p.status = 'pending' AND p.promised_datetime LIKE '% 23:59'`
  );
  if (!rows.length || !rows[0].values.length) return;

  for (const [promiseId, caseId] of rows[0].values) {
    const hist = database.exec(
      `SELECT details FROM case_events
       WHERE case_id = ${caseId} AND event_type = 'call_outcome'
       ORDER BY id DESC LIMIT 1`
    );
    if (!hist.length || !hist[0].values.length) continue;

    const detailsRaw = hist[0].values[0][0];
    if (!detailsRaw) continue;

    let details;
    try {
      details = JSON.parse(detailsRaw);
    } catch {
      continue;
    }

    const candidate = details.promised_datetime || null;
    if (!candidate || String(candidate).includes('23:59')) continue;

    const escaped = String(candidate).replace(/'/g, "''");
    database.run(
      `UPDATE promises SET promised_datetime = '${escaped}' WHERE id = ${promiseId}`
    );
    console.log(`[db] repair: promise ${promiseId} → ${candidate}`);
  }
}

/**
 * ذخیره وضعیت فعلی دیتابیس روی فایل database.sqlite.
 * باید بعد از هر عملیات write فراخوانی شود.
 */
function persist() {
  if (!db) throw new Error('دیتابیس هنوز مقداردهی نشده است (initDatabase را صدا بزنید).');
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

/**
 * دریافت نمونه دیتابیس فعال.
 */
function getDb() {
  if (!db) throw new Error('دیتابیس هنوز مقداردهی نشده است (initDatabase را صدا بزنید).');
  return db;
}

/**
 * اجرای یک کوئری SELECT و بازگرداندن نتیجه به صورت آرایه‌ای از آبجکت‌ها.
 * @param {string} sql
 * @param {object|Array} [params] پارامترهای bind ($name یا ?)
 * @returns {Array<object>}
 */
/** sql.js مقدار undefined را قبول نمی‌کند — به null تبدیل می‌شود. */
function sanitizeParams(params) {
  if (!params || typeof params !== 'object') return params;
  const out = {};
  for (const [key, val] of Object.entries(params)) {
    out[key] = val === undefined ? null : val;
  }
  return out;
}

/** جایگزینی datetime('now') و datetime('now','localtime') با زمان فعلی تهران */
function bindTehranNow(sql, params = {}) {
  const needsNow =
    /datetime\s*\(\s*'now'\s*(?:,\s*'localtime'\s*)?\)/i.test(sql);
  if (!needsNow) return { sql, params: sanitizeParams(params) };

  const now = nowDatetime();
  const outParams = { ...params };
  let idx = 0;
  let outSql = sql.replace(/datetime\s*\(\s*'now'\s*,\s*'localtime'\s*\)/gi, () => {
    idx += 1;
    const key = `$__tehran_now_${idx}`;
    outParams[key] = now;
    return key;
  });
  outSql = outSql.replace(/datetime\s*\(\s*'now'\s*\)/gi, () => {
    idx += 1;
    const key = `$__tehran_now_${idx}`;
    outParams[key] = now;
    return key;
  });
  return { sql: outSql, params: sanitizeParams(outParams) };
}

function query(sql, params = {}) {
  const bound = bindTehranNow(sql, params);
  const stmt = getDb().prepare(bound.sql);
  try {
    stmt.bind(bound.params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

/**
 * اجرای یک عبارت write (INSERT/UPDATE/DELETE).
 * پس از اجرا به‌صورت خودکار persist می‌کند.
 * @param {string} sql
 * @param {object|Array} [params]
 * @returns {{ lastInsertRowid: number, changes: number }}
 */
function runInternal(sql, params = {}, shouldPersist = true) {
  const bound = bindTehranNow(sql, params);
  const database = getDb();
  const stmt = database.prepare(bound.sql);
  try {
    stmt.bind(bound.params);
    stmt.step();
  } finally {
    stmt.free();
  }

  const idRow = database.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
  const values = idRow[0] ? idRow[0].values[0] : [0, 0];

  if (shouldPersist) persist();

  return { lastInsertRowid: values[0], changes: values[1] };
}

function run(sql, params = {}) {
  return runInternal(sql, params, !inTransaction);
}

function execTransactionSql(sql) {
  getDb().run(sql);
}

function transaction(fn) {
  if (inTransaction) {
    return fn();
  }

  inTransaction = true;
  execTransactionSql('BEGIN');
  try {
    const result = fn();
    execTransactionSql('COMMIT');
    inTransaction = false;
    persist();
    return result;
  } catch (err) {
    inTransaction = false;
    try {
      execTransactionSql('ROLLBACK');
    } catch (rollbackErr) {
      const msg = rollbackErr?.message || String(rollbackErr);
      if (!/no transaction is active/i.test(msg)) {
        console.error('[db] ROLLBACK failed:', msg);
      }
    }
    throw err;
  }
}

module.exports = {
  initDatabase,
  getDb,
  persist,
  query,
  run,
  transaction,
  DB_FILE,
};
