'use strict';

const { query, run } = require('../db/database');
const { insertHistoryEvent } = require('../db/caseEvents');
const { nowDatetime, calcActionStatus, todayJalali } = require('../db/dateUtil');
const { ASSIGN_OPERATION } = require('../db/lastAction');

const MAX_ROWS = 1000;

const ASSIGN_HEADERS = {
  'شناسه اعتبار': 'credit_id',
  'نام مذاکره کننده': 'negotiator_name',
  'نام مذاکره‌کننده': 'negotiator_name',
};

const REASSIGN_HEADERS = {
  'شناسه اعتبار': 'credit_id',
  'نام مذاکره کننده جدید': 'negotiator_name',
  'نام مذاکره‌کننده جدید': 'negotiator_name',
};

function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapRow(raw, headerMap) {
  const mapped = {};
  for (const [key, val] of Object.entries(raw)) {
    const field = headerMap[normalizeHeader(key)];
    if (field) mapped[field] = val;
  }
  return mapped;
}

function findCaseByCreditId(creditId) {
  const rows = query(
    `SELECT c.*, (d.first_name || ' ' || d.last_name) AS debtor_name
     FROM cases c
     LEFT JOIN debtors d ON d.id = c.debtor_id
     WHERE c.credit_id = $cid`,
    { $cid: creditId }
  );
  return rows[0] || null;
}

function findNegotiatorByName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  const rows = query('SELECT * FROM negotiators WHERE name = $name', { $name: trimmed });
  return rows[0] || null;
}

function countNegotiatorActiveCases(negotiatorId, excludeCaseId = null) {
  let sql = `SELECT COUNT(*) AS c FROM cases
             WHERE assigned_negotiator_id = $n AND case_status NOT IN ('paid','burned')`;
  const params = { $n: negotiatorId };
  if (excludeCaseId != null) {
    sql += ' AND id <> $id';
    params.$id = excludeCaseId;
  }
  return query(sql, params)[0]?.c ?? 0;
}

function hasDebtorNegotiatorConflict(debtorId, caseId, targetNegotiatorId) {
  const row = query(
    `SELECT COUNT(*) AS c FROM cases
     WHERE debtor_id = $d AND id <> $id
       AND assigned_negotiator_id IS NOT NULL AND assigned_negotiator_id <> $n
       AND case_status NOT IN ('paid','burned')`,
    { $d: debtorId, $id: caseId, $n: targetNegotiatorId }
  )[0];
  return (row?.c ?? 0) > 0;
}

function processAssignRow(mapped, rowNum, rawRow, ctx) {
  const creditId = String(mapped.credit_id ?? '').trim();
  const negotiatorName = String(mapped.negotiator_name ?? '').trim();

  if (!creditId) {
    return { ok: false, reason: 'فیلد شناسه اعتبار خالی است', raw: rawRow };
  }
  if (!negotiatorName) {
    return { ok: false, reason: 'فیلد نام مذاکره‌کننده خالی است', raw: rawRow };
  }

  const caseRow = findCaseByCreditId(creditId);
  if (!caseRow) {
    return { ok: false, reason: 'شناسه اعتبار در سیستم یافت نشد', raw: rawRow, credit_id: creditId };
  }

  if (caseRow.case_status !== 'pending_negotiator_assignment') {
    return {
      ok: false,
      reason: 'پرونده در وضعیت «در انتظار تخصیص به مذاکره‌کننده» نیست',
      raw: rawRow,
      credit_id: creditId,
    };
  }

  const negotiator = findNegotiatorByName(negotiatorName);
  if (!negotiator) {
    return { ok: false, reason: 'مذاکره‌کننده یافت نشد', raw: rawRow, credit_id: creditId };
  }
  if (negotiator.status !== 'active') {
    return { ok: false, reason: 'مذاکره‌کننده غیرفعال است', raw: rawRow, credit_id: creditId };
  }

  if (hasDebtorNegotiatorConflict(caseRow.debtor_id, caseRow.id, negotiator.id)) {
    return {
      ok: false,
      reason: 'پرونده دیگری از این بدهکار به فرد دیگری واگذار شده است',
      raw: rawRow,
      credit_id: creditId,
    };
  }

  const capacityErr = checkCapacity(negotiator, caseRow.id, 0);
  if (capacityErr) {
    return { ok: false, reason: capacityErr, raw: rawRow, credit_id: creditId };
  }

  const assignNow = nowDatetime();
  const assignActionStatus = calcActionStatus(assignNow);
  run(
    `UPDATE cases SET assigned_negotiator_id = $n, case_status = 'pending_negotiator_call',
     next_action = $na, next_action_date = $nad, action_status = $as,
     last_action = $la, last_action_date = $lad, updated_at = datetime('now')
     WHERE id = $id`,
    {
      $n: negotiator.id,
      $id: caseRow.id,
      $na: 'تماس مذاکره‌کننده',
      $nad: assignNow,
      $as: assignActionStatus,
      $la: ASSIGN_OPERATION,
      $lad: todayJalali(),
    }
  );

  const updated = query('SELECT * FROM cases WHERE id = $id', { $id: caseRow.id })[0];
  insertAssignHistory(caseRow.id, caseRow.debtor_id, ctx.userName, negotiator.name, updated);

  return { ok: true, credit_id: creditId };
}

function processReassignRow(mapped, rowNum, rawRow, ctx) {
  const creditId = String(mapped.credit_id ?? '').trim();
  const negotiatorName = String(mapped.negotiator_name ?? '').trim();

  if (!creditId) {
    return { ok: false, reason: 'فیلد شناسه اعتبار خالی است', raw: rawRow };
  }
  if (!negotiatorName) {
    return { ok: false, reason: 'فیلد نام مذاکره‌کننده جدید خالی است', raw: rawRow };
  }

  const caseRow = findCaseByCreditId(creditId);
  if (!caseRow) {
    return { ok: false, reason: 'شناسه اعتبار در سیستم یافت نشد', raw: rawRow, credit_id: creditId };
  }

  if (!caseRow.assigned_negotiator_id) {
    return {
      ok: false,
      reason: 'پرونده مذاکره‌کننده ندارد',
      raw: rawRow,
      credit_id: creditId,
    };
  }

  const prevNeg = query('SELECT * FROM negotiators WHERE id = $id', {
    $id: caseRow.assigned_negotiator_id,
  })[0];
  const prevName = prevNeg?.name || '—';

  const negotiator = findNegotiatorByName(negotiatorName);
  if (!negotiator) {
    return { ok: false, reason: 'مذاکره‌کننده جدید یافت نشد', raw: rawRow, credit_id: creditId };
  }
  if (negotiator.status !== 'active') {
    return { ok: false, reason: 'مذاکره‌کننده جدید غیرفعال است', raw: rawRow, credit_id: creditId };
  }
  if (Number(caseRow.assigned_negotiator_id) === Number(negotiator.id)) {
    return {
      ok: false,
      reason: 'این پرونده هم‌اکنون به همین مذاکره‌کننده تخصیص یافته است',
      raw: rawRow,
      credit_id: creditId,
    };
  }

  if (hasDebtorNegotiatorConflict(caseRow.debtor_id, caseRow.id, negotiator.id)) {
    return {
      ok: false,
      reason: 'پرونده دیگری از این بدهکار به فرد دیگری واگذار شده است',
      raw: rawRow,
      credit_id: creditId,
    };
  }

  const capacityErr = checkCapacity(negotiator, caseRow.id, 0);
  if (capacityErr) {
    return { ok: false, reason: capacityErr, raw: rawRow, credit_id: creditId };
  }

  run(
    `UPDATE cases SET assigned_negotiator_id = $n, updated_at = datetime('now') WHERE id = $id`,
    { $n: negotiator.id, $id: caseRow.id }
  );

  const updated = query('SELECT * FROM cases WHERE id = $id', { $id: caseRow.id })[0];
  insertReassignHistory(caseRow.id, caseRow.debtor_id, ctx.userName, prevName, negotiator.name, updated);

  return { ok: true, credit_id: creditId };
}

function processRows(rows, mode, userName) {
  const headerMap = mode === 'assign' ? ASSIGN_HEADERS : REASSIGN_HEADERS;
  const processor = mode === 'assign' ? processAssignRow : processReassignRow;

  const result = {
    total: rows.length,
    success_count: 0,
    fail_count: 0,
    errors: [],
    error_rows: [],
  };

  const ctx = { userName };

  rows.forEach((rawRow, index) => {
    const rowNum = index + 2;
    const mapped = mapRow(rawRow, headerMap);
    const outcome = processor(mapped, rowNum, rawRow, ctx);

    if (outcome.ok) {
      result.success_count += 1;
    } else {
      result.fail_count += 1;
      result.errors.push({
        row: rowNum,
        credit_id: outcome.credit_id || mapped.credit_id || '—',
        reason: outcome.reason,
      });
      result.error_rows.push({
        ...rawRow,
        ردیف: rowNum,
        'دلیل خطا': outcome.reason,
      });
    }
  });

  return result;
}

function insertAssignHistory(caseId, debtorId, userName, negotiatorName, updated) {
  insertHistoryEvent({
    case_id: caseId,
    operation: 'تخصیص به مذاکره‌کننده',
    user_name: userName || 'ادمین',
    case_status: updated.case_status,
    next_action: updated.next_action,
    next_action_date: updated.next_action_date,
    details: `مذاکره‌کننده: ${negotiatorName} — نوبت تماس از ${updated.next_action_date}`,
  });
}

function insertReassignHistory(caseId, debtorId, userName, prevName, newName, updated) {
  insertHistoryEvent({
    case_id: caseId,
    operation: 'تخصیص مجدد',
    user_name: userName || 'ادمین',
    case_status: updated.case_status,
    next_action: updated.next_action,
    next_action_date: updated.next_action_date,
    details: `از ${prevName} به ${newName}`,
  });
}

function checkCapacity(negotiator, excludeCaseId, batchExtraCount) {
  const dbCount = countNegotiatorActiveCases(negotiator.id, excludeCaseId);
  if (dbCount + batchExtraCount >= negotiator.capacity) {
    return 'ظرفیت مذاکره‌کننده تکمیل است';
  }
  return null;
}

function bulkAssignFromRows(rows, userName) {
  return processRows(rows, 'assign', userName);
}

function bulkReassignFromRows(rows, userName) {
  return processRows(rows, 'reassign', userName);
}

module.exports = {
  MAX_ROWS,
  bulkAssignFromRows,
  bulkReassignFromRows,
};
