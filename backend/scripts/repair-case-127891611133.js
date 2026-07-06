'use strict';

/**
 * یک‌بار: اصلاح وضعیت پرونده 127891611133 پس از ثبت اشتباه «پاسخگو نبود»
 * (next_action = شکست استراتژی به‌جای تماس مجدد)
 *
 * Usage: node scripts/repair-case-127891611133.js
 */

const path = require('path');
const { initDb, query, run, persist } = require('../src/db/database');
const {
  calcActionStatus,
  computeNextActionDate,
  nowDatetime,
} = require('../src/db/dateUtil');
const { effectiveRepeatOnResults } = require('../src/db/strategyActions');

const CREDIT_ID = '127891611133';

async function main() {
  await initDb();

  const rows = query(
    `SELECT c.*, d.mobile FROM cases c JOIN debtors d ON d.id = c.debtor_id WHERE c.credit_id = $cid`,
    { $cid: CREDIT_ID }
  );
  if (!rows.length) {
    console.error('پرونده یافت نشد:', CREDIT_ID);
    process.exit(1);
  }
  const c = rows[0];
  console.log('قبل:', {
    id: c.id,
    case_status: c.case_status,
    next_action: c.next_action,
    current_action_repeat: c.current_action_repeat,
    max_call_count: c.max_call_count,
    call_count: c.call_count,
  });

  const negAction = query(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid AND action_type = 'negotiator_call' ORDER BY seq ASC LIMIT 1`,
    { $sid: c.strategy_id }
  )[0];
  if (!negAction) {
    console.error('اقدام مذاکره در استراتژی یافت نشد');
    process.exit(1);
  }

  const maxRepeat = Number(c.max_call_count) || Number(negAction.max_repeat) || 3;
  const attempts = Number(c.current_action_repeat) || 0;
  const repeatOn = effectiveRepeatOnResults(negAction);

  if (c.next_action !== 'شکست استراتژی' && c.case_status !== 'in_negotiation') {
    console.log('وضعیت پرونده نیاز به تعمیر ندارد — خروج.');
    process.exit(0);
  }

  if (attempts >= maxRepeat) {
    console.log('سقف تماس پر شده — تعمیر خودکار انجام نمی‌شود.');
    process.exit(0);
  }

  const waitRepeat = Number(negAction.wait_repeat_minutes) || 60;
  const nextActionDate = computeNextActionDate(waitRepeat, {
    allowed_from: negAction.allowed_from || '09:00',
    allowed_to: negAction.allowed_to || '18:00',
  });

  run(
    `UPDATE cases SET
       case_status = 'pending_negotiator_recall',
       next_action = 'تماس مذاکره‌کننده',
       next_action_date = $nad,
       action_status = $as,
       updated_at = datetime('now')
     WHERE id = $id`,
    {
      $id: c.id,
      $nad: nextActionDate,
      $as: calcActionStatus(nextActionDate),
    }
  );

  persist();

  const after = query('SELECT case_status, next_action, next_action_date, current_action_repeat FROM cases WHERE id = $id', {
    $id: c.id,
  })[0];
  console.log('بعد:', after);
  console.log('repeat_on_results مؤثر:', repeatOn);
  console.log('تعمیر انجام شد. پیامک عدم پاسخگویی را در صورت نیاز دستی ارسال کنید یا تماس مجدد ثبت کنید.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
