import { formatRial, toFaDigits } from './format'
import { actionTypeLabel } from './constants'

function parseDetails(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* plain text */
  }
  return { _text: String(raw) }
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== ''
}

function rial(value) {
  if (!hasValue(value)) return null
  return `${formatRial(value)} ریال`
}

function num(value) {
  if (!hasValue(value)) return null
  return toFaDigits(value)
}

/** خطوط غیرخالی را به آرایه تبدیل می‌کند */
function buildLines(...parts) {
  return parts.filter(Boolean)
}

function parseNegotiatorName(text) {
  if (!text) return null
  const m = String(text).match(/مذاکره‌کننده:\s*(.+?)(?:\s*—|$)/)
  return m ? m[1].trim() : null
}

function parseCallOutcomeFromText(text) {
  const fields = {}
  if (!text) return fields
  for (const part of String(text).split(' · ')) {
    const trimmed = part.trim()
    if (trimmed.startsWith('وضعیت تماس:')) {
      fields.call_status = trimmed.slice('وضعیت تماس:'.length).trim()
    } else if (trimmed.startsWith('دلیل عدم پرداخت:')) {
      fields.no_payment_reason = trimmed.slice('دلیل عدم پرداخت:'.length).trim()
    } else if (trimmed.startsWith('تصمیم به پرداخت:')) {
      fields.payment_decision = trimmed.slice('تصمیم به پرداخت:'.length).trim()
    } else if (trimmed.startsWith('تعهد:')) {
      fields.promised_summary = trimmed.slice('تعهد:'.length).trim()
    } else if (trimmed.startsWith('تماس بعدی:')) {
      fields.next_call_date = trimmed.slice('تماس بعدی:'.length).trim()
    } else if (trimmed.startsWith('توضیحات:')) {
      fields.description = trimmed.slice('توضیحات:'.length).trim()
    } else if (trimmed === 'ارجاع به حقوقی') {
      fields.refer_to_legal = true
    }
  }
  return fields
}

export function parseCallOutcomeDetails(raw) {
  const d = parseDetails(raw)
  if (!d) return {}
  if (d._text) return parseCallOutcomeFromText(d._text)
  return d
}

function formatCallOutcome(d) {
  const fields = d._text ? parseCallOutcomeFromText(d._text) : d
  const referLabel =
    fields.refer_to_legal === true
      ? 'بله'
      : fields.refer_to_legal === false
        ? 'خیر'
        : null

  const lines = buildLines(
    hasValue(fields.call_status) && `وضعیت تماس: ${fields.call_status}`,
    hasValue(fields.no_payment_reason) && `دلیل عدم پرداخت: ${fields.no_payment_reason}`,
    hasValue(fields.payment_decision) && `تصمیم به پرداخت: ${fields.payment_decision}`,
    hasValue(fields.promised_date) && `تاریخ تعهد پرداخت: ${toFaDigits(fields.promised_date)}`,
    hasValue(fields.promised_amount) && `مبلغ تعهد پرداخت: ${rial(fields.promised_amount)}`,
    !hasValue(fields.promised_date) &&
      !hasValue(fields.promised_amount) &&
      fields.promised_summary &&
      `تعهد پرداخت: ${fields.promised_summary}`,
    hasValue(fields.call_duration) && `مدت تماس: ${toFaDigits(fields.call_duration)} دقیقه`,
    hasValue(fields.call_cost) && `هزینه تماس: ${rial(fields.call_cost)}`,
    hasValue(fields.next_call_date) && `زمان تماس بعدی: ${toFaDigits(fields.next_call_date)}`,
    fields.is_last_call === true && 'آخرین تماس مذاکره‌کننده: بله',
    hasValue(fields.next_action) && `اقدام بعدی: ${fields.next_action}`,
    hasValue(fields.description) && `توضیحات: ${fields.description}`,
    referLabel !== null && `ارجاع به حقوقی: ${referLabel}`
  )
  return lines.length ? lines : ['—']
}

/** خطوط جزئیات ثبت خروجی تماس — برای مدال تاریخچه */
export function formatCallOutcomeDetailLines(raw) {
  const d = parseDetails(raw)
  if (!d) return ['—']
  return formatCallOutcome(d)
}

function formatStrategyFailure(d, text) {
  if (d?.reason && !d.computed_cei) {
    return buildLines(
      hasValue(d.failed_strategy) && `استراتژی شکست‌خورده: ${d.failed_strategy}`,
      `دلیل: ${d.reason}`
    )
  }
  const lines = buildLines(
    hasValue(d?.failed_strategy) && `استراتژی شکست‌خورده: ${d.failed_strategy}`,
    hasValue(d?.computed_cei) && `CEI محاسبه‌شده: ${num(d.computed_cei)}`,
    hasValue(d?.boost_added) && `افزایش CEI: ${num(d.boost_added)}`,
    hasValue(d?.final_cei) && `CEI نهایی: ${num(d.final_cei)}`,
    hasValue(d?.segment_previous) && `سگمنت قبلی: ${d.segment_previous}`,
    hasValue(d?.segment_new) && `سگمنت جدید: ${d.segment_new}`,
    hasValue(d?.strategy_new) && `استراتژی جدید: ${d.strategy_new}`,
    d?.reason && `دلیل: ${d.reason}`
  )
  return lines.length ? lines : text ? [text] : ['—']
}

function formatSmsAction(d, text) {
  const body = d?.body || d?.body_text || d?._text || text
  return buildLines(hasValue(body) && `متن: ${body}`)
}

function formatAutocallAction(d) {
  const body = d.body || d.body_text
  const lines = []
  if (hasValue(body)) lines.push(`متن تماس: ${body}`)
  else if (hasValue(d.result)) lines.push(`نتیجه تماس: ${d.result}`)
  return lines.length ? lines : ['—']
}

function formatCeiUpdate(d) {
  const lines = []
  if (hasValue(d.cei_previous) && hasValue(d.cei_new)) {
    lines.push(`CEI قبلی: ${num(d.cei_previous)} ← CEI جدید: ${num(d.cei_new)}`)
  } else if (hasValue(d.cei)) {
    lines.push(`مقدار CEI: ${num(d.cei)}`)
  } else if (hasValue(d.cei_new)) {
    lines.push(`CEI جدید: ${num(d.cei_new)}`)
  }
  if (hasValue(d.segment_previous_title) && hasValue(d.segment_new_title)) {
    lines.push(`سگمنت قبلی: ${d.segment_previous_title} ← سگمنت جدید: ${d.segment_new_title}`)
  } else if (hasValue(d.segment_new_title) || hasValue(d.segment_title)) {
    lines.push(`سگمنت: ${d.segment_new_title || d.segment_title}`)
  }
  if (hasValue(d.strategy_previous_title) && hasValue(d.strategy_new_title)) {
    lines.push(`استراتژی قبلی: ${d.strategy_previous_title} ← استراتژی جدید: ${d.strategy_new_title}`)
  }
  if (hasValue(d.start_action)) {
    lines.push(`شروع از اکشن: ${actionTypeLabel(d.start_action)}`)
  }
  if (hasValue(d.note)) lines.push(d.note)
  return lines.length ? lines : ['—']
}

function formatStrategyChange(d) {
  const prev = d.strategy_previous_title
  const next = d.strategy_new_title || d.strategy_title
  const start = d.start_action ? actionTypeLabel(d.start_action) : null
  const lines = buildLines(
    hasValue(prev) && hasValue(next) && `استراتژی قبلی: ${prev} ← استراتژی جدید: ${next}`,
    !prev && hasValue(next) && `استراتژی جدید: ${next}`,
    hasValue(start) && `شروع از اکشن: ${start}`,
    hasValue(d.segment_new_title) && `سگمنت: ${d.segment_new_title}`,
    hasValue(d.note) && d.note
  )
  return lines.length ? lines : ['—']
}

function formatAssign(d, text) {
  const name = parseNegotiatorName(text) || d.negotiator_name
  return buildLines(hasValue(name) && `تخصیص به: ${name}`)
}

function formatReassign(d, text) {
  const name = parseNegotiatorName(text) || d.negotiator_name
  const from = d.previous_negotiator_name
  const to = d.new_negotiator_name || name
  if (hasValue(from) && hasValue(to)) {
    return [`از ${from} به ${to}`]
  }
  return buildLines(hasValue(to) && `تخصیص مجدد به: ${to}`)
}

function formatPaymentFull(d) {
  return buildLines(
    hasValue(d.amount) && `مبلغ پرداختی: ${rial(d.amount)}`,
    hasValue(d.previous_claims) && `مطالبات قبلی: ${rial(d.previous_claims)}`,
    `مطالبات جدید: ${d.new_claims === 0 || d.new_claims === '0' ? 'صفر' : rial(d.new_claims)}`
  )
}

function formatPaymentPartial(d) {
  return buildLines(
    hasValue(d.amount) && `مبلغ پرداختی: ${rial(d.amount)}`,
    hasValue(d.previous_claims) && `مطالبات قبلی: ${rial(d.previous_claims)}`,
    hasValue(d.new_claims) && `مطالبات جدید: ${rial(d.new_claims)}`
  )
}

function formatBurnReason(d, text, operation) {
  if (hasValue(d.reason)) return [`دلیل: ${d.reason}`]
  if (hasValue(d.no_payment_reason)) return [`دلیل: ${d.no_payment_reason}`]
  if (text?.includes('فوت')) return ['دلیل: فوت کاربر']
  if (operation?.includes('فوت')) return ['دلیل: فوت کاربر']
  if (text) {
    const reason = text.replace(/^.*دلیل[^:]*:\s*/u, '').trim()
    if (reason && reason !== text) return [`دلیل: ${reason}`]
  }
  return text ? [text] : ['—']
}

/**
 * تبدیل جزئیات تاریخچه به خطوط فارسی قابل‌فهم
 * @param {string} operation
 * @param {string|object|null} raw
 * @param {{ user_name?: string }} context
 * @returns {string[]}
 */
export function formatHistoryDetailsLines(operation, raw, context = {}) {
  const d = parseDetails(raw)
  const text = d?._text || (typeof raw === 'string' && !d ? raw : null)

  switch (operation) {
    case 'ایجاد پرونده':
      return text && !text.includes('پرونده') ? [text] : ['پرونده جدید ایجاد شد.']

    case 'محاسبه CEI': {
      const lines = buildLines(
        hasValue(d?.cei) && `مقدار CEI: ${num(d.cei)}`,
        hasValue(d?.cei_new) && !d?.cei && `مقدار CEI: ${num(d.cei_new)}`,
        hasValue(d?.formula_version) && `نسخه فرمول: ${d.formula_version}`
      )
      return lines.length ? lines : ['—']
    }

    case 'به‌روزرسانی CEI و استراتژی':
      return formatCeiUpdate(d || {})

    case 'تعیین سگمنت': {
      const lines = buildLines(
        hasValue(d?.segment_title) && `سگمنت: ${d.segment_title}`,
        hasValue(d?.cei) && `مقدار CEI: ${num(d.cei)}`,
        hasValue(d?.error) && d.error
      )
      return lines.length ? lines : ['—']
    }

    case 'تخصیص استراتژی': {
      const lines = buildLines(
        hasValue(d?.strategy_title) && `استراتژی تخصیص‌یافته: ${d.strategy_title}`,
        hasValue(d?.segment_title) && `سگمنت: ${d.segment_title}`
      )
      if (lines.length) return lines
      return text ? [text] : ['—']
    }

    case 'تغییر استراتژی پس از پرداخت جزئی':
    case 'اعمال تغییر استراتژی معوق':
      return formatStrategyChange(d || {})

    case 'تخصیص به مذاکره‌کننده':
      return formatAssign(d || {}, text)

    case 'تخصیص مجدد':
      return formatReassign(d || {}, text)

    case 'اجرای پیامک':
    case 'اجرای پیامک (شبیه‌سازی)': {
      if (text && !text.trim().startsWith('{')) return [`متن: ${text.trim()}`]
      return formatSmsAction(d || {}, text)
    }

    case 'اجرای تماس خودکار': {
      const actionType = d?.action_type
      if (actionType === 'warning_autocall' || actionType === 'threatening_autocall') {
        return formatAutocallAction(d || {})
      }
      return formatAutocallAction(d || {})
    }

    case 'ثبت خروجی تماس':
      return formatCallOutcome(d || {})

    case 'ارجاع به حقوقی توسط مذاکره‌کننده':
      return buildLines(
        hasValue(context.user_name) && `ارجاع توسط: ${context.user_name}`
      ).length
        ? [`ارجاع توسط: ${context.user_name}`]
        : ['ارجاع به حقوقی توسط مذاکره‌کننده']

    case 'ارجاع خودکار به حقوقی پس از رسیدن به حداکثر تماس':
      return ['دلیل: رسیدن به حداکثر تعداد تماس']

    case 'ارجاع به حقوقی پس از پایان استراتژی':
      return ['دلیل: پایان استراتژی']

    case 'پرداخت کامل بدهی':
      return formatPaymentFull(d || {})

    case 'پرداخت جزئی بدهی':
      return formatPaymentPartial(d || {})

    case 'سوخت پرونده — فوت کاربر':
      return formatBurnReason(d || {}, text, operation)

    case 'ارسال لینک پرداخت': {
      const body =
        text?.trim() ||
        'کاربر گرامی، لینک پرداخت اقساط معوق شما: [لینک]'
      return [`متن: ${body}`]
    }

    case 'ارسال پیامک عدم پاسخگویی': {
      const body =
        text?.trim() ||
        'کاربر دیجی‌پی، جهت پیگیری اقساط معوق با شما تماس گرفته شد و پاسخگو نبودید. خواهشمند است نسبت به پرداخت اقساط خود از طریق اپلیکیشن اقدام نمایید.'
      return [`متن: ${body}`]
    }

    case 'به‌روزرسانی اطلاعات پرونده':
    case 'به‌روزرسانی اطلاعات مالی پرونده':
      return ['اطلاعات مالی پرونده به‌روزرسانی شد.']

    case 'ارجاع به مذاکره‌کننده':
      return ['پرونده برای تماس مذاکره‌کننده آماده شد.']

    case 'پایان استراتژی':
      return ['استراتژی فعلی به پایان رسید.']

    case 'شکست استراتژی':
      return formatStrategyFailure(d || {}, text)

    case 'ادامه استراتژی پس از پرداخت جزئی':
      return buildLines(hasValue(d?.note) && d.note).length
        ? [d.note]
        : ['استراتژی فعلی ادامه یافت.']

    case 'تأخیر تغییر استراتژی (Respite Time)':
      return buildLines(
        hasValue(d?.note) && d.note,
        hasValue(d?.segment_new_title) && `سگمنت جدید (معوق): ${d.segment_new_title}`
      ).length
        ? buildLines(
            hasValue(d?.note) && d.note,
            hasValue(d?.segment_new_title) && `سگمنت جدید (معوق): ${d.segment_new_title}`
          )
        : ['تغییر استراتژی تا پایان مهلت فعلی به تعویق افتاد.']

    case 'انتظار پایان استراتژی فعلی':
      return buildLines(hasValue(d?.note) && d.note).length
        ? [d.note]
        : ['تغییر استراتژی پس از اتمام استراتژی فعلی اعمال خواهد شد.']

    default:
      if (text) return [text]
      if (d && !d._text) {
        const generic = Object.entries(d)
          .filter(([k, v]) => k !== '_text' && hasValue(v))
          .map(([k, v]) => `${k}: ${typeof v === 'number' && k.includes('amount') ? rial(v) : v}`)
        return generic.length ? generic : ['—']
      }
      return ['—']
  }
}

/** یک رشته خلاصه (برای نمایش فشرده) */
export function formatHistoryDetailsSummary(operation, raw, context) {
  return formatHistoryDetailsLines(operation, raw, context).join(' · ')
}
