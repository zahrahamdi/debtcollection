'use strict';

/**
 * ابزار تاریخ/زمان — next_action_date به فرمت YYYY-MM-DD HH:mm:ss
 * تاریخ‌های جلالی (YYYY/MM/DD) برای فیلدهای دیگر همچنان پشتیبانی می‌شوند.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function jalaliToGregorian(jy, jm, jd) {
  const jy1 = jy - 979;
  const jm1 = jm - 1;
  const jd1 = jd - 1;

  let jDayNo =
    365 * jy1 +
    Math.floor(jy1 / 33) * 8 +
    Math.floor(((jy1 % 33) + 3) / 4);

  const jMonthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  for (let i = 0; i < jm1; i++) jDayNo += jMonthDays[i];
  jDayNo += jd1;

  let gDayNo = jDayNo + 79;

  let gy = 1600 + 400 * Math.floor(gDayNo / 146097);
  gDayNo %= 146097;

  let leap = true;
  if (gDayNo >= 36525) {
    gDayNo--;
    gy += 100 * Math.floor(gDayNo / 36524);
    gDayNo %= 36524;
    if (gDayNo >= 365) gDayNo++;
    else leap = false;
  }

  gy += 4 * Math.floor(gDayNo / 1461);
  gDayNo %= 1461;

  if (gDayNo >= 366) {
    leap = false;
    gDayNo--;
    gy += Math.floor(gDayNo / 365);
    gDayNo %= 365;
  }

  const gMonthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 12 && gDayNo >= gMonthDays[gm]; gm++) gDayNo -= gMonthDays[gm];

  return { year: gy, month: gm + 1, day: gDayNo + 1 };
}

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { year: jy, month: jm, day: jd };
}

function formatJalali(jy, jm, jd) {
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

function formatDatetime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function nowDatetime() {
  return formatDatetime(new Date());
}

function addMinutesFromNow(minutes) {
  return formatDatetime(new Date(Date.now() + Number(minutes || 0) * 60000));
}

/** wait_minutes از الان + ساعت allowed_from روی همان روز (برای next_action_date استراتژی) */
function addMinutesWithAllowedFrom(minutes, allowedFrom) {
  const base = new Date(Date.now() + Number(minutes || 0) * 60000);
  const parts = String(allowedFrom || '09:00').split(':');
  base.setHours(Number(parts[0]) || 9, Number(parts[1]) || 0, 0, 0);
  return formatDatetime(base);
}

/** فردا ساعت شروع بازه مجاز (برای اولین اکشن خارج از بازه) */
function nextAllowedStartDatetime(allowedFrom) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const parts = String(allowedFrom || '09:00').split(':');
  d.setHours(Number(parts[0]) || 9, Number(parts[1]) || 0, 0, 0);
  return formatDatetime(d);
}

function setTimeFromHHMM(date, allowedFrom) {
  const d = new Date(date);
  const parts = String(allowedFrom || '09:00').split(':');
  d.setHours(Number(parts[0]) || 9, Number(parts[1]) || 0, 0, 0);
  return d;
}

/**
 * هم‌تراز کردن datetime با بازه مجاز allowed_from..allowed_to:
 * - در بازه → همان لحظه
 * - قبل از allowed_from → همان روز ساعت allowed_from
 * - بعد از allowed_to → فردا ساعت allowed_from
 */
function alignDatetimeToAllowedWindow(dt, allowedFrom, allowedTo) {
  const d = dt instanceof Date ? new Date(dt.getTime()) : new Date(dt);
  const mins = d.getHours() * 60 + d.getMinutes();
  const from = parseHHMM(allowedFrom || '09:00');
  const to = parseHHMM(allowedTo || '18:00');

  if (from <= to) {
    if (mins >= from && mins <= to) return formatDatetime(d);
    if (mins < from) return formatDatetime(setTimeFromHHMM(d, allowedFrom));
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return formatDatetime(setTimeFromHHMM(next, allowedFrom));
  }

  if (mins >= from || mins <= to) return formatDatetime(d);
  if (mins > to && mins < from) return formatDatetime(setTimeFromHHMM(d, allowedFrom));
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return formatDatetime(setTimeFromHHMM(next, allowedFrom));
}

/** next_action_date اولیه یا از «الان» بر اساس بازه مجاز اولین اکشن */
function computeNextActionDateFromWindow(allowedFrom, allowedTo, baseDate) {
  const base = baseDate
    ? baseDate instanceof Date
      ? baseDate
      : new Date(baseDate)
    : new Date();
  return alignDatetimeToAllowedWindow(base, allowedFrom, allowedTo);
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * parse next_action_date یا تاریخ جلالی (YYYY/MM/DD)
 * @returns {Date|null}
 */
function parseActionDatetime(value) {
  if (!value) return null;
  const s = String(value).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = iso;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  }

  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      const [jy, jm, jd] = parts.map(Number);
      if (jy && jm && jd) {
        const { year, month, day } = jalaliToGregorian(jy, jm, jd);
        return new Date(year, month - 1, day, 0, 0, 0);
      }
    }
  }

  return null;
}

function parseJalali(jalaliStr) {
  const dt = parseActionDatetime(jalaliStr);
  if (!dt) return null;
  return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}

function localTodayParts() {
  const n = new Date();
  return { year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate() };
}

function todayJalali() {
  const { year, month, day } = localTodayParts();
  const j = gregorianToJalali(year, month, day);
  return formatJalali(j.year, j.month, j.day);
}

/** تاریخ و ساعت جلالی فعلی (local تهران) به فرمت YYYY/MM/DD HH:mm */
function nowJalaliDateTime() {
  const n = new Date();
  const j = gregorianToJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  return `${formatJalali(j.year, j.month, j.day)} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
}

function todayUTC() {
  return parseJalali(todayJalali());
}

function calcActionStatus(nextActionDate) {
  if (!nextActionDate) return 'waiting';
  const actionDt = parseActionDatetime(nextActionDate);
  if (!actionDt) return 'waiting';

  const now = new Date();
  if (now.getTime() < actionDt.getTime()) return 'waiting';

  const actionDay = startOfLocalDay(actionDt);
  const today = startOfLocalDay(now);
  if (actionDay.getTime() === today.getTime()) return 'due_today';
  return 'overdue';
}

function daysDiffFromToday(jalaliStr) {
  const date = parseJalali(jalaliStr);
  if (!date) return null;
  const today = todayUTC();
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function isActionDue(nextActionDate) {
  const actionDt = parseActionDatetime(nextActionDate);
  if (!actionDt) return false;
  return Date.now() >= actionDt.getTime();
}

function parseHHMM(str) {
  const parts = String(str || '00:00').split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function currentMinutesOfDay() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function isWithinAllowedWindow(allowedFrom, allowedTo) {
  const now = currentMinutesOfDay();
  const from = parseHHMM(allowedFrom);
  const to = parseHHMM(allowedTo);
  if (from <= to) return now >= from && now <= to;
  return now >= from || now <= to;
}

/** آیا زمان مشخص در بازه allowed_from..allowed_to است؟ */
function isDatetimeWithinAllowedWindow(dt, allowedFrom, allowedTo) {
  const date = dt instanceof Date ? dt : new Date(dt);
  const mins = date.getHours() * 60 + date.getMinutes();
  const from = parseHHMM(allowedFrom);
  const to = parseHHMM(allowedTo);
  if (from <= to) return mins >= from && mins <= to;
  return mins >= from || mins <= to;
}

/**
 * زمان اقدام بعدی: now + wait_minutes، سپس هم‌تراز با بازه مجاز اکشن بعدی.
 */
function computeNextActionDate(waitMinutes, nextAction) {
  const candidate = new Date(Date.now() + Number(waitMinutes || 0) * 60000);
  return alignDatetimeToAllowedWindow(
    candidate,
    nextAction?.allowed_from || '09:00',
    nextAction?.allowed_to || '18:00'
  );
}

function jalaliDateToDatetime(jalaliStr) {
  if (!jalaliStr) return null;
  const parts = String(jalaliStr).trim().split('/');
  if (parts.length !== 3) return null;
  const [jy, jm, jd] = parts.map(Number);
  if (!jy || !jm || !jd) return null;
  const { year, month, day } = jalaliToGregorian(jy, jm, jd);
  return formatDatetime(new Date(year, month - 1, day, 0, 0, 0));
}

/** ترکیب تاریخ جلالی (YYYY/MM/DD) و ساعت (HH:mm) به datetime گرگوری local تهران */
function jalaliDateTimeToDatetime(jalaliStr, timeStr) {
  if (!jalaliStr) return null;
  const parts = String(jalaliStr).trim().split('/');
  if (parts.length !== 3) return null;
  const [jy, jm, jd] = parts.map(Number);
  if (!jy || !jm || !jd) return null;
  const { year, month, day } = jalaliToGregorian(jy, jm, jd);
  const t = String(timeStr || '00:00').split(':');
  const hh = Number(t[0]) || 0;
  const mm = Number(t[1]) || 0;
  return formatDatetime(new Date(year, month - 1, day, hh, mm, 0));
}

/** آیا ساعت (HH:mm) در بازه مجاز [from, to] است؟ */
function isTimeWithinAllowedWindow(timeStr, allowedFrom, allowedTo) {
  const mins = parseHHMM(timeStr);
  const from = parseHHMM(allowedFrom);
  const to = parseHHMM(allowedTo);
  if (from <= to) return mins >= from && mins <= to;
  return mins >= from || mins <= to;
}

/** parse YYYY/MM/DD یا YYYY/MM/DD HH:mm جلالی → datetime گرگوری local */
function parseJalaliPromisedDatetime(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, jy, jmo, jd, h, mi] = m;
  const time = h !== undefined ? `${h}:${mi}` : '23:59';
  return jalaliDateTimeToDatetime(`${jy}/${jmo}/${jd}`, time);
}

function isJalaliDatetimeInPast(jalaliDate, jalaliTime) {
  const iso = jalaliDateTimeToDatetime(jalaliDate, jalaliTime);
  if (!iso) return true;
  const dt = parseActionDatetime(iso);
  if (!dt) return true;
  return Date.now() > dt.getTime();
}

function isJalaliPromisedOverdue(promisedDatetime) {
  const iso = parseJalaliPromisedDatetime(promisedDatetime);
  if (!iso) return false;
  const dt = parseActionDatetime(iso);
  if (!dt) return false;
  return Date.now() > dt.getTime();
}

/** نرمال‌سازی datetime تعهد: YYYY/MM/DD HH:mm */
function normalizePromisedDatetime({ promised_datetime, promised_date, promised_time }) {
  const raw =
    promised_datetime ||
    (promised_date && promised_time ? `${promised_date} ${promised_time}` : null);
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${y}/${pad2(mo)}/${pad2(d)} ${pad2(h)}:${pad2(mi)}`;
}

function promisedDateFromDatetime(promisedDatetime) {
  if (!promisedDatetime) return null;
  return String(promisedDatetime).trim().split(/\s+/)[0] || null;
}

function promisedTimeFromDatetime(promisedDatetime) {
  if (!promisedDatetime) return null;
  return String(promisedDatetime).trim().split(/\s+/)[1] || null;
}

module.exports = {
  parseJalali,
  parseActionDatetime,
  todayUTC,
  todayJalali,
  nowJalaliDateTime,
  nowDatetime,
  addMinutesFromNow,
  addMinutesWithAllowedFrom,
  nextAllowedStartDatetime,
  jalaliDateToDatetime,
  formatDatetime,
  formatJalali,
  gregorianToJalali,
  calcActionStatus,
  daysDiffFromToday,
  isActionDue,
  isWithinAllowedWindow,
  isDatetimeWithinAllowedWindow,
  isTimeWithinAllowedWindow,
  jalaliDateTimeToDatetime,
  parseJalaliPromisedDatetime,
  isJalaliDatetimeInPast,
  isJalaliPromisedOverdue,
  normalizePromisedDatetime,
  promisedDateFromDatetime,
  promisedTimeFromDatetime,
  computeNextActionDate,
  computeNextActionDateFromWindow,
  alignDatetimeToAllowedWindow,
  currentMinutesOfDay,
};
