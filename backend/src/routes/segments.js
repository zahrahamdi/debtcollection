'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { toInterval, intervalsOverlap, validateCondition } = require('../db/segmentUtil');

const CREDIT_TYPES = ['loan', 'bnpl'];

// شمارش پرونده‌های فعال یک سگمنت (فعال = نه پرداخت‌شده و نه سوخت‌شده)
function activeCasesCount(segmentId) {
  const rows = query(
    `SELECT COUNT(*) AS c FROM cases
     WHERE segment_id = $id AND case_status NOT IN ('paid', 'burned')`,
    { $id: segmentId }
  );
  return Number(rows[0]?.c ?? 0);
}

// آیا عنوان در همان نوع اعتبار تکراری است؟ (AC افزوده‌شده)
function isDuplicateTitle(creditType, title, excludeId = null) {
  const rows = query(
    `SELECT id FROM segments WHERE credit_type = $t AND title = $title`,
    { $t: creditType, $title: title }
  );
  return rows.some((r) => r.id !== excludeId);
}

// بررسی همپوشانی با سایر سگمنت‌های همان نوع اعتبار
function hasOverlap(creditType, conditionType, x, y, excludeId = null) {
  const others = query(
    `SELECT id, condition_type, cei_x, cei_y FROM segments WHERE credit_type = $t`,
    { $t: creditType }
  );
  const target = toInterval(conditionType, x, y);
  return others.some((s) => {
    if (excludeId && s.id === excludeId) return false;
    return intervalsOverlap(target, toInterval(s.condition_type, s.cei_x, s.cei_y));
  });
}

function serialize(seg) {
  return { ...seg, active_cases_count: activeCasesCount(seg.id) };
}

/**
 * GET /api/segments
 * لیست سگمنت‌ها به تفکیک نوع اعتبار، به همراه تعداد پرونده فعال هر سگمنت.
 */
router.get('/', (req, res) => {
  try {
    const data = {};
    for (const t of CREDIT_TYPES) {
      const rows = query(
        `SELECT * FROM segments WHERE credit_type = $t ORDER BY cei_x ASC, id ASC`,
        { $t: t }
      );
      data[t] = rows.map(serialize);
    }
    res.json({ data });
  } catch (err) {
    console.error('[GET /api/segments]', err);
    res.status(500).json({ error: 'خطا در دریافت سگمنت‌ها' });
  }
});

/**
 * POST /api/segments
 * ایجاد سگمنت جدید با بررسی نام تکراری و همپوشانی (AC2).
 */
router.post('/', (req, res) => {
  try {
    const { title, credit_type, condition_type, cei_x, cei_y } = req.body || {};
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'عنوان سگمنت اجباری است' });
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }
    if (isDuplicateTitle(credit_type, cleanTitle)) {
      return res.status(400).json({ error: 'سگمنتی با این عنوان در این نوع اعتبار وجود دارد' });
    }
    const condErr = validateCondition(condition_type, cei_x, cei_y);
    if (condErr) return res.status(400).json({ error: condErr });

    if (hasOverlap(credit_type, condition_type, cei_x, cei_y)) {
      return res.status(400).json({ error: 'شرط CEI این سگمنت با یک سگمنت دیگر همپوشانی دارد' });
    }

    const { lastInsertRowid } = run(
      `INSERT INTO segments (title, credit_type, condition_type, cei_x, cei_y)
       VALUES ($title, $t, $ct, $x, $y)`,
      {
        $title: cleanTitle,
        $t: credit_type,
        $ct: condition_type,
        $x: Number(cei_x),
        $y: condition_type === 'between' ? Number(cei_y) : null,
      }
    );
    const rows = query('SELECT * FROM segments WHERE id = $id', { $id: lastInsertRowid });
    res.status(201).json({ data: serialize(rows[0]) });
  } catch (err) {
    console.error('[POST /api/segments]', err);
    res.status(500).json({ error: 'خطا در ایجاد سگمنت' });
  }
});

/**
 * PUT /api/segments/:id
 * ویرایش سگمنت (عنوان، شرط) با بررسی مجدد نام تکراری و همپوشانی.
 */
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = query('SELECT * FROM segments WHERE id = $id', { $id: id });
    if (existing.length === 0) return res.status(404).json({ error: 'سگمنت یافت نشد' });
    const seg = existing[0];

    const cleanTitle = (req.body.title ?? seg.title).trim();
    const condition_type = req.body.condition_type ?? seg.condition_type;
    const cei_x = req.body.cei_x ?? seg.cei_x;
    const cei_y = req.body.cei_y ?? seg.cei_y;

    if (!cleanTitle) return res.status(400).json({ error: 'عنوان سگمنت اجباری است' });
    if (isDuplicateTitle(seg.credit_type, cleanTitle, id)) {
      return res.status(400).json({ error: 'سگمنتی با این عنوان در این نوع اعتبار وجود دارد' });
    }
    const condErr = validateCondition(condition_type, cei_x, cei_y);
    if (condErr) return res.status(400).json({ error: condErr });

    if (hasOverlap(seg.credit_type, condition_type, cei_x, cei_y, id)) {
      return res.status(400).json({ error: 'شرط CEI این سگمنت با یک سگمنت دیگر همپوشانی دارد' });
    }

    run(
      `UPDATE segments SET title = $title, condition_type = $ct, cei_x = $x, cei_y = $y WHERE id = $id`,
      {
        $title: cleanTitle,
        $ct: condition_type,
        $x: Number(cei_x),
        $y: condition_type === 'between' ? Number(cei_y) : null,
        $id: id,
      }
    );
    const rows = query('SELECT * FROM segments WHERE id = $id', { $id: id });
    res.json({ data: serialize(rows[0]) });
  } catch (err) {
    console.error('[PUT /api/segments/:id]', err);
    res.status(500).json({ error: 'خطا در ویرایش سگمنت' });
  }
});

/**
 * DELETE /api/segments/:id
 * حذف سگمنت — اگر پرونده فعال داشته باشد مجاز نیست (AC5).
 */
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = query('SELECT * FROM segments WHERE id = $id', { $id: id });
    if (existing.length === 0) return res.status(404).json({ error: 'سگمنت یافت نشد' });

    if (activeCasesCount(id) > 0) {
      return res.status(400).json({ error: 'این سگمنت پرونده فعال دارد و قابل حذف نیست' });
    }

    run('DELETE FROM segments WHERE id = $id', { $id: id });
    res.json({ data: { id } });
  } catch (err) {
    console.error('[DELETE /api/segments/:id]', err);
    res.status(500).json({ error: 'خطا در حذف سگمنت' });
  }
});

module.exports = router;
