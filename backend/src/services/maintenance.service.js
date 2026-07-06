'use strict';

const fs = require('fs');
const path = require('path');
const { query, run, persist } = require('../db/database');
const { deleteAllCasesAndDebtors } = require('./debtor-cleanup.service');

const FLAG_FILE = path.join(__dirname, '..', '..', '.pending-maintenance.json');

function findLightLoan2Strategies() {
  return query(
    `SELECT id, title FROM strategies
     WHERE title LIKE '%سبک وام%'
       AND title <> 'استراتژی سبک وام'
       AND (
         title LIKE '%۲%'
         OR title LIKE '%2%'
         OR title LIKE '%دو%'
       )
     ORDER BY id ASC`
  );
}

function removeStrategyRows(rows) {
  const removed = [];
  for (const st of rows) {
    const ab = run('DELETE FROM ab_tests WHERE strategy_a_id = $id OR strategy_b_id = $id', {
      $id: st.id,
    });
    run('DELETE FROM strategy_actions WHERE strategy_id = $id', { $id: st.id });
    run('DELETE FROM strategies WHERE id = $id', { $id: st.id });
    removed.push({ id: st.id, title: st.title, ab_tests_removed: ab.changes });
  }
  persist();
  return removed;
}

function removeStrategyByTitle(title) {
  const rows = query('SELECT id, title FROM strategies WHERE title = $t', { $t: title });
  if (!rows.length) {
    return { found: false, title };
  }
  return { found: true, removed: removeStrategyRows(rows) };
}

function removeLightLoan2Strategy() {
  const rows = findLightLoan2Strategies();
  if (!rows.length) {
    const similar = query(`SELECT id, title FROM strategies WHERE title LIKE '%سبک وام%' ORDER BY id`);
    return { found: false, similar };
  }
  return { found: true, removed: removeStrategyRows(rows) };
}

function runPendingMaintenance() {
  if (!fs.existsSync(FLAG_FILE)) return null;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
  } catch (err) {
    console.error('[maintenance] فایل flag نامعتبر است:', err.message);
    fs.unlinkSync(FLAG_FILE);
    return { error: 'invalid_flag' };
  }

  const results = {};

  for (const task of payload.tasks || []) {
    if (task === 'clear_all_cases') {
      results.clear_all_cases = deleteAllCasesAndDebtors();
      console.log('[maintenance] همه پرونده‌ها و بدهکاران حذف شدند:', results.clear_all_cases.deleted);
    } else if (task === 'clear_ab_tests') {
      const before = query('SELECT COUNT(*) AS c FROM ab_tests')[0]?.c ?? 0;
      const { changes } = run('DELETE FROM ab_tests');
      results.clear_ab_tests = { before, removed: changes };
      console.log('[maintenance] سناریوهای A/B حذف شدند:', results.clear_ab_tests);
    } else if (task === 'remove_light_loan_2_strategy') {
      results.remove_light_loan_2_strategy = removeLightLoan2Strategy();
      console.log('[maintenance] حذف استراتژی سبک وام ۲:', results.remove_light_loan_2_strategy);
    } else if (task.startsWith('remove_strategy:')) {
      const title = task.slice('remove_strategy:'.length);
      results[`remove_strategy:${title}`] = removeStrategyByTitle(title);
      console.log('[maintenance] حذف استراتژی:', results[`remove_strategy:${title}`]);
    }
  }

  fs.unlinkSync(FLAG_FILE);
  persist();
  return results;
}

module.exports = { runPendingMaintenance, removeStrategyByTitle, removeLightLoan2Strategy };
