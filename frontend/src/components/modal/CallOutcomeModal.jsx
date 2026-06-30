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
  no_payment_reason: '',
  payment_decision: '',
  promised_date: '',
  promised_amount: '',
  next_call_date: '',
  description: '',
  refer_to_legal: false,
}

// تبدیل رشته‌ی تاریخ جلالی (با ارقام فارسی/لاتین) به Date
function parseJalali(str) {
  const en = toEnDigits(str).trim()
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(en)) return null
  const d = parse(en, 'yyyy/MM/dd', new Date())
  return isNaN(d.getTime()) ? null : d
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.call_status) return setError('وضعیت تماس را انتخاب کنید.')

    if (willPay) {
      if (!form.promised_date || form.promised_amount === '')
        return setError('تاریخ و مبلغ تعهد پرداخت اجباری است.')
      if (Number(toEnDigits(form.promised_amount)) > Number(caseRow?.claims_amount ?? 0))
        return setError('مبلغ تعهد نباید بیشتر از مطالبات پرونده باشد.')
      // اعتبارسنجی سقف Promise to Pay با تقویم جلالی (AC14/16)
      const pd = parseJalali(form.promised_date)
      if (!pd) return setError('فرمت تاریخ تعهد نامعتبر است (مثال: ۱۴۰۴/۰۷/۱۲).')
      const diff = differenceInCalendarDays(pd, new Date())
      if (diff < 0) return setError('تاریخ تعهد نمی‌تواند در گذشته باشد.')
      if (diff > maxPromiseDays)
        return setError(`تاریخ تعهد نباید بیش از ${toFaDigits(maxPromiseDays)} روز از امروز باشد.`)
    }
    if (form.next_call_date && !parseJalali(form.next_call_date))
      return setError('فرمت تاریخ تماس بعدی نامعتبر است.')

    setSaving(true)
    setError('')
    try {
      await submitCallOutcome(caseRow.id, {
        call_status: form.call_status,
        no_payment_reason: form.no_payment_reason || null,
        payment_decision: form.payment_decision || null,
        promised_date: willPay ? toEnDigits(form.promised_date) : null,
        promised_amount: willPay ? Number(toEnDigits(form.promised_amount)) : null,
        next_call_date: form.next_call_date ? toEnDigits(form.next_call_date) : null,
        description: form.description || null,
        refer_to_legal: form.refer_to_legal,
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
        <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span>
            پرونده <span className="font-medium text-slate-700">{caseRow.credit_id}</span> —{' '}
            {caseRow.debtor_name}
          </span>
          <span className="text-slate-400">
            نمایش تماس شماره {toFaDigits(caseRow.call_count ?? 0)} از{' '}
            {toFaDigits(caseRow.max_call_count ?? 0)}
          </span>
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

        <div>
          <label className={labelClass}>زمان تماس بعدی برای پیگیری</label>
          <input
            className={fieldClass}
            placeholder="۱۴۰۴/۰۷/۱۵"
            value={form.next_call_date}
            onChange={(e) => set({ next_call_date: e.target.value })}
          />
        </div>

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

        <button
          type="button"
          onClick={() => toast('ارسال لینک پرداخت در نسخه دمو فعال نیست.', { icon: '🔗' })}
          className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
        >
          <Link2 className="h-4 w-4" />
          ارسال لینک پرداخت
        </button>

        {error && <p className="text-sm text-rose-500">{error}</p>}
      </form>
    </Modal>
  )
}
