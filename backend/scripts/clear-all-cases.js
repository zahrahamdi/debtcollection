'use strict';

/**
 * حذف همه پرونده‌ها، بدهکاران و داده‌های وابسته
 * اجرا: npm run clear-all-cases
 */

const { initDatabase, query } = require('../src/db/database');
const { deleteAllCasesAndDebtors } = require('../src/services/debtor-cleanup.service');

async function main() {
  await initDatabase();

  const before = {
    cases: query('SELECT COUNT(*) AS c FROM cases')[0]?.c ?? 0,
    debtors: query('SELECT COUNT(*) AS c FROM debtors')[0]?.c ?? 0,
  };

  const result = deleteAllCasesAndDebtors();

  const after = {
    cases: query('SELECT COUNT(*) AS c FROM cases')[0]?.c ?? 0,
    debtors: query('SELECT COUNT(*) AS c FROM debtors')[0]?.c ?? 0,
  };

  console.log('[clear-all-cases] قبل:', before);
  console.log('[clear-all-cases] حذف‌شده:', result.deleted);
  console.log('[clear-all-cases] بعد:', after);
}

main().catch((err) => {
  console.error('[clear-all-cases] خطا:', err);
  process.exit(1);
});
