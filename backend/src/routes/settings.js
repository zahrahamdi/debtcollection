'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');

// کلیدهایی که باید عدد صحیح مثبت باشند (اعتبارسنجی سمت سرور)
const POSITIVE_INT_KEYS = new Set([
  'min_dpd',
  'promise_to_pay_max_days',
  'partial_payment_gap_days',
  'loan_cap',
  'bnpl_cap',
]);

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/**
 * GET /api/settings
 * همه تنظیمات را به صورت آبجکت key→value برمی‌گرداند.
 */
router.get('/', (req, res) => {
  try {
    const rows = query('SELECT key, value FROM settings');
    const data = {};
    for (const r of rows) data[r.key] = r.value;
    res.json({ data });
  } catch (err) {
    console.error('[GET /api/settings]', err);
    res.status(500).json({ error: 'خطا در دریافت تنظیمات' });
  }
});

/**
 * GET /api/settings/history?key=...
 * تاریخچه تغییرات یک کلید (یا همه، اگر key داده نشود).
 */
router.get('/history', (req, res) => {
  try {
    const { key } = req.query;
    const rows = key
      ? query('SELECT * FROM settings_history WHERE key = $key ORDER BY id DESC', { $key: key })
      : query('SELECT * FROM settings_history ORDER BY id DESC');
    res.json({ data: rows });
  } catch (err) {
    console.error('[GET /api/settings/history]', err);
    res.status(500).json({ error: 'خطا در دریافت تاریخچه تنظیمات' });
  }
});

/**
 * PUT /api/settings
 * به‌روزرسانی یک یا چند تنظیم به همراه ثبت تاریخچه.
 * body: { changes: [{ key, value }], user_name }
 */
router.put('/', (req, res) => {
  try {
    const { changes, user_name } = req.body || {};
    if (!Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'هیچ تغییری ارسال نشده است' });
    }

    // اعتبارسنجی
    for (const c of changes) {
      if (!c || !c.key) {
        return res.status(400).json({ error: 'کلید تنظیم نامعتبر است' });
      }
      if (POSITIVE_INT_KEYS.has(c.key) && !isPositiveInt(c.value)) {
        return res
          .status(400)
          .json({ error: `مقدار «${c.key}» باید عدد صحیح مثبت باشد` });
      }
    }

    // اعمال تغییرات + ثبت تاریخچه
    for (const c of changes) {
      const existing = query('SELECT value FROM settings WHERE key = $key', { $key: c.key });
      const oldValue = existing.length ? existing[0].value : null;
      const newValue = String(c.value);

      if (oldValue === newValue) continue; // بدون تغییر

      if (existing.length) {
        run('UPDATE settings SET value = $value WHERE key = $key', {
          $value: newValue,
          $key: c.key,
        });
      } else {
        run('INSERT INTO settings (key, value) VALUES ($key, $value)', {
          $key: c.key,
          $value: newValue,
        });
      }

      run(
        `INSERT INTO settings_history (key, old_value, new_value, user_name)
         VALUES ($key, $old, $new, $user)`,
        { $key: c.key, $old: oldValue, $new: newValue, $user: user_name || 'ادمین' }
      );
    }

    const rows = query('SELECT key, value FROM settings');
    const data = {};
    for (const r of rows) data[r.key] = r.value;
    res.json({ data });
  } catch (err) {
    console.error('[PUT /api/settings]', err);
    res.status(500).json({ error: 'خطا در ذخیره تنظیمات' });
  }
});

module.exports = router;
