'use strict';

/**
 * حذف پرونده (و در صورت نیاز بدهکار یتیم) بر اساس شناسه اعتبار
 * اجرا: node scripts/delete-case-by-credit-id.js 127891611121
 */

const { initDatabase, query, run, persist } = require('../src/db/database');

const creditId = process.argv[2];
if (!creditId) {
  console.error('Usage: node scripts/delete-case-by-credit-id.js <credit_id>');
  process.exit(1);
}

async function main() {
  await initDatabase();

  const rows = query('SELECT id, debtor_id FROM cases WHERE credit_id = $cid', { $cid: creditId });
  if (!rows.length) {
    console.log(`[delete-case] پرونده با شناسه ${creditId} یافت نشد.`);
    process.exit(0);
  }

  const { id: caseId, debtor_id: debtorId } = rows[0];
  const tables = [
    'case_events',
    'case_history',
    'case_actions',
    'promises',
    'case_files',
    'payments',
    'installments',
  ];

  for (const table of tables) {
    run(`DELETE FROM ${table} WHERE case_id = $id`, { $id: caseId });
  }
  run('DELETE FROM cases WHERE id = $id', { $id: caseId });

  const left = query('SELECT id FROM cases WHERE debtor_id = $d LIMIT 1', { $d: debtorId });
  if (!left.length) {
    run('DELETE FROM phone_numbers WHERE debtor_id = $d', { $d: debtorId });
    run('DELETE FROM addresses WHERE debtor_id = $d', { $d: debtorId });
    run('DELETE FROM debtors WHERE id = $d', { $d: debtorId });
    console.log(`[delete-case] پرونده ${creditId} و بدهکار مرتبط (id=${debtorId}) حذف شد.`);
  } else {
    console.log(`[delete-case] پرونده ${creditId} حذف شد (بدهکار id=${debtorId} پرونده دیگری دارد).`);
  }

  persist();
}

main().catch((err) => {
  console.error('[delete-case] خطا:', err);
  process.exit(1);
});
