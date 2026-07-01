import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { format, parse, differenceInCalendarDays } from 'date-fns-jalali'
import { Link2, Scale } from 'lucide-react'
import Modal from './Modal'
import { submitCallOutcome } from '../../api/cases'
import { fetchSettings } from '../../api/settings'
import { currentUser } from '../../utils/auth'
import { toFaDigits, toEnDigits, formatRial } from '../../utils/format'

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const disabledFieldClass =
  'w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'

const NO_PAYMENT_REASONS = [
  'بیماری',
  'مسدودی حساب',
  'مرجوعی کالا',
  'فوت کاربر',
  'کالا تحویل داده نشده',
  'اختلاف در مبلغ',
  'عدم اطلاع از بدهی',
  'مشکل اپلیکیشن یا لینک پرداخت',
  'بیکاری یا مشکل مالی موقت',
  'در سفر یا خارج از کشور',
  'درخواست تقسیط مجدد',
  'سایر (با توضیحات اجباری)',
]

const emptyForm = {
  call_status: '',
  call_duration: '',
  no_payment_reason: '',
  payment_decision: '',
  promised_date: '',
  promised_amount: '',
  next_call_date: '',
  next_call_time: '',
  description: '',
  refer_to_legal: false,
  send_payment_link: false,
}

const two = (n) => String(n).padStart(2, '0')

// ساعت HH:mm با ارقام لاتین (برای input type=time)
function hhmmFromOffset(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60000)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

// تاریخ جلالی YYYY/MM/DD با آفست دقیقه
function jalaliDateFromOffset(offsetMin = 0) {
  return format(new Date(Date.now() + offsetMin * 60000), 'yyyy/MM/dd')
}

// تبدیل رشته‌ی تاریخ جلالی (با ارقام فارسی/لاتین) به Date
function parseJalali(str) {
  const en = toEnDigits(str).trim()
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(en)) return null
  const d = parse(en, 'yyyy/MM/dd', new Date())
  return isNaN(d.getTime()) ? null : d
}

// آیا ساعت HH:mm در بازه [from, to] است؟
function timeInWindow(t, from, to) {
  const en = toEnDigits(t)
  const [h, m] = en.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return false
  const mins = h * 60 + m
  const [fh, fm] = String(from).split(':').map(Number)
  const [th, tm] = String(to).split(':').map(Number)
  const fromM = fh * 60 + fm
  const toM = th * 60 + tm
  if (fromM <= toM) return mins >= fromM && mins <= toM
  return mins >= fromM || mins <= toM
}

export default function CallOutcomeModal({ open, onClose, caseRow, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [maxPromiseDays, setMaxPromiseDays] = useState(10)

  useEffect(() => {
    if (!open) return
    setForm(emptyForm)
    setError('')
    fetchSettings()
      .then((s) => setMaxPromiseDays(Number(s.promise_to_pay_max_days) || 10))
      .catch(() => {})
  }, [open])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const willPay = form.payment_decision === 'دارد'

  // اطلاعات مرحله تماس مذاکره‌کننده در استراتژی پرونده
  const stage = caseRow?.negotiator_stage || null
  const allowedFrom = stage?.allowed_from || '09:00'
  const allowedTo = stage?.allowed_to || '18:00'
  const waitMinutes = Number(stage?.wait_minutes) || 0
  const nextActionLabel = stage?.next_action_label || 'شکست استراتژی'

  // فقط تماس‌های استراتژی فعلی شمرده می‌شوند (بعد از شروع استراتژی فعلی پرونده)
  const callCount = Number(caseRow?.current_strategy_call_count) || 0
  const maxCalls = Number(caseRow?.max_call_count) || 0
  const isLastCall = maxCalls > 0 && callCount + 1 >= maxCalls

  // تعیین حالت فیلدهای تماس بعدی
  let mode
  if (willPay) mode = 'willpay'
  else if (isLastCall) mode = 'last'
  else if (form.call_status === 'پاسخگو نبود') mode = 'noanswer'
  else mode = 'followup'

  const showNextCall = mode !== 'last'
  const dateEditable = mode === 'followup'
  const timeEditable = mode === 'willpay' || mode === 'followup'

  // autofill تاریخ/ساعت تماس بعدی بر اساس حالت
  useEffect(() => {
    if (!open || mode === 'last') return
    if (mode === 'willpay') {
      // تاریخ = تاریخ تعهد (readonly، از فیلد promised_date خوانده می‌شود)، ساعت = ساعت فعلی (قابل ویرایش)
      setForm((f) => ({ ...f, next_call_time: hhmmFromOffset(0) }))
    } else {
      // noanswer / followup: تاریخ و ساعت = الان + wait
      setForm((f) => ({
        ...f,
        next_call_date: jalaliDateFromOffset(waitMinutes),
        next_call_time: hhmmFromOffset(waitMinutes),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open, waitMinutes])

  // مقدار نمایش تاریخ تماس بعدی (در حالت willpay = تاریخ تعهد)
  const nextCallDateValue = mode === 'willpay' ? form.promised_date : form.next_call_date

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.call_status) return setError('وضعیت تماس را انتخاب کنید.')
    const duration = Number(toEnDigits(form.call_duration))
    if (!form.call_duration || Number.isNaN(duration) || duration <= 0)
      return setError('مدت تماس به دقیقه اجباری است.')

    if (willPay) {
      if (!form.promised_date || form.promised_amount === '')
        return setError('تاریخ و مبلغ تعهد پرداخت اجباری است.')
      if (Number(toEnDigits(form.promised_amount)) > Number(caseRow?.claims_amount ?? 0))
        return setError('مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد.')
      const pd = parseJalali(form.promised_date)
      if (!pd) return setError('فرمت تاریخ تعهد نامعتبر است (مثال: ۱۴۰۴/۰۷/۱۲).')
      const diff = differenceInCalendarDays(pd, new Date())
      if (diff < 0) return setError('تاریخ تعهد نمی‌تواند در گذشته باشد.')
      if (diff > maxPromiseDays)
        return setError(`تاریخ تعهد نباید بیش از ${toFaDigits(maxPromiseDays)} روز از امروز باشد.`)
    }

    // اعتبارسنجی تاریخ/ساعت تماس بعدی (به‌جز حالت آخرین تماس که مخفی است)
    if (mode !== 'last') {
      const dateStr = willPay ? form.promised_date : form.next_call_date
      const timeStr = toEnDigits(form.next_call_time)
      if (!dateStr || !timeStr) return setError('تاریخ و ساعت تماس بعدی اجباری است.')
      if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return setError('فرمت ساعت تماس بعدی نامعتبر است.')
      if (dateEditable && !parseJalali(dateStr))
        return setError('فرمت تاریخ تماس بعدی نامعتبر است.')
      if (!timeInWindow(timeStr, allowedFrom, allowedTo))
        return setError(
          `ساعت تماس بعدی باید در بازه مجاز (${toFaDigits(allowedFrom)} تا ${toFaDigits(allowedTo)}) باشد.`
        )
    }

    setSaving(true)
    setError('')
    try {
      const nextCallDate =
        mode === 'last'
          ? null
          : willPay
            ? toEnDigits(form.promised_date)
            : toEnDigits(form.next_call_date)
      await submitCallOutcome(caseRow.id, {
        call_status: form.call_status,
        call_duration: duration,
        no_payment_reason: form.no_payment_reason || null,
        payment_decision: form.payment_decision || null,
        promised_date: willPay ? toEnDigits(form.promised_date) : null,
        promised_amount: willPay ? Number(toEnDigits(form.promised_amount)) : null,
        next_call_date: nextCallDate,
        next_call_time: mode === 'last' ? null : toEnDigits(form.next_call_time),
        description: form.description || null,
        refer_to_legal: form.refer_to_legal,
        send_payment_link: form.send_payment_link,
        call_date: format(new Date(), 'yyyy/MM/dd'),
        user_name: currentUser.name,
      })
      toast.success('خروجی تماس ثبت شد.')
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error ?? 'خطا در ثبت خروجی تماس')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="ثبت خروجی تماس"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            انصراف
          </button>
          <button
            type="submit"
            form="call-outcome-form"
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'در حال ثبت…' : 'ثبت خروجی تماس'}
          </button>
        </>
      }
    >
      {caseRow && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>
              پرونده <span className="font-medium text-slate-700">{caseRow.credit_id}</span> —{' '}
              {caseRow.debtor_name}
            </span>
          </div>
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-center text-sm font-medium text-brand-700">
            تماس {toFaDigits(callCount + 1)} از {toFaDigits(maxCalls)}
          </div>
        </div>
      )}

      <form
        id="call-outcome-form"
        onSubmit={handleSubmit}
        className="max-h-[60vh] space-y-4 overflow-y-auto pl-1"
      >
        <div>
          <label className={labelClass}>وضعیت تماس</label>
          <select
            className={fieldClass}
            value={form.call_status}
            onChange={(e) => set({ call_status: e.target.value })}
          >
            <option value="" disabled>
              انتخاب کنید
            </option>
            <option>پاسخگو بود</option>
            <option>پاسخگو نبود</option>
            <option>ناسزا گفت</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>مدت تماس به دقیقه</label>
          <input
            type="number"
            dir="ltr"
            min="1"
            className={fieldClass}
            placeholder="مثلاً ۵"
            value={form.call_duration}
            onChange={(e) => set({ call_duration: e.target.value })}
          />
        </div>

        <div>
          <label className={labelClass}>دلیل عدم پرداخت</label>
          <select
            className={fieldClass}
            value={form.no_payment_reason}
            onChange={(e) => set({ no_payment_reason: e.target.value })}
          >
            <option value="">— انتخاب کنید —</option>
            {NO_PAYMENT_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>تصمیم به پرداخت</label>
          <select
            className={fieldClass}
            value={form.payment_decision}
            onChange={(e) => set({ payment_decision: e.target.value })}
          >
            <option value="">— انتخاب کنید —</option>
            <option value="دارد">دارد</option>
            <option value="ندارد">ندارد</option>
            <option value="نامشخص">نامشخص</option>
          </select>
        </div>

        {willPay && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-brand-50/50 p-3">
            <div>
              <label className={labelClass}>تاریخ اعلام‌شده برای پرداخت</label>
              <input
                className={fieldClass}
                placeholder="۱۴۰۴/۰۷/۱۰"
                value={form.promised_date}
                onChange={(e) => set({ promised_date: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>مبلغ تعهد پرداخت (ریال)</label>
              <input
                className={fieldClass}
                placeholder="۰"
                inputMode="numeric"
                value={form.promised_amount}
                onChange={(e) => set({ promised_amount: e.target.value })}
              />
              {caseRow && (
                <p className="mt-1 text-[11px] text-slate-400">
                  مطالبات پرونده: {formatRial(caseRow.claims_amount)} ریال
                </p>
              )}
            </div>
          </div>
        )}

        {showNextCall ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>تاریخ تماس بعدی</label>
                <input
                  className={dateEditable ? fieldClass : disabledFieldClass}
                  placeholder="۱۴۰۴/۰۷/۱۵"
                  value={nextCallDateValue}
                  disabled={!dateEditable}
                  onChange={(e) => set({ next_call_date: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>ساعت تماس بعدی</label>
                <input
                  type="time"
                  dir="ltr"
                  className={timeEditable ? fieldClass : disabledFieldClass}
                  value={toEnDigits(form.next_call_time)}
                  disabled={!timeEditable}
                  onChange={(e) => set({ next_call_time: e.target.value })}
                />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              بازه مجاز تماس مذاکره‌کننده: {toFaDigits(allowedFrom)} تا {toFaDigits(allowedTo)}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            این آخرین تماس مذاکره‌کننده است. زمان اقدام بعدی به‌صورت خودکار «اکنون + {toFaDigits(waitMinutes)} دقیقه»
            تنظیم می‌شود.
            <div className="mt-1 font-medium">اقدام بعدی: {nextActionLabel}</div>
          </div>
        )}

        <div>
          <label className={labelClass}>توضیحات تکمیلی</label>
          <textarea
            className={fieldClass}
            rows={3}
            placeholder="یادداشت مذاکره‌کننده…"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={form.refer_to_legal}
            onChange={(e) => set({ refer_to_legal: e.target.checked })}
          />
          <Scale className="h-4 w-4 text-slate-400" />
          ارجاع به حقوقی
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={form.send_payment_link}
            onChange={(e) => set({ send_payment_link: e.target.checked })}
          />
          <Link2 className="h-4 w-4 text-slate-400" />
          ارسال لینک پرداخت
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}
      </form>
    </Modal>
  )
}
