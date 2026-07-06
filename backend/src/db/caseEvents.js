'use strict';

const { query, run } = require('./database');
const { nowDatetime, parseActionDatetime } = require('./dateUtil');
const { actionTypeToLabel, ASSIGN_OPERATION } = require('./lastAction');

const EVENT_TYPES = ['action', 'assignment', 'system', 'call_outcome', 'payment'];

function historyOperationToEventType(operation) {
  if (operation === ASSIGN_OPERATION || operation === 'تخصیص مجدد') return 'assignment';
  if (operation === 'ثبت خروجی تماس') return 'call_outcome';
  if (operation === 'پرداخت کامل بدهی' || operation === 'پرداخت جزئی بدهی') return 'payment';
  return 'system';
}

function insertCaseEvent(fields) {
  const {
    case_id,
    event_type,
    action_type = null,
    label,
    result = null,
    details = null,
    user_name = 'سیستم',
    seq = null,
    repeat_count = 0,
    cost = 0,
    next_action = null,
    next_action_date = null,
    case_status = null,
    created_at = null,
  } = fields;

  const eventCreatedAt = created_at || nowDatetime();

  const params = {
    $case_id: case_id,
    $event_type: event_type,
    $action_type: action_type,
    $label: label,
    $result: result,
    $details: details,
    $user_name: user_name || 'سیستم',
    $seq: seq,
    $repeat_count: repeat_count ?? 0,
    $cost: cost ?? 0,
    $next_action: next_action,
    $next_action_date: next_action_date,
    $case_status: case_status,
    $created_at: eventCreatedAt,
  };

  const sql = `INSERT INTO case_events
    (case_id, event_type, action_type, label, result, details, user_name, seq, repeat_count, cost,
     next_action, next_action_date, case_status, created_at)
    VALUES ($case_id, $event_type, $action_type, $label, $result, $details, $user_name, $seq, $repeat_count, $cost,
     $next_action, $next_action_date, $case_status, $created_at)`;
  return run(sql, params);
}

/** درج رکورد action (جایگزین case_actions) */
function insertActionEvent(fields) {
  const label = fields.label || actionTypeToLabel(fields.action_type) || fields.action_type;
  return insertCaseEvent({
    ...fields,
    event_type: 'action',
    label,
  });
}

/** درج رکورد history (جایگزین case_history) */
function insertHistoryEvent(fields) {
  const {
    case_id,
    operation,
    user_name = 'سیستم',
    case_status = null,
    next_action = null,
    next_action_date = null,
    details = null,
    created_at = null,
  } = fields;

  return insertCaseEvent({
    case_id,
    event_type: historyOperationToEventType(operation),
    label: operation,
    details,
    user_name,
    case_status,
    next_action,
    next_action_date,
    created_at,
  });
}

function listCaseEvents(caseId, filters = {}) {
  const conditions = ['case_id = $case_id'];
  const params = { $case_id: Number(caseId) };

  if (filters.event_type) {
    conditions.push('event_type = $event_type');
    params.$event_type = filters.event_type;
  }
  if (filters.label) {
    conditions.push('label = $label');
    params.$label = filters.label;
  }
  if (filters.user_name) {
    conditions.push('user_name LIKE $user_name');
    params.$user_name = `%${filters.user_name}%`;
  }
  if (filters.from_date) {
    conditions.push('created_at >= $from_date');
    params.$from_date = filters.from_date;
  }
  if (filters.to_date) {
    conditions.push('created_at <= $to_date');
    params.$to_date = filters.to_date;
  }

  return query(
    `SELECT * FROM case_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at ASC, id ASC`,
    params
  );
}

function getLatestCaseEvent(caseId) {
  const rows = query(
    `SELECT * FROM case_events WHERE case_id = $id ORDER BY created_at DESC, id DESC LIMIT 1`,
    { $id: Number(caseId) }
  );
  return rows[0] || null;
}

function countRecentEvents(caseId, eventType, actionType, withinSeconds = 10) {
  const conditions = ['case_id = $id'];
  const params = { $id: Number(caseId) };

  if (eventType) {
    conditions.push('event_type = $et');
    params.$et = eventType;
  }
  if (actionType) {
    conditions.push('action_type = $at');
    params.$at = actionType;
  }

  const rows = query(
    `SELECT id, created_at, details FROM case_events WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 20`,
    params
  );
  const cutoff = Date.now() - Number(withinSeconds) * 1000;

  return rows.filter((r) => {
    const dt = parseActionDatetime(r.created_at);
    if (!dt || dt.getTime() <= cutoff) return false;
    // فقط خروجی تماس ثبت‌شده (نه placeholder) — duplicate submit guard
    if (actionType === 'negotiator_call' && !r.details) return false;
    return true;
  });
}

function maxActionSeq(caseId) {
  const row = query(
    `SELECT COALESCE(MAX(seq), 0) AS m FROM case_events WHERE case_id = $id AND event_type = 'action'`,
    { $id: Number(caseId) }
  )[0];
  return row?.m ?? 0;
}

function parseEventBodyText(details) {
  if (details === null || details === undefined || details === '') return null;
  const raw = String(details);
  if (!raw.trim().startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.body_text) return String(parsed.body_text);
    if (parsed?.body) return String(parsed.body);
  } catch {
    /* plain text */
  }
  return raw;
}

/** نگاشت رویداد action به شکل legacy case_actions برای سازگاری API */
function mapEventToLegacyAction(ev) {
  return {
    id: ev.id,
    case_id: ev.case_id,
    seq: ev.seq,
    action_type: ev.action_type,
    label: ev.label,
    body_text:
      ev.action_type !== 'negotiator_call' &&
      ev.action_type !== 'strategy_failure' &&
      ev.event_type !== 'payment'
        ? parseEventBodyText(ev.details)
        : null,
    result: ev.result,
    action_date: ev.created_at,
    created_at: ev.created_at,
    cost: ev.cost,
    repeat_count: ev.repeat_count,
    call_status: ev.action_type === 'negotiator_call' ? ev.details : null,
    next_call_date: ev.next_action_date,
  };
}

module.exports = {
  EVENT_TYPES,
  historyOperationToEventType,
  insertCaseEvent,
  insertActionEvent,
  insertHistoryEvent,
  listCaseEvents,
  getLatestCaseEvent,
  countRecentEvents,
  maxActionSeq,
  mapEventToLegacyAction,
};
