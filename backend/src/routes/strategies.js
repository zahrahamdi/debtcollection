'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { getActions, validateActions, replaceActions } = require('../db/strategyActions');

const CREDIT_TYPES = ['loan', 'bnpl'];

// آیا این سگمنت قبلاً استراتژی دارد؟ (قانون: هر سگمنت حداکثر یک استراتژی مستقل؛
// دو استراتژی فقط از طریق سناریوی A/B Test مجاز است)
function segmentHasStrategy(segmentId, excludeId = null) {
  const rows = query('SELECT id FROM strategies WHERE segment_id = $sid', { $sid: segmentId });
  return rows.some((r) => r.id !== excludeId);
}

// تعداد پرونده‌های فعال یک استراتژی (فعال = نه پرداخت‌شده و نه سوخت‌شده)
function activeCasesCount(strategyId) {
  const rows = query(
    `SELECT COUNT(*) AS c FROM cases
     WHERE strategy_id = $id AND case_status NOT IN ('paid', 'burned')`,
    { $id: strategyId }
  );
  return Number(rows[0]?.c ?? 0);
}

// اعتبارسنجی سگمنت (وجود داشته باشد و نوع اعتبارش با استراتژی یکی باشد)
function validateSegment(segmentId, creditType) {
  if (segmentId === null || segmentId === undefined || segmentId === '') {
    return 'انتخاب سگمنت اجباری است';
  }
  const rows = query('SELECT credit_type FROM segments WHERE id = $id', { $id: segmentId });
  if (rows.length === 0) return 'سگمنت انتخاب‌شده یافت نشد';
  if (rows[0].credit_type !== creditType) {
    return 'سگمنت انتخاب‌شده با نوع اعتبار استراتژی هم‌خوانی ندارد';
  }
  return null;
}

function strategySuccessRate(strategyId) {
  const total = Number(
    query('SELECT COUNT(*) AS c FROM cases WHERE strategy_id = $id', { $id: strategyId })[0]?.c ?? 0
  );
  if (total === 0) return null;
  const paid = Number(
    query(
      `SELECT COUNT(*) AS c FROM cases WHERE strategy_id = $id AND case_status = 'paid'`,
      { $id: strategyId }
    )[0]?.c ?? 0
  );
  return Math.round((paid / total) * 1000) / 10;
}

function serialize(s) {
  return {
    ...s,
    active_cases_count: activeCasesCount(s.id),
    success_rate: strategySuccessRate(s.id),
  };
}

/**
 * GET /api/strategies
 * لیست استراتژی‌ها با عنوان سگمنت، تعداد پرونده فعال و ایجادکننده (Story 12.1).
 * ستون‌های A/B Test در برش بعدی پر می‌شوند.
 */
router.get('/', (req, res) => {
  try {
    const rows = query(`
      SELECT
        st.*,
        sg.title AS segment_title,
        ab.name AS ab_name,
        CASE
          WHEN ab.strategy_a_id = st.id THEN ab.ratio_a
          WHEN ab.strategy_b_id = st.id THEN ab.ratio_b
        END AS ab_ratio
      FROM strategies st
      LEFT JOIN segments sg ON sg.id = st.segment_id
      LEFT JOIN ab_tests ab ON ab.strategy_a_id = st.id OR ab.strategy_b_id = st.id
      ORDER BY st.created_at DESC, st.id DESC
    `);
    res.json({ data: rows.map(serialize) });
  } catch (err) {
    console.error('[GET /api/strategies]', err);
    res.status(500).json({ error: 'خطا در دریافت استراتژی‌ها' });
  }
});

/**
 * GET /api/strategies/:id
 * جزئیات یک استراتژی به همراه اکشن‌های آن (برای ویرایش).
 */
router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = query(
      `SELECT st.*, sg.title AS segment_title FROM strategies st
       LEFT JOIN segments sg ON sg.id = st.segment_id WHERE st.id = $id`,
      { $id: id }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'استراتژی یافت نشد' });
    res.json({ data: { ...serialize(rows[0]), actions: getActions(id) } });
  } catch (err) {
    console.error('[GET /api/strategies/:id]', err);
    res.status(500).json({ error: 'خطا در دریافت استراتژی' });
  }
});

/**
 * POST /api/strategies
 */
router.post('/', (req, res) => {
  try {
    const { title, credit_type, segment_id, created_by, actions } = req.body || {};
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'عنوان استراتژی اجباری است' });
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }
    const segErr = validateSegment(segment_id, credit_type);
    if (segErr) return res.status(400).json({ error: segErr });
    if (segmentHasStrategy(segment_id)) {
      return res.status(400).json({
        error: 'این سگمنت قبلاً یک استراتژی دارد. برای دو استراتژی از سناریوی A/B Test استفاده کنید.',
      });
    }
    const actErr = validateActions(actions);
    if (actErr) return res.status(400).json({ error: actErr });

    const { lastInsertRowid } = run(
      `INSERT INTO strategies (title, credit_type, segment_id, created_by)
       VALUES ($title, $t, $sid, $by)`,
      { $title: cleanTitle, $t: credit_type, $sid: segment_id, $by: created_by || 'ادمین' }
    );
    replaceActions(lastInsertRowid, actions);

    const rows = query(
      `SELECT st.*, sg.title AS segment_title FROM strategies st
       LEFT JOIN segments sg ON sg.id = st.segment_id WHERE st.id = $id`,
      { $id: lastInsertRowid }
    );
    res.status(201).json({ data: { ...serialize(rows[0]), actions: getActions(lastInsertRowid) } });
  } catch (err) {
    console.error('[POST /api/strategies]', err);
    res.status(500).json({ error: 'خطا در ایجاد استراتژی' });
  }
});

/**
 * PUT /api/strategies/:id
 */
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = query('SELECT * FROM strategies WHERE id = $id', { $id: id });
    if (existing.length === 0) return res.status(404).json({ error: 'استراتژی یافت نشد' });
    const st = existing[0];

    const cleanTitle = (req.body.title ?? st.title).trim();
    const credit_type = req.body.credit_type ?? st.credit_type;
    const segment_id = req.body.segment_id ?? st.segment_id;

    if (!cleanTitle) return res.status(400).json({ error: 'عنوان استراتژی اجباری است' });
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }
    const segErr = validateSegment(segment_id, credit_type);
    if (segErr) return res.status(400).json({ error: segErr });
    const actErr = validateActions(req.body.actions);
    if (actErr) return res.status(400).json({ error: actErr });

    run(
      `UPDATE strategies SET title = $title, credit_type = $t, segment_id = $sid,
       updated_at = datetime('now') WHERE id = $id`,
      { $title: cleanTitle, $t: credit_type, $sid: segment_id, $id: id }
    );
    if (req.body.actions !== undefined) replaceActions(id, req.body.actions);

    const rows = query(
      `SELECT st.*, sg.title AS segment_title FROM strategies st
       LEFT JOIN segments sg ON sg.id = st.segment_id WHERE st.id = $id`,
      { $id: id }
    );
    res.json({ data: { ...serialize(rows[0]), actions: getActions(id) } });
  } catch (err) {
    console.error('[PUT /api/strategies/:id]', err);
    res.status(500).json({ error: 'خطا در ویرایش استراتژی' });
  }
});

/**
 * DELETE /api/strategies/:id
 * حذف فقط اگر هیچ پرونده بازی وجود نداشته باشد (AC5).
 */
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = query('SELECT * FROM strategies WHERE id = $id', { $id: id });
    if (existing.length === 0) return res.status(404).json({ error: 'استراتژی یافت نشد' });

    if (activeCasesCount(id) > 0) {
      return res.status(400).json({ error: 'این استراتژی پرونده باز دارد و قابل حذف نیست' });
    }

    run('DELETE FROM strategies WHERE id = $id', { $id: id });
    res.json({ data: { id } });
  } catch (err) {
    console.error('[DELETE /api/strategies/:id]', err);
    res.status(500).json({ error: 'خطا در حذف استراتژی' });
  }
});

module.exports = router;
