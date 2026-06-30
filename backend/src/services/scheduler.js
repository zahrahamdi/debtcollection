'use strict';

const cron = require('node-cron');
const strategyEngine = require('./strategy-engine.service');

let started = false;

function startScheduler() {
  if (started) return;
  started = true;

  cron.schedule('* * * * *', () => {
    strategyEngine.run().catch((err) => {
      console.error('[scheduler] خطا در اجرای موتور استراتژی:', err);
    });
  });

  console.log('[scheduler] زمان‌بند موتور استراتژی فعال شد (هر ۱ دقیقه)');
}

module.exports = { startScheduler };
