'use strict';

const cron = require('node-cron');
const { query, run } = require('../db/database');
const { isJalaliPromisedOverdue, nowDatetime, calcActionStatus } = require('../db/dateUtil');
const strategyEngine = require('./strategy-engine.service');

let started = false;

function formatRial(amount) {
  return `${Number(amount).toLocaleString('en-US')} ریال`;
}

function isAfterLastNegotiatorCall(caseRow) {
  const maxCalls = Number(caseRow.max_call_count) || 3;
  const attempts = Number(caseRow.current_action_repeat) || 0;
  return attempts >= maxCalls && caseRow.next_action !== 'تماس مذاکره‌کننده';
}

async function checkBrokenPromises() {
  const rows = query(
    `SELECT p.id, p.case_id, p.promised_datetime, p.amount,
            c.debtor_id, c.case_status, c.next_action, c.next_action_date,
            c.max_call_count, c.current_action_repeat, c.strategy_id
     FROM promises p
     JOIN cases c ON c.id = p.case_id
     WHERE p.status = 'pending' AND p.promised_datetime IS NOT NULL`
  );

  let engineNeeded = false;

  for (const row of rows) {
    if (!isJalaliPromisedOverdue(row.promised_datetime)) continue;

    run(`UPDATE promises SET status = 'broken' WHERE id = $id`, { $id: row.id });

    const details = `تاریخ سررسید: ${row.promised_datetime} · مبلغ تعهد: ${formatRial(row.amount)}`;
    run(
      `INSERT INTO case_history (case_id, debtor_id, user_name, operation, case_status, next_action, next_action_date, details)
       VALUES ($cid, $did, 'سیستم', 'نقض تعهد پرداخت', $st, $na, $nad, $det)`,
      {
        $cid: row.case_id,
        $did: row.debtor_id,
        $st: row.case_status,
        $na: row.next_action,
        $nad: row.next_action_date,
        $det: details,
      }
    );

    if (isAfterLastNegotiatorCall(row)) {
      const nad = nowDatetime();
      run(
        `UPDATE cases SET next_action_date = $nad, action_status = $as, updated_at = datetime('now')
         WHERE id = $id`,
        {
          $nad: nad,
          $as: calcActionStatus(nad),
          $id: row.case_id,
        }
      );
      engineNeeded = true;
    }
  }

  if (engineNeeded) {
    await strategyEngine.run();
  }
}

function startScheduler() {
  if (started) return;
  started = true;

  cron.schedule('* * * * *', () => {
    strategyEngine.run().catch((err) => {
      console.error('[scheduler] خطا در اجرای موتور استراتژی:', err);
    });
    checkBrokenPromises().catch((err) => {
      console.error('[scheduler] خطا در بررسی تعهدات نقض‌شده:', err);
    });
  });

  console.log('[scheduler] زمان‌بند موتور استراتژی و تعهدات پرداخت فعال شد (هر ۱ دقیقه)');
}

module.exports = { startScheduler, checkBrokenPromises };
