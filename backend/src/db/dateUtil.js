'use strict';

/**
 * ابزار تاریخ/زمان — next_action_date به فرمت YYYY-MM-DD HH:mm:ss
 * تاریخ‌های جلالی (YYYY/MM/DD) برای فیلدهای دیگر همچنان پشتیبانی می‌شوند.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toEnDigits(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
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

const TEHRAN_TZ = 'Asia/Tehran';

function tehranNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function formatDatetime(date) {
  if (date instanceof Date) {
    const p = tehranNowParts(date);
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  const p = tehranNowParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

function parseTehranLocalIso(y, mo, d, h = 0, mi = 0, se = 0) {
  const iso = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(se)}+03:30`;
  return new Date(iso);
}

function nowDatetime() {
  return formatDatetime(new Date());
}

function addMinutesFromNow(minutes) {
  return formatDatetime(new Date(Date.now() + Number(minutes || 0) * 60000));
}

/** wait_minutes از الان + ساعت allowed_from روی همان روز (برای next_action_date استراتژی) */
function tehranMinutesOfDay(date) {
  const p = tehranNowParts(date instanceof Date ? date : new Date(date));
  return p.hour * 60 + p.minute;
}

function setTehranTimeOnDate(date, allowedFrom) {
  const p = tehranNowParts(date instanceof Date ? date : new Date(date));
  const parts = String(allowedFrom || '09:00').split(':');
  return parseTehranLocalIso(
    p.year,
    p.month,
    p.day,
    Number(parts[0]) || 9,
    Number(parts[1]) || 0,
    0
  );
}

function addTehranDays(date, days) {
  const p = tehranNowParts(date instanceof Date ? date : new Date(date));
  const noon = parseTehranLocalIso(p.year, p.month, p.day, 12, 0, 0);
  return new Date(noon.getTime() + Number(days) * 86400000);
}

function addMinutesWithAllowedFrom(minutes, allowedFrom) {
  const base = new Date(Date.now() + Number(minutes || 0) * 60000);
  return formatDatetime(setTehranTimeOnDate(base, allowedFrom));
}

function nextAllowedStartDatetime(allowedFrom) {
  return formatDatetime(setTehranTimeOnDate(addTehranDays(new Date(), 1), allowedFrom));
}

/**
 * هم‌تراز کردن datetime با بازه مجاز allowed_from..allowed_to (وقت تهران)
 */
function alignDatetimeToAllowedWindow(dt, allowedFrom, allowedTo) {
  const d = dt instanceof Date ? dt : new Date(dt);
  const mins = tehranMinutesOfDay(d);
  const from = parseHHMM(allowedFrom || '09:00');
  const to = parseHHMM(allowedTo || '18:00');

  if (from <= to) {
    if (mins >= from && mins <= to) return formatDatetime(d);
    if (mins < from) return formatDatetime(setTehranTimeOnDate(d, allowedFrom));
    return formatDatetime(setTehranTimeOnDate(addTehranDays(d, 1), allowedFrom));
  }

  if (mins >= from || mins <= to) return formatDatetime(d);
  if (mins > to && mins < from) return formatDatetime(setTehranTimeOnDate(d, allowedFrom));
  return formatDatetime(setTehranTimeOnDate(addTehranDays(d, 1), allowedFrom));
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

function startOfTehranDay(date) {
  const p = tehranNowParts(date instanceof Date ? date : new Date(date));
  return parseTehranLocalIso(p.year, p.month, p.day, 0, 0, 0);
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
    return parseTehranLocalIso(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(se));
  }

  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      const [jy, jm, jd] = parts.map(Number);
      if (jy && jm && jd) {
        const { year, month, day } = jalaliToGregorian(jy, jm, jd);
        return parseTehranLocalIso(year, month, day, 0, 0, 0);
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
  const p = tehranNowParts(new Date());
  return { year: p.year, month: p.month, day: p.day };
}

function todayJalali() {
  const { year, month, day } = localTodayParts();
  const j = gregorianToJalali(year, month, day);
  return formatJalali(j.year, j.month, j.day);
}

/** تاریخ و ساعت جلالی فعلی (local تهران) به فرمت YYYY/MM/DD HH:mm */
function nowJalaliDateTime() {
  return dateToJalaliDateTime(new Date());
}

/** تبدیل Date یا timestamp به رشته جلالی YYYY/MM/DD HH:mm (وقت تهران) */
function dateToJalaliDateTime(date) {
  const p = tehranNowParts(date instanceof Date ? date : new Date(date));
  const j = gregorianToJalali(p.year, p.month, p.day);
  return `${formatJalali(j.year, j.month, j.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
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

  const actionDay = startOfTehranDay(actionDt);
  const today = startOfTehranDay(now);
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
  const p = tehranNowParts(new Date());
  return p.hour * 60 + p.minute;
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
  return formatDatetime(parseTehranLocalIso(year, month, day, 0, 0, 0));
}

/** ترکیب تاریخ جلالی (YYYY/MM/DD) و ساعت (HH:mm) → datetime گرگوری با offset تهران */
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
  return formatDatetime(parseTehranLocalIso(year, month, day, hh, mm, 0));
}

/** تاریخ گرگوری امروز (YYYY-MM-DD) — وقت تهران */
function tehranTodayDateString() {
  return nowDatetime().slice(0, 10);
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

/** نرمال‌سازی تاریخ/ساعت پرداخت: YYYY/MM/DD HH:mm (بدون ساعت → 12:00) */
function normalizePaymentDatetime(value) {
  if (!value) return null;
  const s = toEnDigits(value).trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (h !== undefined) {
    return `${y}/${pad2(mo)}/${pad2(d)} ${pad2(h)}:${pad2(mi)}`;
  }
  return `${y}/${pad2(mo)}/${pad2(d)} 12:00`;
}

function paymentDatetimeToIso(normalized) {
  if (!normalized) return null;
  const [datePart, timePart] = normalized.split(/\s+/);
  return jalaliDateTimeToDatetime(datePart, timePart || '12:00');
}

function isPaymentDatetimeInFuture(value) {
  const normalized = normalizePaymentDatetime(value);
  if (!normalized) return null;
  const iso = paymentDatetimeToIso(normalized);
  const dt = parseActionDatetime(iso);
  if (!dt) return null;
  return Date.now() < dt.getTime();
}

module.exports = {
  parseJalali,
  parseActionDatetime,
  todayUTC,
  todayJalali,
  nowJalaliDateTime,
  dateToJalaliDateTime,
  nowDatetime,
  tehranTodayDateString,
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
  normalizePaymentDatetime,
  paymentDatetimeToIso,
  isPaymentDatetimeInFuture,
  computeNextActionDate,
  computeNextActionDateFromWindow,
  alignDatetimeToAllowedWindow,
  currentMinutesOfDay,
};
