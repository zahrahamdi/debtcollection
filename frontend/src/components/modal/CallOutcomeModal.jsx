import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { format, parse, differenceInCalendarDays } from 'date-fns-jalali'
import { Link2, Scale } from 'lucide-react'
import Modal from './Modal'
import JalaliDatePicker from '../form/JalaliDatePicker'
import { submitCallOutcome } from '../../api/cases'
import { fetchSettings } from '../../api/settings'
import { toFaDigits, toEnDigits, formatRial, formatJalaliDateTime, jalaliDateTimeStyle } from '../../utils/format'

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
  promised_time: '',
  promised_amount: '',
  next_call_date: '',
  next_call_time: '',
  description: '',
  refer_to_legal: false,
  send_payment_link: false,
}

const two = (n) => String(n).padStart(2, '0')

function hhmmFromOffset(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60000)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

function jalaliDateFromOffset(offsetMin = 0) {
  return format(new Date(Date.now() + offsetMin * 60000), 'yyyy/MM/dd')
}

function parseJalali(str) {
  const en = toEnDigits(str).trim()
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(en)) return null
  const d = parse(en, 'yyyy/MM/dd', new Date())
  return Number.isNaN(d.getTime()) ? null : d
}

function parseJalaliDateTimeLocal(dateStr, timeStr) {
  const d = parseJalali(dateStr)
  if (!d) return null
  const en = toEnDigits(timeStr)
  const [h, m] = en.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  d.setHours(h, m, 0, 0)
  return d
}

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

  const stage = caseRow?.negotiator_stage || null
  const allowedFrom = stage?.allowed_from || '09:00'
  const allowedTo = stage?.allowed_to || '18:00'
  const waitMinutes = Number(stage?.wait_next_minutes ?? stage?.wait_minutes) || 0
  const waitRepeatMinutes = Number(stage?.wait_repeat_minutes) || 0
  const nextActionLabel = stage?.next_action_label || 'شکست استراتژی'

  const attemptsSoFar = Number(caseRow?.current_action_repeat) || 0
  const maxCalls = Number(caseRow?.max_call_count) || Number(stage?.max_repeat) || 3
  const isNoAnswer = form.call_status === 'پاسخگو نبود'
  const durationRequired =
    form.call_status === 'پاسخگو بود' || form.call_status === 'ناسزا گفت'
  const reachedMax = attemptsSoFar + 1 >= maxCalls

  let mode
  if (reachedMax && isNoAnswer) mode = 'last_noanswer'
  else if (isNoAnswer) mode = 'noanswer'
  else if (reachedMax && willPay) mode = 'last_willpay'
  else if (reachedMax) mode = 'last'
  else if (willPay) mode = 'willpay'
  else mode = 'followup'

  const hideNextCall = ['noanswer', 'last', 'last_noanswer', 'last_willpay'].includes(mode)
  const showNextCall = !hideNextCall
  const timeEditable = mode === 'followup'
  const promiseLockedNextCall = mode === 'willpay'

  useEffect(() => {
    if (!open || !willPay) return
    setForm((f) => ({
      ...f,
      promised_date: f.promised_date || jalaliDateFromOffset(0),
      promised_time: f.promised_time || hhmmFromOffset(0),
    }))
  }, [open, willPay])

  useEffect(() => {
    if (!open || hideNextCall) return
    if (mode === 'willpay') {
      setForm((f) => ({
        ...f,
        next_call_date: f.promised_date,
        next_call_time: f.promised_time,
      }))
      return
    }
    setForm((f) => ({
      ...f,
      next_call_date: jalaliDateFromOffset(waitMinutes),
      next_call_time: hhmmFromOffset(waitMinutes),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, open, waitMinutes, form.promised_date, form.promised_time])

  const nextCallDateValue = promiseLockedNextCall ? form.promised_date : form.next_call_date
  const nextCallTimeValue = promiseLockedNextCall ? form.promised_time : form.next_call_time

  const promisedDatetimePreview =
    form.promised_date && form.promised_time
      ? `${toEnDigits(form.promised_date)} ${toEnDigits(form.promised_time)}`
      : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.call_status) return setError('وضعیت تماس را انتخاب کنید.')
    const duration = isNoAnswer ? 0 : Number(toEnDigits(form.call_duration))
    if (durationRequired) {
      if (!form.call_duration || Number.isNaN(duration) || duration <= 0)
        return setError('مدت تماس به دقیقه اجباری است.')
    }

    if (willPay) {
      if (!form.promised_date || !form.promised_time || form.promised_amount === '')
        return setError('تاریخ، ساعت و مبلغ تعهد پرداخت اجباری است.')
      if (Number(toEnDigits(form.promised_amount)) > Number(caseRow?.claims_amount ?? 0))
        return setError('مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد.')
      const pd = parseJalali(form.promised_date)
      if (!pd) return setError('فرمت تاریخ تعهد نامعتبر است.')
      const diff = differenceInCalendarDays(pd, new Date())
      if (diff < 0) return setError('تاریخ تعهد نمی‌تواند در گذشته باشد.')
      if (diff > maxPromiseDays)
        return setError(`تاریخ تعهد نباید بیش از ${toFaDigits(maxPromiseDays)} روز از امروز باشد.`)
      const promisedTime = toEnDigits(form.promised_time)
      if (!/^\d{1,2}:\d{2}$/.test(promisedTime))
        return setError('فرمت ساعت تعهد نامعتبر است.')
      if (!timeInWindow(promisedTime, allowedFrom, allowedTo))
        return setError(
          `ساعت تعهد باید در بازه مجاز (${toFaDigits(allowedFrom)} تا ${toFaDigits(allowedTo)}) باشد.`
        )
      const promisedDt = parseJalaliDateTimeLocal(form.promised_date, promisedTime)
      if (!promisedDt) return setError('تاریخ/ساعت تعهد نامعتبر است.')
      if (promisedDt.getTime() < Date.now())
        return setError('تاریخ و ساعت تعهد نمی‌تواند در گذشته باشد.')
    }

    if (showNextCall && mode === 'followup') {
      const dateStr = form.next_call_date
      const timeStr = toEnDigits(form.next_call_time)
      if (!dateStr || !timeStr) return setError('تاریخ و ساعت تماس بعدی اجباری است.')
      if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return setError('فرمت ساعت تماس بعدی نامعتبر است.')
      if (!parseJalali(dateStr)) return setError('فرمت تاریخ تماس بعدی نامعتبر است.')
      if (!timeInWindow(timeStr, allowedFrom, allowedTo))
        return setError(
          `ساعت تماس بعدی باید در بازه مجاز (${toFaDigits(allowedFrom)} تا ${toFaDigits(allowedTo)}) باشد.`
        )
    }

    setSaving(true)
    setError('')
    try {
      const promisedDate = willPay ? toEnDigits(form.promised_date) : null
      const promisedTime = willPay ? toEnDigits(form.promised_time) : null
      const promisedDatetime =
        willPay && promisedDate && promisedTime ? `${promisedDate} ${promisedTime}` : null

      await submitCallOutcome(caseRow.id, {
        call_status: form.call_status,
        call_duration: duration,
        no_payment_reason: isNoAnswer ? null : form.no_payment_reason || null,
        payment_decision: form.payment_decision || null,
        promised_date: promisedDate,
        promised_time: promisedTime,
        promised_datetime: promisedDatetime,
        promised_amount: willPay ? Number(toEnDigits(form.promised_amount)) : null,
        next_call_date: !showNextCall
          ? null
          : willPay
            ? promisedDate
            : toEnDigits(form.next_call_date),
        next_call_time: !showNextCall
          ? null
          : willPay
            ? promisedTime
            : toEnDigits(form.next_call_time),
        description: form.description || null,
        refer_to_legal: form.refer_to_legal,
        send_payment_link: form.send_payment_link,
        call_date: format(new Date(), 'yyyy/MM/dd'),
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
            تماس {toFaDigits(attemptsSoFar + 1)} از {toFaDigits(maxCalls)}
          </div>
          {caseRow.next_action_date && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
              زمان اقدام بعدی:{' '}
              <span style={jalaliDateTimeStyle}>{formatJalaliDateTime(caseRow.next_action_date)}</span>
            </div>
          )}
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
            onChange={(e) => {
              const status = e.target.value
              set({
                call_status: status,
                ...(status === 'پاسخگو نبود'
                  ? {
                      call_duration: '',
                      no_payment_reason: '',
                      payment_decision: '',
                      promised_date: '',
                      promised_time: '',
                      promised_amount: '',
                      next_call_date: '',
                      next_call_time: '',
                      description: '',
                      refer_to_legal: false,
                      send_payment_link: false,
                    }
                  : {}),
              })
            }}
          >
            <option value="" disabled>
              انتخاب کنید
            </option>
            <option>پاسخگو بود</option>
            <option>پاسخگو نبود</option>
            <option>ناسزا گفت</option>
          </select>
        </div>

        {isNoAnswer ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {mode === 'last_noanswer' ? (
              <>
                این آخرین تماس مجاز است و مشتری پاسخگو نبود.
                <div className="mt-1 font-medium">اقدام بعدی: {nextActionLabel}</div>
              </>
            ) : (
              <>
                عدم پاسخگویی ثبت می‌شود و سیستم زمان تماس مجدد را به‌صورت خودکار «اکنون +{' '}
                {toFaDigits(waitRepeatMinutes)} دقیقه» تنظیم می‌کند (تا سقف تکرار).
              </>
            )}
          </div>
        ) : (
          <>
        <div>
          <label className={labelClass}>
            مدت تماس به دقیقه
            {durationRequired && <span className="text-rose-500"> *</span>}
          </label>
          <input
            type="number"
            dir="ltr"
            min={durationRequired ? 1 : 0}
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
          <div className="space-y-3 rounded-xl bg-brand-50/50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>تاریخ تعهد</label>
                <JalaliDatePicker
                  value={form.promised_date}
                  onChange={(v) => set({ promised_date: v })}
                />
              </div>
              <div>
                <label className={labelClass}>ساعت تعهد</label>
                <input
                  type="time"
                  dir="ltr"
                  className={fieldClass}
                  value={toEnDigits(form.promised_time)}
                  onChange={(e) => set({ promised_time: e.target.value })}
                />
              </div>
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
            <p className="text-[11px] text-slate-400">
              بازه مجاز ساعت تعهد: {toFaDigits(allowedFrom)} تا {toFaDigits(allowedTo)}
            </p>
          </div>
        )}

        {showNextCall ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>تاریخ تماس بعدی</label>
                {promiseLockedNextCall ? (
                  <JalaliDatePicker value={nextCallDateValue} onChange={() => {}} disabled />
                ) : (
                  <JalaliDatePicker
                    value={nextCallDateValue}
                    onChange={(v) => set({ next_call_date: v })}
                  />
                )}
              </div>
              <div>
                <label className={labelClass}>ساعت تماس بعدی</label>
                <input
                  type="time"
                  dir="ltr"
                  className={timeEditable ? fieldClass : disabledFieldClass}
                  value={toEnDigits(nextCallTimeValue)}
                  disabled={!timeEditable}
                  onChange={(e) => set({ next_call_time: e.target.value })}
                />
              </div>
            </div>
            {promiseLockedNextCall && (
              <p className="mt-1 text-[11px] text-brand-600">
                زمان تماس بعدی برابر زمان تعهد پرداخت است.
              </p>
            )}
            {!promiseLockedNextCall && (
              <p className="mt-1 text-[11px] text-slate-400">
                بازه مجاز تماس مذاکره‌کننده: {toFaDigits(allowedFrom)} تا {toFaDigits(allowedTo)}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {mode === 'last_willpay' && (
              <>
                این آخرین تماس مجاز است. چون تعهد پرداخت داده‌اید، سیستم تا تاریخ{' '}
                {promisedDatetimePreview ? (
                  <span style={jalaliDateTimeStyle}>{formatJalaliDateTime(promisedDatetimePreview)}</span>
                ) : (
                  'تعهد'
                )}{' '}
                منتظر می‌ماند. در صورت عدم پرداخت تا آن تاریخ، اقدام بعدی: {nextActionLabel}
              </>
            )}
            {mode === 'last' && (
              <>
                این آخرین تماس مجاز مذاکره‌کننده در این استراتژی است. سیستم به‌طور خودکار
                به اقدام بعدی می‌رود.
                <div className="mt-1 font-medium">اقدام بعدی: {nextActionLabel}</div>
              </>
            )}
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
          </>
        )}

        {error && <p className="text-sm text-rose-500">{error}</p>}
      </form>
    </Modal>
  )
}
