'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const { calcActionStatus, daysDiffFromToday } = require('../db/dateUtil');

const PAGE_SIZE = 100;

const CASE_SEGMENT_STRATEGY_JOINS = `
      LEFT JOIN segments seg ON seg.id = c.segment_id
      LEFT JOIN strategies str ON str.id = c.strategy_id
`;

const CASE_SEGMENT_STRATEGY_FIELDS = `
        seg.title AS segment_title,
        str.title AS strategy_title,
`;

// افزودن وضعیت اقدام محاسبه‌شده به هر پرونده
function enrichRow(row) {
  return { ...row, action_status: calcActionStatus(row.next_action_date) };
}

/**
 * GET /api/cases
 * لیست پرونده‌ها با فیلتر سرور و pagination.
 * Query params: debtor_name, national_code, credit_id, case_status,
 *               action_status, negotiator_name, page (default 1)
 */
router.get('/', (req, res) => {
  try {
    const {
      debtor_name,
      national_code,
      credit_id,
      case_status,
      action_status,
      negotiator_name,
      page,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);

    const conditions = [];
    const params = {};

    if (debtor_name) {
      conditions.push(`(d.first_name || ' ' || d.last_name) LIKE $debtor_name`);
      params.$debtor_name = `%${debtor_name}%`;
    }
    if (national_code) {
      conditions.push(`d.national_code LIKE $national_code`);
      params.$national_code = `%${national_code}%`;
    }
    if (credit_id) {
      conditions.push(`c.credit_id LIKE $credit_id`);
      params.$credit_id = `%${credit_id}%`;
    }
    if (case_status) {
      conditions.push(`c.case_status = $case_status`);
      params.$case_status = case_status;
    }
    if (negotiator_name) {
      conditions.push(`n.name LIKE $negotiator_name`);
      params.$negotiator_name = `%${negotiator_name}%`;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows = query(
      `
      SELECT
        c.id,
        c.credit_id,
        c.credit_type,
        c.supplier,
        c.guarantee_type,
        c.debt_class,
        c.dpd,
        c.credit_amount,
        c.outstanding_debt,
        c.claims_amount,
        c.penalty_amount,
        c.case_status,
        c.last_action,
        c.last_action_date,
        c.next_action,
        c.next_action_date,
        c.cei,
        c.segment_id,
        c.strategy_id,
        ${CASE_SEGMENT_STRATEGY_FIELDS}
        c.assigned_negotiator_id,
        d.id   AS debtor_id,
        d.first_name || ' ' || d.last_name AS debtor_name,
        d.national_code,
        d.mobile,
        d.province,
        n.name AS negotiator_name
      FROM cases c
      JOIN   debtors d    ON d.id = c.debtor_id
      LEFT JOIN negotiators n ON n.id = c.assigned_negotiator_id
      ${CASE_SEGMENT_STRATEGY_JOINS}
      ${whereClause}
      ORDER BY c.id ASC
      `,
      params
    );

    // محاسبه پویای وضعیت اقدام برای همه ردیف‌ها
    rows = rows.map(enrichRow);

    // فیلتر وضعیت اقدام بعد از محاسبه (چون مقدار در DB ممکن است کهنه باشد)
    if (action_status) {
      rows = rows.filter((r) => r.action_status === action_status);
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const data = rows.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

    res.json({ count: total, page: pageNum, total_pages: totalPages, data });
  } catch (err) {
    console.error('[GET /api/cases]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست پرونده‌ها' });
  }
});

/**
 * GET /api/cases/:id
 * جزئیات کامل یک پرونده برای ساید بار.
 */
router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);

    const rows = query(
      `
      SELECT
        c.*,
        d.first_name || ' ' || d.last_name AS debtor_name,
        d.national_code,
        d.mobile,
        d.province,
        n.name AS negotiator_name,
        seg.title AS segment_title,
        str.title AS strategy_title
      FROM cases c
      JOIN   debtors d    ON d.id = c.debtor_id
      LEFT JOIN negotiators n ON n.id = c.assigned_negotiator_id
      LEFT JOIN segments seg ON seg.id = c.segment_id
      LEFT JOIN strategies str ON str.id = c.strategy_id
      WHERE c.id = $id
      `,
      { $id: id }
    );

    if (rows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });
    const caseRow = enrichRow(rows[0]);

    const actions = query(
      `SELECT * FROM case_actions WHERE case_id = $id ORDER BY seq ASC`,
      { $id: id }
    );

    const promises = query(
      `SELECT * FROM promises WHERE case_id = $id ORDER BY id DESC`,
      { $id: id }
    );
    const brokenPromisesCount = promises.filter((p) => p.status === 'broken').length;
    const activePromise = promises.find((p) => p.status === 'pending') || null;

    const files = query(`SELECT * FROM case_files WHERE case_id = $id`, { $id: id });

    const otherCases = query(
      `
      SELECT id, credit_id, credit_type, case_status, claims_amount
      FROM cases
      WHERE debtor_id = $debtorId AND id <> $id
      ORDER BY id ASC
      `,
      { $debtorId: caseRow.debtor_id, $id: id }
    );

    res.json({
      data: {
        ...caseRow,
        actions,
        promises,
        broken_promises_count: brokenPromisesCount,
        active_promise: activePromise,
        files,
        other_cases: otherCases,
      },
    });
  } catch (err) {
    console.error('[GET /api/cases/:id]', err);
    res.status(500).json({ error: 'خطا در دریافت جزئیات پرونده' });
  }
});

/**
 * GET /api/cases/:id/history
 * تاریخچه کامل تغییرات و اقدامات یک پرونده (Audit Trail).
 */
router.get('/:id/history', (req, res) => {
  try {
    const id = Number(req.params.id);
    const caseRows = query('SELECT id FROM cases WHERE id = $id', { $id: id });
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });

    const history = query(
      `SELECT * FROM case_history WHERE case_id = $id ORDER BY id DESC`,
      { $id: id }
    );
    res.json({ data: history });
  } catch (err) {
    console.error('[GET /api/cases/:id/history]', err);
    res.status(500).json({ error: 'خطا در دریافت تاریخچه پرونده' });
  }
});

/**
 * POST /api/cases/:id/assign
 * تخصیص / تخصیص مجدد پرونده به مذاکره‌کننده.
 * body: { negotiator_id, user_name }
 */
router.post('/:id/assign', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { negotiator_id, user_name } = req.body || {};

    const caseRows = query('SELECT * FROM cases WHERE id = $id', { $id: id });
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });
    const c = caseRows[0];

    const negRows = query('SELECT * FROM negotiators WHERE id = $id', { $id: negotiator_id });
    if (negRows.length === 0)
      return res.status(400).json({ error: 'مذاکره‌کننده انتخاب‌شده یافت نشد' });
    const neg = negRows[0];

    if (neg.status !== 'active')
      return res.status(400).json({ error: 'مذاکره‌کننده غیرفعال است و نمی‌توان به او تخصیص داد' });

    const isReassign = c.assigned_negotiator_id != null;

    if (!isReassign && c.case_status !== 'pending_negotiator_assignment') {
      return res
        .status(400)
        .json({ error: 'این پرونده در وضعیت «در انتظار تخصیص به مذاکره‌کننده» نیست' });
    }
    if (isReassign && Number(c.assigned_negotiator_id) === Number(negotiator_id)) {
      return res
        .status(400)
        .json({ error: 'این پرونده هم‌اکنون به همین مذاکره‌کننده تخصیص یافته است' });
    }

    // قانون یک بدهکار = یک مذاکره‌کننده
    const conflict = query(
      `SELECT COUNT(*) AS c FROM cases
       WHERE debtor_id = $d AND id <> $id
         AND assigned_negotiator_id IS NOT NULL AND assigned_negotiator_id <> $n
         AND case_status NOT IN ('paid','burned')`,
      { $d: c.debtor_id, $id: id, $n: negotiator_id }
    );
    if ((conflict[0]?.c ?? 0) > 0) {
      return res
        .status(400)
        .json({ error: 'پرونده دیگری از این بدهکار به مذاکره‌کننده دیگری واگذار شده است' });
    }

    // بررسی ظرفیت
    const targetActive = query(
      `SELECT COUNT(*) AS c FROM cases
       WHERE assigned_negotiator_id = $n AND id <> $id AND case_status NOT IN ('paid','burned')`,
      { $n: negotiator_id, $id: id }
    )[0].c;
    if (targetActive >= neg.capacity) {
      return res.status(400).json({ error: 'ظرفیت مذاکره‌کننده تکمیل است و تخصیص انجام نشد' });
    }

    if (isReassign) {
      run(
        `UPDATE cases SET assigned_negotiator_id = $n, updated_at = datetime('now') WHERE id = $id`,
        { $n: negotiator_id, $id: id }
      );
    } else {
      run(
        `UPDATE cases SET assigned_negotiator_id = $n, case_status = 'pending_negotiator_call',
         updated_at = datetime('now') WHERE id = $id`,
        { $n: negotiator_id, $id: id }
      );
    }

    const updated = query('SELECT * FROM cases WHERE id = $id', { $id: id })[0];
    const op = isReassign ? 'تخصیص مجدد' : 'تخصیص به مذاکره‌کننده';

    run(
      `INSERT INTO case_history
        (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
       VALUES ($cid, $did, $user, $op, $status, $na, $nad, $details)`,
      {
        $cid: id,
        $did: c.debtor_id,
        $user: user_name || 'ادمین',
        $op: op,
        $status: updated.case_status,
        $na: updated.next_action,
        $nad: updated.next_action_date,
        $details: `مذاکره‌کننده: ${neg.name}`,
      }
    );

    res.json({
      data: {
        id,
        assigned_negotiator_id: Number(negotiator_id),
        case_status: updated.case_status,
        mode: isReassign ? 'reassign' : 'assign',
      },
    });
  } catch (err) {
    console.error('[POST /api/cases/:id/assign]', err);
    res.status(500).json({ error: 'خطا در تخصیص پرونده' });
  }
});

/**
 * POST /api/cases/:id/call-outcome
 * ثبت خروجی تماس مذاکره‌کننده.
 * body: { call_status, no_payment_reason, payment_decision, promised_date,
 *         promised_amount, next_call_date, description, refer_to_legal,
 *         call_date, user_name }
 */
router.post('/:id/call-outcome', (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};

    const caseRows = query('SELECT * FROM cases WHERE id = $id', { $id: id });
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });
    const c = caseRows[0];

    if (!b.call_status) return res.status(400).json({ error: 'وضعیت تماس اجباری است' });

    const willPay = b.payment_decision === 'دارد';

    if (willPay) {
      if (!b.promised_date || b.promised_amount === undefined || b.promised_amount === '') {
        return res.status(400).json({ error: 'تاریخ و مبلغ تعهد پرداخت اجباری است' });
      }
      if (Number(b.promised_amount) > Number(c.claims_amount)) {
        return res
          .status(400)
          .json({ error: 'مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد' });
      }

      // اعتبارسنجی سقف تاریخ Promise to Pay از تنظیمات
      const settingRow = query(
        `SELECT value FROM settings WHERE key = 'promise_to_pay_max_days'`
      );
      const maxDays = parseInt(settingRow[0]?.value || '10');
      const diffDays = daysDiffFromToday(b.promised_date);

      if (diffDays === null) {
        return res.status(400).json({ error: 'فرمت تاریخ تعهد پرداخت نامعتبر است (YYYY/MM/DD)' });
      }
      if (diffDays < 0) {
        return res.status(400).json({ error: 'تاریخ تعهد پرداخت نمی‌تواند در گذشته باشد' });
      }
      if (diffDays > maxDays) {
        return res.status(400).json({
          error: `تاریخ تعهد پرداخت نمی‌تواند بیش از ${maxDays} روز از امروز باشد`,
        });
      }
    }

    const isDeath = b.no_payment_reason === 'فوت کاربر';
    const newCallCount = (c.call_count || 0) + 1;

    // تعیین وضعیت جدید و تاریخ اقدام بعدی
    let newStatus = 'in_negotiation';
    let nextActionDate = c.next_action_date;

    if (isDeath) {
      newStatus = 'burned';
      nextActionDate = null;
    } else if (b.refer_to_legal) {
      newStatus = 'pending_legal_assignment';
      nextActionDate = null;
    } else {
      nextActionDate = willPay ? b.promised_date : (b.next_call_date || null);
      // رسیدن به حداکثر تماس و نبود تعهد پرداخت → ارجاع خودکار به حقوقی
      if (!willPay && c.max_call_count && newCallCount >= c.max_call_count) {
        newStatus = 'pending_legal_assignment';
        nextActionDate = null;
      }
    }

    // هزینه تماس مذاکره‌کننده = حقوق ساعتی × (میانگین مدت تماس / ۶۰)
    let cost = 0;
    if (c.assigned_negotiator_id && c.strategy_id) {
      const neg = query('SELECT hourly_wage FROM negotiators WHERE id = $n', {
        $n: c.assigned_negotiator_id,
      })[0];
      const act = query(
        `SELECT avg_call_duration FROM strategy_actions
         WHERE strategy_id = $s AND action_type = 'negotiator_call'
         ORDER BY seq ASC LIMIT 1`,
        { $s: c.strategy_id }
      )[0];
      if (neg && act && act.avg_call_duration) {
        cost = Math.round((neg.hourly_wage * act.avg_call_duration) / 60);
      }
    }

    // ساخت متن خلاصه نتیجه
    const parts = [`وضعیت تماس: ${b.call_status}`];
    if (b.no_payment_reason) parts.push(`دلیل عدم پرداخت: ${b.no_payment_reason}`);
    if (b.payment_decision) parts.push(`تصمیم به پرداخت: ${b.payment_decision}`);
    if (willPay) parts.push(`تعهد: ${b.promised_amount} ریال در ${b.promised_date}`);
    if (b.next_call_date) parts.push(`تماس بعدی: ${b.next_call_date}`);
    if (b.description) parts.push(`توضیحات: ${b.description}`);
    if (b.refer_to_legal) parts.push('ارجاع به حقوقی');
    const resultText = parts.join(' · ');

    // ثبت در سابقه اقدام‌ها
    const maxSeq = query(
      'SELECT COALESCE(MAX(seq),0) AS m FROM case_actions WHERE case_id = $id',
      { $id: id }
    )[0].m;

    run(
      `INSERT INTO case_actions
        (case_id, seq, action_type, body_text, result, action_date, cost, call_status, next_call_date)
       VALUES ($cid, $seq, 'negotiator_call', NULL, $res, $date, $cost, $cs, $ncd)`,
      {
        $cid: id,
        $seq: maxSeq + 1,
        $res: resultText,
        $date: b.call_date || null,
        $cost: cost,
        $cs: b.call_status,
        $ncd: b.next_call_date || null,
      }
    );

    // به‌روزرسانی پرونده
    run(
      `UPDATE cases SET
        call_count = $cc,
        case_status = $st,
        next_action_date = $nad,
        last_action = 'تماس تلفنی مذاکره‌کننده',
        last_action_date = $cd,
        case_cost = case_cost + $cost,
        updated_at = datetime('now')
       WHERE id = $id`,
      {
        $cc: newCallCount,
        $st: newStatus,
        $nad: nextActionDate,
        $cd: b.call_date || null,
        $cost: cost,
        $id: id,
      }
    );

    // ثبت تعهد پرداخت
    if (willPay) {
      run(
        `INSERT INTO promises (case_id, promised_date, amount, status)
         VALUES ($id, $pd, $amt, 'pending')`,
        { $id: id, $pd: b.promised_date, $amt: Number(b.promised_amount) }
      );
    }

    // ثبت خودکار پیامک عدم پاسخگویی در تاریخچه
    if (b.call_status === 'پاسخگو نبود' && !b.refer_to_legal) {
      run(
        `INSERT INTO case_history
          (case_id, debtor_id, user_name, operation, case_status, details)
         VALUES ($id, $did, 'سیستم', 'ارسال پیامک عدم پاسخگویی', $st, 'پیامک خودکار عدم پاسخگویی ارسال شد')`,
        { $id: id, $did: c.debtor_id, $st: newStatus }
      );
    }

    // ثبت اصلی در تاریخچه
    run(
      `INSERT INTO case_history
        (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
       VALUES ($id, $did, $user, 'ثبت خروجی تماس', $st, $na, $nad, $details)`,
      {
        $id: id,
        $did: c.debtor_id,
        $user: b.user_name || 'مذاکره‌کننده',
        $st: newStatus,
        $na: c.next_action,
        $nad: nextActionDate,
        $details: resultText,
      }
    );

    res.json({ data: { id, case_status: newStatus, call_count: newCallCount, cost } });
  } catch (err) {
    console.error('[POST /api/cases/:id/call-outcome]', err);
    res.status(500).json({ error: 'خطا در ثبت خروجی تماس' });
  }
});

module.exports = router;
