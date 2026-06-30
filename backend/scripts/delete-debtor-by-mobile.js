'use strict';

/**
 * حذف بدهکار و پرونده‌های مرتبط بر اساس شماره موبایل
 * اجرا: node scripts/delete-debtor-by-mobile.js [mobile]
 */

const { initDatabase } = require('../src/db/database');
const { deleteDebtorByMobile } = require('../src/services/debtor-cleanup.service');

const mobile = process.argv[2] || '09128898006';

initDatabase()
  .then(() => {
    const result = deleteDebtorByMobile(mobile);
    if (!result.found) {
      console.log('[delete] بدهکاری با موبایل', mobile, 'یافت نشد.');
      return;
    }
    console.log('[delete] بدهکاران:', result.matched);
    console.log('[delete] پرونده‌های حذف‌شده (ids):', result.cases);
    console.log('[delete] تعداد ردیف‌ها:', result.deleted);
  })
  .catch((err) => {
    console.error('[delete] خطا:', err);
    process.exit(1);
  });
