'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { computeCei } = require('../db/cei');

const CREDIT_TYPES = ['loan', 'bnpl'];

// برچسب فارسی انواع اعتبار (برای پیام خطا)
const CREDIT_LABEL = {
  loan: 'وام',
  bnpl: 'BNPL',
  single_installment: 'اعتبار یک‌قسطه',
  four_installment: 'اعتبار ۴ قسطه',
};

// نگاشت نوع اعتبار پرونده به نوع فرمول CEI:
// BNPL فرمول خودش را دارد؛ بقیه (وام/یک‌قسطه/۴‌قسطه) از فرمول «وام» استفاده می‌کنند.
const formulaTypeOf = (creditType) => (creditType === 'bnpl' ? 'bnpl' : 'loan');

// اعتبارسنجی پارامترهای فرمول
function validateParams(creditType, params) {
  if (!params || typeof params !== 'object') return 'پارامترها نامعتبر است';

  const positive = (v) => typeof v === 'number' && v > 0;
  const nonNeg = (v) => typeof v === 'number' && v >= 0;

  if (creditType === 'loan') {
    const { w_a, w_c, w_i, cap, c_none, c_note, c_cheque, a, f, k } = params;
    // وزن‌ها و Cap باید مثبت باشند
    if (![w_a, w_c, w_i, cap].every(positive)) return 'وزن‌ها و Cap باید عدد مثبت باشند';
    // مجموع وزن‌ها برای وام باید ۶۰ باشد (AC7)
    if (Math.round((w_a + w_c + w_i) * 100) / 100 !== 60) {
      return 'مجموع وزن‌های W_A + W_C + W_I باید برابر ۶۰ باشد'
    }
    // ضرایب ضمانت و پارامترهای منحنی باید نامنفی باشند (چک می‌تواند ۰ باشد)
    if (![c_none, c_note, c_cheque, a, f, k].every(nonNeg)) {
      return 'ضرایب ضمانت و پارامترهای a/f/k باید نامنفی باشند'
    }
  } else if (creditType === 'bnpl') {
    const { w_a, cap } = params;
    if (![w_a, cap].every(positive)) return 'وزن مبلغ و Cap باید عدد مثبت باشند';
  } else {
    return 'نوع اعتبار نامعتبر است';
  }
  return null;
}

// گرفتن نسخه فعال یک نوع اعتبار
function activeFormula(creditType) {
  const rows = query(
    `SELECT * FROM cei_formulas WHERE credit_type = $t AND is_active = 1 ORDER BY version DESC LIMIT 1`,
    { $t: creditType }
  );
  return rows[0] || null;
}

/**
 * GET /api/cei-formulas
 * نسخه فعال و تاریخچه نسخه‌ها برای هر نوع اعتبار.
 */
router.get('/', (req, res) => {
  try {
    const data = {};
    for (const t of CREDIT_TYPES) {
      const active = activeFormula(t);
      const versions = query(
        `SELECT id, version, change_note, user_name, created_at, is_active
         FROM cei_formulas WHERE credit_type = $t ORDER BY version DESC`,
        { $t: t }
      );
      data[t] = {
        active: active ? { ...active, params: JSON.parse(active.params) } : null,
        versions,
      };
    }
    res.json({ data });
  } catch (err) {
    console.error('[GET /api/cei-formulas]', err);
    res.status(500).json({ error: 'خطا در دریافت فرمول‌های CEI' });
  }
});

/**
 * PUT /api/cei-formulas
 * ذخیره تغییر فرمول → ساخت نسخه جدید و غیرفعال‌کردن نسخه قبلی (AC1, AC2).
 * body: { credit_type, params, change_note, user_name }
 */
router.put('/', (req, res) => {
  try {
    const { credit_type, params, change_note, user_name } = req.body || {};
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }
    const err = validateParams(credit_type, params);
    if (err) return res.status(400).json({ error: err });

    const current = activeFormula(credit_type);
    const nextVersion = current ? current.version + 1 : 1;

    // غیرفعال‌کردن نسخه فعلی
    run('UPDATE cei_formulas SET is_active = 0 WHERE credit_type = $t AND is_active = 1', {
      $t: credit_type,
    });

    // درج نسخه جدید
    run(
      `INSERT INTO cei_formulas (credit_type, version, params, is_active, change_note, user_name)
       VALUES ($t, $v, $p, 1, $note, $user)`,
      {
        $t: credit_type,
        $v: nextVersion,
        $p: JSON.stringify(params),
        $note: change_note || `به‌روزرسانی نسخه ${nextVersion}`,
        $user: user_name || 'ادمین',
      }
    );

    const active = activeFormula(credit_type);
    res.json({ data: { ...active, params: JSON.parse(active.params) } });
  } catch (err) {
    console.error('[PUT /api/cei-formulas]', err);
    res.status(500).json({ error: 'خطا در ذخیره فرمول CEI' });
  }
});

/**
 * POST /api/cei-formulas/test
 * پیش‌نمایش CEI برای یک شناسه اعتبار بدون اعمال هیچ تغییری (AC9).
 * body: { credit_type, credit_id }
 */
router.post('/test', (req, res) => {
  try {
    const { credit_type, credit_id } = req.body || {};
    if (!CREDIT_TYPES.includes(credit_type)) {
      return res.status(400).json({ error: 'نوع اعتبار نامعتبر است' });
    }

    const rows = query(
      `SELECT claims_amount, guarantee_type, first_unpaid_no, credit_type
       FROM cases WHERE credit_id = $cid`,
      { $cid: credit_id }
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `پرونده‌ای با شناسه اعتبار «${credit_id}» یافت نشد` });
    }

    // نوع اعتبار پرونده باید با تب فعلی سازگار باشد
    // (تب وام پرونده BNPL را نمی‌پذیرد و برعکس)
    const caseFormulaType = formulaTypeOf(rows[0].credit_type);
    if (caseFormulaType !== credit_type) {
      const tabLabel = credit_type === 'bnpl' ? 'BNPL' : 'وام';
      const caseLabel = CREDIT_LABEL[rows[0].credit_type] || rows[0].credit_type;
      return res.status(400).json({
        error: `این پرونده از نوع «${caseLabel}» است و در تب ${tabLabel} قابل تست نیست.`,
      });
    }

    const active = activeFormula(credit_type);
    if (!active) return res.status(404).json({ error: 'فرمول فعالی برای این نوع اعتبار وجود ندارد' });

    const params = JSON.parse(active.params);
    const result = computeCei(credit_type, params, rows[0]);

    res.json({
      data: {
        credit_id,
        version: active.version,
        cei: result.cei,
        breakdown: result.breakdown,
      },
    });
  } catch (err) {
    console.error('[POST /api/cei-formulas/test]', err);
    res.status(500).json({ error: 'خطا در محاسبه پیش‌نمایش CEI' });
  }
});

module.exports = router;
