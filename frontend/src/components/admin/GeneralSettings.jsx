import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, Clock, CalendarClock, HandCoins } from 'lucide-react'
import { fetchSettings, updateSettings, fetchSettingsHistory } from '../../api/settings'
import { currentUser } from '../../utils/auth'
import { toFaDigits } from '../../utils/format'
import Modal from '../modal/Modal'

// کارت‌های تنظیمات عمومی (Story 11.4 PRD)
const CARDS = [
  {
    key: 'partial_payment_gap_days',
    icon: HandCoins,
    title: 'تنظیمات پرداخت جزئی',
    label: 'تعداد روزهای فاصله پس از پرداخت جزئی',
    suffix: 'روز',
    description:
      'پس از ثبت پرداخت جزئی، سیستم تاریخ اقدام بعدی پرونده را بر اساس این مقدار تنظیم می‌کند.',
  },
  {
    key: 'promise_to_pay_max_days',
    icon: CalendarClock,
    title: 'تنظیمات تعهد پرداخت (Promise to Pay)',
    label: 'حداکثر مهلت مجاز برای تعهد پرداخت',
    suffix: 'روز',
    description:
      'مذاکره‌کننده هنگام ثبت تعهد پرداخت نمی‌تواند تاریخی بیشتر از این تعداد روز از تاریخ تماس انتخاب کند.',
  },
]

const inputClass =
  'w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

function formatWhen(value) {
  try {
    return new Date(value.replace(' ', 'T') + 'Z').toLocaleString('fa-IR')
  } catch {
    return value
  }
}

// جدول تاریخچه تغییرات هر کارت (Story 11.4 AC5 — «تاریخچه تغییرات هر کارت نگهداری می‌شود»)
function CardHistory({ rows }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center gap-1 text-[11px] font-medium text-slate-400">
        <Clock className="h-3.5 w-3.5" />
        تاریخچه تغییرات
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">تغییری ثبت نشده است.</p>
      ) : (
        <table className="w-full text-right text-[11px]">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 font-medium">تاریخ</th>
              <th className="py-1 font-medium">قبلی</th>
              <th className="py-1 font-medium">جدید</th>
              <th className="py-1 font-medium">کاربر</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((h) => (
              <tr key={h.id} className="border-t border-slate-50 text-slate-500">
                <td className="py-1">{formatWhen(h.changed_at)}</td>
                <td className="py-1">{toFaDigits(h.old_value ?? '—')}</td>
                <td className="py-1 font-medium text-slate-700">{toFaDigits(h.new_value)}</td>
                <td className="py-1">{h.user_name || 'ادمین'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function GeneralSettings() {
  const [values, setValues] = useState({})
  const [initial, setInitial] = useState({})
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errors, setErrors] = useState({})

  const load = () => {
    setLoading(true)
    Promise.all([fetchSettings(), fetchSettingsHistory()])
      .then(([s, h]) => {
        const picked = {}
        for (const c of CARDS) picked[c.key] = s[c.key] ?? ''
        setValues(picked)
        setInitial(picked)
        setHistory(h)
      })
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت تنظیمات')
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const dirtyChanges = useMemo(
    () =>
      CARDS.filter((c) => String(values[c.key] ?? '') !== String(initial[c.key] ?? '')).map((c) => ({
        key: c.key,
        value: values[c.key],
      })),
    [values, initial]
  )

  const validate = () => {
    const errs = {}
    for (const c of CARDS) {
      const n = Number(values[c.key])
      if (!Number.isInteger(n) || n <= 0) {
        errs[c.key] = 'باید عدد صحیح مثبت باشد'
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const onSaveClick = () => {
    if (!validate()) return
    if (dirtyChanges.length === 0) {
      toast('تغییری برای ذخیره وجود ندارد.', { icon: 'ℹ️' })
      return
    }
    setConfirmOpen(true)
  }

  const onConfirm = async () => {
    setSaving(true)
    try {
      await updateSettings(dirtyChanges, currentUser.name)
      toast.success('تنظیمات با موفقیت ذخیره شد.')
      setConfirmOpen(false)
      load()
    } catch (e) {
      console.error(e)
      toast.error(e?.response?.data?.error ?? 'خطا در ذخیره تنظیمات')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">در حال بارگذاری…</div>
  }

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-lg font-bold text-slate-800">تنظیمات عمومی</h3>
        <p className="mt-1 text-sm text-slate-400">تنظیمات کلی سیستم وصول مطالبات.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </span>
                <h4 className="text-sm font-bold text-slate-700">{card.title}</h4>
              </div>

              <label className="mb-1 block text-xs font-medium text-slate-500">{card.label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  className={inputClass}
                  value={values[card.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [card.key]: e.target.value }))}
                />
                <span className="text-sm text-slate-400">{card.suffix}</span>
              </div>
              {errors[card.key] && (
                <p className="mt-1 text-xs text-rose-500">{errors[card.key]}</p>
              )}

              <p className="mt-3 text-xs leading-5 text-slate-400">{card.description}</p>

              <CardHistory rows={history.filter((h) => h.key === card.key)} />
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onSaveClick}
          disabled={dirtyChanges.length === 0}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Save className="h-4 w-4" />
          ذخیره تغییرات
        </button>
      </div>

      {/* مدال تأیید (طبق PRD برای هر ذخیره) */}
      <Modal
        open={confirmOpen}
        onClose={() => !saving && setConfirmOpen(false)}
        title="تأیید ذخیره تغییرات"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'در حال ذخیره…' : 'تأیید و ذخیره'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">تغییرات زیر ذخیره می‌شوند:</p>
        <ul className="mt-3 space-y-2">
          {dirtyChanges.map((c) => {
            const card = CARDS.find((x) => x.key === c.key)
            return (
              <li
                key={c.key}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-500">{card?.label}</span>
                <span className="font-medium text-slate-700">
                  {toFaDigits(initial[c.key])} ← {toFaDigits(c.value)} روز
                </span>
              </li>
            )
          })}
        </ul>
      </Modal>
    </div>
  )
}
