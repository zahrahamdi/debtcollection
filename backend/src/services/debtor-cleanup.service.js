'use strict';

const { query, run, getDb, persist } = require('../db/database');

function mobileTail(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(-10);
}

function findDebtorsByMobile(mobile) {
  const tail = mobileTail(mobile);
  if (tail.length !== 10) return [];
  const debtors = query('SELECT id, first_name, last_name, national_code, mobile FROM debtors');
  return debtors.filter((d) => mobileTail(d.mobile) === tail);
}

function deleteDebtorsByIds(debtorIds) {
  if (debtorIds.length === 0) {
    return { deleted: {}, debtors: [], cases: [] };
  }

  const db = getDb();
  const del = (sql, params) => {
    db.run(sql, params);
    const row = db.exec('SELECT changes() AS c');
    return row[0]?.values[0]?.[0] ?? 0;
  };
  const sel = (sql, params) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const placeholders = debtorIds.map(() => '?').join(',');
  const cases = sel(`SELECT id, credit_id FROM cases WHERE debtor_id IN (${placeholders})`, debtorIds);
  const caseIds = cases.map((c) => c.id);
  const counts = {};

  if (caseIds.length > 0) {
    const cph = caseIds.map(() => '?').join(',');
    counts.case_events = del(`DELETE FROM case_events WHERE case_id IN (${cph})`, caseIds);
    counts.case_history = del(`DELETE FROM case_history WHERE case_id IN (${cph})`, caseIds);
    counts.case_actions = del(`DELETE FROM case_actions WHERE case_id IN (${cph})`, caseIds);
    counts.promises = del(`DELETE FROM promises WHERE case_id IN (${cph})`, caseIds);
    counts.case_files = del(`DELETE FROM case_files WHERE case_id IN (${cph})`, caseIds);
    counts.payments = del(`DELETE FROM payments WHERE case_id IN (${cph})`, caseIds);
    counts.installments = del(`DELETE FROM installments WHERE case_id IN (${cph})`, caseIds);
    counts.cases = del(`DELETE FROM cases WHERE id IN (${cph})`, caseIds);
  } else {
    counts.cases = 0;
  }

  counts.phone_numbers = del(`DELETE FROM phone_numbers WHERE debtor_id IN (${placeholders})`, debtorIds);
  counts.addresses = del(`DELETE FROM addresses WHERE debtor_id IN (${placeholders})`, debtorIds);
  counts.debtors = del(`DELETE FROM debtors WHERE id IN (${placeholders})`, debtorIds);

  persist();

  return { deleted: counts, debtors: debtorIds, cases };
}

function deleteDebtorByMobile(mobile) {
  const matched = findDebtorsByMobile(mobile);
  if (matched.length === 0) {
    return { found: false, deleted: {}, debtors: [], cases: [] };
  }
  const result = deleteDebtorsByIds(matched.map((d) => d.id));
  return { found: true, matched, ...result };
}

/** حذف همه بدهکاران و پرونده‌ها */
function deleteAllCasesAndDebtors() {
  const allDebtors = query('SELECT id FROM debtors');
  const debtorIds = allDebtors.map((d) => d.id);
  if (!debtorIds.length) {
    return { deleted: { cases: 0, debtors: 0 }, debtors: [], cases: [] };
  }
  return deleteDebtorsByIds(debtorIds);
}

/** حذف همه بدهکاران و پرونده‌ها به‌جز بدهکار با شماره موبایل مشخص */
function deleteAllExceptMobile(mobile) {
  const keepDebtors = findDebtorsByMobile(mobile);
  if (keepDebtors.length === 0) {
    return { ok: false, error: 'بدهکار نگه‌داشته‌شده با این موبایل یافت نشد', kept: [], deleted: {} };
  }

  const keepIds = keepDebtors.map((d) => d.id);
  const allDebtors = query('SELECT id, first_name, last_name, mobile FROM debtors');
  const deleteDebtorIds = allDebtors.filter((d) => !keepIds.includes(d.id)).map((d) => d.id);

  const result = deleteDebtorsByIds(deleteDebtorIds);

  const kept_cases = [];
  for (const id of keepIds) {
    kept_cases.push(
      ...query('SELECT id, credit_id, case_status FROM cases WHERE debtor_id = $did', { $did: id })
    );
  }

  return {
    ok: true,
    kept: keepDebtors,
    removed_debtors: deleteDebtorIds.length,
    deleted: result.deleted,
    kept_cases,
  };
}

module.exports = {
  deleteDebtorByMobile,
  deleteAllExceptMobile,
  deleteAllCasesAndDebtors,
  findDebtorsByMobile,
};
