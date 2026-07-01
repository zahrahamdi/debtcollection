// ابزارهای قالب‌بندی نمایش

import { format as formatJalaliFn, parse as parseJalaliFn } from 'date-fns-jalali'

// تبدیل اعداد لاتین به فارسی
export function toFaDigits(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
}

// تبدیل ارقام فارسی/عربی به لاتین (برای parse ورودی کاربر)
export function toEnDigits(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
}

// قالب‌بندی مبلغ ریالی با جداکننده هزارگان و رقم فارسی
export function formatRial(amount) {
  if (amount === null || amount === undefined || amount === '') return '—'
  const num = Number(amount)
  if (Number.isNaN(num)) return '—'
  return toFaDigits(num.toLocaleString('en-US'))
}

// نمایش عدد ساده با رقم فارسی
export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  return toFaDigits(Number(value).toLocaleString('en-US'))
}

// نمایش تاریخ (در نسخه دمو رشته شمسی از backend می‌آید)
export function formatDate(value) {
  if (!value) return '—'
  return toFaDigits(value)
}

const DISPLAY_OFFSET_MS = 3.5 * 60 * 60 * 1000

function applyDisplayOffset(date) {
  return new Date(date.getTime() + DISPLAY_OFFSET_MS)
}

/** تاریخ و ساعت شمسی — ورودی: YYYY-MM-DD HH:mm:ss یا YYYY/MM/DD
 *  @param {{ offset?: boolean }} options — offset=false برای ساعت‌های تعریف‌شده در استراتژی (بدون +۳.۵)
 */
export function formatJalaliDateTime(value, options = {}) {
  const { offset = true } = options
  if (!value) return '—'
  const en = toEnDigits(String(value).trim())

  const isoMatch = en.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, y, mo, d, h, mi, sec] = isoMatch
    const raw = new Date(Number(y), Number(mo) - 1, Number(d), Number(h || 0), Number(mi || 0), Number(sec || 0))
    const date = offset ? applyDisplayOffset(raw) : raw
    if (!Number.isNaN(date.getTime())) {
      return toFaDigits(formatJalaliFn(date, 'yyyy/MM/dd HH:mm'))
    }
  }

  const jalaliMatch = en.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (jalaliMatch) {
    const [, jy, jmo, jd, h, mi] = jalaliMatch
    const parsed = parseJalaliFn(`${jy}/${jmo}/${jd}`, 'yyyy/MM/dd', new Date())
    if (!Number.isNaN(parsed.getTime())) {
      if (h !== undefined) {
        parsed.setHours(Number(h), Number(mi || 0), 0, 0)
        const adjusted = offset ? applyDisplayOffset(parsed) : parsed
        return toFaDigits(formatJalaliFn(adjusted, 'yyyy/MM/dd HH:mm'))
      }
      return toFaDigits(formatJalaliFn(parsed, 'yyyy/MM/dd'))
    }
  }

  return toFaDigits(value)
}

/** تاریخ اقدام بعدی — بدون جابجایی ۳.۵ ساعته */
export function formatNextActionDateTime(value) {
  return formatJalaliDateTime(value, { offset: false })
}

export const jalaliDateTimeStyle = { direction: 'ltr', display: 'inline-block' }

// نمایش متن یا خط تیره در صورت خالی بودن
export function orDash(value) {
  return value === null || value === undefined || value === '' ? '—' : value
}

// نمایش شماره موبایل ایران با صفر اول
export function formatMobile(value) {
  if (value === null || value === undefined || value === '') return '—'
  const digits = String(value).replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('9')) {
    return toFaDigits(`0${digits}`)
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return toFaDigits(digits)
  }
  return toFaDigits(String(value))
}
