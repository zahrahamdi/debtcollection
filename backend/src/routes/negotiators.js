'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');

const COOPERATION_TYPES = ['internal', 'outsourced'];
const STATUSES = ['active', 'inactive'];

const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const isNonNegInt = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;

// شمارش با یک شرط مشخص روی پرونده‌های تخصیص‌یافته به مذاکره‌کننده
function countCases(negId, extraWhere = '') {
  const sql = `SELECT COUNT(*) AS c FROM cases WHERE assigned_negotiator_id = $id ${extraWhere}`;
  return query(sql, { $id: negId })[0]?.c ?? 0;
}

// فیلدهای محاسباتی گرید (Story 2.1)
function withStats(n) {
  const total = countCases(n.id);
  const paid = countCases(n.id, `AND case_status = 'paid'`);
  return {
    ...n,
    active_cases_count: countCases(n.id, `AND case_status NOT IN ('paid','burned')`),
    today_calls: countCases(n.id, `AND action_status = 'due_today'`),
    overdue_actions: countCases(n.id, `AND action_status = 'overdue'`),
    success_rate: total > 0 ? Math.round((paid / total) * 100) : 0,
  };
}

/**
 * GET /api/negotiators
 * لیست مذاکره‌کنندگان با فیلدهای محاسباتی.
 */
router.get('/', (req, res) => {
  try {
    const rows = query('SELECT * FROM negotiators ORDER BY id ASC');
    res.json({ data: rows.map(withStats) });
  } catch (err) {
    console.error('[GET /api/negotiators]', err);
    res.status(500).json({ error: 'خطا در دریافت مذاکره‌کنندگان' });
  }
});

/**
 * POST /api/negotiators
 * ایجاد مذاکره‌کننده جدید (Story 2.2). وضعیت پیش‌فرض: فعال.
 */
router.post('/', (req, res) => {
  try {
    const { name, capacity, cooperation_type, hourly_wage } = req.body || {};
    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'نام مذاکره‌کننده اجباری است' });
    if (!COOPERATION_TYPES.includes(cooperation_type)) {
      return res.status(400).json({ error: 'نوع همکاری نامعتبر است' });
    }
    if (!isNonNegInt(capacity)) {
      return res.status(400).json({ error: 'ظرفیت کاری باید عدد صحیح نامنفی باشد' });
    }
    if (!isPositiveInt(hourly_wage)) {
      return res.status(400).json({ error: 'حقوق ساعتی باید عدد صحیح مثبت باشد' });
    }

    const { lastInsertRowid } = run(
      `INSERT INTO negotiators (name, status, cooperation_type, capacity, hourly_wage)
       VALUES ($name, 'active', $ct, $cap, $wage)`,
      { $name: cleanName, $ct: cooperation_type, $cap: Number(capacity), $wage: Number(hourly_wage) }
    );
    const rows = query('SELECT * FROM negotiators WHERE id = $id', { $id: lastInsertRowid });
    res.status(201).json({ data: withStats(rows[0]) });
  } catch (err) {
    console.error('[POST /api/negotiators]', err);
    res.status(500).json({ error: 'خطا در ایجاد مذاکره‌کننده' });
  }
});

/**
 * PUT /api/negotiators/:id
 * ویرایش (Story 2.3): ظرفیت، وضعیت، نوع همکاری، حقوق ساعتی. (نام تغییر نمی‌کند.)
 */
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = query('SELECT * FROM negotiators WHERE id = $id', { $id: id });
    if (existing.length === 0) return res.status(404).json({ error: 'مذاکره‌کننده یافت نشد' });
    const n = existing[0];

    const capacity = req.body.capacity ?? n.capacity;
    const status = req.body.status ?? n.status;
    const cooperation_type = req.body.cooperation_type ?? n.cooperation_type;
    const hourly_wage = req.body.hourly_wage ?? n.hourly_wage;

    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است' });
    if (!COOPERATION_TYPES.includes(cooperation_type)) {
      return res.status(400).json({ error: 'نوع همکاری نامعتبر است' });
    }
    if (!isNonNegInt(capacity)) {
      return res.status(400).json({ error: 'ظرفیت کاری باید عدد صحیح نامنفی باشد' });
    }
    if (!isPositiveInt(hourly_wage)) {
      return res.status(400).json({ error: 'حقوق ساعتی باید عدد صحیح مثبت باشد' });
    }

    run(
      `UPDATE negotiators SET capacity = $cap, status = $st, cooperation_type = $ct, hourly_wage = $wage
       WHERE id = $id`,
      { $cap: Number(capacity), $st: status, $ct: cooperation_type, $wage: Number(hourly_wage), $id: id }
    );
    const rows = query('SELECT * FROM negotiators WHERE id = $id', { $id: id });
    res.json({ data: withStats(rows[0]) });
  } catch (err) {
    console.error('[PUT /api/negotiators/:id]', err);
    res.status(500).json({ error: 'خطا در ویرایش مذاکره‌کننده' });
  }
});

module.exports = router;
