'use strict';

/**
 * ابزار سگمنت‌ها (Story 11.3 PRD)
 * هر شرط CEI به یک بازه با مشخص‌بودن شمول مرزها تبدیل می‌شود:
 *   { lo, hi, loInc, hiInc }
 * قرارداد:
 *   between (X < CEI ≤ Y) | lt (CEI < X) | lte (CEI ≤ X)
 *   gt (CEI > X) | gte (CEI ≥ X)
 */

const SCALE_MIN = 0;
const SCALE_MAX = 100;

const CONDITION_TYPES = ['between', 'lt', 'lte', 'gt', 'gte'];

// تبدیل شرط به بازه با شمول مرزها
function toInterval(conditionType, x, y) {
  const xn = Number(x);
  const yn = Number(y);
  switch (conditionType) {
    case 'between':
      return { lo: xn, hi: yn, loInc: false, hiInc: true }; // X < CEI ≤ Y
    case 'lt':
      return { lo: SCALE_MIN, hi: xn, loInc: true, hiInc: false }; // CEI < X
    case 'lte':
      return { lo: SCALE_MIN, hi: xn, loInc: true, hiInc: true }; // CEI ≤ X
    case 'gt':
      return { lo: xn, hi: SCALE_MAX, loInc: false, hiInc: true }; // CEI > X
    case 'gte':
      return { lo: xn, hi: SCALE_MAX, loInc: true, hiInc: true }; // CEI ≥ X
    default:
      return { lo: SCALE_MIN, hi: SCALE_MAX, loInc: true, hiInc: true };
  }
}

// آیا دو بازه نقطه‌ی مشترک واقعی دارند؟ (با احتساب شمول مرزها)
function intervalsOverlap(a, b) {
  if (a.hi < b.lo || b.hi < a.lo) return false;
  if (a.hi === b.lo) return a.hiInc && b.loInc; // تماس در نقطه‌ی مرزی
  if (b.hi === a.lo) return b.hiInc && a.loInc;
  return true;
}

// اعتبارسنجی مقادیر شرط
function validateCondition(conditionType, x, y) {
  if (!CONDITION_TYPES.includes(conditionType)) return 'نوع شرط نامعتبر است';
  const xn = Number(x);
  if (Number.isNaN(xn) || xn < SCALE_MIN || xn > SCALE_MAX) {
    return 'مقدار شرط باید عددی بین ۰ تا ۱۰۰ باشد';
  }
  if (conditionType === 'between') {
    const yn = Number(y);
    if (Number.isNaN(yn) || yn < SCALE_MIN || yn > SCALE_MAX) {
      return 'مقدار دوم شرط باید عددی بین ۰ تا ۱۰۰ باشد';
    }
    if (xn >= yn) return 'در شرط «بین»، مقدار اول باید کوچک‌تر از مقدار دوم باشد';
  }
  return null;
}

module.exports = { CONDITION_TYPES, toInterval, intervalsOverlap, validateCondition };
