'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { jalaliDateToDatetime } = require('../db/dateUtil');
const { listCaseEvents } = require('../db/caseEvents');
const {
  authorize,
  requireAdmin,
  requireCallOutcomeAccess,
} = require('../middleware/auth.middleware');
const {
  listCases,
  getCaseById,
  assignCase,
  submitCallOutcome,
} = require('../services/cases.service');

/**
 * GET /api/cases
 */
router.get('/', (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /api/cases/:id
 */
router.get('/:id', (req, res, next) => {
  try {
    const data = getCaseById(Number(req.params.id));
    if (!data) return res.status(404).json({ error: 'پرونده یافت نشد' });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cases/:id/history
 */
router.get('/:id/history', (req, res, next) => {
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

    const filters = {};
    if (operation) filters.label = operation;
    if (user_name) filters.user_name = user_name;
    if (from_date) {
      const fromDt = jalaliDateToDatetime(String(from_date).trim());
      if (fromDt) filters.from_date = fromDt;
    }
    if (to_date) {
      const toDt = jalaliDateToDatetime(String(to_date).trim());
      if (toDt) filters.to_date = toDt.replace(' 00:00:00', ' 23:59:59');
    }

    const events = listCaseEvents(id, filters);
    const history = events.map((e) => ({
      id: e.id,
      case_id: e.case_id,
      user_name: e.user_name,
      operation: e.label,
      case_status: e.case_status,
      next_action: e.next_action,
      next_action_date: e.next_action_date,
      details: e.details,
      created_at: e.created_at,
      credit_id: caseRows[0].credit_id,
      debtor_name: caseRows[0].debtor_name,
    }));

    res.json({
      data: history,
      case: caseRows[0],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cases/:id/assign
 */
router.post('/:id/assign', requireAdmin, (req, res, next) => {
  try {
    const { negotiator_id } = req.body || {};
    const data = assignCase(Number(req.params.id), negotiator_id, req.user);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cases/:id/call-outcome
 */
router.post(
  '/:id/call-outcome',
  authorize('call_outcome', 'create'),
  requireCallOutcomeAccess,
  async (req, res, next) => {
    try {
      const data = await submitCallOutcome(Number(req.params.id), req.body, req.user);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
