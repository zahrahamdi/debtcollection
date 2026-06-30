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
function query(sql, params = {}) {
  const stmt = getDb().prepare(sql);
  try {
    stmt.bind(params);
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
    stmt.bind(params);
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
