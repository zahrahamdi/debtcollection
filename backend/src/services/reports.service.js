'use strict';

const { query } = require('../db/database');
const {
  jalaliDateToDatetime,
  gregorianToJalali,
  formatJalali,
} = require('../db/dateUtil');

const SMS_TYPES = ['warning_sms', 'threatening_sms'];
const AUTOCALL_TYPES = ['warning_autocall', 'threatening_autocall'];
const NEGOTIATOR_TYPES = ['negotiator_call'];
const CONVERSION_ACTION_TYPES = [
  ...SMS_TYPES,
  ...AUTOCALL_TYPES,
  ...NEGOTIATOR_TYPES,
];

const FOLLOWUP_EXCLUDED_STATUSES = new Set([
  'burned',
  'paid',
  'pending_cei',
  'pending_strategy',
  'pending_strategy_start',
  'pending_legal_assignment',
]);

const ACTION_LABELS = {
  warning_sms: 'ارسال پیامک هشدار',
  threatening_sms: 'ارسال پیامک تهدید',
  warning_autocall: 'تماس خودکار هشدار',
  threatening_autocall: 'تماس خودکار تهدید',
  negotiator_call: 'تماس مذاکره‌کننده',
};

const STATUS_KEYS = [
  'pending_sms_result',
  'pending_sms_retry',
  'pending_autocall_result',
  'pending_autocall_retry',
  'pending_strategy_continue',
  'pending_negotiator_assignment',
  'pending_negotiator_call',
  'pending_negotiator_recall',
  'in_negotiation',
  'pending_legal_assignment',
  'burned',
  'paid',
];

const STATUS_LABELS = {
  pending_cei: 'در انتظار محاسبه CEI',
  pending_strategy: 'در انتظار تخصیص استراتژی',
  pending_strategy_start: 'در انتظار شروع استراتژی',
  pending_strategy_continue: 'در انتظار ادامه استراتژی',
  pending_sms_result: 'در انتظار نتیجه پیامک',
  pending_sms_retry: 'در انتظار ارسال مجدد پیامک',
  pending_autocall_result: 'در انتظار نتیجه تماس خودکار',
  pending_autocall_retry: 'در انتظار تماس خودکار مجدد',
  pending_negotiator_assignment: 'در انتظار تخصیص به مذاکره‌کننده',
  pending_negotiator_call: 'در انتظار تماس مذاکره‌کننده',
  pending_negotiator_recall: 'در انتظار تماس مجدد مذاکره‌کننده',
  in_negotiation: 'در انتظار نتیجه تماس مذاکره‌کننده',
  pending_legal_assignment: 'در انتظار تخصیص به حقوقی',
  paid: 'پرداخت شده',
  burned: 'سوخت شده',
};

function parseFilters(q) {
  const fromDt = q.from_date ? jalaliDateToDatetime(String(q.from_date).trim()) : null;
  let toDt = q.to_date ? jalaliDateToDatetime(String(q.to_date).trim()) : null;
  if (toDt) toDt = toDt.replace(' 00:00:00', ' 23:59:59');

  return {
    from_date: q.from_date ? String(q.from_date).trim() : null,
    to_date: q.to_date ? String(q.to_date).trim() : null,
    from_dt: fromDt,
    to_dt: toDt,
    credit_type: q.credit_type || null,
    segment_id: q.segment_id ? Number(q.segment_id) : null,
    negotiator_id: q.negotiator_id ? Number(q.negotiator_id) : null,
    province: q.province ? String(q.province).trim() : null,
    case_status: q.case_status ? String(q.case_status).trim() : null,
    strategy_id: q.strategy_id ? Number(q.strategy_id) : null,
    cooperation_type: q.cooperation_type ? String(q.cooperation_type).trim() : null,
  };
}

function buildCaseWhere(filters, { dateField = 'created_at' } = {}) {
  const parts = [];
  const params = {};
  const joins = [];
  const joinSet = new Set();

  const addJoin = (sql) => {
    if (!joinSet.has(sql)) {
      joinSet.add(sql);
      joins.push(sql);
    }
  };

  if (filters.province) {
    addJoin('INNER JOIN debtors d ON d.id = c.debtor_id');
    parts.push('d.province = $province');
    params.$province = filters.province;
  }
  if (filters.cooperation_type) {
    addJoin('INNER JOIN negotiators neg ON neg.id = c.assigned_negotiator_id');
    parts.push('neg.cooperation_type = $cooperation_type');
    params.$cooperation_type = filters.cooperation_type;
  }
  if (filters.credit_type) {
    parts.push('c.credit_type = $credit_type');
    params.$credit_type = filters.credit_type;
  }
  if (filters.segment_id) {
    parts.push('c.segment_id = $segment_id');
    params.$segment_id = filters.segment_id;
  }
  if (filters.negotiator_id) {
    parts.push('c.assigned_negotiator_id = $negotiator_id');
    params.$negotiator_id = filters.negotiator_id;
  }
  if (filters.case_status) {
    parts.push('c.case_status = $case_status');
    params.$case_status = filters.case_status;
  }
  if (filters.strategy_id) {
    parts.push('c.strategy_id = $strategy_id');
    params.$strategy_id = filters.strategy_id;
  }
  if (filters.from_dt && dateField) {
    parts.push(`c.${dateField} >= $from_dt`);
    params.$from_dt = filters.from_dt;
  }
  if (filters.to_dt && dateField) {
    parts.push(`c.${dateField} <= $to_dt`);
    params.$to_dt = filters.to_dt;
  }

  return {
    joins,
    clause: parts.length ? parts.join(' AND ') : '1=1',
    params,
  };
}

function caseFromClause(where) {
  const joinStr = where.joins.length ? ` ${where.joins.join(' ')}` : '';
  return `FROM cases c${joinStr} WHERE ${where.clause}`;
}

function parseFlexibleDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = new Date(s.replace(' ', 'T')).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const iso = jalaliDateToDatetime(s.split(' ')[0]);
    if (!iso) return null;
    const t = new Date(iso.replace(' ', 'T')).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function utcDatetimeToJalaliDate(isoStr) {
  if (!isoStr) return null;
  const s = String(isoStr).trim();
  const dt = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const j = gregorianToJalali(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  return formatJalali(j.year, j.month, j.day);
}

function addDaysToJalali(jalaliStr, days) {
  const iso = jalaliDateToDatetime(jalaliStr);
  if (!iso) return null;
  const dt = new Date(iso.replace(' ', 'T'));
  dt.setDate(dt.getDate() + days);
  const j = gregorianToJalali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return formatJalali(j.year, j.month, j.day);
}

function iterateJalaliDates(fromJalali, toJalali) {
  if (!fromJalali || !toJalali) return [];
  const dates = [];
  let cur = fromJalali;
  let guard = 0;
  while (cur <= toJalali && guard < 4000) {
    dates.push(cur);
    const next = addDaysToJalali(cur, 1);
    if (!next || next === cur) break;
    cur = next;
    guard += 1;
  }
  return dates;
}

function actionChannel(actionType) {
  if (SMS_TYPES.includes(actionType)) return 'sms';
  if (AUTOCALL_TYPES.includes(actionType)) return 'autocall';
  if (NEGOTIATOR_TYPES.includes(actionType)) return 'negotiator';
  return null;
}

function mapStatusCount(rows) {
  const map = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  for (const row of rows) {
    const key = row.case_status;
    if (map[key] !== undefined) map[key] += row.cnt;
  }
  return map;
}

function sumCosts(rows) {
  let sms = 0;
  let autocall = 0;
  let negotiator = 0;
  for (const row of rows) {
    const cost = Number(row.total_cost) || 0;
    if (SMS_TYPES.includes(row.action_type)) sms += cost;
    else if (AUTOCALL_TYPES.includes(row.action_type)) autocall += cost;
    else if (NEGOTIATOR_TYPES.includes(row.action_type)) negotiator += cost;
  }
  return { sms, autocall, negotiator, total: sms + autocall + negotiator };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function costToCollectionRatio(totalCost, totalCollected) {
  if (!totalCollected || totalCollected <= 0) return null;
  return round4(totalCost / totalCollected);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function computeAvgDaysToPayment(cases, paymentsByCase) {
  const days = [];
  for (const c of cases) {
    if (c.case_status !== 'paid') continue;
    const created = parseFlexibleDate(c.created_at);
    if (!created) continue;
    const pays = paymentsByCase[c.id] || [];
    if (!pays.length) continue;
    const firstPay = pays.reduce((min, p) => {
      const t = parseFlexibleDate(p.payment_date);
      return t && (!min || t < min) ? t : min;
    }, null);
    if (!firstPay) continue;
    days.push((firstPay - created) / 86400000);
  }
  if (!days.length) return null;
  return round2(days.reduce((a, b) => a + b, 0) / days.length);
}

function sumCollectedForCases(caseIds, paymentsByCase) {
  let total = 0;
  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      total += Number(p.amount) || 0;
    }
  }
  return total;
}

function sumFullCollectedForCases(caseIds, paymentsByCase) {
  let total = 0;
  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      if (p.payment_type === 'full') total += Number(p.amount) || 0;
    }
  }
  return total;
}

function loadStrategyFailuresByCase(caseIds) {
  if (!caseIds.length) return {};
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  const rows = query(
    `SELECT case_id, action_date FROM case_actions
     WHERE case_id IN (${ph}) AND action_type = 'strategy_failure'`,
    params
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.case_id]) map[r.case_id] = [];
    map[r.case_id].push(r);
  }
  return map;
}

function firstOutcomeAfterAction(caseId, actionDate, paymentsByCase, failuresByCase) {
  const actionTs = parseFlexibleDate(actionDate);
  const events = [];

  for (const p of paymentsByCase[caseId] || []) {
    const payTs = parseFlexibleDate(p.payment_date);
    if (payTs === null) continue;
    if (actionTs !== null && payTs < actionTs) continue;
    if (p.payment_type === 'full') events.push({ type: 'full', ts: payTs });
    else if (p.payment_type === 'partial') events.push({ type: 'partial', ts: payTs });
  }

  for (const f of failuresByCase[caseId] || []) {
    const fTs = parseFlexibleDate(f.action_date);
    if (fTs === null) continue;
    if (actionTs !== null && fTs < actionTs) continue;
    events.push({ type: 'failure', ts: fTs });
  }

  if (!events.length) return 'continue';
  events.sort((a, b) => a.ts - b.ts);
  return events[0].type;
}

function casePaidAfterAction(caseRow, actionDate, paymentsByCase) {
  if (caseRow.case_status !== 'paid') return false;
  const pays = paymentsByCase[caseRow.id] || [];
  const actionTs = parseFlexibleDate(actionDate);
  if (actionTs === null) return pays.length > 0;
  return pays.some((p) => {
    const payTs = parseFlexibleDate(p.payment_date);
    return payTs !== null && payTs >= actionTs;
  });
}

function attributePaymentChannel(caseId, paymentDate, actionsByCase) {
  const actions = (actionsByCase[caseId] || [])
    .filter((a) => !['payment_full', 'payment_partial'].includes(a.action_type))
    .sort((a, b) => (parseFlexibleDate(a.action_date) || 0) - (parseFlexibleDate(b.action_date) || 0));

  const payTs = parseFlexibleDate(paymentDate);
  if (!payTs) return null;

  let last = null;
  for (const a of actions) {
    const ts = parseFlexibleDate(a.action_date);
    if (ts !== null && ts <= payTs) last = a;
  }
  return last ? actionChannel(last.action_type) : null;
}

function paymentInJalaliRange(paymentDate, fromJalali, toJalali) {
  if (!paymentDate) return false;
  const d = String(paymentDate).split(' ')[0];
  if (fromJalali && d < fromJalali) return false;
  if (toJalali && d > toJalali) return false;
  return true;
}

function loadActionsByCase(caseIds) {
  if (!caseIds.length) return {};
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  const rows = query(
    `SELECT case_id, action_type, action_date, cost FROM case_actions WHERE case_id IN (${ph})`,
    params
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.case_id]) map[r.case_id] = [];
    map[r.case_id].push(r);
  }
  return map;
}

function loadPaymentsByCase(caseIds) {
  if (!caseIds.length) return {};
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  const rows = query(
    `SELECT case_id, amount, payment_date, payment_type FROM payments WHERE case_id IN (${ph})`,
    params
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.case_id]) map[r.case_id] = [];
    map[r.case_id].push(r);
  }
  return map;
}

function strategyStats(strategyId, filters) {
  const where = buildCaseWhere(filters, { dateField: 'created_at' });
  const params = { ...where.params, $sid: strategyId };

  const cases = query(
    `SELECT c.id, c.case_status, c.created_at ${caseFromClause(where)} AND c.strategy_id = $sid`,
    params
  );

  const total = cases.length;
  const paidCases = cases.filter((c) => c.case_status === 'paid');
  const paidCount = paidCases.length;
  const conversionRate = total > 0 ? round2((paidCount / total) * 100) : 0;

  const caseIds = cases.map((c) => c.id);
  const paymentsByCase = loadPaymentsByCase(caseIds);
  const avgDays = computeAvgDaysToPayment(paidCases, paymentsByCase);

  return {
    total_cases: total,
    paid_cases: paidCount,
    conversion_rate: conversionRate,
    success_rate: conversionRate,
    avg_days_to_payment: avgDays,
    cases,
    paymentsByCase,
  };
}

function strategyCostForCases(caseIds, jalaliFrom, jalaliTo) {
  if (!caseIds.length) return 0;
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  let dateClause = '';
  if (jalaliFrom) {
    dateClause += ' AND ca.action_date >= $from_jalali';
    params.$from_jalali = jalaliFrom;
  }
  if (jalaliTo) {
    dateClause += ' AND ca.action_date <= $to_jalali';
    params.$to_jalali = jalaliTo;
  }
  const row = query(
    `SELECT COALESCE(SUM(ca.cost), 0) AS total_cost
     FROM case_actions ca
     WHERE ca.case_id IN (${ph})${dateClause}`,
    params
  )[0];
  return Number(row?.total_cost) || 0;
}

function pickAbWinner(statsA, statsB) {
  if (statsA.success_rate !== statsB.success_rate) {
    return statsA.success_rate > statsB.success_rate ? 'a' : 'b';
  }
  const daysA = statsA.avg_days_to_payment ?? Infinity;
  const daysB = statsB.avg_days_to_payment ?? Infinity;
  if (daysA !== daysB) return daysA < daysB ? 'a' : 'b';
  return statsA.cost <= statsB.cost ? 'a' : 'b';
}

function buildActionDateCaseWhere(filters) {
  const caseFilters = { ...filters, from_dt: null, to_dt: null };
  const where = buildCaseWhere(caseFilters, { dateField: null });
  return where;
}

function getCasesReport(filters) {
  const where = buildCaseWhere(filters, { dateField: 'created_at' });

  const allCases = query(
    `SELECT c.id, c.case_status, c.created_at, c.claims_amount, c.segment_id ${caseFromClause(where)}`,
    where.params
  );

  const total_cases = allCases.length;
  const paid_cases = allCases.filter((c) => c.case_status === 'paid').length;
  const burned_cases = allCases.filter((c) => c.case_status === 'burned').length;
  const legal_cases = allCases.filter((c) => c.case_status === 'pending_legal_assignment').length;
  const collection_rate = total_cases > 0 ? round2((paid_cases / total_cases) * 100) : 0;
  const total_claims = allCases.reduce((s, c) => s + (Number(c.claims_amount) || 0), 0);

  const caseIds = allCases.map((c) => c.id);
  const paymentsByCase = loadPaymentsByCase(caseIds);
  const total_collected = sumCollectedForCases(caseIds, paymentsByCase);
  const avg_days_to_payment = computeAvgDaysToPayment(allCases, paymentsByCase);
  const total_cost = strategyCostForCases(caseIds, null, null);
  const cost_to_collection_ratio = costToCollectionRatio(total_cost, total_collected);
  const active_followup_cases = allCases.filter(
    (c) => !FOLLOWUP_EXCLUDED_STATUSES.has(c.case_status)
  ).length;

  const statusCountMap = {};
  for (const c of allCases) {
    statusCountMap[c.case_status] = (statusCountMap[c.case_status] || 0) + 1;
  }
  const cases_by_status = Object.entries(statusCountMap)
    .map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status] || status,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const segmentJoinStr = where.joins.length ? ` ${where.joins.join(' ')}` : '';
  const segmentRows = query(
    `SELECT c.segment_id, s.title AS segment, COUNT(*) AS cnt
     FROM cases c${segmentJoinStr}
     LEFT JOIN segments s ON s.id = c.segment_id
     WHERE ${where.clause}
     GROUP BY c.segment_id, s.title
     ORDER BY cnt DESC`,
    where.params
  );
  const cases_by_segment = segmentRows.map((r) => ({
    segment_id: r.segment_id,
    segment: r.segment || '—',
    count: r.cnt,
  }));

  const createdByJalali = {};
  const paidFullByJalali = {};
  for (const c of allCases) {
    const jDate = utcDatetimeToJalaliDate(c.created_at);
    if (jDate) createdByJalali[jDate] = (createdByJalali[jDate] || 0) + 1;
  }
  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      if (p.payment_type !== 'full') continue;
      const jPay = String(p.payment_date || '').split(' ')[0];
      if (!jPay) continue;
      paidFullByJalali[jPay] = (paidFullByJalali[jPay] || 0) + 1;
    }
  }

  const trendDates =
    filters.from_date && filters.to_date
      ? iterateJalaliDates(filters.from_date, filters.to_date)
      : [...new Set([...Object.keys(createdByJalali), ...Object.keys(paidFullByJalali)])].sort();

  const daily_trend = trendDates.map((date) => ({
    date,
    created_count: createdByJalali[date] || 0,
    paid_full_count: paidFullByJalali[date] || 0,
  }));

  return {
    total_cases,
    paid_cases,
    collection_rate,
    burned_cases,
    legal_cases,
    total_claims,
    total_collected,
    total_cost,
    cost_to_collection_ratio,
    active_followup_cases,
    avg_days_to_payment,
    cases_by_status,
    cases_by_segment,
    daily_trend,
  };
}

function getFunnelReport(filters) {
  const caseWhere = buildCaseWhere(filters, { dateField: 'created_at' });
  const joinStr = caseWhere.joins.length ? ` ${caseWhere.joins.join(' ')}` : '';
  const allCases = query(
    `SELECT c.id, c.case_status, c.created_at FROM cases c${joinStr} WHERE ${caseWhere.clause}`,
    caseWhere.params
  );
  const total_cases = allCases.length;
  const caseMap = Object.fromEntries(allCases.map((c) => [c.id, c]));
  const caseIds = allCases.map((c) => c.id);
  const paymentsByCase = loadPaymentsByCase(caseIds);
  const failuresByCase = loadStrategyFailuresByCase(caseIds);

  const legal_cases = allCases.filter((c) => c.case_status === 'pending_legal_assignment').length;

  const actionWhere = buildActionDateCaseWhere(filters);
  const actionJoinStr = actionWhere.joins.length ? ` ${actionWhere.joins.join(' ')}` : '';

  const actions = query(
    `SELECT ca.case_id, ca.action_type, ca.action_date
     FROM case_actions ca
     INNER JOIN cases c ON c.id = ca.case_id${actionJoinStr}
     WHERE ${actionWhere.clause}
       AND ca.action_type IN ($t1, $t2, $t3, $t4, $t5)
       ${filters.from_date ? 'AND ca.action_date >= $from_jalali' : ''}
       ${filters.to_date ? 'AND ca.action_date <= $to_jalali' : ''}`,
    {
      ...actionWhere.params,
      $t1: 'warning_sms',
      $t2: 'threatening_sms',
      $t3: 'warning_autocall',
      $t4: 'threatening_autocall',
      $t5: 'negotiator_call',
      ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
      ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
    }
  );

  const reachedByType = {};
  const firstActionByCaseType = {};
  for (const type of CONVERSION_ACTION_TYPES) {
    reachedByType[type] = new Set();
  }

  for (const action of actions) {
    if (!CONVERSION_ACTION_TYPES.includes(action.action_type)) continue;
    if (!caseMap[action.case_id]) continue;
    reachedByType[action.action_type].add(action.case_id);

    const key = `${action.case_id}:${action.action_type}`;
    const existing = firstActionByCaseType[key];
    if (!existing) {
      firstActionByCaseType[key] = action;
    } else {
      const existingTs = parseFlexibleDate(existing.action_date) ?? Infinity;
      const curTs = parseFlexibleDate(action.action_date) ?? Infinity;
      if (curTs < existingTs) firstActionByCaseType[key] = action;
    }
  }

  let orderedTypes = CONVERSION_ACTION_TYPES;
  if (filters.strategy_id) {
    const strategySteps = query(
      `SELECT DISTINCT action_type FROM strategy_actions
       WHERE strategy_id = $sid AND action_type IN ($t1, $t2, $t3, $t4, $t5)
       ORDER BY MIN(seq) ASC`,
      {
        $sid: filters.strategy_id,
        $t1: 'warning_sms',
        $t2: 'threatening_sms',
        $t3: 'warning_autocall',
        $t4: 'threatening_autocall',
        $t5: 'negotiator_call',
      }
    );
    if (strategySteps.length) {
      orderedTypes = strategySteps.map((r) => r.action_type);
    }
  }

  const steps = orderedTypes.map((action_type) => {
    const reached_count = reachedByType[action_type].size;
    let paid_full_count = 0;
    let paid_partial_count = 0;
    let strategy_failure_count = 0;

    for (const caseId of reachedByType[action_type]) {
      const firstAction = firstActionByCaseType[`${caseId}:${action_type}`];
      if (!firstAction) continue;
      const outcome = firstOutcomeAfterAction(
        caseId,
        firstAction.action_date,
        paymentsByCase,
        failuresByCase
      );
      if (outcome === 'full') paid_full_count += 1;
      else if (outcome === 'partial') paid_partial_count += 1;
      else if (outcome === 'failure') strategy_failure_count += 1;
    }

    const continued_count = Math.max(
      0,
      reached_count - paid_full_count - paid_partial_count - strategy_failure_count
    );
    const conversion_rate =
      reached_count > 0 ? round2((paid_full_count / reached_count) * 100) : 0;

    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      reached_count,
      paid_full_count,
      paid_partial_count,
      strategy_failure_count,
      continued_count,
      paid_after_count: paid_full_count,
      paid_after_percent: total_cases > 0 ? round2((paid_full_count / total_cases) * 100) : 0,
      reached_percent: total_cases > 0 ? round2((reached_count / total_cases) * 100) : 0,
      conversion_rate,
    };
  });

  return { total_cases, legal_cases, steps };
}

function getStrategiesPerformance(filters) {
  let strategySql = `
    SELECT s.id, s.title, s.credit_type, s.segment_id, seg.title AS segment
    FROM strategies s
    LEFT JOIN segments seg ON seg.id = s.segment_id
    WHERE 1=1`;
  const strategyParams = {};
  if (filters.credit_type) {
    strategySql += ' AND s.credit_type = $credit_type';
    strategyParams.$credit_type = filters.credit_type;
  }
  if (filters.segment_id) {
    strategySql += ' AND s.segment_id = $segment_id';
    strategyParams.$segment_id = filters.segment_id;
  }
  if (filters.strategy_id) {
    strategySql += ' AND s.id = $strategy_id';
    strategyParams.$strategy_id = filters.strategy_id;
  }
  strategySql += ' ORDER BY s.id ASC';

  const strategies = query(strategySql, strategyParams);

  const strategies_comparison = strategies.map((s) => {
    const stats = strategyStats(s.id, filters);
    const caseIds = stats.cases.map((c) => c.id);
    const total_cost = strategyCostForCases(caseIds, filters.from_date, filters.to_date);
    const total_collected = sumFullCollectedForCases(caseIds, stats.paymentsByCase);
    return {
      strategy_id: s.id,
      title: s.title,
      segment: s.segment || '—',
      total_cases: stats.total_cases,
      success_rate: stats.success_rate,
      avg_days_to_payment: stats.avg_days_to_payment,
      total_cost,
      total_collected,
      cost_to_collection_ratio: costToCollectionRatio(total_cost, total_collected),
      cost_per_collected: total_collected > 0 ? round4(total_cost / total_collected) : null,
    };
  });

  const abScenarios = query(`
    SELECT ab.*,
           sa.title AS strategy_a_title,
           sb.title AS strategy_b_title
    FROM ab_tests ab
    LEFT JOIN strategies sa ON sa.id = ab.strategy_a_id
    LEFT JOIN strategies sb ON sb.id = ab.strategy_b_id
    ORDER BY ab.id ASC
  `);

  const ab_test_results = abScenarios.map((ab) => {
    const abFilters = { ...filters };
    if (!abFilters.credit_type) abFilters.credit_type = ab.credit_type;
    if (!abFilters.segment_id && ab.segment_id) abFilters.segment_id = ab.segment_id;

    const statsA = strategyStats(ab.strategy_a_id, abFilters);
    const statsB = strategyStats(ab.strategy_b_id, abFilters);
    const costA = strategyCostForCases(
      statsA.cases.map((c) => c.id),
      abFilters.from_date,
      abFilters.to_date
    );
    const costB = strategyCostForCases(
      statsB.cases.map((c) => c.id),
      abFilters.from_date,
      abFilters.to_date
    );

    const strategy_a = {
      title: ab.strategy_a_title,
      success_rate: statsA.success_rate,
      avg_days: statsA.avg_days_to_payment,
      cost: costA,
    };
    const strategy_b = {
      title: ab.strategy_b_title,
      success_rate: statsB.success_rate,
      avg_days: statsB.avg_days_to_payment,
      cost: costB,
    };

    return {
      scenario_name: ab.name,
      strategy_a,
      strategy_b,
      winner: pickAbWinner(
        { success_rate: statsA.success_rate, avg_days_to_payment: statsA.avg_days_to_payment, cost: costA },
        { success_rate: statsB.success_rate, avg_days_to_payment: statsB.avg_days_to_payment, cost: costB }
      ),
    };
  });

  return { strategies_comparison, ab_test_results };
}

function getStrategiesCost(filters) {
  const where = buildActionDateCaseWhere(filters);
  const joinStr = where.joins.length ? ` ${where.joins.join(' ')}` : '';

  const costRows = query(
    `SELECT ca.action_type, SUM(ca.cost) AS total_cost, COUNT(*) AS executions
     FROM case_actions ca
     INNER JOIN cases c ON c.id = ca.case_id${joinStr}
     WHERE ${where.clause}
       AND ca.action_type IN ($t1, $t2, $t3, $t4, $t5)
       ${filters.from_date ? 'AND ca.action_date >= $from_jalali' : ''}
       ${filters.to_date ? 'AND ca.action_date <= $to_jalali' : ''}
     GROUP BY ca.action_type`,
    {
      ...where.params,
      $t1: 'warning_sms',
      $t2: 'threatening_sms',
      $t3: 'warning_autocall',
      $t4: 'threatening_autocall',
      $t5: 'negotiator_call',
      ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
      ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
    }
  );

  const costs = sumCosts(costRows);
  const total_sms_cost = costs.sms;
  const total_autocall_cost = costs.autocall;
  const total_negotiator_cost = costs.negotiator;
  const total_cost = costs.total;

  const matchedCases = query(
    `SELECT DISTINCT c.id ${caseFromClause(where)}
     ${filters.from_date ? 'AND EXISTS (SELECT 1 FROM case_actions ca2 WHERE ca2.case_id = c.id AND ca2.action_date >= $from_jalali)' : ''}
     ${filters.to_date ? 'AND EXISTS (SELECT 1 FROM case_actions ca3 WHERE ca3.case_id = c.id AND ca3.action_date <= $to_jalali)' : ''}`,
    {
      ...where.params,
      ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
      ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
    }
  );
  const caseIds = matchedCases.map((c) => c.id);
  const actionsByCase = loadActionsByCase(caseIds);
  const paymentsByCase = loadPaymentsByCase(caseIds);

  let total_collected = 0;
  const collectedByChannel = { sms: 0, autocall: 0, negotiator: 0, other: 0 };

  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) continue;
      const amt = Number(p.amount) || 0;
      total_collected += amt;
      const ch = attributePaymentChannel(id, p.payment_date, actionsByCase);
      if (ch === 'sms') collectedByChannel.sms += amt;
      else if (ch === 'autocall') collectedByChannel.autocall += amt;
      else if (ch === 'negotiator') collectedByChannel.negotiator += amt;
      else collectedByChannel.other += amt;
    }
  }

  const roi = total_cost > 0 ? round2((total_collected / total_cost) * 100) : null;
  const cost_to_collection_ratio = costToCollectionRatio(total_cost, total_collected);

  const actionExecutions = query(
    `SELECT ca.id, ca.case_id, ca.action_type, ca.action_date, ca.cost
     FROM case_actions ca
     INNER JOIN cases c ON c.id = ca.case_id${joinStr}
     WHERE ${where.clause}
       AND ca.action_type IN ($t1, $t2, $t3, $t4, $t5)
       ${filters.from_date ? 'AND ca.action_date >= $from_jalali' : ''}
       ${filters.to_date ? 'AND ca.action_date <= $to_jalali' : ''}`,
    {
      ...where.params,
      $t1: 'warning_sms',
      $t2: 'threatening_sms',
      $t3: 'warning_autocall',
      $t4: 'threatening_autocall',
      $t5: 'negotiator_call',
      ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
      ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
    }
  );

  const collectedByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );
  const paymentsAfterByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );

  for (const action of actionExecutions) {
    if (!CONVERSION_ACTION_TYPES.includes(action.action_type)) continue;
    const pays = paymentsByCase[action.case_id] || [];
    const actionTs = parseFlexibleDate(action.action_date);
    let actionCollected = 0;
    let hasPaymentAfter = false;
    for (const p of pays) {
      if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) continue;
      const payTs = parseFlexibleDate(p.payment_date);
      if (actionTs !== null && payTs !== null && payTs >= actionTs) {
        hasPaymentAfter = true;
        actionCollected += Number(p.amount) || 0;
      }
    }
    if (hasPaymentAfter) paymentsAfterByAction[action.action_type] += 1;
    collectedByAction[action.action_type] += actionCollected;
  }

  const action_stats = CONVERSION_ACTION_TYPES.map((action_type) => {
    const row = costRows.find((r) => r.action_type === action_type);
    const execution_count = row?.executions ?? 0;
    const actionCost = Number(row?.total_cost) || 0;
    const actionCollected = collectedByAction[action_type] || 0;
    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      execution_count,
      total_cost: actionCost,
      total_collected: actionCollected,
      roi: actionCost > 0 ? round2((actionCollected / actionCost) * 100) : null,
      cost_to_collection_ratio: costToCollectionRatio(actionCost, actionCollected),
      conversion_rate:
        execution_count > 0
          ? round2((paymentsAfterByAction[action_type] / execution_count) * 100)
          : 0,
    };
  });

  const cost_distribution = CONVERSION_ACTION_TYPES.map((action_type) => {
    const row = costRows.find((r) => r.action_type === action_type);
    const value = Number(row?.total_cost) || 0;
    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      value,
      percent: total_cost > 0 ? round2((value / total_cost) * 100) : 0,
    };
  }).filter((item) => item.value > 0);

  const collectedTotalForDist = CONVERSION_ACTION_TYPES.reduce(
    (sum, t) => sum + (collectedByAction[t] || 0),
    0
  );

  const collection_distribution = CONVERSION_ACTION_TYPES.map((action_type) => {
    const value = collectedByAction[action_type] || 0;
    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      value,
      percent:
        collectedTotalForDist > 0 ? round2((value / collectedTotalForDist) * 100) : 0,
    };
  }).filter((item) => item.value > 0);

  return {
    summary: {
      total_sms_cost,
      total_autocall_cost,
      total_negotiator_cost,
      total_cost,
      total_collected,
      roi,
      cost_to_collection_ratio,
    },
    action_stats,
    cost_distribution,
    collection_distribution,
  };
}

function getNegotiatorsReport(filters) {
  const negParts = ['1=1'];
  const negParams = {};
  if (filters.negotiator_id) {
    negParts.push('n.id = $negotiator_id');
    negParams.$negotiator_id = filters.negotiator_id;
  }
  if (filters.cooperation_type) {
    negParts.push('n.cooperation_type = $cooperation_type');
    negParams.$cooperation_type = filters.cooperation_type;
  }

  const negotiators = query(
    `SELECT n.id, n.name, n.cooperation_type, n.status
     FROM negotiators n
     WHERE ${negParts.join(' AND ')}
     ORDER BY n.name ASC`,
    negParams
  );

  const activeCaseRows = query(
    `SELECT c.assigned_negotiator_id AS negotiator_id, COUNT(*) AS cnt
     FROM cases c
     WHERE c.assigned_negotiator_id IS NOT NULL
       AND c.case_status NOT IN ('paid', 'burned')
     GROUP BY c.assigned_negotiator_id`
  );
  const activeByNeg = Object.fromEntries(
    activeCaseRows.map((r) => [r.negotiator_id, r.cnt])
  );

  const callRows = query(
    `SELECT c.assigned_negotiator_id AS negotiator_id,
            COUNT(*) AS total_calls,
            COALESCE(SUM(ca.cost), 0) AS total_cost
     FROM case_actions ca
     INNER JOIN cases c ON c.id = ca.case_id
     WHERE ca.action_type = 'negotiator_call'
       AND c.assigned_negotiator_id IS NOT NULL
     GROUP BY c.assigned_negotiator_id`
  );
  const callsByNeg = Object.fromEntries(
    callRows.map((r) => [
      r.negotiator_id,
      { total_calls: r.total_calls, total_cost: Number(r.total_cost) || 0 },
    ])
  );

  const promiseRows = query(
    `SELECT c.assigned_negotiator_id AS negotiator_id,
            COUNT(*) AS promises_made,
            SUM(CASE WHEN p.status = 'fulfilled' THEN 1 ELSE 0 END) AS promises_fulfilled
     FROM promises p
     INNER JOIN cases c ON c.id = p.case_id
     WHERE c.assigned_negotiator_id IS NOT NULL
     GROUP BY c.assigned_negotiator_id`
  );
  const promisesByNeg = Object.fromEntries(
    promiseRows.map((r) => [
      r.negotiator_id,
      {
        promises_made: r.promises_made,
        promises_fulfilled: Number(r.promises_fulfilled) || 0,
      },
    ])
  );

  const durationRows = query(
    `SELECT c.assigned_negotiator_id AS negotiator_id, ch.details
     FROM case_history ch
     INNER JOIN cases c ON c.id = ch.case_id
     WHERE ch.operation = 'ثبت خروجی تماس'
       AND c.assigned_negotiator_id IS NOT NULL`
  );
  const durationsByNeg = {};
  for (const row of durationRows) {
    if (!row.details) continue;
    try {
      const det = JSON.parse(row.details);
      const dur = Number(det.call_duration);
      if (!dur || dur <= 0) continue;
      if (!durationsByNeg[row.negotiator_id]) durationsByNeg[row.negotiator_id] = [];
      durationsByNeg[row.negotiator_id].push(dur);
    } catch {
      /* skip */
    }
  }

  const negotiators_comparison = negotiators.map((n) => {
    const caseFilters = {
      ...filters,
      from_date: null,
      to_date: null,
      from_dt: null,
      to_dt: null,
      negotiator_id: n.id,
      cooperation_type: null,
    };
    const where = buildCaseWhere(caseFilters, { dateField: null });
    const cases = query(
      `SELECT c.id, c.case_status, c.created_at ${caseFromClause(where)}`,
      where.params
    );
    const paidCases = cases.filter((c) => c.case_status === 'paid');
    const caseIds = cases.map((c) => c.id);
    const paymentsByCase = loadPaymentsByCase(caseIds);
    const total_cases = cases.length;
    const paid_cases = paidCases.length;

    const callInfo = callsByNeg[n.id] || { total_calls: 0, total_cost: 0 };
    const promiseInfo = promisesByNeg[n.id] || { promises_made: 0, promises_fulfilled: 0 };
    const durs = durationsByNeg[n.id] || [];
    const avg_call_duration = durs.length
      ? round2(durs.reduce((a, b) => a + b, 0) / durs.length)
      : null;

    return {
      id: n.id,
      name: n.name,
      cooperation_type: n.cooperation_type,
      active_cases: activeByNeg[n.id] || 0,
      total_calls: callInfo.total_calls,
      success_rate: total_cases > 0 ? round2((paid_cases / total_cases) * 100) : 0,
      avg_call_duration,
      total_cost: callInfo.total_cost,
      avg_days_to_payment: computeAvgDaysToPayment(paidCases, paymentsByCase),
      promises_made: promiseInfo.promises_made,
      promises_fulfilled: promiseInfo.promises_fulfilled,
      promise_fulfillment_rate:
        promiseInfo.promises_made > 0
          ? round2((promiseInfo.promises_fulfilled / promiseInfo.promises_made) * 100)
          : 0,
    };
  });

  const historyParts = ["ch.operation = 'ثبت خروجی تماس'"];
  const historyParams = {};
  if (filters.negotiator_id) {
    historyParts.push('c.assigned_negotiator_id = $negotiator_id');
    historyParams.$negotiator_id = filters.negotiator_id;
  }
  if (filters.cooperation_type) {
    historyParts.push('neg.cooperation_type = $cooperation_type');
    historyParams.$cooperation_type = filters.cooperation_type;
  }

  const historyJoin =
    filters.cooperation_type
      ? 'INNER JOIN negotiators neg ON neg.id = c.assigned_negotiator_id'
      : '';

  const historyRows = query(
    `SELECT ch.details
     FROM case_history ch
     INNER JOIN cases c ON c.id = ch.case_id
     ${historyJoin}
     WHERE ${historyParts.join(' AND ')}`,
    historyParams
  );

  const reasonCounts = {};
  let reasonTotal = 0;
  for (const row of historyRows) {
    if (!row.details) continue;
    try {
      const det = JSON.parse(row.details);
      const reason = det.no_payment_reason;
      if (!reason) continue;
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      reasonTotal += 1;
    } catch {
      /* skip malformed JSON */
    }
  }

  const no_payment_reasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({
      reason,
      count,
      percent: reasonTotal > 0 ? round2((count / reasonTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { negotiators_comparison, no_payment_reasons };
}

module.exports = {
  parseFilters,
  buildCaseWhere,
  caseFromClause,
  mapStatusCount,
  loadActionsByCase,
  loadPaymentsByCase,
  paymentInJalaliRange,
  attributePaymentChannel,
  buildActionDateCaseWhere,
  sumCosts,
  round2,
  computeAvgDaysToPayment,
  parseFlexibleDate,
  CONVERSION_ACTION_TYPES,
  strategyStats,
  getCasesReport,
  getFunnelReport,
  getStrategiesPerformance,
  getStrategiesCost,
  getNegotiatorsReport,
};
