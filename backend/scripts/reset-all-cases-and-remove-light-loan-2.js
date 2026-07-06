'use strict';

/**
 * پاک کردن همه پرونده‌ها/بدهکاران + حذف «استراتژی سبک وام ۲» + پاک کردن سناریوهای A/B
 * اجرا: npm run reset-cases-light-loan-2
 */

const { initDatabase, query, run, persist } = require('../src/db/database');
const {
  deleteAllCasesAndDebtors,
} = require('../src/services/debtor-cleanup.service');
const { removeLightLoan2Strategy } = require('../src/services/maintenance.service');

async function main() {
  await initDatabase();

  const caseCleanup = deleteAllCasesAndDebtors();
  console.log('[reset] پرونده‌ها و بدهکاران:', caseCleanup.deleted);

  const strategyResult = removeLightLoan2Strategy();
  console.log('[reset] حذف استراتژی سبک وام ۲:', strategyResult);

  const abBefore = query('SELECT COUNT(*) AS c FROM ab_tests')[0]?.c ?? 0;
  const abRemoved = run('DELETE FROM ab_tests');
  console.log('[reset] سناریوهای A/B:', { before: abBefore, removed: abRemoved.changes });

  persist();

  console.log('[reset] وضعیت نهایی:', {
    cases: query('SELECT COUNT(*) AS c FROM cases')[0].c,
    debtors: query('SELECT COUNT(*) AS c FROM debtors')[0].c,
    ab_tests: query('SELECT COUNT(*) AS c FROM ab_tests')[0].c,
    strategies: query('SELECT id, title FROM strategies ORDER BY id'),
  });
}

main().catch((err) => {
  console.error('[reset] خطا:', err);
  process.exit(1);
});
