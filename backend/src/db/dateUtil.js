'use strict';

/**
 * ابزار تاریخ جلالی — تبدیل، مقایسه و محاسبه بازه زمانی.
 */

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
  const pad = (n) => String(n).padStart(2, '0');
  return `${jy}/${pad(jm)}/${pad(jd)}`;
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

function tomorrowJalali() {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  const j = gregorianToJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  return formatJalali(j.year, j.month, j.day);
}

function jalaliDateAfterMinutes(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return formatJalali(j.year, j.month, j.day);
}

function parseJalali(jalaliStr) {
  if (!jalaliStr) return null;
  const parts = String(jalaliStr).split('/');
  if (parts.length !== 3) return null;
  const [jy, jm, jd] = parts.map(Number);
  if (!jy || !jm || !jd) return null;
  const { year, month, day } = jalaliToGregorian(jy, jm, jd);
  return new Date(Date.UTC(year, month - 1, day));
}

function todayUTC() {
  return parseJalali(todayJalali());
}

function calcActionStatus(nextActionDate) {
  if (!nextActionDate) return 'waiting';
  const actionDate = parseJalali(nextActionDate);
  if (!actionDate) return 'waiting';
  const today = todayUTC();
  const diff = actionDate.getTime() - today.getTime();
  if (diff > 0) return 'waiting';
  if (diff === 0) return 'due_today';
  return 'overdue';
}

function daysDiffFromToday(jalaliStr) {
  const date = parseJalali(jalaliStr);
  if (!date) return null;
  const today = todayUTC();
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function isActionDue(nextActionDate) {
  const diff = daysDiffFromToday(nextActionDate);
  return diff !== null && diff <= 0;
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

module.exports = {
  parseJalali,
  todayUTC,
  todayJalali,
  tomorrowJalali,
  jalaliDateAfterMinutes,
  formatJalali,
  gregorianToJalali,
  calcActionStatus,
  daysDiffFromToday,
  isActionDue,
  isWithinAllowedWindow,
  currentMinutesOfDay,
};
