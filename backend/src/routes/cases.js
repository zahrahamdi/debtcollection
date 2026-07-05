'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');
const {
  calcActionStatus,
  daysDiffFromToday,
  nowDatetime,
  nowJalaliDateTime,
  jalaliDateToDatetime,
  jalaliDateTimeToDatetime,
  isTimeWithinAllowedWindow,
  isJalaliDatetimeInPast,
  normalizePromisedDatetime,
  promisedDateFromDatetime,
  promisedTimeFromDatetime,
  computeNextActionDate,
  todayJalali,
} = require('../db/dateUtil');
const { sendSms, replacePlaceholders, NO_ANSWER_SMS_TEXT, PAYMENT_LINK_SMS_TEMPLATE } = require('../services/sms.service');
const { parseRepeatOnResults } = require('../db/strategyActions');
const { buildLastActionMap, resolveLastAction, ASSIGN_OPERATION } = require('../db/lastAction');

const PAGE_SIZE = 100;

// برچسب فارسی انواع اکشن استراتژی (برای نمایش اقدام بعدی)
const STRATEGY_ACTION_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

// اطلاعات مرحله تماس مذاکره‌کننده در استراتژی پرونده (بازه مجاز، wait، اکشن بعدی)
function computeNegotiatorStage(strategyId) {
  if (!strategyId) return null;
  const actions = query(
    'SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq ASC',
    { $sid: strategyId }
  );
  const negIdx = actions.findIndex((a) => a.action_type === 'negotiator_call');
  if (negIdx === -1) return null;
  const neg = actions[negIdx];
  const next = actions[negIdx + 1] || null;
  return {
    seq: neg.seq,
    allowed_from: neg.allowed_from || null,
    allowed_to: neg.allowed_to || null,
    wait_next_minutes: neg.wait_next_minutes ?? neg.wait_minutes ?? 0,
    wait_repeat_minutes: neg.wait_repeat_minutes ?? 60,
    max_repeat: neg.max_repeat ?? 3,
    repeat_on_results: parseRepeatOnResults(neg),
    next_action_type: next ? next.action_type : null,
    next_action_label: next ? STRATEGY_ACTION_LABELS[next.action_type] || next.action_type : null,
  };
}

const CASE_SEGMENT_STRATEGY_JOINS = `
      LEFT JOIN segments seg ON seg.id = c.segment_id
      LEFT JOIN strategies str ON str.id = c.strategy_id
`;

const CASE_SEGMENT_STRATEGY_FIELDS = `
        seg.title AS segment_title,
        str.title AS strategy_title,
`;

// افزودن وضعیت اقدام محاسبه‌شده و last_action از case_actions
function enrichRow(row, lastActionMap) {
  const resolved = lastActionMap?.[row.id] ?? resolveLastAction(row.id);
  return {
    ...row,
    action_status: calcActionStatus(row.next_action_date),
    last_action: resolved.last_action,
    last_action_date: resolved.last_action_date,
  };
}

/**
 * GET /api/cases
 * لیست پرونده‌ها با فیلتر سرور و pagination.
 * Query params: debtor_name, national_code, credit_id, credit_type, case_status,
 *               action_status, negotiator_name, page (default 1)
 */
router.get('/', (req, res) => {
  try {
    const {
      debtor_name,
      national_code,
      credit_id,
      credit_type,
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
    if (credit_type) {
      conditions.push(`c.credit_type = $credit_type`);
      params.$credit_type = credit_type;
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

    // محاسبه پویای وضعیت اقدام و آخرین اقدام از case_actions
    const lastActionMap = buildLastActionMap(rows.map((r) => r.id));
    rows = rows.map((r) => enrichRow(r, lastActionMap));

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
    const lastActionMap = buildLastActionMap([id]);
    const caseRow = enrichRow(rows[0], lastActionMap);

    const actions = query(
      `SELECT * FROM case_actions WHERE case_id = $id ORDER BY id ASC`,
      { $id: id }
    );

    const promises = query(
      `SELECT * FROM promises WHERE case_id = $id ORDER BY id DESC`,
      { $id: id }
    );
    const brokenPromisesCount = promises.filter((p) => p.status === 'broken').length;
    const activeRows = query(
      `SELECT * FROM promises WHERE case_id = $id AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      { $id: id }
    );
    const activePromise = activeRows[0] || null;

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

    // تعداد شکست استراتژی از روی case_history
    const strategyFailureCount = query(
      `SELECT COUNT(*) AS c FROM case_history WHERE case_id = $id AND operation = 'شکست استراتژی'`,
      { $id: id }
    )[0].c;

    // تماس‌های واقعی مذاکره‌کننده = رکوردهای negotiator_call که خروجی تماس (call_status) دارند
    const negotiatorCallOutcomes = actions.filter(
      (a) => a.action_type === 'negotiator_call' && a.call_status
    );
    const totalNegotiatorCalls = negotiatorCallOutcomes.length;

    // تماس‌های استراتژی فعلی = تماس‌هایی که بعد از آخرین marker شکست استراتژی ثبت شده‌اند
    const failureSeqs = actions
      .filter((a) => a.action_type === 'strategy_failure')
      .map((a) => Number(a.seq) || 0);
    const lastFailureSeq = failureSeqs.length ? Math.max(...failureSeqs) : 0;
    const currentStrategyCallCount = negotiatorCallOutcomes.filter(
      (a) => (Number(a.seq) || 0) > lastFailureSeq
    ).length;

    res.json({
      data: {
        ...caseRow,
        actions,
        promises,
        broken_promises_count: brokenPromisesCount,
        active_promise: activePromise,
        files,
        other_cases: otherCases,
        negotiator_stage: computeNegotiatorStage(caseRow.strategy_id),
        strategy_failure_count: strategyFailureCount,
        total_negotiator_calls: totalNegotiatorCalls,
        current_strategy_call_count: currentStrategyCallCount,
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
 * Query: operation, user_name, from_date (YYYY/MM/DD), to_date (YYYY/MM/DD)
 */
router.get('/:id/history', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { operation, user_name, from_date, to_date } = req.query;

    const caseRows = query(
      `SELECT c.id, c.credit_id, (d.first_name || ' ' || d.last_name) AS debtor_name
       FROM cases c
       LEFT JOIN debtors d ON d.id = c.debtor_id
       WHERE c.id = $id`,
      { $id: id }
    );
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });

    const conditions = ['h.case_id = $id'];
    const params = { $id: id };

    if (operation) {
      conditions.push('h.operation = $operation');
      params.$operation = operation;
    }
    if (user_name) {
      conditions.push('h.user_name LIKE $user_name');
      params.$user_name = `%${user_name}%`;
    }
    if (from_date) {
      const fromDt = jalaliDateToDatetime(String(from_date).trim());
      if (fromDt) {
        conditions.push('h.created_at >= $from_date');
        params.$from_date = fromDt;
      }
    }
    if (to_date) {
      const toDt = jalaliDateToDatetime(String(to_date).trim());
      if (toDt) {
        conditions.push('h.created_at <= $to_date');
        params.$to_date = toDt.replace(' 00:00:00', ' 23:59:59');
      }
    }

    const history = query(
      `SELECT
         h.*,
         c.credit_id,
         (d.first_name || ' ' || d.last_name) AS debtor_name
       FROM case_history h
       JOIN cases c ON c.id = h.case_id
       LEFT JOIN debtors d ON d.id = h.debtor_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY h.created_at ASC, h.id ASC`,
      params
    );

    res.json({
      data: history,
      case: caseRows[0],
    });
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
      const assignNow = nowDatetime();
      const assignActionStatus = calcActionStatus(assignNow);
      const assignDate = todayJalali();
      run(
        `UPDATE cases SET assigned_negotiator_id = $n, case_status = 'pending_negotiator_call',
         next_action = $na, next_action_date = $nad, action_status = $as,
         last_action = $la, last_action_date = $lad, updated_at = datetime('now') WHERE id = $id`,
        {
          $n: negotiator_id,
          $id: id,
          $na: 'تماس مذاکره‌کننده',
          $nad: assignNow,
          $as: assignActionStatus,
          $la: ASSIGN_OPERATION,
          $lad: assignDate,
        }
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
        $details: isReassign
          ? `مذاکره‌کننده: ${neg.name}`
          : `مذاکره‌کننده: ${neg.name} — نوبت تماس از ${updated.next_action_date}`,
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
 *         send_payment_link, call_date, user_name }
 */
router.post('/:id/call-outcome', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};

    const caseRows = query(
      `SELECT c.*, d.first_name, d.last_name, d.mobile
       FROM cases c
       JOIN debtors d ON d.id = c.debtor_id
       WHERE c.id = $id`,
      { $id: id }
    );
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });
    const c = caseRows[0];

    if (!b.call_status) return res.status(400).json({ error: 'وضعیت تماس اجباری است' });

    const isNoAnswer = b.call_status === 'پاسخگو نبود' || b.call_status === 'no_answer';
    const callDuration = isNoAnswer ? 0 : Number(b.call_duration);
    if (!isNoAnswer && (!callDuration || callDuration <= 0)) {
      return res.status(400).json({ error: 'مدت تماس به دقیقه اجباری است' });
    }

    const willPay = b.payment_decision === 'دارد';
    const userName = b.user_name || 'مذاکره‌کننده';
    const debtorName = `${c.first_name || ''} ${c.last_name || ''}`.trim();

    const stage = computeNegotiatorStage(c.strategy_id) || {};
    const allowedFrom = stage.allowed_from || '09:00';
    const allowedTo = stage.allowed_to || '18:00';

    if (willPay) {
      const promisedDatetimeNorm = normalizePromisedDatetime(b);
      if (!promisedDatetimeNorm || b.promised_amount === undefined || b.promised_amount === '') {
        return res.status(400).json({ error: 'تاریخ، ساعت و مبلغ تعهد پرداخت اجباری است' });
      }
      const promisedDate = promisedDateFromDatetime(promisedDatetimeNorm);
      const promisedTime = promisedTimeFromDatetime(promisedDatetimeNorm);

      if (Number(b.promised_amount) > Number(c.claims_amount)) {
        return res
          .status(400)
          .json({ error: 'مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد' });
      }
      if (!isTimeWithinAllowedWindow(promisedTime, allowedFrom, allowedTo)) {
        return res.status(400).json({
          error: `ساعت تعهد باید در بازه مجاز (${allowedFrom} تا ${allowedTo}) باشد`,
        });
      }
      if (isJalaliDatetimeInPast(promisedDate, promisedTime)) {
        return res.status(400).json({ error: 'تاریخ و ساعت تعهد نمی‌تواند در گذشته باشد' });
      }

      const settingRow = query(
        `SELECT value FROM settings WHERE key = 'promise_to_pay_max_days'`
      );
      const maxDays = parseInt(settingRow[0]?.value || '10', 10);
      const diffDays = daysDiffFromToday(promisedDate);

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

    const promisedDatetime = willPay ? normalizePromisedDatetime(b) : null;
    const promisedDate = promisedDateFromDatetime(promisedDatetime);
    const promisedTime = promisedTimeFromDatetime(promisedDatetime);

    const isDeath = b.no_payment_reason === 'فوت کاربر';
    const newCallCount = (c.call_count || 0) + 1;

    const waitRepeatMinutes = Number(stage.wait_repeat_minutes) || 0;
    const nextActionLabelAfterCall = stage.next_action_label || 'شکست استراتژی';
    const negWindow = { allowed_from: allowedFrom, allowed_to: allowedTo };
    const repeatOn = stage.repeat_on_results || [];

    // تعداد تلاش‌های انجام‌شده روی اکشن مذاکرهٔ جاری (شامل همین تماس)
    const maxRepeat = Number(c.max_call_count) || Number(stage.max_repeat) || 3;
    const attemptsSoFar = Number(c.current_action_repeat) || 0;
    if (attemptsSoFar >= maxRepeat) {
      return res.status(400).json({ error: 'سقف تماس‌های مجاز در این استراتژی پر شده است' });
    }
    const attemptsMade = attemptsSoFar + 1;
    const reachedMax = attemptsMade >= maxRepeat;

    const shouldRetryNegotiator =
      !isDeath &&
      !b.refer_to_legal &&
      repeatOn.length > 0 &&
      repeatOn.includes(b.call_status) &&
      attemptsMade < maxRepeat;

    let newStatus = 'in_negotiation';
    let nextAction = c.next_action;
    let nextActionDate = c.next_action_date;
    let clearStrategy = false;

    if (isDeath) {
      newStatus = 'burned';
      nextAction = null;
      nextActionDate = null;
      clearStrategy = true;
    } else if (b.refer_to_legal) {
      newStatus = 'pending_legal_assignment';
      nextAction = 'تخصیص به حقوقی';
      nextActionDate = null;
    } else if (shouldRetryNegotiator) {
      newStatus = 'pending_negotiator_recall';
      nextActionDate = computeNextActionDate(waitRepeatMinutes, negWindow);
      nextAction = 'تماس مذاکره‌کننده';
    } else if (b.call_status === 'پاسخگو نبود') {
      // پاسخگو نبود ولی در repeat_on_results نیست (یا سقف پر شده) → عبور به اقدام بعدی
      newStatus = 'in_negotiation';
      nextActionDate = nowDatetime();
      nextAction = nextActionLabelAfterCall;
    } else if (willPay) {
      if (reachedMax) {
        newStatus = 'in_negotiation';
        nextActionDate = jalaliDateTimeToDatetime(promisedDate, promisedTime);
        if (!nextActionDate) {
          return res.status(400).json({ error: 'تاریخ/ساعت تعهد پرداخت نامعتبر است' });
        }
        nextAction = nextActionLabelAfterCall;
      } else {
        nextActionDate = jalaliDateTimeToDatetime(promisedDate, promisedTime);
        if (!nextActionDate) {
          return res.status(400).json({ error: 'تاریخ/ساعت تعهد پرداخت نامعتبر است' });
        }
        nextAction = 'تماس مذاکره‌کننده';
      }
    } else if (reachedMax) {
      newStatus = 'in_negotiation';
      nextActionDate = nowDatetime();
      nextAction = nextActionLabelAfterCall;
    } else {
      // پاسخگو بود (ناسزا/عدم پرداخت/نامشخص): مذاکره‌کننده تاریخ و ساعت تماس بعدی را تعیین می‌کند.
      if (!b.next_call_date || !b.next_call_time) {
        return res.status(400).json({ error: 'تاریخ و ساعت تماس بعدی اجباری است' });
      }
      if (!isTimeWithinAllowedWindow(b.next_call_time, allowedFrom, allowedTo)) {
        return res
          .status(400)
          .json({ error: `ساعت تماس بعدی باید در بازه مجاز (${allowedFrom} تا ${allowedTo}) باشد` });
      }
      const combined = jalaliDateTimeToDatetime(b.next_call_date, b.next_call_time);
      if (!combined) return res.status(400).json({ error: 'تاریخ/ساعت تماس بعدی نامعتبر است' });
      nextActionDate = combined;
      nextAction = 'تماس مذاکره‌کننده';
    }

    const scheduledNextCall =
      !isDeath &&
      !b.refer_to_legal &&
      !shouldRetryNegotiator &&
      !reachedMax &&
      ((willPay && promisedDatetime) ||
        (Boolean(b.next_call_date) && Boolean(b.next_call_time)));
    const nextCallJalali =
      willPay && promisedDatetime
        ? promisedDatetime
        : scheduledNextCall
          ? `${b.next_call_date} ${b.next_call_time}`
          : null;

    let cost = 0;
    if (!isNoAnswer && c.assigned_negotiator_id) {
      const neg = query('SELECT hourly_wage FROM negotiators WHERE id = $n', {
        $n: c.assigned_negotiator_id,
      })[0];
      if (neg?.hourly_wage) {
        cost = Math.round((neg.hourly_wage * callDuration) / 60);
      }
    }

    const parts = [`وضعیت تماس: ${b.call_status}`];
    if (b.no_payment_reason) parts.push(`دلیل عدم پرداخت: ${b.no_payment_reason}`);
    if (b.payment_decision) parts.push(`تصمیم به پرداخت: ${b.payment_decision}`);
    if (willPay) parts.push(`تعهد: ${b.promised_amount} ریال در ${promisedDatetime}`);
    if (nextCallJalali) parts.push(`تماس بعدی: ${nextCallJalali}`);
    if (shouldRetryNegotiator)
      parts.push(`تکرار تماس — ${b.call_status} (تلاش ${attemptsMade} از ${maxRepeat})`);
    if (reachedMax && !isDeath && !b.refer_to_legal && !shouldRetryNegotiator)
      parts.push(`آخرین تماس — اقدام بعدی: ${nextActionLabelAfterCall}`);
    if (b.description) parts.push(`توضیحات: ${b.description}`);
    if (b.refer_to_legal) parts.push('ارجاع به حقوقی');
    const resultText = parts.join(' · ');

    const maxSeq = query(
      'SELECT COALESCE(MAX(seq),0) AS m FROM case_actions WHERE case_id = $id',
      { $id: id }
    )[0].m;

    run(
      `INSERT INTO case_actions
        (case_id, seq, action_type, body_text, result, action_date, cost, repeat_count, call_status, next_call_date)
       VALUES ($cid, $seq, 'negotiator_call', NULL, $res, $date, $cost, $rep, $cs, $ncd)`,
      {
        $cid: id,
        $seq: maxSeq + 1,
        $res: resultText,
        $date: nowJalaliDateTime(),
        $cost: cost,
        $rep: attemptsMade,
        $cs: b.call_status,
        $ncd: nextCallJalali,
      }
    );

    run(
      `UPDATE cases SET
        call_count = $cc,
        current_action_repeat = $rep,
        case_status = $st,
        next_action = $na,
        next_action_date = $nad,
        action_status = $as,
        last_action = 'تماس مذاکره‌کننده',
        last_action_date = $cd,
        case_cost = case_cost + $cost,
        strategy_id = CASE WHEN $clear = 1 THEN NULL ELSE strategy_id END,
        current_action_seq = CASE WHEN $clear = 1 THEN 0 ELSE current_action_seq END,
        updated_at = datetime('now')
       WHERE id = $id`,
      {
        $cc: newCallCount,
        $rep: attemptsMade,
        $st: newStatus,
        $na: nextAction,
        $nad: nextActionDate,
        $as: calcActionStatus(nextActionDate),
        $cd: b.call_date || null,
        $cost: cost,
        $clear: clearStrategy ? 1 : 0,
        $id: id,
      }
    );

    if (willPay && promisedDatetime) {
      run(`DELETE FROM promises WHERE case_id = $id AND status = 'pending'`, { $id: id });
      run(
        `INSERT INTO promises (case_id, promised_datetime, amount, status)
         VALUES ($id, $pdt, $amt, 'pending')`,
        { $id: id, $pdt: promisedDatetime, $amt: Number(b.promised_amount) }
      );
    }

    if (b.call_status === 'پاسخگو نبود' && !b.refer_to_legal && !isDeath && shouldRetryNegotiator) {
      await sendSms(c.mobile, NO_ANSWER_SMS_TEXT);
      run(
        `INSERT INTO case_history
          (case_id, debtor_id, user_name, operation, case_status, details)
         VALUES ($id, $did, 'سیستم', 'ارسال پیامک عدم پاسخگویی', $st, $det)`,
        { $id: id, $did: c.debtor_id, $st: newStatus, $det: NO_ANSWER_SMS_TEXT }
      );
    }

    if (b.send_payment_link) {
      const linkText = replacePlaceholders(PAYMENT_LINK_SMS_TEMPLATE, {
        userName: debtorName,
        claimsAmount: c.claims_amount,
      });
      await sendSms(c.mobile, linkText);
      run(
        `INSERT INTO case_history
          (case_id, debtor_id, user_name, operation, case_status, details)
         VALUES ($id, $did, $user, 'ارسال لینک پرداخت', $st, $det)`,
        {
          $id: id,
          $did: c.debtor_id,
          $user: userName,
          $st: newStatus,
          $det: linkText,
        }
      );
    }

    if (isDeath) {
      run(
        `INSERT INTO case_history
          (case_id, debtor_id, user_name, operation, case_status, details)
         VALUES ($id, $did, $user, 'سوخت پرونده — فوت کاربر', $st, $det)`,
        {
          $id: id,
          $did: c.debtor_id,
          $user: userName,
          $st: newStatus,
          $det: 'پرونده به دلیل فوت کاربر سوخت شد و استراتژی متوقف گردید.',
        }
      );
    }

    if (b.refer_to_legal) {
      run(
        `INSERT INTO case_history
          (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
         VALUES ($id, $did, $user, 'ارجاع به حقوقی توسط مذاکره‌کننده', $st, $na, $nad, $det)`,
        {
          $id: id,
          $did: c.debtor_id,
          $user: userName,
          $st: newStatus,
          $na: nextAction,
          $nad: nextActionDate,
          $det: 'ارجاع به حقوقی توسط مذاکره‌کننده',
        }
      );
    }

    const historyDetails = JSON.stringify({
      call_status: b.call_status,
      no_payment_reason: b.no_payment_reason || null,
      payment_decision: b.payment_decision || null,
      promised_date: willPay ? promisedDate : null,
      promised_time: willPay ? promisedTime : null,
      promised_datetime: willPay ? promisedDatetime : null,
      promised_amount: willPay ? Number(b.promised_amount) : null,
      call_duration: callDuration,
      call_cost: cost,
      next_call_date: nextCallJalali,
      next_call_time: scheduledNextCall ? b.next_call_time || null : null,
      no_answer: isNoAnswer,
      attempt: attemptsMade,
      max_repeat: maxRepeat,
      reached_max: isNoAnswer ? reachedMax : null,
      next_action: nextAction,
      description: b.description || null,
      refer_to_legal: Boolean(b.refer_to_legal),
    });

    run(
      `INSERT INTO case_history
        (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
       VALUES ($id, $did, $user, 'ثبت خروجی تماس', $st, $na, $nad, $details)`,
      {
        $id: id,
        $did: c.debtor_id,
        $user: userName,
        $st: newStatus,
        $na: nextAction,
        $nad: nextActionDate,
        $details: historyDetails,
      }
    );

    res.json({ data: { id, case_status: newStatus, call_count: newCallCount, cost } });
  } catch (err) {
    console.error('[POST /api/cases/:id/call-outcome]', err);
    res.status(500).json({ error: 'خطا در ثبت خروجی تماس' });
  }
});

module.exports = router;
