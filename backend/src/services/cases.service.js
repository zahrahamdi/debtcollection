'use strict';

const { query, run } = require('../db/database');
const {
  calcActionStatus,
  daysDiffFromToday,
  nowDatetime,
  nowJalaliDateTime,
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
const { userDisplayName } = require('../services/auth.service');

const DEFAULT_LIMIT = 100;

const STRATEGY_ACTION_LABELS = {
  warning_sms: 'پیامک هشدار',
  threatening_sms: 'پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

const CASE_SEGMENT_STRATEGY_JOINS = `
      LEFT JOIN segments seg ON seg.id = c.segment_id
      LEFT JOIN strategies str ON str.id = c.strategy_id
`;

const CASE_SEGMENT_STRATEGY_FIELDS = `
        seg.title AS segment_title,
        str.title AS strategy_title,
`;

const CASE_LIST_SELECT = `
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
`;

class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function actorName(user) {
  return user ? userDisplayName(user) : 'سیستم';
}

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

function enrichRow(row, lastActionMap) {
  const resolved = lastActionMap?.[row.id] ?? resolveLastAction(row.id);
  return {
    ...row,
    action_status: calcActionStatus(row.next_action_date),
    last_action: resolved.last_action,
    last_action_date: resolved.last_action_date,
  };
}

function buildActionStatusSqlCondition(status) {
  if (status === 'waiting') {
    return `(c.next_action_date IS NULL OR c.next_action_date > datetime('now', 'localtime'))`;
  }
  if (status === 'due_today') {
    return `(c.next_action_date IS NOT NULL AND c.next_action_date <= datetime('now', 'localtime') AND date(c.next_action_date) = date('now', 'localtime'))`;
  }
  if (status === 'overdue') {
    return `(c.next_action_date IS NOT NULL AND c.next_action_date <= datetime('now', 'localtime') AND date(c.next_action_date) < date('now', 'localtime'))`;
  }
  return null;
}

function buildListWhereClause(filters) {
  const conditions = [];
  const params = {};

  if (filters.debtor_name) {
    conditions.push(
      `(d.first_name LIKE $debtor_name OR d.last_name LIKE $debtor_name OR (d.first_name || ' ' || d.last_name) LIKE $debtor_name)`
    );
    params.$debtor_name = `%${filters.debtor_name}%`;
  }
  if (filters.national_code) {
    conditions.push('d.national_code = $national_code');
    params.$national_code = filters.national_code;
  }
  if (filters.credit_id) {
    conditions.push('c.credit_id = $credit_id');
    params.$credit_id = filters.credit_id;
  }
  if (filters.credit_type) {
    conditions.push('c.credit_type = $credit_type');
    params.$credit_type = filters.credit_type;
  }
  if (filters.case_status) {
    conditions.push('c.case_status = $case_status');
    params.$case_status = filters.case_status;
  }
  if (filters.assigned_negotiator_id) {
    conditions.push('c.assigned_negotiator_id = $assigned_negotiator_id');
    params.$assigned_negotiator_id = Number(filters.assigned_negotiator_id);
  } else if (filters.negotiator_name) {
    conditions.push('n.name LIKE $negotiator_name');
    params.$negotiator_name = `%${filters.negotiator_name}%`;
  }
  if (filters.action_status) {
    const actionSql = buildActionStatusSqlCondition(filters.action_status);
    if (actionSql) conditions.push(actionSql);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function listCases(filters = {}, pagination = {}) {
  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit = Math.max(1, Math.min(500, parseInt(pagination.limit, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  const { whereClause, params } = buildListWhereClause(filters);

  const countRow = query(
    `SELECT COUNT(*) AS total
     FROM cases c
     JOIN debtors d ON d.id = c.debtor_id
     LEFT JOIN negotiators n ON n.id = c.assigned_negotiator_id
     ${CASE_SEGMENT_STRATEGY_JOINS.replace(/^\s+/, '')}
     ${whereClause}`,
    params
  )[0];
  const total = countRow?.total ?? 0;
  const total_pages = Math.max(1, Math.ceil(total / limit) || 1);

  let rows = query(
    `${CASE_LIST_SELECT}
     ${whereClause}
     ORDER BY c.id ASC
     LIMIT $limit OFFSET $offset`,
    { ...params, $limit: limit, $offset: offset }
  );

  const lastActionMap = buildLastActionMap(rows.map((r) => r.id));
  rows = rows.map((r) => enrichRow(r, lastActionMap));

  return { data: rows, total, page, limit, total_pages };
}

function getCaseById(caseId) {
  const id = Number(caseId);
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

  if (!rows.length) return null;

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

  const strategyFailureCount = query(
    `SELECT COUNT(*) AS c FROM case_history WHERE case_id = $id AND operation = 'شکست استراتژی'`,
    { $id: id }
  )[0].c;

  const negotiatorCallOutcomes = actions.filter(
    (a) => a.action_type === 'negotiator_call' && a.call_status
  );
  const totalNegotiatorCalls = negotiatorCallOutcomes.length;

  const failureSeqs = actions
    .filter((a) => a.action_type === 'strategy_failure')
    .map((a) => Number(a.seq) || 0);
  const lastFailureSeq = failureSeqs.length ? Math.max(...failureSeqs) : 0;
  const currentStrategyCallCount = negotiatorCallOutcomes.filter(
    (a) => (Number(a.seq) || 0) > lastFailureSeq
  ).length;

  return {
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
  };
}

function assignCase(caseId, negotiatorId, user) {
  const id = Number(caseId);
  const userName = actorName(user);

  const caseRows = query('SELECT * FROM cases WHERE id = $id', { $id: id });
  if (!caseRows.length) throw new ServiceError(404, 'پرونده یافت نشد');
  const c = caseRows[0];

  const negRows = query('SELECT * FROM negotiators WHERE id = $id', { $id: negotiatorId });
  if (!negRows.length) throw new ServiceError(400, 'مذاکره‌کننده انتخاب‌شده یافت نشد');
  const neg = negRows[0];

  if (neg.status !== 'active') {
    throw new ServiceError(400, 'مذاکره‌کننده غیرفعال است و نمی‌توان به او تخصیص داد');
  }

  const isReassign = c.assigned_negotiator_id != null;

  if (!isReassign && c.case_status !== 'pending_negotiator_assignment') {
    throw new ServiceError(400, 'این پرونده در وضعیت «در انتظار تخصیص به مذاکره‌کننده» نیست');
  }
  if (isReassign && Number(c.assigned_negotiator_id) === Number(negotiatorId)) {
    throw new ServiceError(400, 'این پرونده هم‌اکنون به همین مذاکره‌کننده تخصیص یافته است');
  }

  const conflict = query(
    `SELECT COUNT(*) AS c FROM cases
       WHERE debtor_id = $d AND id <> $id
         AND assigned_negotiator_id IS NOT NULL AND assigned_negotiator_id <> $n
         AND case_status NOT IN ('paid','burned')`,
    { $d: c.debtor_id, $id: id, $n: negotiatorId }
  );
  if ((conflict[0]?.c ?? 0) > 0) {
    throw new ServiceError(400, 'پرونده دیگری از این بدهکار به مذاکره‌کننده دیگری واگذار شده است');
  }

  const targetActive = query(
    `SELECT COUNT(*) AS c FROM cases
       WHERE assigned_negotiator_id = $n AND id <> $id AND case_status NOT IN ('paid','burned')`,
    { $n: negotiatorId, $id: id }
  )[0].c;
  if (targetActive >= neg.capacity) {
    throw new ServiceError(400, 'ظرفیت مذاکره‌کننده تکمیل است و تخصیص انجام نشد');
  }

  if (isReassign) {
    run(
      `UPDATE cases SET assigned_negotiator_id = $n, updated_at = datetime('now') WHERE id = $id`,
      { $n: negotiatorId, $id: id }
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
        $n: negotiatorId,
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
      $user: userName,
      $op: op,
      $status: updated.case_status,
      $na: updated.next_action,
      $nad: updated.next_action_date,
      $details: isReassign
        ? `مذاکره‌کننده: ${neg.name}`
        : `مذاکره‌کننده: ${neg.name} — نوبت تماس از ${updated.next_action_date}`,
    }
  );

  return {
    id,
    assigned_negotiator_id: Number(negotiatorId),
    case_status: updated.case_status,
    mode: isReassign ? 'reassign' : 'assign',
  };
}

async function submitCallOutcome(caseId, body, user) {
  const id = Number(caseId);
  const b = body || {};
  const userName = actorName(user);

  const caseRows = query(
    `SELECT c.*, d.first_name, d.last_name, d.mobile
       FROM cases c
       JOIN debtors d ON d.id = c.debtor_id
       WHERE c.id = $id`,
    { $id: id }
  );
  if (!caseRows.length) throw new ServiceError(404, 'پرونده یافت نشد');
  const c = caseRows[0];

  if (c.case_status === 'paid' || c.case_status === 'burned') {
    throw new ServiceError(
      400,
      'این پرونده تعیین تکلیف شده و امکان ثبت خروجی تماس وجود ندارد.'
    );
  }

  const recentCall = query(
    `SELECT id FROM case_actions
     WHERE case_id = $id AND action_type = 'negotiator_call'
       AND created_at > datetime('now', '-10 seconds')`,
    { $id: id }
  );
  if (recentCall.length) {
    throw new ServiceError(400, 'خروجی تماس اخیراً ثبت شده است. لطفاً صبر کنید.');
  }

  if (!b.call_status) throw new ServiceError(400, 'وضعیت تماس اجباری است');

  const isNoAnswer = b.call_status === 'پاسخگو نبود' || b.call_status === 'no_answer';
  const callDuration = isNoAnswer ? 0 : Number(b.call_duration);
  if (!isNoAnswer && (!callDuration || callDuration <= 0)) {
    throw new ServiceError(400, 'مدت تماس به دقیقه اجباری است');
  }

  const willPay = b.payment_decision === 'دارد';
  const debtorName = `${c.first_name || ''} ${c.last_name || ''}`.trim();

  const stage = computeNegotiatorStage(c.strategy_id) || {};
  const allowedFrom = stage.allowed_from || '09:00';
  const allowedTo = stage.allowed_to || '18:00';

  if (willPay) {
    const promisedDatetimeNorm = normalizePromisedDatetime(b);
    if (!promisedDatetimeNorm || b.promised_amount === undefined || b.promised_amount === '') {
      throw new ServiceError(400, 'تاریخ، ساعت و مبلغ تعهد پرداخت اجباری است');
    }
    const promisedDate = promisedDateFromDatetime(promisedDatetimeNorm);
    const promisedTime = promisedTimeFromDatetime(promisedDatetimeNorm);

    if (Number(b.promised_amount) > Number(c.claims_amount)) {
      throw new ServiceError(400, 'مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد');
    }
    if (!isTimeWithinAllowedWindow(promisedTime, allowedFrom, allowedTo)) {
      throw new ServiceError(400, `ساعت تعهد باید در بازه مجاز (${allowedFrom} تا ${allowedTo}) باشد`);
    }
    if (isJalaliDatetimeInPast(promisedDate, promisedTime)) {
      throw new ServiceError(400, 'تاریخ و ساعت تعهد نمی‌تواند در گذشته باشد');
    }

    const settingRow = query(`SELECT value FROM settings WHERE key = 'promise_to_pay_max_days'`);
    const maxDays = parseInt(settingRow[0]?.value || '10', 10);
    const diffDays = daysDiffFromToday(promisedDate);

    if (diffDays === null) {
      throw new ServiceError(400, 'فرمت تاریخ تعهد پرداخت نامعتبر است (YYYY/MM/DD)');
    }
    if (diffDays < 0) {
      throw new ServiceError(400, 'تاریخ تعهد پرداخت نمی‌تواند در گذشته باشد');
    }
    if (diffDays > maxDays) {
      throw new ServiceError(400, `تاریخ تعهد پرداخت نمی‌تواند بیش از ${maxDays} روز از امروز باشد`);
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

  const maxRepeat = Number(c.max_call_count) || Number(stage.max_repeat) || 3;
  const attemptsSoFar = Number(c.current_action_repeat) || 0;
  if (attemptsSoFar >= maxRepeat) {
    throw new ServiceError(400, 'سقف تماس‌های مجاز در این استراتژی پر شده است');
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
    newStatus = 'in_negotiation';
    nextActionDate = nowDatetime();
    nextAction = nextActionLabelAfterCall;
  } else if (willPay) {
    if (reachedMax) {
      newStatus = 'in_negotiation';
      nextActionDate = jalaliDateTimeToDatetime(promisedDate, promisedTime);
      if (!nextActionDate) throw new ServiceError(400, 'تاریخ/ساعت تعهد پرداخت نامعتبر است');
      nextAction = nextActionLabelAfterCall;
    } else {
      nextActionDate = jalaliDateTimeToDatetime(promisedDate, promisedTime);
      if (!nextActionDate) throw new ServiceError(400, 'تاریخ/ساعت تعهد پرداخت نامعتبر است');
      nextAction = 'تماس مذاکره‌کننده';
    }
  } else if (reachedMax) {
    newStatus = 'in_negotiation';
    nextActionDate = nowDatetime();
    nextAction = nextActionLabelAfterCall;
  } else {
    if (!b.next_call_date || !b.next_call_time) {
      throw new ServiceError(400, 'تاریخ و ساعت تماس بعدی اجباری است');
    }
    if (!isTimeWithinAllowedWindow(b.next_call_time, allowedFrom, allowedTo)) {
      throw new ServiceError(400, `ساعت تماس بعدی باید در بازه مجاز (${allowedFrom} تا ${allowedTo}) باشد`);
    }
    const combined = jalaliDateTimeToDatetime(b.next_call_date, b.next_call_time);
    if (!combined) throw new ServiceError(400, 'تاریخ/ساعت تماس بعدی نامعتبر است');
    nextActionDate = combined;
    nextAction = 'تماس مذاکره‌کننده';
  }

  const scheduledNextCall =
    !isDeath &&
    !b.refer_to_legal &&
    !shouldRetryNegotiator &&
    !reachedMax &&
    ((willPay && promisedDatetime) || (Boolean(b.next_call_date) && Boolean(b.next_call_time)));
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
  if (shouldRetryNegotiator) {
    parts.push(`تکرار تماس — ${b.call_status} (تلاش ${attemptsMade} از ${maxRepeat})`);
  }
  if (reachedMax && !isDeath && !b.refer_to_legal && !shouldRetryNegotiator) {
    parts.push(`آخرین تماس — اقدام بعدی: ${nextActionLabelAfterCall}`);
  }
  if (b.description) parts.push(`توضیحات: ${b.description}`);
  if (b.refer_to_legal) parts.push('ارجاع به حقوقی');
  const resultText = parts.join(' · ');

  const maxSeq = query('SELECT COALESCE(MAX(seq),0) AS m FROM case_actions WHERE case_id = $id', {
    $id: id,
  })[0].m;

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

  return { id, case_status: newStatus, call_count: newCallCount, cost };
}

module.exports = {
  ServiceError,
  listCases,
  getCaseById,
  assignCase,
  submitCallOutcome,
};
