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

// مسیر فایل دیتابیس در ریشه پوشه backend
const DB_FILE = path.join(__dirname, '..', '..', 'database.sqlite');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

let SQL = null; // ماژول sql.js (پس از init)
let db = null;  // نمونه دیتابیس فعال

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
      `SELECT details FROM case_history
       WHERE case_id = ${caseId} AND operation = 'ثبت خروجی تماس'
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

function query(sql, params = {}) {
  const stmt = getDb().prepare(sql);
  try {
    stmt.bind(sanitizeParams(params));
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
function run(sql, params = {}) {
  const database = getDb();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(sanitizeParams(params));
    stmt.step();
  } finally {
    stmt.free();
  }

  const idRow = database.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
  const values = idRow[0] ? idRow[0].values[0] : [0, 0];

  persist();

  return { lastInsertRowid: values[0], changes: values[1] };
}

module.exports = {
  initDatabase,
  getDb,
  persist,
  query,
  run,
  DB_FILE,
};
