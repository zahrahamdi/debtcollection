'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');

function mapInstallmentRow(row) {
  const penaltyWaiver = Number(row.penalty_waiver) || 0;
  const amount = Number(row.amount) || 0;
  const penaltyBalance = Number(row.penalty_balance) || 0;
  const fee = Number(row.fee) || 0;
  const totalPayable = Math.max(0, amount + penaltyBalance + fee - penaltyWaiver);
  const bankSettlement =
    row.payment_status === 'paid' ? Number(row.bank_settlement) || totalPayable : 0;
  const guaranteeWithdrawal = Number(row.guarantee_withdrawal) || 0;

  return {
    id: row.id,
    installment_number: row.installment_number,
    due_date: row.due_date,
    amount,
    penalty_balance: penaltyBalance,
    fee,
    penalty_waiver: penaltyWaiver,
    total_payable: totalPayable,
    bank_settlement: bankSettlement,
    guarantee_withdrawal: guaranteeWithdrawal,
    payment_date: row.payment_date,
    payment_status: row.payment_status,
    installment_status: row.status,
    debt_class: row.debt_class,
    debtor_mobile: row.debtor_mobile,
    debtor_national_code: row.debtor_national_code,
    credit_id: row.credit_id,
  };
}

/**
 * GET /api/cases/:id/installments
 * لیست اقساط یک پرونده.
 * Query: installment_status, debt_class, payment_status (unpaid | paid)
 */
router.get('/:id/installments', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { installment_status, debt_class, payment_status } = req.query;

    const caseRows = query(
      `SELECT
         c.id,
         c.credit_id,
         c.claims_amount,
         c.debt_class,
         (d.first_name || ' ' || d.last_name) AS debtor_name
       FROM cases c
       LEFT JOIN debtors d ON d.id = c.debtor_id
       WHERE c.id = $id`,
      { $id: id }
    );
    if (caseRows.length === 0) return res.status(404).json({ error: 'پرونده یافت نشد' });

    const conditions = ['i.case_id = $id'];
    const params = { $id: id };

    if (installment_status) {
      conditions.push('i.status = $installment_status');
      params.$installment_status = String(installment_status).trim();
    }
    if (debt_class) {
      conditions.push('c.debt_class = $debt_class');
      params.$debt_class = String(debt_class).trim();
    }
    if (payment_status) {
      const ps = String(payment_status).trim();
      if (ps === 'unpaid' || ps === 'paid') {
        conditions.push('i.payment_status = $payment_status');
        params.$payment_status = ps;
      }
    }

    const rows = query(
      `SELECT
         i.id,
         i.installment_number,
         i.due_date,
         i.amount,
         i.penalty_balance,
         i.fee,
         i.status,
         i.payment_status,
         i.payment_date,
         c.debt_class,
         c.credit_id,
         d.mobile AS debtor_mobile,
         d.national_code AS debtor_national_code
       FROM installments i
       JOIN cases c ON c.id = i.case_id
       LEFT JOIN debtors d ON d.id = c.debtor_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.installment_number ASC, i.id ASC`,
      params
    );

    res.json({
      data: rows.map(mapInstallmentRow),
      case: caseRows[0],
    });
  } catch (err) {
    console.error('[GET /api/cases/:id/installments]', err);
    res.status(500).json({ error: 'خطا در دریافت اقساط پرونده' });
  }
});

module.exports = router;
