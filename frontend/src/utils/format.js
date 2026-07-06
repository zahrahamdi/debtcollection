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

const TEHRAN_TZ = 'Asia/Tehran'

function parseToDate(value) {
  const en = toEnDigits(String(value).trim())

  const isoMatch = en.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (isoMatch) {
    const [, y, mo, d, h, mi, sec] = isoMatch
    const date = new Date(
      `${y}-${mo}-${d}T${String(h || 0).padStart(2, '0')}:${mi || '00'}:${String(sec || 0).padStart(2, '0')}+03:30`
    )
    if (!Number.isNaN(date.getTime())) return date
  }

  const jalaliMatch = en.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (jalaliMatch) {
    const [, jy, jmo, jd, h, mi] = jalaliMatch
    const parsed = parseJalaliFn(`${jy}/${jmo}/${jd}`, 'yyyy/MM/dd', new Date())
    if (!Number.isNaN(parsed.getTime())) {
      if (h !== undefined) parsed.setHours(Number(h), Number(mi || 0), 0, 0)
      return parsed
    }
  }

  const fallback = new Date(value)
  if (!Number.isNaN(fallback.getTime())) return fallback

  return null
}

function tehranParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type) => parts.find((p) => p.type === type)?.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function inputHasTime(value) {
  const en = toEnDigits(String(value).trim())
  return /\d{1,2}:\d{2}/.test(en)
}

/** نمایش literal تاریخ/ساعت جلالی ذخیره‌شده (بدون تبدیل timezone) */
function formatStoredJalaliDatetime(value) {
  const en = toEnDigits(String(value).trim())
  const m = en.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const date = `${y}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`
  if (h !== undefined && mi !== undefined) {
    return toFaDigits(`${date} - ${String(h).padStart(2, '0')}:${mi}`)
  }
  return toFaDigits(date)
}

/** تاریخ و ساعت شمسی با تایم‌زون تهران — فرمت: ۱۴۰۴/۰۶/۰۱ - ۱۴:۳۰ */
export function formatJalaliDateTime(value) {
  if (!value) return '—'

  const stored = formatStoredJalaliDatetime(value)
  if (stored) return stored

  const date = parseToDate(value)
  if (!date) return toFaDigits(String(value))

  const { year, month, day, hour, minute } = tehranParts(date)
  const jalaliDate = formatJalaliFn(new Date(year, month - 1, day), 'yyyy/MM/dd')

  if (inputHasTime(value)) {
    const hm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    return toFaDigits(`${jalaliDate} - ${hm}`)
  }

  return toFaDigits(jalaliDate)
}

/** زمان ثبت دیتابیس — ISO گرگوری به وقت تهران (همیشه تاریخ + ساعت) */
export function formatSqliteDateTime(value) {
  if (!value) return '—'

  const stored = formatStoredJalaliDatetime(value)
  if (stored) return stored

  const date = parseToDate(value)
  if (!date) return toFaDigits(String(value))

  const { year, month, day, hour, minute } = tehranParts(date)
  const jalaliDate = formatJalaliFn(new Date(year, month - 1, day), 'yyyy/MM/dd')
  const hm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return toFaDigits(`${jalaliDate} - ${hm}`)
}

/** تاریخ شمسی — alias برای formatJalaliDateTime */
export function formatDate(value) {
  return formatJalaliDateTime(value)
}

/** تاریخ اقدام بعدی */
export function formatNextActionDateTime(value) {
  return formatJalaliDateTime(value)
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
