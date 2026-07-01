'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { jalaliDateToDatetime } = require('../db/dateUtil');

const SMS_TYPES = ['warning_sms', 'threatening_sms'];
const AUTOCALL_TYPES = ['warning_autocall', 'threatening_autocall'];
const NEGOTIATOR_TYPES = ['negotiator_call'];
const CONVERSION_ACTION_TYPES = [
  ...SMS_TYPES,
  ...AUTOCALL_TYPES,
  ...NEGOTIATOR_TYPES,
];

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
  };
}

function buildCaseWhere(filters, { dateField = 'created_at' } = {}) {
  const parts = [];
  const params = {};

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
  if (filters.from_dt && dateField) {
    parts.push(`c.${dateField} >= $from_dt`);
    params.$from_dt = filters.from_dt;
  }
  if (filters.to_dt && dateField) {
    parts.push(`c.${dateField} <= $to_dt`);
    params.$to_dt = filters.to_dt;
  }

  return {
    clause: parts.length ? parts.join(' AND ') : '1=1',
    params,
  };
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
    `SELECT case_id, action_type, action_date FROM case_actions WHERE case_id IN (${ph})`,
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
  const rows = query(`SELECT case_id, amount, payment_date FROM payments WHERE case_id IN (${ph})`, params);
  const map = {};
  for (const r of rows) {
    if (!map[r.case_id]) map[r.case_id] = [];
    map[r.case_id].push(r);
  }
  return map;
}

function strategyStats(strategyId, filters) {
  const { clause, params } = buildCaseWhere(filters, { dateField: 'created_at' });
  params.$sid = strategyId;

  const cases = query(
    `SELECT c.id, c.case_status, c.created_at FROM cases c
     WHERE c.strategy_id = $sid AND ${clause}`,
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
    avg_days_to_payment: avgDays,
  };
}

/**
 * GET /api/reports/summary
 */
router.get('/summary', (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const { clause, params } = buildCaseWhere(filters, { dateField: 'created_at' });

    const createdCount = query(
      `SELECT COUNT(*) AS cnt FROM cases c WHERE ${clause}`,
      params
    )[0]?.cnt ?? 0;

    const statusRows = query(
      `SELECT c.case_status, COUNT(*) AS cnt FROM cases c WHERE ${clause} GROUP BY c.case_status`,
      params
    );
    const cases_by_status = mapStatusCount(statusRows);

    const allCases = query(`SELECT c.id, c.case_status, c.created_at FROM cases c WHERE ${clause}`, params);
    const caseIds = allCases.map((c) => c.id);
    const actionsByCase = loadActionsByCase(caseIds);
    const paymentsByCase = loadPaymentsByCase(caseIds);

    let collectedTotal = 0;
    let collectedSms = 0;
    let collectedAutocall = 0;
    let collectedNegotiator = 0;

    for (const c of allCases) {
      for (const p of paymentsByCase[c.id] || []) {
        if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) continue;
        const amt = Number(p.amount) || 0;
        collectedTotal += amt;
        const ch = attributePaymentChannel(c.id, p.payment_date, actionsByCase);
        if (ch === 'sms') collectedSms += amt;
        else if (ch === 'autocall') collectedAutocall += amt;
        else if (ch === 'negotiator') collectedNegotiator += amt;
      }
    }

    const costParams = { ...params };
    const costWhereParts = [];
    if (filters.credit_type) costWhereParts.push('c.credit_type = $credit_type');
    if (filters.segment_id) costWhereParts.push('c.segment_id = $segment_id');
    if (filters.negotiator_id) costWhereParts.push('c.assigned_negotiator_id = $negotiator_id');
    const costCaseClause = costWhereParts.length ? costWhereParts.join(' AND ') : '1=1';

    const costRows = query(
      `SELECT ca.action_type, SUM(ca.cost) AS total_cost
       FROM case_actions ca
       INNER JOIN cases c ON c.id = ca.case_id
       WHERE ${costCaseClause}
       ${filters.from_date ? 'AND ca.action_date >= $from_jalali' : ''}
       ${filters.to_date ? 'AND ca.action_date <= $to_jalali' : ''}
       GROUP BY ca.action_type`,
      {
        ...costParams,
        ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
        ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
      }
    );

    const costs = sumCosts(costRows);
    const costToCollectedRatio =
      collectedTotal > 0 ? round2((costs.total / collectedTotal) * 100) : null;

    const avgDaysToPayment = computeAvgDaysToPayment(allCases, paymentsByCase);

    res.json({
      data: {
        cases_created: createdCount,
        cases_by_status,
        collected: {
          total: collectedTotal,
          via_sms: collectedSms,
          via_autocall: collectedAutocall,
          via_negotiator: collectedNegotiator,
        },
        operational_cost: {
          sms: costs.sms,
          autocall: costs.autocall,
          negotiator: costs.negotiator,
          total: costs.total,
          cost_to_collected_ratio: costToCollectedRatio,
        },
        avg_days_to_payment: avgDaysToPayment,
      },
    });
  } catch (err) {
    console.error('[GET /api/reports/summary]', err);
    res.status(500).json({ error: 'خطا در دریافت خلاصه گزارش' });
  }
});

/**
 * GET /api/reports/action-conversion
 */
router.get('/action-conversion', (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const { clause, params } = buildCaseWhere(filters, { dateField: null });

    const costWhereParts = [];
    if (filters.credit_type) costWhereParts.push('c.credit_type = $credit_type');
    if (filters.segment_id) costWhereParts.push('c.segment_id = $segment_id');
    if (filters.negotiator_id) costWhereParts.push('c.assigned_negotiator_id = $negotiator_id');
    const caseClause = costWhereParts.length ? costWhereParts.join(' AND ') : '1=1';

    const actions = query(
      `SELECT ca.id, ca.case_id, ca.action_type, ca.action_date
       FROM case_actions ca
       INNER JOIN cases c ON c.id = ca.case_id
       WHERE ${caseClause}
         AND ca.action_type IN ($t1, $t2, $t3, $t4, $t5)
         ${filters.from_date ? 'AND ca.action_date >= $from_jalali' : ''}
         ${filters.to_date ? 'AND ca.action_date <= $to_jalali' : ''}`,
      {
        ...params,
        $t1: 'warning_sms',
        $t2: 'threatening_sms',
        $t3: 'warning_autocall',
        $t4: 'threatening_autocall',
        $t5: 'negotiator_call',
        ...(filters.from_date ? { $from_jalali: filters.from_date } : {}),
        ...(filters.to_date ? { $to_jalali: filters.to_date } : {}),
      }
    );

    const caseIds = [...new Set(actions.map((a) => a.case_id))];
    const paymentsByCase = loadPaymentsByCase(caseIds);

    const stats = {};
    for (const type of CONVERSION_ACTION_TYPES) {
      stats[type] = { executions: 0, payments_after: 0 };
    }

    for (const action of actions) {
      if (!stats[action.action_type]) continue;
      stats[action.action_type].executions += 1;

      const pays = paymentsByCase[action.case_id] || [];
      const actionTs = parseFlexibleDate(action.action_date);
      const hasPaymentAfter = pays.some((p) => {
        if (!paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)) return false;
        const payTs = parseFlexibleDate(p.payment_date);
        return actionTs !== null && payTs !== null && payTs >= actionTs;
      });
      if (hasPaymentAfter) stats[action.action_type].payments_after += 1;
    }

    const data = CONVERSION_ACTION_TYPES.map((action_type) => {
      const { executions, payments_after } = stats[action_type];
      return {
        action_type,
        executions,
        payments_after,
        conversion_rate: executions > 0 ? round2((payments_after / executions) * 100) : 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('[GET /api/reports/action-conversion]', err);
    res.status(500).json({ error: 'خطا در دریافت نرخ تبدیل اقدام‌ها' });
  }
});

/**
 * GET /api/reports/ab-tests
 */
router.get('/ab-tests', (req, res) => {
  try {
    const filters = parseFilters(req.query);

    const scenarios = query(`
      SELECT ab.*,
             sa.title AS strategy_a_title,
             sb.title AS strategy_b_title
      FROM ab_tests ab
      LEFT JOIN strategies sa ON sa.id = ab.strategy_a_id
      LEFT JOIN strategies sb ON sb.id = ab.strategy_b_id
      ORDER BY ab.id ASC
    `);

    const data = scenarios.map((ab) => {
      const abFilters = { ...filters };
      if (!abFilters.credit_type) abFilters.credit_type = ab.credit_type;

      const statsA = strategyStats(ab.strategy_a_id, abFilters);
      const statsB = strategyStats(ab.strategy_b_id, abFilters);

      return {
        id: ab.id,
        name: ab.name,
        credit_type: ab.credit_type,
        segment_id: ab.segment_id,
        strategy_a: {
          id: ab.strategy_a_id,
          name: ab.strategy_a_title,
          conversion_rate: statsA.conversion_rate,
          avg_days_to_payment: statsA.avg_days_to_payment,
          total_cases: statsA.total_cases,
          paid_cases: statsA.paid_cases,
        },
        strategy_b: {
          id: ab.strategy_b_id,
          name: ab.strategy_b_title,
          conversion_rate: statsB.conversion_rate,
          avg_days_to_payment: statsB.avg_days_to_payment,
          total_cases: statsB.total_cases,
          paid_cases: statsB.paid_cases,
        },
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('[GET /api/reports/ab-tests]', err);
    res.status(500).json({ error: 'خطا در دریافت نتایج A/B Test' });
  }
});

module.exports = router;
