'use strict';

require('dotenv').config();

const createApp = require('./app');
const { initDatabase } = require('./db/database');

const PORT = process.env.PORT || 3000;

/**
 * نقطه شروع برنامه:
 *   1. ابتدا دیتابیس مقداردهی می‌شود (load فایل موجود یا ساخت جدید + اجرای schema).
 *   2. سپس سرور Express بالا می‌آید.
 */
async function start() {
  try {
    await initDatabase();

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
