'use strict';

/**
 * حذف همه بدهکاران/پرونده‌ها به‌جز یک شماره موبایل
 * اجرا: node scripts/delete-all-except-mobile.js [mobile]
 */

const { initDatabase } = require('../src/db/database');
const { deleteAllExceptMobile } = require('../src/services/debtor-cleanup.service');

const mobile = process.argv[2] || '09128898006';

initDatabase()
  .then(() => {
    const result = deleteAllExceptMobile(mobile);
    if (!result.ok) {
      console.error('[delete] خطا:', result.error);
      process.exit(1);
    }
    console.log('[delete] نگه‌داشته شد:', result.kept);
    console.log('[delete] پرونده‌های باقی‌مانده:', result.kept_cases);
    console.log('[delete] بدهکاران حذف‌شده:', result.removed_debtors);
    console.log('[delete] تعداد ردیف‌ها:', result.deleted);
  })
  .catch((err) => {
    console.error('[delete] خطا:', err);
    process.exit(1);
  });
