'use strict';

/**
 * حذف همه سناریوهای A/B Test بدون دست‌زدن به استراتژی‌ها
 * نتیجه: نرخ توزیع و سناریو A/B Test برای همه استراتژی‌ها خالی می‌شود.
 * اجرا: node scripts/clear-ab-tests.js
 */

const { initDatabase, query, run } = require('../src/db/database');

initDatabase()
  .then(() => {
    const before = query('SELECT COUNT(*) AS c FROM ab_tests')[0]?.c ?? 0;
    const { changes } = run('DELETE FROM ab_tests');
    const after = query('SELECT COUNT(*) AS c FROM ab_tests')[0]?.c ?? 0;
    console.log('[clear-ab-tests] سناریوهای قبل از حذف:', before);
    console.log('[clear-ab-tests] ردیف‌های حذف‌شده:', changes);
    console.log('[clear-ab-tests] سناریوهای باقی‌مانده:', after);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[clear-ab-tests] خطا:', err);
    process.exit(1);
  });
