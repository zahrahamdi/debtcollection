'use strict';

/**
 * نسبت‌دهی پرونده به استراتژی‌ها بر اساس بازه‌های اجرا (نه فقط strategy_id فعلی).
 * پرونده‌ای که از سبک به سنگین رفته در هر دو استراتژی شمرده می‌شود.
 */

const { query } = require('../db/database');

const TRANSITION_LABELS = new Set([
  'تخصیص استراتژی',
  'به‌روزرسانی CEI و استراتژی',
  'تغییر استراتژی پس از پرداخت جزئی',
  'اعمال تغییر استراتژی معوق',
]);

function parseJsonDetails(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function loadStrategyLookups() {
  const strategies = query('SELECT id, title, segment_id, credit_type FROM strategies ORDER BY id ASC');
  const segments = query('SELECT id, title FROM segments ORDER BY id ASC');
  const titleToId = {};
  const defaultBySegment = {};
  const segmentTitleToId = {};
  for (const s of strategies) {
    titleToId[s.title] = Number(s.id);
    const key = `${s.segment_id}:${s.credit_type}`;
    if (!defaultBySegment[key]) defaultBySegment[key] = Number(s.id);
  }
  for (const seg of segments) {
    segmentTitleToId[seg.title] = Number(seg.id);
  }
  return { titleToId, defaultBySegment, segmentTitleToId, strategies };
}

function resolveStrategyFromSegment(segmentId, creditType, defaultBySegment) {
  if (!segmentId) return null;
  const formulaType = creditType === 'bnpl' ? 'bnpl' : 'loan';
  return defaultBySegment[`${segmentId}:${formulaType}`] ?? null;
}

function loadTimelineEventsByCase(caseIds) {
  if (!caseIds.length) return {};
  const ph = caseIds.map((_, i) => `$id${i}`).join(', ');
  const params = Object.fromEntries(caseIds.map((id, i) => [`$id${i}`, id]));
  const rows = query(
    `SELECT case_id, label, details, created_at, event_type, action_type
     FROM case_events
     WHERE case_id IN (${ph})
       AND (
         label IN ('تخصیص استراتژی', 'به‌روزرسانی CEI و استراتژی',
                   'تغییر استراتژی پس از پرداخت جزئی', 'اعمال تغییر استراتژی معوق')
         OR action_type = 'strategy_failure'
       )
     ORDER BY case_id ASC, created_at ASC, id ASC`,
    params
  );
  const map = {};
  for (const row of rows) {
    if (!map[row.case_id]) map[row.case_id] = [];
    map[row.case_id].push(row);
  }
  return map;
}

function transitionToStrategyId(ev, creditType, lookups) {
  const d = parseJsonDetails(ev.details);
  if (!d) return null;

  if (ev.label === 'تخصیص استراتژی' && d.strategy_id) {
    return Number(d.strategy_id);
  }

  if (ev.label === 'به‌روزرسانی CEI و استراتژی') {
    if (d.strategy_new_id) return Number(d.strategy_new_id);
  }

  if (ev.label === 'اعمال تغییر استراتژی معوق') {
    if (d.strategy_new_id) return Number(d.strategy_new_id);
    const segId = d.new_segment_id ?? d.segment_new_id;
    if (segId) return resolveStrategyFromSegment(Number(segId), creditType, lookups.defaultBySegment);
  }

  if (ev.label === 'تغییر استراتژی پس از پرداخت جزئی') {
    if (d.strategy_id) return Number(d.strategy_id);
    if (d.strategy_new_id) return Number(d.strategy_new_id);
    const segId = d.new_segment_id ?? d.segment_new_id;
    if (segId) return resolveStrategyFromSegment(Number(segId), creditType, lookups.defaultBySegment);
    if (d.segment_new_title) {
      const segFromTitle = lookups.segmentTitleToId[d.segment_new_title];
      if (segFromTitle) {
        return resolveStrategyFromSegment(segFromTitle, creditType, lookups.defaultBySegment);
      }
    }
  }

  if (ev.action_type === 'strategy_failure') {
    if (d.reason && String(d.reason).includes('آخرین استراتژی')) return null;
    if (d.strategy_new) return lookups.titleToId[d.strategy_new] ?? null;
  }

  return null;
}

function buildCaseTenures(caseRow, events, lookups, parseFlexibleDate) {
  const segments = [];
  let activeSid = null;
  let activeStart = parseFlexibleDate(caseRow.created_at);

  for (const ev of events) {
    const ts = parseFlexibleDate(ev.created_at);
    if (ts === null) continue;

    if (ev.action_type === 'strategy_failure') {
      if (activeSid != null && activeStart != null) {
        segments.push({ strategyId: activeSid, startMs: activeStart, endMs: ts });
      }
      activeSid = null;
      activeStart = null;
      const nextSid = transitionToStrategyId(ev, caseRow.credit_type, lookups);
      if (nextSid) {
        activeSid = nextSid;
        activeStart = ts;
      }
      continue;
    }

    if (!TRANSITION_LABELS.has(ev.label)) continue;

    const nextSid = transitionToStrategyId(ev, caseRow.credit_type, lookups);
    if (!nextSid) continue;

    if (activeSid === nextSid) continue;

    if (activeSid != null && activeStart != null) {
      segments.push({ strategyId: activeSid, startMs: activeStart, endMs: ts });
    }
    activeSid = nextSid;
    activeStart = ts;
  }

  if (activeSid != null && activeStart != null) {
    segments.push({ strategyId: activeSid, startMs: activeStart, endMs: null });
  } else if (!segments.length && caseRow.strategy_id) {
    segments.push({
      strategyId: Number(caseRow.strategy_id),
      startMs: activeStart ?? parseFlexibleDate(caseRow.created_at) ?? Date.now(),
      endMs: null,
    });
  }

  return segments;
}

function tenureOverlapsFilter(tenure, filters, parseFlexibleDate) {
  if (!filters?.from_dt && !filters?.to_dt) return true;
  const start = tenure.startMs;
  const end = tenure.endMs ?? Date.now();
  const from = filters.from_dt ? parseFlexibleDate(filters.from_dt) : null;
  const to = filters.to_dt ? parseFlexibleDate(filters.to_dt) : null;
  if (from !== null && end < from) return false;
  if (to !== null && start > to) return false;
  return true;
}

function timestampInTenure(ts, tenure) {
  if (ts === null) return false;
  const end = tenure.endMs ?? Number.MAX_SAFE_INTEGER;
  return ts >= tenure.startMs && ts <= end;
}

/** فقط پرداخت کامل در نرخ تبدیل استراتژی شمرده می‌شود؛ پرداخت جزئی وصول است نه تبدیل */
function isStrategyConversionPayment(payment) {
  return payment?.payment_type === 'full';
}

function computeStrategyAttribution(strategyId, caseTenureRows, deps) {
  const {
    paymentsByCase,
    actionsByCase,
    filters,
    parseFlexibleDate,
    parsePaymentDate,
    paymentInJalaliRange,
    isCollectiblePayment,
    round2,
  } = deps;

  const tenuresForStrategy = [];
  for (const row of caseTenureRows) {
    for (const tenure of row.tenures) {
      if (tenure.strategyId !== strategyId) continue;
      if (!tenureOverlapsFilter(tenure, filters, parseFlexibleDate)) continue;
      tenuresForStrategy.push({ caseId: row.caseId, ...tenure });
    }
  }

  const caseIds = new Set(tenuresForStrategy.map((t) => t.caseId));
  const paidCaseIds = new Set();
  const daysToPayment = [];
  let totalCost = 0;
  let totalCollected = 0;

  for (const tenure of tenuresForStrategy) {
    const payments = (paymentsByCase[tenure.caseId] || []).filter(isCollectiblePayment);
    const tenurePayments = [];
    const conversionPayments = [];

    for (const p of payments) {
      const payTs = parsePaymentDate(p.payment_date);
      if (!timestampInTenure(payTs, tenure)) continue;
      if (
        filters.from_date &&
        !paymentInJalaliRange(p.payment_date, filters.from_date, filters.to_date)
      ) {
        continue;
      }
      tenurePayments.push({ ...p, payTs });
      totalCollected += Number(p.amount) || 0;
      if (isStrategyConversionPayment(p)) {
        conversionPayments.push({ ...p, payTs });
      }
    }

    if (conversionPayments.length) {
      paidCaseIds.add(tenure.caseId);
      const firstPayTs = conversionPayments.reduce(
        (min, p) => (p.payTs < min ? p.payTs : min),
        conversionPayments[0].payTs
      );
      daysToPayment.push((firstPayTs - tenure.startMs) / 86400000);
    }

    for (const action of actionsByCase[tenure.caseId] || []) {
      const actionTs = parseFlexibleDate(action.action_date);
      if (!timestampInTenure(actionTs, tenure)) continue;
      if (filters.from_dt && actionTs < parseFlexibleDate(filters.from_dt)) continue;
      if (filters.to_dt && actionTs > parseFlexibleDate(filters.to_dt)) continue;
      totalCost += Number(action.cost) || 0;
    }
  }

  const totalCases = caseIds.size;
  const paidCases = paidCaseIds.size;
  const conversionRate = totalCases > 0 ? round2((paidCases / totalCases) * 100) : 0;
  const avgDays =
    daysToPayment.length > 0
      ? round2(daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length)
      : null;

  return {
    total_cases: totalCases,
    paid_cases: paidCases,
    conversion_rate: conversionRate,
    success_rate: conversionRate,
    avg_days_to_payment: avgDays,
    total_cost: totalCost,
    total_collected: totalCollected,
    case_ids: [...caseIds],
    tenures: tenuresForStrategy,
  };
}

function buildCaseTenureRows(cases, parseFlexibleDate) {
  if (!cases.length) return { rows: [], lookups: loadStrategyLookups() };
  const lookups = loadStrategyLookups();
  const caseIds = cases.map((c) => c.id);
  const eventsByCase = loadTimelineEventsByCase(caseIds);
  const rows = cases.map((c) => ({
    caseId: c.id,
    creditType: c.credit_type,
    tenures: buildCaseTenures(c, eventsByCase[c.id] || [], lookups, parseFlexibleDate),
  }));
  return { rows, lookups };
}

function getTenuresForStrategy(caseTenureRows, strategyId, filters, parseFlexibleDate) {
  const tenures = [];
  for (const row of caseTenureRows) {
    for (const tenure of row.tenures) {
      if (tenure.strategyId !== strategyId) continue;
      if (!tenureOverlapsFilter(tenure, filters, parseFlexibleDate)) continue;
      tenures.push({ caseId: row.caseId, ...tenure });
    }
  }
  return tenures;
}

function isTimestampInStrategyTenures(caseId, ts, tenures) {
  if (ts === null) return false;
  return tenures.some((t) => t.caseId === caseId && timestampInTenure(ts, t));
}

function caseIdsForStrategy(caseTenureRows, strategyId, filters, parseFlexibleDate) {
  const ids = new Set();
  for (const row of caseTenureRows) {
    for (const tenure of row.tenures) {
      if (tenure.strategyId !== strategyId) continue;
      if (!tenureOverlapsFilter(tenure, filters, parseFlexibleDate)) continue;
      ids.add(row.caseId);
      break;
    }
  }
  return [...ids];
}

module.exports = {
  buildCaseTenureRows,
  computeStrategyAttribution,
  caseIdsForStrategy,
  getTenuresForStrategy,
  isTimestampInStrategyTenures,
  buildCaseTenures,
  tenureOverlapsFilter,
  timestampInTenure,
};
