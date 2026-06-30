import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, Lock, CalendarX2, FileCheck2, Hourglass } from 'lucide-react'
import { fetchSettings, updateSettings, fetchSettingsHistory } from '../../api/settings'
import { currentUser } from '../../utils/auth'
import { toFaDigits } from '../../utils/format'
import Modal from '../modal/Modal'

const inputClass =
  'w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

function formatWhen(value) {
  try {
    return new Date(value.replace(' ', 'T') + 'Z').toLocaleString('fa-IR')
  } catch {
    return value
  }
}

// شروط ثابت و غیرقابل ویرایش (شرط دوم و سوم — Story 11.1)
const FIXED_CONDITIONS = [
  {
    icon: CalendarX2,
    title: 'شرط دوم: کلاس بدهی',
    text: 'کلاس بدهی باید سررسید گذشته باشد.',
  },
  {
    icon: FileCheck2,
    title: 'شرط سوم: تکراری نبودن پرونده',
    text: 'برای این شناسه اعتبار، پرونده فعالی وجود نداشته باشد.',
  },
]

export default function CaseCreationRules() {
  const [value, setValue] = useState('')
  const [initial, setInitial] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([fetchSettings(), fetchSettingsHistory('min_dpd')])
      .then(([s, h]) => {
        setValue(s.min_dpd ?? '')
        setInitial(s.min_dpd ?? '')
        setHistory(h)
      })
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت تنظیمات')
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const dirty = String(value) !== String(initial)

  const validate = () => {
    const n = Number(value)
    if (!Number.isInteger(n) || n <= 0) {
      setError('حداقل روزهای دیرکرد باید عدد صحیح مثبت باشد.')
      return false
    }
    setError('')
    return true
  }

  const onSaveClick = () => {
    if (!validate()) return
    if (!dirty) {
      toast('تغییری برای ذخیره وجود ندارد.', { icon: 'ℹ️' })
      return
    }
    setConfirmOpen(true)
  }

  const onConfirm = async () => {
    setSaving(true)
    try {
      await updateSettings([{ key: 'min_dpd', value }], currentUser.name)
      toast.success('شرایط ایجاد پرونده ذخیره شد.')
      setConfirmOpen(false)
      load()
    } catch (e) {
      console.error(e)
      toast.error(e?.response?.data?.error ?? 'خطا در ذخیره')
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
        <h3 className="text-lg font-bold text-slate-800">شرایط ایجاد پرونده بدهی</h3>
        <p className="mt-1 text-sm text-slate-400">
          پرونده بدهی زمانی ایجاد می‌شود که تمامی شرایط زیر برقرار باشند.
        </p>
      </div>

      {/* شرط اول — قابل ویرایش */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Hourglass className="h-5 w-5" />
          </span>
          <h4 className="text-sm font-bold text-slate-700">شرط اول: حداقل روزهای دیرکرد</h4>
        </div>

        <label className="mb-1 block text-xs font-medium text-slate-500">
          حداقل روزهای دیرکرد (DPD)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            className={inputClass}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="text-sm text-slate-400">روز</span>
        </div>
        {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
        <p className="mt-3 text-xs leading-5 text-slate-400">
          پرونده زمانی ایجاد می‌شود که روزهای دیرکرد بزرگ‌تر یا مساوی این مقدار باشد. (پیش‌فرض: ۶۱ روز)
        </p>
      </div>

      {/* شروط ثابت — غیرقابل ویرایش */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {FIXED_CONDITIONS.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.title} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200 text-slate-500">
                  <Icon className="h-5 w-5" />
                </span>
                <h4 className="text-sm font-bold text-slate-600">{c.title}</h4>
                <span className="mr-auto flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500">
                  <Lock className="h-3 w-3" />
                  غیرقابل ویرایش
                </span>
              </div>
              <p className="text-sm text-slate-600">{c.text}</p>
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onSaveClick}
          disabled={!dirty}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Save className="h-4 w-4" />
          ذخیره تغییرات
        </button>
      </div>

      {/* تاریخچه تغییرات */}
      <div className="mt-6">
        <h4 className="mb-3 border-r-2 border-brand-500 pr-2 text-sm font-bold text-slate-700">
          تاریخچه تغییرات
        </h4>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">تاریخ تغییر</th>
                <th className="px-4 py-3 font-medium">مقدار قبلی</th>
                <th className="px-4 py-3 font-medium">مقدار جدید</th>
                <th className="px-4 py-3 font-medium">کاربر</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    تغییری ثبت نشده است.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-slate-600">{formatWhen(h.changed_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{toFaDigits(h.old_value ?? '—')} روز</td>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {toFaDigits(h.new_value)} روز
                    </td>
                    <td className="px-4 py-3 text-slate-600">{h.user_name || 'ادمین'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* مدال تأیید */}
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
        <p className="text-sm text-slate-600">حداقل روزهای دیرکرد تغییر می‌کند:</p>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">حداقل روزهای دیرکرد (DPD)</span>
          <span className="font-medium text-slate-700">
            {toFaDigits(initial)} ← {toFaDigits(value)} روز
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-400">این تغییر فقط روی پرونده‌های جدید اعمال می‌شود.</p>
      </Modal>
    </div>
  )
}
