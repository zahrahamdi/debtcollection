'use strict';

require('dotenv').config();

const createApp = require('./app');
const { initDatabase } = require('./db/database');
const { runPendingMaintenance } = require('./services/maintenance.service');

const PORT = process.env.PORT || 3000;

/**
 * نقطه شروع برنامه:
 *   1. ابتدا دیتابیس مقداردهی می‌شود (load فایل موجود یا ساخت جدید + اجرای schema).
 *   2. سپس سرور Express بالا می‌آید.
 *   3. در صورت وجود backend/.pending-maintenance.json عملیات نگهداری (مثل حذف همه پرونده‌ها) اجرا می‌شود.
 */
async function start() {
  try {
    await initDatabase();

    // اجرای عملیات نگهداری در صورت وجود فایل flag
    const maintenanceResult = runPendingMaintenance();
    if (maintenanceResult) {
      console.log('[maintenance] عملیات نگهداری انجام شد:', JSON.stringify(maintenanceResult, null, 2));
    }

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`[server] سرور دیجی‌پی روی پورت ${PORT} اجرا شد.`);
      console.log(`[server] تست سلامت: http://localhost:${PORT}/api/health`);
      console.log(`[server] لیست پرونده‌ها: http://localhost:${PORT}/api/cases`);
      console.log(`[server] عملیات گروهی: http://localhost:${PORT}/api/bulk`);

      const { startScheduler } = require('./services/scheduler');
      startScheduler();
    });
  } catch (err) {
    console.error('[server] خطا در راه‌اندازی سرور:', err);
    process.exit(1);
  }
}

start();
