'use strict';

const Kavenegar = require('kavenegar');

const MOCK_PAYMENT_LINK = 'https://pay.digipay.ir/mock/settle';

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

function getApi() {
  const apikey = process.env.KAVENEGAR_API_KEY;
  if (!apikey) return null;
  return Kavenegar.KavenegarApi({ apikey });
}

/**
 * ارسال پیامک از طریق کاوه‌نگار
 * @param {string} phoneNumber
 * @param {string} text
 * @returns {Promise<boolean>}
 */
function sendSms(phoneNumber, text) {
  return new Promise((resolve) => {
    const api = getApi();
    if (!api) {
      console.error('[sms] KAVENEGAR_API_KEY تنظیم نشده است');
      resolve(false);
      return;
    }

    const sender = process.env.KAVENEGAR_SENDER;
    if (!sender) {
      console.error('[sms] KAVENEGAR_SENDER تنظیم نشده است');
      resolve(false);
      return;
    }

    api.Send(
      {
        message: text,
        sender,
        receptor: phoneNumber,
      },
      (response, status) => {
        if (status === 200) {
          resolve(true);
        } else {
          console.error('[sms] خطا در ارسال:', status, response);
          resolve(false);
        }
      }
    );
  });
}

module.exports = {
  sendSms,
  replacePlaceholders,
  formatRial,
  MOCK_PAYMENT_LINK,
};
