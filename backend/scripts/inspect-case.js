'use strict';
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'database.sqlite');
const creditId = process.argv[2] || '123789';

(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });
  const db = new SQL.Database(fs.readFileSync(DB_FILE));

  const q = (sql, params = {}) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const cases = q(
    `SELECT c.*, d.mobile FROM cases c JOIN debtors d ON d.id = c.debtor_id WHERE c.credit_id = $cid`,
    { $cid: creditId }
  );
  if (!cases.length) {
    console.log('Case not found for credit_id:', creditId);
    process.exit(1);
  }
  const c = cases[0];
  console.log('=== CASE ===');
  console.log(JSON.stringify(c, null, 2));

  const actions = q(
    `SELECT * FROM strategy_actions WHERE strategy_id = $sid ORDER BY seq`,
    { $sid: c.strategy_id }
  );
  console.log('\n=== STRATEGY ACTIONS ===');
  console.log(JSON.stringify(actions, null, 2));

  const caseActions = q(
    `SELECT id, seq, action_type, result, repeat_count, action_date FROM case_actions WHERE case_id = $id ORDER BY id`,
    { $id: c.id }
  );
  console.log('\n=== CASE ACTIONS ===');
  console.log(JSON.stringify(caseActions, null, 2));

  const smsCount = caseActions.filter((a) =>
    ['warning_sms', 'threatening_sms'].includes(a.action_type)
  ).length;
  console.log('\nSMS case_actions count:', smsCount);

  const history = q(
    `SELECT id, operation, case_status, next_action, created_at, details FROM case_history WHERE case_id = $id ORDER BY id`,
    { $id: c.id }
  );
  console.log('\n=== CASE HISTORY (SMS related) ===');
  console.log(
    JSON.stringify(
      history.filter((h) =>
        /پیامک|sms/i.test(h.operation + (h.details || ''))
      ),
      null,
      2
    )
  );
})();
