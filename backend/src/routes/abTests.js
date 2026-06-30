'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { validateActions, replaceActions } = require('../db/strategyActions');

const CREDIT_TYPES = ['loan', 'bnpl'];

// اعتبارسنجی سگمنت (وجود + هم‌خوانی نوع اعتبار)
function validateSegment(segmentId, creditType) {
  if (!segmentId) return 'انتخاب سگمنت اجباری است';
  const rows = query('SELECT credit_type FROM segments WHERE id = $id', { $id: segmentId });
  if (rows.length === 0) return 'سگمنت انتخاب‌شده یافت نشد';
  if (rows[0].credit_type !== creditType) {
    return 'سگمنت انتخاب‌شده با نوع اعتبار سناریو هم‌خوانی ندارد';
  }
  return null;
}

// تعداد استراتژی‌های موجود در یک سگمنت
function segmentStrategyCount(segmentId) {
  const rows = query('SELECT COUNT(*) AS c FROM strategies WHERE segment_id = $sid', {
    $sid: segmentId,
  });
  return rows[0]?.c ?? 0;
}

// ساخت یک استراتژی جدید به همراه اقدام‌هایش
function createStrategyWithActions(title, creditType, segmentId, createdBy, actions) {
  const { lastInsertRowid } = run(
    `INSERT INTO strategies (title, credit_type, segment_id, created_by)
     VALUES ($title, $t, $sid, $by)`,
    { $title: title, $t: creditType, $sid: segmentId, $by: createdBy || 'ادمین' }
  );
  replaceActions(lastInsertRowid, actions);
  return lastInsertRowid;
}

/**
 * GET /api/ab-tests
 * لیست سناریوها با عنوان سگمنت و عنوان استراتژی‌ها.
 */
router.get('/', (req, res) => {
  try {
    const rows = query(`
      SELECT
        ab.*,
        sg.title AS segment_title,
        sa.title AS strategy_a_title,
        sb.title AS strategy_b_title
      FROM ab_tests ab
      LEFT JOIN segments sg ON sg.id = ab.segment_id
      LEFT JOIN strategies sa ON sa.id = ab.strategy_a_id
      LEFT JOIN strategies sb ON sb.id = ab.strategy_b_id
      ORDER BY ab.created_at DESC, ab.id DESC
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error('[GET /api/ab-tests]', err);
    res.status(500).json({ error: 'خطا در دریافت سناریوها' });
  }
});

/**
 * POST /api/ab-tests
 * ایجاد سناریو به همراه «دو استراتژی جدید» و اقدام‌هایشان (Story 12.3 + قانون جدید).
 * سگمنت باید خالی باشد؛ مجموع نرخ توزیع باید ۱۰۰٪ باشد (AC1).
 * body: { name, credit_type, segment_id, strategy_a:{title,actions}, ratio_a, strategy_b:{title,actions}, ratio_b, created_by }
 */
router.post('/', (req, res) => {
  try {
    const { name, credit_type, segment_id, strategy_a, strategy_b, ratio_a, ratio_b, created_by } =
      req.body || {};

    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'نام سناریو اجباری است' });
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }
    const segErr = validateSegment(segment_id, credit_type);
    if (segErr) return res.status(400).json({ error: segErr });

    // سگمنت باید خالی باشد (دو استراتژی سناریو تنها ساکنان سگمنت خواهند بود)
    if (segmentStrategyCount(segment_id) > 0) {
      return res.status(400).json({
        error: 'این سگمنت قبلاً استراتژی دارد. سناریوی A/B فقط روی سگمنت بدون استراتژی قابل تعریف است.',
      });
    }

    const titleA = (strategy_a?.title || '').trim();
    const titleB = (strategy_b?.title || '').trim();
    if (!titleA || !titleB) {
      return res.status(400).json({ error: 'عنوان هر دو استراتژی اجباری است' });
    }

    const ra = Number(ratio_a);
    const rb = Number(ratio_b);
    if (!Number.isInteger(ra) || !Number.isInteger(rb) || ra < 0 || rb < 0) {
      return res.status(400).json({ error: 'نرخ توزیع باید عدد صحیح نامنفی باشد' });
    }
    if (ra + rb !== 100) {
      return res.status(400).json({ error: 'مجموع نرخ توزیع دو استراتژی باید ۱۰۰٪ باشد' });
    }

    const actErrA = validateActions(strategy_a?.actions);
    if (actErrA) return res.status(400).json({ error: `استراتژی اول: ${actErrA}` });
    const actErrB = validateActions(strategy_b?.actions);
    if (actErrB) return res.status(400).json({ error: `استراتژی دوم: ${actErrB}` });

    // ساخت دو استراتژی + اقدام‌ها
    const aId = createStrategyWithActions(titleA, credit_type, segment_id, created_by, strategy_a?.actions);
    const bId = createStrategyWithActions(titleB, credit_type, segment_id, created_by, strategy_b?.actions);

    const { lastInsertRowid } = run(
      `INSERT INTO ab_tests (name, credit_type, segment_id, strategy_a_id, ratio_a, strategy_b_id, ratio_b)
       VALUES ($name, $t, $sid, $a, $ra, $b, $rb)`,
      { $name: cleanName, $t: credit_type, $sid: segment_id, $a: aId, $ra: ra, $b: bId, $rb: rb }
    );
    const rows = query('SELECT * FROM ab_tests WHERE id = $id', { $id: lastInsertRowid });
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error('[POST /api/ab-tests]', err);
    res.status(500).json({ error: 'خطا در ایجاد سناریو' });
  }
});

/**
 * DELETE /api/ab-tests/:id
 * حذف سناریو به همراه دو استراتژی آن.
 */
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = query('SELECT * FROM ab_tests WHERE id = $id', { $id: id });
    if (rows.length === 0) return res.status(404).json({ error: 'سناریو یافت نشد' });
    const ab = rows[0];

    // اگر یکی از استراتژی‌ها پرونده باز دارد، حذف مجاز نیست
    const openCases = query(
      `SELECT COUNT(*) AS c FROM cases
       WHERE strategy_id IN ($a, $b) AND case_status NOT IN ('paid','burned')`,
      { $a: ab.strategy_a_id, $b: ab.strategy_b_id }
    );
    if ((openCases[0]?.c ?? 0) > 0) {
      return res.status(400).json({ error: 'استراتژی‌های این سناریو پرونده باز دارند و قابل حذف نیستند' });
    }

    run('DELETE FROM ab_tests WHERE id = $id', { $id: id });
    run('DELETE FROM strategies WHERE id IN ($a, $b)', { $a: ab.strategy_a_id, $b: ab.strategy_b_id });
    res.json({ data: { id } });
  } catch (err) {
    console.error('[DELETE /api/ab-tests/:id]', err);
    res.status(500).json({ error: 'خطا در حذف سناریو' });
  }
});

module.exports = router;
