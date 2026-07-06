'use strict';

const { query } = require('../db/database');
const {
  buildCaseTenureRows,
  computeStrategyAttribution,
  getTenuresForStrategy,
  isTimestampInStrategyTenures,
} = require('./strategy-attribution.service');
const {
  jalaliDateToDatetime,
  jalaliDateTimeToDatetime,
  gregorianToJalali,
  formatJalali,
  parseActionDatetime,
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
    parts.push(`(
      c.strategy_id = $strategy_id
      OR EXISTS (
        SELECT 1 FROM case_events ce_hist
        WHERE ce_hist.case_id = c.id
          AND ce_hist.event_type = 'history'
          AND (
            ce_hist.details LIKE $strategy_id_pat1
            OR ce_hist.details LIKE $strategy_id_pat2
            OR ce_hist.details LIKE $strategy_new_id_pat1
            OR ce_hist.details LIKE $strategy_new_id_pat2
          )
      )
    )`);
    params.$strategy_id = filters.strategy_id;
    const sid = filters.strategy_id;
    params.$strategy_id_pat1 = `%"strategy_id":${sid},%`;
    params.$strategy_id_pat2 = `%"strategy_id":${sid}}%`;
    params.$strategy_new_id_pat1 = `%"strategy_new_id":${sid},%`;
    params.$strategy_new_id_pat2 = `%"strategy_new_id":${sid}}%`;
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

function jalaliFilterRange(fromJalali, toJalali) {
  const from_dt = fromJalali ? jalaliDateToDatetime(String(fromJalali).trim()) : null;
  let to_dt = toJalali ? jalaliDateToDatetime(String(toJalali).trim()) : null;
  if (to_dt) to_dt = to_dt.replace(' 00:00:00', ' 23:59:59');
  return { from_dt, to_dt };
}

function parseFlexibleDate(str, { endOfDay = false } = {}) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const dt = parseActionDatetime(s);
    return dt ? dt.getTime() : null;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const datePart = s.split(' ')[0];
    const timeMatch = s.match(/\s+(\d{1,2}):(\d{2})/);
    const hasTime = Boolean(timeMatch);
    let iso;
    if (hasTime) {
      iso = jalaliDateTimeToDatetime(datePart, `${timeMatch[1]}:${timeMatch[2]}`);
    } else {
      iso = jalaliDateToDatetime(datePart);
      if (iso && endOfDay) iso = iso.replace(' 00:00:00', ' 23:59:59');
    }
    if (!iso) return null;
    const dt = parseActionDatetime(iso);
    return dt ? dt.getTime() : null;
  }
  return null;
}

function isDateOnlyPayment(str) {
  if (!str) return true;
  const s = String(str).trim();
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return !/\d{1,2}:\d{2}/.test(s);
}

function parsePaymentDate(str) {
  return parseFlexibleDate(str, { endOfDay: isDateOnlyPayment(str) });
}

function normalizeJalaliDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
}

function storageDatetimeToJalaliDate(isoStr) {
  const dt = parseActionDatetime(isoStr);
  if (!dt) return null;
  const j = gregorianToJalali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
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

function sumCollectedForCasesInRange(caseIds, paymentsByCase, fromJalali, toJalali) {
  let total = 0;
  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      if (!paymentInJalaliRange(p.payment_date, fromJalali, toJalali)) continue;
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

function lastActionBeforePayment(caseId, paymentDate, actionsByCase) {
  const payTs = parsePaymentDate(paymentDate);
  if (payTs === null) return null;

  const attributionTypes = new Set(CONVERSION_ACTION_TYPES);
  let best = null;
  let bestTs = -1;
  let bestId = -1;

  for (const a of actionsByCase[caseId] || []) {
    if (!attributionTypes.has(a.action_type)) continue;
    const ts = parseFlexibleDate(a.action_date);
    if (ts === null || ts > payTs) continue;
    const id = Number(a.id) || 0;
    if (ts > bestTs || (ts === bestTs && id > bestId)) {
      best = a;
      bestTs = ts;
      bestId = id;
    }
  }
  return best;
}

function lastConversionActionBeforePayment(caseId, paymentDate, actionsByCase) {
  return lastActionBeforePayment(caseId, paymentDate, actionsByCase);
}

function attributePaymentChannel(caseId, paymentDate, actionsByCase) {
  const last = lastConversionActionBeforePayment(caseId, paymentDate, actionsByCase);
  return last ? actionChannel(last.action_type) : null;
}

function paymentInJalaliRange(paymentDate, fromJalali, toJalali) {
  if (!paymentDate) return false;
  const d = normalizeJalaliDate(String(paymentDate).split(' ')[0]);
  if (!d) return false;
  const from = normalizeJalaliDate(fromJalali);
  const to = normalizeJalaliDate(toJalali);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function loadActionsByCase(caseIds) {
  if (!caseIds.length) return {};
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  const rows = query(
    `SELECT ce.rowid AS id, ce.case_id, ce.action_type, ce.created_at AS action_date, ce.cost FROM case_events ce
     WHERE case_id IN (${ph}) AND event_type = 'action'`,
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

function attributionDeps(filters) {
  return {
    filters,
    parseFlexibleDate,
    parsePaymentDate,
    paymentInJalaliRange,
    isCollectiblePayment,
    round2,
  };
}

function loadCasePoolForAttribution(filters) {
  const poolFilters = { ...filters, strategy_id: null };
  const where = buildCaseWhere(poolFilters, { dateField: 'created_at' });
  return query(
    `SELECT c.id, c.case_status, c.created_at, c.credit_type, c.strategy_id ${caseFromClause(where)}`,
    where.params
  );
}

function buildAttributionContext(filters) {
  const casePool = loadCasePoolForAttribution(filters);
  const { rows: caseTenureRows } = buildCaseTenureRows(casePool, parseFlexibleDate);
  const caseIds = casePool.map((c) => c.id);
  return {
    caseTenureRows,
    paymentsByCase: loadPaymentsByCase(caseIds),
    actionsByCase: loadActionsByCase(caseIds),
  };
}

function strategyStats(strategyId, filters, attributionCtx) {
  if (attributionCtx) {
    const stats = computeStrategyAttribution(strategyId, attributionCtx.caseTenureRows, {
      ...attributionDeps(filters),
      paymentsByCase: attributionCtx.paymentsByCase,
      actionsByCase: attributionCtx.actionsByCase,
    });
    return {
      ...stats,
      cases: stats.case_ids.map((id) => ({ id })),
      paymentsByCase: attributionCtx.paymentsByCase,
    };
  }

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
  const { from_dt, to_dt } = jalaliFilterRange(jalaliFrom, jalaliTo);
  let dateClause = '';
  if (from_dt) {
    dateClause += ' AND ce.created_at >= $from_dt';
    params.$from_dt = from_dt;
  }
  if (to_dt) {
    dateClause += ' AND ce.created_at <= $to_dt';
    params.$to_dt = to_dt;
  }
  const row = query(
    `SELECT COALESCE(SUM(ce.cost), 0) AS total_cost
     FROM case_events ce
     WHERE ce.event_type = 'action' AND ce.case_id IN (${ph})${dateClause}`,
    params
  )[0];
  return Number(row?.total_cost) || 0;
}

function pickAbWinner(statsA, statsB) {
  const rateA = Number(statsA.success_rate) || 0;
  const rateB = Number(statsB.success_rate) || 0;

  if (rateA === 0 && rateB === 0) return null;
  if (rateA === 0) return 'b';
  if (rateB === 0) return 'a';

  if (rateA !== rateB) {
    return rateA > rateB ? 'a' : 'b';
  }
  const daysA = statsA.avg_days_to_payment ?? Infinity;
  const daysB = statsB.avg_days_to_payment ?? Infinity;
  if (daysA !== daysB) return daysA < daysB ? 'a' : 'b';
  return statsA.cost <= statsB.cost ? 'a' : 'b';
}

function isCollectiblePayment(payment) {
  const type = payment?.payment_type;
  if (type == null || type === '') return true;
  return type === 'full' || type === 'partial';
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
  const total_collected = sumCollectedForCasesInRange(
    caseIds,
    paymentsByCase,
    filters.from_date,
    filters.to_date
  );
  const avg_days_to_payment = computeAvgDaysToPayment(allCases, paymentsByCase);
  const total_cost = strategyCostForCases(caseIds, filters.from_date, filters.to_date);
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
    const jDate = storageDatetimeToJalaliDate(c.created_at);
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
  const attributionCtx = buildAttributionContext(filters);

  const strategies_comparison = strategies.map((s) => {
    const stats = strategyStats(s.id, filters, attributionCtx);
    const total_cost = stats.total_cost ?? 0;
    const total_collected = stats.total_collected ?? 0;
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
    INNER JOIN strategies sa ON sa.id = ab.strategy_a_id
    INNER JOIN strategies sb ON sb.id = ab.strategy_b_id
    ORDER BY ab.id ASC
  `);

  const ab_test_results = abScenarios.map((ab) => {
    const abFilters = {
      from_date: filters.from_date,
      to_date: filters.to_date,
      from_dt: filters.from_dt,
      to_dt: filters.to_dt,
      credit_type: ab.credit_type,
      segment_id: ab.segment_id,
    };

    const abCtx = buildAttributionContext(abFilters);
    const statsA = strategyStats(ab.strategy_a_id, abFilters, abCtx);
    const statsB = strategyStats(ab.strategy_b_id, abFilters, abCtx);

    const strategy_a = {
      title: ab.strategy_a_title,
      success_rate: statsA.success_rate,
      avg_days: statsA.avg_days_to_payment,
      cost: statsA.total_cost ?? 0,
    };
    const strategy_b = {
      title: ab.strategy_b_title,
      success_rate: statsB.success_rate,
      avg_days: statsB.avg_days_to_payment,
      cost: statsB.total_cost ?? 0,
    };

    return {
      scenario_name: ab.name,
      strategy_a,
      strategy_b,
      winner: pickAbWinner(
        {
          success_rate: statsA.success_rate,
          avg_days_to_payment: statsA.avg_days_to_payment,
          cost: statsA.total_cost ?? 0,
        },
        {
          success_rate: statsB.success_rate,
          avg_days_to_payment: statsB.avg_days_to_payment,
          cost: statsB.total_cost ?? 0,
        }
      ),
    };
  });

  return { strategies_comparison, ab_test_results };
}

function getStrategiesCost(filters) {
  const where = buildActionDateCaseWhere(filters);
  const joinStr = where.joins.length ? ` ${where.joins.join(' ')}` : '';

  if (filters.strategy_id) {
    const poolFilters = { ...filters, strategy_id: null };
    const attributionCtx = buildAttributionContext(poolFilters);
    const strategyTenures = getTenuresForStrategy(
      attributionCtx.caseTenureRows,
      filters.strategy_id,
      filters,
      parseFlexibleDate
    );
    const caseIds = [...new Set(strategyTenures.map((t) => t.caseId))];

    if (!caseIds.length) {
      return {
        summary: {
          total_sms_cost: 0,
          total_autocall_cost: 0,
          total_negotiator_cost: 0,
          total_cost: 0,
          total_collected: 0,
          roi: null,
          cost_to_collection_ratio: null,
        },
        action_stats: CONVERSION_ACTION_TYPES.map((action_type) => ({
          action_type,
          label: ACTION_LABELS[action_type] || action_type,
          execution_count: 0,
          payment_count: 0,
          total_cost: 0,
          total_collected: 0,
          roi: null,
          cost_to_collection_ratio: null,
          conversion_rate: 0,
        })),
        cost_distribution: [],
        collection_distribution: [],
      };
    }

    const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
    const idParams = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
    const actionExecutions = query(
      `SELECT ce.rowid AS id, ce.case_id, ce.action_type, ce.created_at AS action_date, ce.cost
       FROM case_events ce
       WHERE ce.event_type = 'action'
         AND ce.action_type IN ($t1, $t2, $t3, $t4, $t5)
         AND ce.case_id IN (${ph})
         ${filters.from_dt ? 'AND ce.created_at >= $from_dt' : ''}
         ${filters.to_dt ? 'AND ce.created_at <= $to_dt' : ''}`,
      {
        ...idParams,
        $t1: 'warning_sms',
        $t2: 'threatening_sms',
        $t3: 'warning_autocall',
        $t4: 'threatening_autocall',
        $t5: 'negotiator_call',
        ...(filters.from_dt ? { $from_dt: filters.from_dt } : {}),
        ...(filters.to_dt ? { $to_dt: filters.to_dt } : {}),
      }
    ).filter((action) =>
      isTimestampInStrategyTenures(
        action.case_id,
        parseFlexibleDate(action.action_date),
        strategyTenures
      )
    );

    const actionsByCase = loadActionsByCase(caseIds);
    const paymentsByCase = loadPaymentsByCase(caseIds);

    const executionCountByAction = Object.fromEntries(
      CONVERSION_ACTION_TYPES.map((t) => [t, 0])
    );
    const costByAction = Object.fromEntries(CONVERSION_ACTION_TYPES.map((t) => [t, 0]));
    for (const action of actionExecutions) {
      if (!CONVERSION_ACTION_TYPES.includes(action.action_type)) continue;
      executionCountByAction[action.action_type] += 1;
      costByAction[action.action_type] += Number(action.cost) || 0;
    }

    const collectionCountByAction = Object.fromEntries(
      CONVERSION_ACTION_TYPES.map((t) => [t, 0])
    );
    const collectedAmountByAction = Object.fromEntries(
      CONVERSION_ACTION_TYPES.map((t) => [t, 0])
    );
    const executionIdsLeadingToPayment = new Set();
    let total_collected = 0;
    const collectedByChannel = { sms: 0, autocall: 0, negotiator: 0, other: 0 };

    for (const id of caseIds) {
      for (const p of paymentsByCase[id] || []) {
        if (!isCollectiblePayment(p)) continue;
        if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) continue;

        const payTs = parsePaymentDate(p.payment_date);
        if (!isTimestampInStrategyTenures(id, payTs, strategyTenures)) continue;

        const amt = Number(p.amount) || 0;
        total_collected += amt;

        const lastAction = lastConversionActionBeforePayment(id, p.payment_date, actionsByCase);
        if (!lastAction) continue;
        const actionTs = parseFlexibleDate(lastAction.action_date);
        if (!isTimestampInStrategyTenures(id, actionTs, strategyTenures)) continue;

        collectionCountByAction[lastAction.action_type] += 1;
        collectedAmountByAction[lastAction.action_type] += amt;
        if (lastAction.id != null) executionIdsLeadingToPayment.add(lastAction.id);

        const ch = actionChannel(lastAction.action_type);
        if (ch === 'sms') collectedByChannel.sms += amt;
        else if (ch === 'autocall') collectedByChannel.autocall += amt;
        else if (ch === 'negotiator') collectedByChannel.negotiator += amt;
        else collectedByChannel.other += amt;
      }
    }

    const executionsLeadingCountByAction = Object.fromEntries(
      CONVERSION_ACTION_TYPES.map((t) => [t, 0])
    );
    for (const action of actionExecutions) {
      if (executionIdsLeadingToPayment.has(action.id)) {
        executionsLeadingCountByAction[action.action_type] += 1;
      }
    }

    const costs = sumCosts(
      CONVERSION_ACTION_TYPES.map((action_type) => ({
        action_type,
        total_cost: costByAction[action_type] || 0,
      }))
    );
    const total_sms_cost = costs.sms;
    const total_autocall_cost = costs.autocall;
    const total_negotiator_cost = costs.negotiator;
    const total_cost = costs.total;
    const roi = total_cost > 0 ? round2((total_collected / total_cost) * 100) : null;
    const cost_to_collection_ratio = costToCollectionRatio(total_cost, total_collected);

    const action_stats = CONVERSION_ACTION_TYPES.map((action_type) => {
      const execution_count = executionCountByAction[action_type] || 0;
      const actionCost = costByAction[action_type] || 0;
      const actionCollected = collectedAmountByAction[action_type] || 0;
      const payment_count = collectionCountByAction[action_type] || 0;
      const ledToPaymentCount = executionsLeadingCountByAction[action_type] || 0;
      return {
        action_type,
        label: ACTION_LABELS[action_type] || action_type,
        execution_count,
        payment_count,
        total_cost: actionCost,
        total_collected: actionCollected,
        roi: actionCost > 0 ? round2((actionCollected / actionCost) * 100) : null,
        cost_to_collection_ratio: costToCollectionRatio(actionCost, actionCollected),
        conversion_rate:
          execution_count > 0 ? round2((ledToPaymentCount / execution_count) * 100) : 0,
      };
    });

    const cost_distribution = CONVERSION_ACTION_TYPES.map((action_type) => {
      const value = costByAction[action_type] || 0;
      return {
        action_type,
        label: ACTION_LABELS[action_type] || action_type,
        value,
        percent: total_cost > 0 ? round2((value / total_cost) * 100) : 0,
      };
    }).filter((item) => item.value > 0);

    const collectionTotalAmount = CONVERSION_ACTION_TYPES.reduce(
      (sum, t) => sum + (collectedAmountByAction[t] || 0),
      0
    );

    const collection_distribution = CONVERSION_ACTION_TYPES.map((action_type) => {
      const value = collectedAmountByAction[action_type] || 0;
      return {
        action_type,
        label: ACTION_LABELS[action_type] || action_type,
        value,
        percent:
          collectionTotalAmount > 0 ? round2((value / collectionTotalAmount) * 100) : 0,
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

  const costRows = query(
    `SELECT ce.action_type, SUM(ce.cost) AS total_cost, COUNT(*) AS executions
     FROM case_events ce
     INNER JOIN cases c ON c.id = ce.case_id${joinStr}
     WHERE ${where.clause}
       AND ce.event_type = 'action'
       AND ce.action_type IN ($t1, $t2, $t3, $t4, $t5)
       ${filters.from_dt ? 'AND ce.created_at >= $from_dt' : ''}
       ${filters.to_dt ? 'AND ce.created_at <= $to_dt' : ''}
     GROUP BY ce.action_type`,
    {
      ...where.params,
      $t1: 'warning_sms',
      $t2: 'threatening_sms',
      $t3: 'warning_autocall',
      $t4: 'threatening_autocall',
      $t5: 'negotiator_call',
      ...(filters.from_dt ? { $from_dt: filters.from_dt } : {}),
      ...(filters.to_dt ? { $to_dt: filters.to_dt } : {}),
    }
  );

  const costs = sumCosts(costRows);
  const total_sms_cost = costs.sms;
  const total_autocall_cost = costs.autocall;
  const total_negotiator_cost = costs.negotiator;
  const total_cost = costs.total;

  const matchedCases = query(
    `SELECT DISTINCT c.id ${caseFromClause(where)}
     ${filters.from_dt ? 'AND EXISTS (SELECT 1 FROM case_events ce2 WHERE ce2.case_id = c.id AND ce2.event_type = \'action\' AND ce2.created_at >= $from_dt)' : ''}
     ${filters.to_dt ? 'AND EXISTS (SELECT 1 FROM case_events ce3 WHERE ce3.case_id = c.id AND ce3.event_type = \'action\' AND ce3.created_at <= $to_dt)' : ''}`,
    {
      ...where.params,
      ...(filters.from_dt ? { $from_dt: filters.from_dt } : {}),
      ...(filters.to_dt ? { $to_dt: filters.to_dt } : {}),
    }
  );
  const caseIds = matchedCases.map((c) => c.id);
  const actionsByCase = loadActionsByCase(caseIds);
  const paymentsByCase = loadPaymentsByCase(caseIds);

  const actionExecutions = query(
    `SELECT ce.rowid AS id, ce.case_id, ce.action_type, ce.created_at AS action_date, ce.cost
     FROM case_events ce
     INNER JOIN cases c ON c.id = ce.case_id${joinStr}
     WHERE ${where.clause}
       AND ce.event_type = 'action'
       AND ce.action_type IN ($t1, $t2, $t3, $t4, $t5)
       ${filters.from_dt ? 'AND ce.created_at >= $from_dt' : ''}
       ${filters.to_dt ? 'AND ce.created_at <= $to_dt' : ''}`,
    {
      ...where.params,
      $t1: 'warning_sms',
      $t2: 'threatening_sms',
      $t3: 'warning_autocall',
      $t4: 'threatening_autocall',
      $t5: 'negotiator_call',
      ...(filters.from_dt ? { $from_dt: filters.from_dt } : {}),
      ...(filters.to_dt ? { $to_dt: filters.to_dt } : {}),
    }
  );

  const executionCountByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );
  for (const action of actionExecutions) {
    if (CONVERSION_ACTION_TYPES.includes(action.action_type)) {
      executionCountByAction[action.action_type] += 1;
    }
  }

  const collectionCountByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );
  const collectedAmountByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );
  const executionIdsLeadingToPayment = new Set();
  let total_collected = 0;
  const collectedByChannel = { sms: 0, autocall: 0, negotiator: 0, other: 0 };

  for (const id of caseIds) {
    for (const p of paymentsByCase[id] || []) {
      if (!isCollectiblePayment(p)) continue;
      if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) continue;

      const amt = Number(p.amount) || 0;
      total_collected += amt;

      const lastAction = lastConversionActionBeforePayment(id, p.payment_date, actionsByCase);
      if (!lastAction) continue;

      collectionCountByAction[lastAction.action_type] += 1;
      collectedAmountByAction[lastAction.action_type] += amt;
      if (lastAction.id != null) executionIdsLeadingToPayment.add(lastAction.id);

      const ch = actionChannel(lastAction.action_type);
      if (ch === 'sms') collectedByChannel.sms += amt;
      else if (ch === 'autocall') collectedByChannel.autocall += amt;
      else if (ch === 'negotiator') collectedByChannel.negotiator += amt;
      else collectedByChannel.other += amt;
    }
  }

  const executionsLeadingCountByAction = Object.fromEntries(
    CONVERSION_ACTION_TYPES.map((t) => [t, 0])
  );
  for (const action of actionExecutions) {
    if (executionIdsLeadingToPayment.has(action.id)) {
      executionsLeadingCountByAction[action.action_type] += 1;
    }
  }

  const roi = total_cost > 0 ? round2((total_collected / total_cost) * 100) : null;
  const cost_to_collection_ratio = costToCollectionRatio(total_cost, total_collected);

  const action_stats = CONVERSION_ACTION_TYPES.map((action_type) => {
    const row = costRows.find((r) => r.action_type === action_type);
    const execution_count = executionCountByAction[action_type] || Number(row?.executions) || 0;
    const actionCost = Number(row?.total_cost) || 0;
    const actionCollected = collectedAmountByAction[action_type] || 0;
    const payment_count = collectionCountByAction[action_type] || 0;
    const ledToPaymentCount = executionsLeadingCountByAction[action_type] || 0;
    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      execution_count,
      payment_count,
      total_cost: actionCost,
      total_collected: actionCollected,
      roi: actionCost > 0 ? round2((actionCollected / actionCost) * 100) : null,
      cost_to_collection_ratio: costToCollectionRatio(actionCost, actionCollected),
      conversion_rate:
        execution_count > 0 ? round2((ledToPaymentCount / execution_count) * 100) : 0,
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

  const collectionTotalAmount = CONVERSION_ACTION_TYPES.reduce(
    (sum, t) => sum + (collectedAmountByAction[t] || 0),
    0
  );

  const collection_distribution = CONVERSION_ACTION_TYPES.map((action_type) => {
    const value = collectedAmountByAction[action_type] || 0;
    return {
      action_type,
      label: ACTION_LABELS[action_type] || action_type,
      value,
      percent:
        collectionTotalAmount > 0 ? round2((value / collectionTotalAmount) * 100) : 0,
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
            COALESCE(SUM(ce.cost), 0) AS total_cost
     FROM case_events ce
     INNER JOIN cases c ON c.id = ce.case_id
     WHERE ce.event_type = 'action' AND ce.action_type = 'negotiator_call'
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
            SUM(CASE WHEN p.status = 'fulfilled' THEN 1 ELSE 0 END) AS promises_fulfilled,
            SUM(CASE WHEN p.status = 'broken' THEN 1 ELSE 0 END) AS promises_broken
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
        promises_broken: Number(r.promises_broken) || 0,
      },
    ])
  );

  const durationRows = query(
    `SELECT c.assigned_negotiator_id AS negotiator_id, ce.details
     FROM case_events ce
     INNER JOIN cases c ON c.id = ce.case_id
     WHERE ce.label = 'ثبت خروجی تماس'
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
    const promiseInfo = promisesByNeg[n.id] || {
      promises_made: 0,
      promises_fulfilled: 0,
      promises_broken: 0,
    };
    const resolvedPromises =
      promiseInfo.promises_fulfilled + promiseInfo.promises_broken;
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
      promises_broken: promiseInfo.promises_broken,
      promise_fulfillment_rate:
        resolvedPromises > 0
          ? round2((promiseInfo.promises_fulfilled / resolvedPromises) * 100)
          : null,
    };
  });

  const historyParts = ["ce.label = 'ثبت خروجی تماس'"];
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
    `SELECT ce.details
     FROM case_events ce
     INNER JOIN cases c ON c.id = ce.case_id
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
  getStrategiesPerformance,
  getStrategiesCost,
  getNegotiatorsReport,
};
