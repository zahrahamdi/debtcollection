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

function isMockMode() {
  return process.env.SMS_MOCK === 'true';
}

/**
 * ارسال پیامک — در حالت SMS_MOCK=true بدون فراخوانی کاوه‌نگار شبیه‌سازی می‌شود.
 * @returns {Promise<{ ok: boolean, simulated: boolean }>}
 */
function sendSms(phoneNumber, text) {
  if (isMockMode()) {
    console.log(`[sms] شبیه‌سازی → ${phoneNumber}: ${String(text).slice(0, 80)}${text.length > 80 ? '…' : ''}`);
    return Promise.resolve({ ok: true, simulated: true });
  }

  const Kavenegar = require('kavenegar');
  const apikey = process.env.KAVENEGAR_API_KEY;
  const sender = process.env.KAVENEGAR_SENDER;

  if (!apikey) {
    console.error('[sms] KAVENEGAR_API_KEY تنظیم نشده است');
    return Promise.resolve({ ok: false, simulated: false });
  }
  if (!sender) {
    console.error('[sms] KAVENEGAR_SENDER تنظیم نشده است');
    return Promise.resolve({ ok: false, simulated: false });
  }

  const api = Kavenegar.KavenegarApi({ apikey });

  return new Promise((resolve) => {
    api.Send(
      { message: text, sender, receptor: phoneNumber },
      (response, status, message) => {
        if (status === 200) {
          resolve({ ok: true, simulated: false });
        } else {
          console.error('[sms] خطا در ارسال:', status, message, response);
          resolve({ ok: false, simulated: false });
        }
      }
    );
  });
}

module.exports = {
  sendSms,
  replacePlaceholders,
  formatRial,
  isMockMode,
  MOCK_PAYMENT_LINK,
  NO_ANSWER_SMS_TEXT,
  PAYMENT_LINK_SMS_TEMPLATE,
};
