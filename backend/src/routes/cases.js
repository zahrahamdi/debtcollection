'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { jalaliDateToDatetime } = require('../db/dateUtil');
const {
  authorize,
  requireAdmin,
  requireCallOutcomeAccess,
} = require('../middleware/auth.middleware');
const {
  ServiceError,
  listCases,
  getCaseById,
  assignCase,
  submitCallOutcome,
} = require('../services/cases.service');

function handleServiceError(res, err, label) {
  if (err instanceof ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(label, err);
  return res.status(500).json({ error: 'خطای داخلی سرور' });
}

/**
 * GET /api/cases
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
      assigned_negotiator_id,
      page,
      limit,
    } = req.query;

    const result = listCases(
      {
        debtor_name,
        national_code,
        credit_id,
        credit_type,
        case_status,
        action_status,
        negotiator_name,
        assigned_negotiator_id,
      },
      { page, limit }
    );

    res.json(result);
  } catch (err) {
    console.error('[GET /api/cases]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست پرونده‌ها' });
  }
});

/**
 * GET /api/cases/:id
 */
router.get('/:id', (req, res) => {
  try {
    const data = getCaseById(Number(req.params.id));
    if (!data) return res.status(404).json({ error: 'پرونده یافت نشد' });
    res.json({ data });
  } catch (err) {
    console.error('[GET /api/cases/:id]', err);
    res.status(500).json({ error: 'خطا در دریافت جزئیات پرونده' });
  }
});

/**
 * GET /api/cases/:id/history
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
 */
router.post('/:id/assign', requireAdmin, (req, res) => {
  try {
    const { negotiator_id } = req.body || {};
    const data = assignCase(Number(req.params.id), negotiator_id, req.user);
    res.json({ data });
  } catch (err) {
    return handleServiceError(res, err, '[POST /api/cases/:id/assign]');
  }
});

/**
 * POST /api/cases/:id/call-outcome
 */
router.post(
  '/:id/call-outcome',
  authorize('call_outcome', 'create'),
  requireCallOutcomeAccess,
  async (req, res) => {
    try {
      const data = await submitCallOutcome(Number(req.params.id), req.body, req.user);
      res.json({ data });
    } catch (err) {
      return handleServiceError(res, err, '[POST /api/cases/:id/call-outcome]');
    }
  }
);

module.exports = router;
