'use strict';

/**
 * محاسبه شاخص سختی وصول (CEI) — بخش ۵.۲ PRD
 * ------------------------------------------------------------------
 * فرمول وام:  CEI = W_A·A + W_C·C + W_I·I(n)
 *   A = min(1, Amount / Cap)
 *   C = بر اساس نوع ضمانت (بدون ضامن / سفته / چک)
 *   I(n): n = شماره اولین قسط پرداخت‌نشده
 *     n ≤ 3 :  I = 1 - a·(n-1)
 *     n > 3 :  I = max(f, f + (1 - 2a - f)·exp(-k·(n-3)))
 *
 * فرمول BNPL: CEI = W_A · A
 */

// پارامترهای پیش‌فرض (Story 11.2 PRD)
const DEFAULT_LOAN_PARAMS = {
  w_a: 30,
  w_c: 18,
  w_i: 12,
  cap: 1000000000,
  c_none: 1, // بدون ضامن
  c_note: 0.5, // سفته / e-note
  c_cheque: 0, // چک
  a: 0.08,
  f: 0.1,
  k: 0.616,
};

const DEFAULT_BNPL_PARAMS = {
  w_a: 60,
  cap: 100000000,
};

const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;

// انتخاب Collateral Factor بر اساس نوع ضمانت
function collateralFactor(params, guaranteeType) {
  switch (guaranteeType) {
    case 'promissory_note':
      return params.c_note;
    case 'cheque':
      return params.c_cheque;
    case 'none':
    default:
      return params.c_none;
  }
}

/**
 * محاسبه CEI برای یک پرونده.
 * @param {string} creditType  loan | bnpl
 * @param {object} params      پارامترهای فرمول
 * @param {object} caseData    { claims_amount, guarantee_type, first_unpaid_no }
 * @returns {{ cei:number, breakdown:object }}
 */
function computeCei(creditType, params, caseData) {
  const amount = Number(caseData.claims_amount) || 0;

  if (creditType === 'bnpl') {
    const cap = Number(params.cap) || 1;
    const A = Math.min(1, amount / cap);
    const cei = Number(params.w_a) * A;
    return { cei: round2(cei), breakdown: { amount, A: round4(A) } };
  }

  // وام
  const cap = Number(params.cap) || 1;
  const A = Math.min(1, amount / cap);
  const C = collateralFactor(params, caseData.guarantee_type);

  const n = Number(caseData.first_unpaid_no) || 1;
  const a = Number(params.a);
  const f = Number(params.f);
  const k = Number(params.k);
  let I;
  if (n <= 3) {
    I = 1 - a * (n - 1);
  } else {
    I = Math.max(f, f + (1 - 2 * a - f) * Math.exp(-k * (n - 3)));
  }

  const cei = Number(params.w_a) * A + Number(params.w_c) * C + Number(params.w_i) * I;
  return {
    cei: round2(cei),
    breakdown: { amount, A: round4(A), C: round4(C), n, I: round4(I) },
  };
}

/** CEI نهایی = CEI محاسبه‌شده + cei_boost (boost هرگز در این تابع کم نمی‌شود) */
function applyCeiBoost(computedCei, ceiBoost = 0) {
  return round2(Number(computedCei) + Number(ceiBoost || 0));
}

module.exports = { computeCei, applyCeiBoost, DEFAULT_LOAN_PARAMS, DEFAULT_BNPL_PARAMS };
