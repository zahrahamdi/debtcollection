// ابزارهای قالب‌بندی نمایش

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
