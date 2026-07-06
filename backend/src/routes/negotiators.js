'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { authorize } = require('../middleware/auth.middleware');
const { assignRoleToUser } = require('../services/auth.service');

const COOPERATION_TYPES = ['internal', 'outsourced'];
const STATUSES = ['active', 'inactive'];

const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const isNonNegInt = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;

function countCases(negId, extraWhere = '') {
  const sql = `SELECT COUNT(*) AS c FROM cases WHERE assigned_negotiator_id = $id ${extraWhere}`;
  return query(sql, { $id: negId })[0]?.c ?? 0;
}

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

function mapNegotiatorRow(n) {
  const displayName =
    n.user_first_name || n.user_last_name
      ? `${n.user_first_name || ''} ${n.user_last_name || ''}`.trim()
      : n.name;
  return withStats({
    id: n.id,
    user_id: n.user_id,
    name: displayName,
    status: n.status,
    cooperation_type: n.cooperation_type,
    capacity: n.capacity,
    hourly_wage: n.hourly_wage,
    created_at: n.created_at,
    email: n.email ?? null,
  });
}

const NEGOTIATOR_SELECT = `
  SELECT n.*, u.first_name AS user_first_name, u.last_name AS user_last_name, u.email
  FROM negotiators n
  LEFT JOIN users u ON u.id = n.user_id
`;

router.get('/', (req, res, next) => {
  try {
    const rows = query(`${NEGOTIATOR_SELECT} ORDER BY n.id ASC`);
    res.json({ data: rows.map(mapNegotiatorRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize('negotiators', 'create'), (req, res, next) => {
  try {
    const { user_id, capacity, cooperation_type, hourly_wage } = req.body || {};
    const uid = Number(user_id);
    if (!uid) return res.status(400).json({ error: 'انتخاب کاربر اجباری است' });
    if (!COOPERATION_TYPES.includes(cooperation_type)) {
      return res.status(400).json({ error: 'نوع همکاری نامعتبر است' });
    }
    if (!isNonNegInt(capacity)) {
      return res.status(400).json({ error: 'ظرفیت کاری باید عدد صحیح نامنفی باشد' });
    }
    if (!isPositiveInt(hourly_wage)) {
      return res.status(400).json({ error: 'حقوق ساعتی باید عدد صحیح مثبت باشد' });
    }

    const userRows = query('SELECT * FROM users WHERE id = $id', { $id: uid });
    if (!userRows.length) return res.status(404).json({ error: 'کاربر یافت نشد' });

    const existingNeg = query('SELECT id FROM negotiators WHERE user_id = $uid', { $uid: uid });
    if (existingNeg.length) {
      return res.status(409).json({ error: 'این کاربر قبلاً به عنوان مذاکره‌کننده ثبت شده است' });
    }

    const fullName = `${userRows[0].first_name} ${userRows[0].last_name}`.trim();
    const { lastInsertRowid } = run(
      `INSERT INTO negotiators (user_id, name, status, cooperation_type, capacity, hourly_wage)
       VALUES ($uid, $name, 'active', $ct, $cap, $wage)`,
      {
        $uid: uid,
        $name: fullName,
        $ct: cooperation_type,
        $cap: Number(capacity),
        $wage: Number(hourly_wage),
      }
    );

    assignRoleToUser(uid, 'negotiator');

    const rows = query(`${NEGOTIATOR_SELECT} WHERE n.id = $id`, { $id: lastInsertRowid });
    res.status(201).json({ data: mapNegotiatorRow(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authorize('negotiators', 'edit'), (req, res, next) => {
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
    const rows = query(`${NEGOTIATOR_SELECT} WHERE n.id = $id`, { $id: id });
    res.json({ data: mapNegotiatorRow(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
