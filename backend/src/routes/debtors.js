'use strict';

const express = require('express');
const router = express.Router();
const { query, run } = require('../db/database');

const DEFAULT_LIMIT = 100;

function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function validateMobilePhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length !== 11) return 'شماره موبایل باید ۱۱ رقم باشد';
  if (!digits.startsWith('09')) return 'شماره موبایل باید با ۰۹ شروع شود';
  return null;
}

function parseIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

const AGGREGATE_SELECT = `
  SELECT
    d.*,
    COUNT(DISTINCT c.id) AS case_count,
    COUNT(DISTINCT CASE WHEN c.case_status NOT IN ('paid', 'burned') THEN c.id END) AS active_case_count,
    COALESCE(SUM(c.claims_amount), 0) AS total_claims,
    COALESCE(SUM(c.penalty_amount), 0) AS total_penalty,
    COALESCE(SUM(c.outstanding_debt), 0) AS total_outstanding_debt
  FROM debtors d
  LEFT JOIN cases c ON c.debtor_id = d.id
`;

/**
 * GET /api/debtors
 */
router.get('/', (req, res) => {
  try {
    const {
      mobile,
      national_code,
      province,
      first_name,
      last_name,
      min_claims,
      max_claims,
      min_penalty,
      max_penalty,
      page,
      limit,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));

    const conditions = [];
    const params = {};

    if (mobile) {
      const digits = normalizePhone(mobile);
      conditions.push(`(
        d.mobile LIKE $mobile
        OR EXISTS (
          SELECT 1 FROM phone_numbers pn
          WHERE pn.debtor_id = d.id AND pn.phone LIKE $mobile
        )
      )`);
      params.$mobile = `%${digits}%`;
    }
    if (national_code) {
      conditions.push('d.national_code LIKE $national_code');
      params.$national_code = `%${national_code}%`;
    }
    if (province) {
      conditions.push('d.province LIKE $province');
      params.$province = `%${province}%`;
    }
    if (first_name) {
      conditions.push('d.first_name LIKE $first_name');
      params.$first_name = `%${first_name}%`;
    }
    if (last_name) {
      conditions.push('d.last_name LIKE $last_name');
      params.$last_name = `%${last_name}%`;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows = query(
      `${AGGREGATE_SELECT}
       ${whereClause}
       GROUP BY d.id
       ORDER BY d.id ASC`,
      params
    );

    const minClaims = parseIntOrNull(min_claims);
    const maxClaims = parseIntOrNull(max_claims);
    const minPenalty = parseIntOrNull(min_penalty);
    const maxPenalty = parseIntOrNull(max_penalty);

    rows = rows.filter((r) => {
      const claims = Number(r.total_claims) || 0;
      const penalty = Number(r.total_penalty) || 0;
      if (minClaims !== null && claims < minClaims) return false;
      if (maxClaims !== null && claims > maxClaims) return false;
      if (minPenalty !== null && penalty < minPenalty) return false;
      if (maxPenalty !== null && penalty > maxPenalty) return false;
      return true;
    });

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageLimit));
    const data = rows.slice((pageNum - 1) * pageLimit, pageNum * pageLimit).map(formatDebtorListRow);

    res.json({
      count: total,
      page: pageNum,
      total_pages: totalPages,
      limit: pageLimit,
      data,
    });
  } catch (err) {
    console.error('[GET /api/debtors]', err);
    res.status(500).json({ error: 'خطا در دریافت لیست بدهکاران' });
  }
});

function formatDebtorListRow(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    national_code: row.national_code,
    gender: row.gender,
    mobile: row.mobile,
    province: row.province,
    city: row.city,
    customer_rank: row.customer_rank,
    created_at: row.created_at,
    case_count: row.case_count,
    active_case_count: row.active_case_count,
    total_claims: row.total_claims,
    total_penalty: row.total_penalty,
    total_outstanding_debt: row.total_outstanding_debt,
  };
}

/**
 * GET /api/debtors/:id
 */
router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = query('SELECT * FROM debtors WHERE id = $id', { $id: id });
    if (rows.length === 0) return res.status(404).json({ error: 'بدهکار یافت نشد' });

    const debtor = rows[0];
    const phones = query(
      'SELECT id, phone, source, created_at FROM phone_numbers WHERE debtor_id = $id ORDER BY id ASC',
      { $id: id }
    );

    const phoneNumbers = [...phones];
    if (debtor.mobile) {
      const mainNorm = normalizePhone(debtor.mobile);
      const exists = phoneNumbers.some((p) => normalizePhone(p.phone) === mainNorm);
      if (!exists) {
        phoneNumbers.unshift({
          id: null,
          phone: debtor.mobile,
          source: 'digipay',
          created_at: debtor.created_at,
        });
      }
    }
    const addresses = query(
      'SELECT id, address, postal_code, source, created_at FROM addresses WHERE debtor_id = $id ORDER BY id ASC',
      { $id: id }
    );

    const agg = query(
      `SELECT
         COUNT(*) AS case_count,
         COUNT(CASE WHEN case_status NOT IN ('paid', 'burned') THEN 1 END) AS active_case_count,
         COALESCE(SUM(claims_amount), 0) AS total_claims,
         COALESCE(SUM(penalty_amount), 0) AS total_penalty,
         COALESCE(SUM(outstanding_debt), 0) AS total_outstanding_debt
       FROM cases WHERE debtor_id = $id`,
      { $id: id }
    )[0];

    res.json({
      data: {
        ...debtor,
        phone_numbers: phoneNumbers,
        addresses,
        case_count: agg?.case_count ?? 0,
        active_case_count: agg?.active_case_count ?? 0,
        total_claims: agg?.total_claims ?? 0,
        total_penalty: agg?.total_penalty ?? 0,
        total_outstanding_debt: agg?.total_outstanding_debt ?? 0,
      },
    });
  } catch (err) {
    console.error('[GET /api/debtors/:id]', err);
    res.status(500).json({ error: 'خطا در دریافت جزئیات بدهکار' });
  }
});

/**
 * POST /api/debtors/:id/phone-numbers
 * body: { phone }
 */
router.post('/:id/phone-numbers', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { phone } = req.body || {};

    const debtorRows = query('SELECT id FROM debtors WHERE id = $id', { $id: id });
    if (debtorRows.length === 0) return res.status(404).json({ error: 'بدهکار یافت نشد' });

    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'شماره تماس اجباری است' });
    }

    const validationError = validateMobilePhone(phone);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalized = normalizePhone(phone);

    const dupSameDebtor = query(
      `SELECT id FROM phone_numbers
       WHERE debtor_id = $id AND REPLACE(REPLACE(phone, '-', ''), ' ', '') = $p LIMIT 1`,
      { $p: normalized, $id: id }
    );
    if (dupSameDebtor.length > 0) {
      return res.status(400).json({ error: 'این شماره تماس قبلاً ثبت شده است' });
    }

    const duplicate = query(
      `SELECT id FROM phone_numbers WHERE REPLACE(REPLACE(phone, '-', ''), ' ', '') = $p LIMIT 1`,
      { $p: normalized }
    );
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'این شماره تماس قبلاً ثبت شده است' });
    }

    const mainDup = query(
      `SELECT id FROM debtors
       WHERE REPLACE(REPLACE(mobile, '-', ''), ' ', '') = $p AND id != $id LIMIT 1`,
      { $p: normalized, $id: id }
    );
    if (mainDup.length > 0) {
      return res.status(400).json({ error: 'این شماره تماس قبلاً ثبت شده است' });
    }

    const existingMain = query(
      `SELECT mobile FROM debtors WHERE id = $id`,
      { $id: id }
    )[0];
    if (
      existingMain?.mobile &&
      normalizePhone(existingMain.mobile) === normalized
    ) {
      return res.status(400).json({ error: 'این شماره تماس قبلاً ثبت شده است' });
    }

    run(
      `INSERT INTO phone_numbers (debtor_id, phone, source) VALUES ($did, $phone, 'manual')`,
      { $did: id, $phone: normalized }
    );

    const inserted = query(
      'SELECT id, phone, source, created_at FROM phone_numbers WHERE debtor_id = $id ORDER BY id DESC LIMIT 1',
      { $id: id }
    )[0];

    res.status(201).json({ data: inserted });
  } catch (err) {
    console.error('[POST /api/debtors/:id/phone-numbers]', err);
    res.status(500).json({ error: 'خطا در افزودن شماره تماس' });
  }
});

module.exports = router;
