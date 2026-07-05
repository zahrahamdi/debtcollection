'use strict';

const MOCK_PAYMENT_LINK = 'https://pay.digipay.ir/mock/settle';

const NO_ANSWER_SMS_TEXT =
  'کاربر دیجی‌پی، جهت پیگیری اقساط معوق با شما تماس گرفته شد و پاسخگو نبودید. خواهشمند است نسبت به پرداخت اقساط خود از طریق اپلیکیشن اقدام نمایید.';

const PAYMENT_LINK_SMS_TEMPLATE =
  'کاربر گرامی، لینک پرداخت اقساط معوق شما: {لینک_پرداخت}';

function formatRial(amount) {
  const n = Number(amount) || 0;
  return `${n.toLocaleString('en-US')} ریال`;
}

function replacePlaceholders(text, { userName, claimsAmount, paymentLink = MOCK_PAYMENT_LINK }) {
  return String(text ?? '')
    .replace(/\{نام_کاربر\}/g, userName || '')
    .replace(/\{مبلغ_مطالبات\}/g, formatRial(claimsAmount))
    .replace(/\{لینک_پرداخت\}/g, paymentLink);
}

async function sendSms(phoneNumber, text) {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000 + 500));

  const results = [
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: true, result: 'ارسال شد' },
    { success: false, result: 'ارسال نشد' },
    { success: false, result: 'ارسال نشد' },
  ];

  const picked = results[Math.floor(Math.random() * results.length)];

  console.log(`[SMS Mock] به ${phoneNumber}: ${text.substring(0, 30)}... → ${picked.result}`);

  return picked;
}

module.exports = {
  sendSms,
  replacePlaceholders,
  formatRial,
  MOCK_PAYMENT_LINK,
  NO_ANSWER_SMS_TEXT,
  PAYMENT_LINK_SMS_TEMPLATE,
};
