'use strict';

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/auth.middleware');
const { query } = require('../db/database');
const {
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
} = require('../services/reports.service');

router.use(authorize('reports', 'view'));

/**
 * GET /api/reports/summary
 */
router.get('/summary', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const where = buildCaseWhere(filters, { dateField: 'created_at' });

    const createdCount = query(
      `SELECT COUNT(*) AS cnt ${caseFromClause(where)}`,
      where.params
    )[0]?.cnt ?? 0;

    const statusRows = query(
      `SELECT c.case_status, COUNT(*) AS cnt ${caseFromClause(where)} GROUP BY c.case_status`,
      where.params
    );
    const cases_by_status = mapStatusCount(statusRows);

    const allCases = query(
      `SELECT c.id, c.case_status, c.created_at ${caseFromClause(where)}`,
      where.params
    );
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

    const costWhere = buildActionDateCaseWhere(filters);
    const costJoinStr = costWhere.joins.length ? ` ${costWhere.joins.join(' ')}` : '';

    const costRows = query(
      `SELECT ce.action_type, SUM(ce.cost) AS total_cost
       FROM case_events ce
       INNER JOIN cases c ON c.id = ce.case_id${costJoinStr}
       WHERE ${costWhere.clause}
         AND ce.event_type = 'action'
       ${filters.from_date ? 'AND ce.created_at >= $from_jalali' : ''}
       ${filters.to_date ? 'AND ce.created_at <= $to_jalali' : ''}
       GROUP BY ce.action_type`,
      {
        ...costWhere.params,
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
    next(err);
  }
});

/**
 * GET /api/reports/cases
 */
router.get('/cases', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = getCasesReport(filters);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/strategies/performance
 */
router.get('/strategies/performance', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = getStrategiesPerformance(filters);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/strategies/cost
 */
router.get('/strategies/cost', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = getStrategiesCost(filters);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/negotiators
 */
router.get('/negotiators', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const result = getNegotiatorsReport(filters);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/meta
 */
router.get('/meta', (_req, res, next) => {
  try {
    const rows = query(
      `SELECT DISTINCT province FROM debtors
       WHERE province IS NOT NULL AND TRIM(province) != ''
       ORDER BY province ASC`
    );
    res.json({ data: { provinces: rows.map((r) => r.province) } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/action-conversion
 */
router.get('/action-conversion', (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const where = buildActionDateCaseWhere(filters);
    const joinStr = where.joins.length ? ` ${where.joins.join(' ')}` : '';

    const actions = query(
      `SELECT ce.rowid AS id, ce.case_id, ce.action_type, ce.created_at AS action_date
       FROM case_events ce
       INNER JOIN cases c ON c.id = ce.case_id${joinStr}
       WHERE ${where.clause}
         AND ce.event_type = 'action'
         AND ce.action_type IN ($t1, $t2, $t3, $t4, $t5)
         ${filters.from_date ? 'AND ce.created_at >= $from_jalali' : ''}
         ${filters.to_date ? 'AND ce.created_at <= $to_jalali' : ''}`,
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
    next(err);
  }
});

/**
 * GET /api/reports/ab-tests
 */
router.get('/ab-tests', (req, res, next) => {
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
    next(err);
  }
});

module.exports = router;
