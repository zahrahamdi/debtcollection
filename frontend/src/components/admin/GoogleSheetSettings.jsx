import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, Sheet, Link2, PlugZap } from 'lucide-react'
import { fetchSettings, updateSettings } from '../../api/settings'
import { testGsheetConnection } from '../../api/gsheet'
import { currentUser } from '../../utils/auth'
import Modal from '../modal/Modal'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'

// دو کارت: پرونده‌ها و پرداخت‌ها
const CARDS = [
  { prefix: 'cases', title: 'تنظیمات Google Sheet پرونده‌ها' },
  { prefix: 'payments', title: 'تنظیمات Google Sheet پرداخت‌ها' },
]

// فیلدهای هر کارت (با کلید settings)
const FIELDS = [
  { key: 'title', label: 'عنوان تنظیم', placeholder: 'مثال: شیت پرونده‌ها' },
  { key: 'url', label: 'آدرس Google Sheet', placeholder: 'https://docs.google.com/spreadsheets/d/...' },
  { key: 'tab', label: 'نام Sheet یا Tab', placeholder: 'Sheet1' },
  { key: 'status_col', label: 'نام ستون وضعیت پردازش', placeholder: 'وضعیت پردازش' },
  { key: 'error_col', label: 'نام ستون دلیل خطا', placeholder: 'دلیل خطا' },
]

const k = (prefix, field) => `gsheet_${prefix}_${field}`

// مقادیر پیش‌فرض هنگام خالی بودن
const defaults = (prefix) => ({
  [k(prefix, 'title')]: '',
  [k(prefix, 'url')]: '',
  [k(prefix, 'tab')]: 'Sheet1',
  [k(prefix, 'status_col')]: 'وضعیت پردازش',
  [k(prefix, 'error_col')]: 'دلیل خطا',
  [k(prefix, 'active')]: '0',
})

export default function GoogleSheetSettings() {
  const [form, setForm] = useState({})
  const [initial, setInitial] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [testing, setTesting] = useState('')

  const load = () => {
    setLoading(true)
    fetchSettings()
      .then((s) => {
        const picked = {}
        for (const c of CARDS) {
          const d = defaults(c.prefix)
          for (const key of Object.keys(d)) {
            picked[key] = s[key] !== undefined && s[key] !== '' ? s[key] : d[key]
          }
        }
        setForm(picked)
        setInitial(picked)
      })
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت تنظیمات')
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const dirty = Object.keys(form).some((key) => String(form[key]) !== String(initial[key]))

  const onConfirm = async () => {
    setSaving(true)
    try {
      const changes = Object.keys(form).map((key) => ({ key, value: form[key] }))
      await updateSettings(changes, currentUser.name)
      toast.success('تنظیمات Google Sheet ذخیره شد.')
      setConfirmOpen(false)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا در ذخیره تنظیمات')
    } finally {
      setSaving(false)
    }
  }

  const runTest = async (prefix) => {
    setTesting(prefix)
    try {
      const res = await testGsheetConnection(form[k(prefix, 'url')])
      toast.success(res?.message ?? 'اتصال معتبر است.')
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا در تست اتصال')
    } finally {
      setTesting('')
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">در حال بارگذاری…</div>
  }

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-lg font-bold text-slate-800">تنظیمات Google Sheet</h3>
        <p className="mt-1 text-sm text-slate-400">
          آدرس و ساختار شیت‌ها را تنظیم کنید. اجرای سینک از صفحه‌ی پرونده‌ها انجام می‌شود، نه این‌جا.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map(({ prefix, title }) => {
          const active = form[k(prefix, 'active')] === '1'
          return (
            <div key={prefix} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Sheet className="h-5 w-5" />
                </span>
                <h4 className="text-sm font-bold text-slate-700">{title}</h4>
              </div>

              <div className="space-y-3">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className={labelClass}>{f.label}</label>
                    <input
                      className={inputClass}
                      dir={f.key === 'url' ? 'ltr' : 'rtl'}
                      placeholder={f.placeholder}
                      value={form[k(prefix, f.key)] ?? ''}
                      onChange={(e) => setField(k(prefix, f.key), e.target.value)}
                    />
                  </div>
                ))}

                {/* وضعیت اتصال */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-medium text-slate-500">وضعیت اتصال</span>
                  <button
                    type="button"
                    onClick={() => setField(k(prefix, 'active'), active ? '0' : '1')}
                    className={[
                      'rounded-full px-3 py-1 text-xs font-medium',
                      active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
                    ].join(' ')}
                  >
                    {active ? 'فعال' : 'غیرفعال'}
                  </button>
                </div>

                {/* دکمه تست اتصال */}
                <button
                  type="button"
                  onClick={() => runTest(prefix)}
                  disabled={testing === prefix}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-60"
                >
                  <PlugZap className="h-4 w-4" />
                  {testing === prefix ? 'در حال تست…' : 'تست اتصال'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!dirty}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Save className="h-4 w-4" />
          ذخیره تغییرات
        </button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !saving && setConfirmOpen(false)}
        title="تأیید ذخیره تنظیمات"
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
        <p className="text-sm text-slate-600">تنظیمات اتصال Google Sheet ذخیره می‌شوند.</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <Link2 className="h-4 w-4 text-brand-500" />
          اجرای سینک از صفحه‌ی پرونده‌ها انجام خواهد شد.
        </div>
      </Modal>
    </div>
  )
}
