import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, FlaskConical, History as HistoryIcon } from 'lucide-react'
import { fetchCeiFormulas, updateCeiFormula, testCeiFormula } from '../../api/cei'
import { currentUser } from '../../utils/auth'
import { toFaDigits, formatRial } from '../../utils/format'
import Modal from '../modal/Modal'

// تعریف فیلدهای پارامتر هر نوع اعتبار (Story 11.2)
const FIELD_DEFS = {
  loan: [
    { key: 'w_a', label: 'وزن مبلغ (W_A)', step: '1' },
    { key: 'w_c', label: 'وزن ضمانت (W_C)', step: '1' },
    { key: 'w_i', label: 'وزن قسط (W_I)', step: '1' },
    { key: 'cap', label: 'سقف مبلغ Cap (ریال)', step: '1', big: true },
    { key: 'c_none', label: 'مقدار بدون ضامن', step: '0.01' },
    { key: 'c_note', label: 'مقدار سفته / e-note', step: '0.01' },
    { key: 'c_cheque', label: 'مقدار چک', step: '0.01' },
    { key: 'a', label: 'پارامتر a', step: '0.01' },
    { key: 'f', label: 'پارامتر f', step: '0.01' },
    { key: 'k', label: 'پارامتر k', step: '0.001' },
  ],
  bnpl: [
    { key: 'w_a', label: 'وزن مبلغ (W_A)', step: '1' },
    { key: 'cap', label: 'سقف مبلغ Cap (ریال)', step: '1', big: true },
  ],
}

const TABS = [
  { key: 'loan', label: 'وام' },
  { key: 'bnpl', label: 'BNPL' },
]

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
// input عددی در RTL مقادیر اعشاری/بلند را کلیپ می‌کند؛ با چپ‌چین و dir=ltr کامل نمایش داده می‌شود
const numInputClass = `${inputClass} text-left`

function formatWhen(value) {
  try {
    return new Date(value.replace(' ', 'T') + 'Z').toLocaleString('fa-IR')
  } catch {
    return value
  }
}

// نمایش بصری فرمول
function FormulaBox({ tab }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50/50 px-5 py-4 text-center" dir="ltr">
      {tab === 'loan' ? (
        <div className="space-y-1 font-mono text-sm text-brand-800">
          <div className="text-base font-bold">CEI = W_A·A + W_C·C + W_I·I(n)</div>
          <div className="text-xs text-brand-600">A = min(1, Amount / Cap)</div>
          <div className="text-xs text-brand-600">
            I(n) = n≤3 → 1−a·(n−1) &nbsp;|&nbsp; n&gt;3 → max(f, f+(1−2a−f)·e^(−k·(n−3)))
          </div>
        </div>
      ) : (
        <div className="space-y-1 font-mono text-sm text-brand-800">
          <div className="text-base font-bold">CEI = W_A·A</div>
          <div className="text-xs text-brand-600">A = min(1, Amount / Cap)</div>
        </div>
      )}
    </div>
  )
}

export default function CeiSettings() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('loan')
  const [params, setParams] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')

  // بخش تست فرمول
  const [testId, setTestId] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')

  const load = () => {
    setLoading(true)
    fetchCeiFormulas()
      .then((d) => {
        setData(d)
        setParams({ ...(d[tab]?.active?.params ?? {}) })
      })
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت فرمول‌های CEI')
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // با تغییر تب، پارامترهای همان تب بارگذاری می‌شوند
  const switchTab = (t) => {
    setTab(t)
    setParams({ ...(data[t]?.active?.params ?? {}) })
    setError('')
    setTestResult(null)
    setTestError('')
    setTestId('')
  }

  const fields = FIELD_DEFS[tab]
  const active = data?.[tab]?.active
  const versions = data?.[tab]?.versions ?? []

  const weightSum = useMemo(() => {
    if (tab !== 'loan') return null
    return Number(params.w_a || 0) + Number(params.w_c || 0) + Number(params.w_i || 0)
  }, [params, tab])

  const validate = () => {
    for (const fld of fields) {
      const v = Number(params[fld.key])
      if (Number.isNaN(v) || v < 0) {
        setError(`مقدار «${fld.label}» نامعتبر است.`)
        return false
      }
    }
    if (tab === 'loan' && Math.round(weightSum * 100) / 100 !== 60) {
      setError('مجموع وزن‌های W_A + W_C + W_I باید برابر ۶۰ باشد.')
      return false
    }
    setError('')
    return true
  }

  const onSaveClick = () => {
    if (validate()) setConfirmOpen(true)
  }

  const onConfirm = async () => {
    setSaving(true)
    try {
      await updateCeiFormula(tab, normalizeParams(params), currentUser.name)
      toast.success('نسخه جدید فرمول CEI ذخیره شد.')
      setConfirmOpen(false)
      load()
    } catch (e) {
      console.error(e)
      toast.error(e?.response?.data?.error ?? 'خطا در ذخیره فرمول')
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!testId.trim()) {
      setTestError('شناسه اعتبار را وارد کنید.')
      return
    }
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      const res = await testCeiFormula(tab, testId.trim())
      setTestResult(res)
    } catch (e) {
      setTestError(e?.response?.data?.error ?? 'خطا در محاسبه پیش‌نمایش')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">در حال بارگذاری…</div>
  }

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-lg font-bold text-slate-800">شاخص سختی وصول (CEI)</h3>
        <p className="mt-1 text-sm text-slate-400">
          پارامترهای فرمول CEI برای هر نوع اعتبار. با هر ذخیره، نسخه جدیدی از فرمول ساخته می‌شود.
        </p>
      </div>

      {/* تب‌ها */}
      <div className="mb-5 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={[
              'relative px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'text-brand-700 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-600'
                : 'text-slate-400 hover:text-slate-600',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* نسخه فعلی + فرمول بصری */}
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          نسخه فعلی: نسخه {toFaDigits(active?.version ?? 1)}
        </span>
      </div>
      <FormulaBox tab={tab} />

      {/* پارامترها */}
      <div className="mt-5 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel sm:grid-cols-2">
        {fields.map((fld) => (
          <div key={fld.key} className={fld.big ? 'sm:col-span-2 lg:col-span-1' : ''}>
            <label className="mb-1 block text-xs font-medium text-slate-500">{fld.label}</label>
            <input
              type="number"
              step={fld.step}
              dir="ltr"
              className={numInputClass}
              value={params[fld.key] ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, [fld.key]: e.target.value }))}
            />
            {fld.big && params[fld.key] && (
              <p className="mt-1 text-[11px] text-slate-400">
                {formatRial(params[fld.key])} ریال
              </p>
            )}
          </div>
        ))}
      </div>

      {/* اندیکاتور مجموع وزن‌ها (فقط وام) */}
      {tab === 'loan' && (
        <div
          className={[
            'mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium',
            Math.round(weightSum * 100) / 100 === 60
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-600',
          ].join(' ')}
        >
          مجموع وزن‌ها: {toFaDigits(weightSum)} / ۶۰
          {Math.round(weightSum * 100) / 100 === 60 ? ' ✓' : ' (باید برابر ۶۰ باشد)'}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onSaveClick}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Save className="h-4 w-4" />
          ذخیره و ساخت نسخه جدید
        </button>
      </div>

      {/* بخش تست فرمول */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
          <FlaskConical className="h-4 w-4 text-brand-500" />
          تست فرمول (پیش‌نمایش — بدون اعمال تغییر)
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">شناسه اعتبار</label>
            <input
              className={inputClass}
              placeholder="مثال: CR-1001"
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-60"
          >
            {testing ? 'در حال محاسبه…' : 'محاسبه پیش‌نمایش'}
          </button>
        </div>

        {testError && <p className="mt-2 text-sm text-rose-500">{testError}</p>}

        {testResult && (
          <div className="mt-4 rounded-xl bg-brand-50/60 p-4">
            <div className="text-sm text-slate-500">
              CEI پیش‌نمایش برای{' '}
              <span className="font-medium text-slate-700">{testResult.credit_id}</span> (نسخه{' '}
              {toFaDigits(testResult.version)}):
            </div>
            <div className="mt-1 text-2xl font-bold text-brand-700">{toFaDigits(testResult.cei)}</div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>مبلغ: {formatRial(testResult.breakdown.amount)}</span>
              <span>A = {toFaDigits(testResult.breakdown.A)}</span>
              {testResult.breakdown.C !== undefined && (
                <span>C = {toFaDigits(testResult.breakdown.C)}</span>
              )}
              {testResult.breakdown.I !== undefined && (
                <span>
                  I({toFaDigits(testResult.breakdown.n)}) = {toFaDigits(testResult.breakdown.I)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* تاریخچه نسخه‌ها */}
      <div className="mt-6">
        <h4 className="mb-3 flex items-center gap-1 border-r-2 border-brand-500 pr-2 text-sm font-bold text-slate-700">
          <HistoryIcon className="h-4 w-4" />
          تاریخچه نسخه‌های فرمول
        </h4>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">نسخه</th>
                <th className="px-4 py-3 font-medium">تاریخ فعال‌شدن</th>
                <th className="px-4 py-3 font-medium">کاربر</th>
                <th className="px-4 py-3 font-medium">تغییرات</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-700">نسخه {toFaDigits(v.version)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(v.created_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{v.user_name || 'ادمین'}</td>
                  <td className="px-4 py-3 text-slate-600">{v.change_note || '—'}</td>
                  <td className="px-4 py-3">
                    {v.is_active ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        فعال
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                        غیرفعال
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* مدال تأیید */}
      <Modal
        open={confirmOpen}
        onClose={() => !saving && setConfirmOpen(false)}
        title="تأیید ساخت نسخه جدید"
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
              {saving ? 'در حال ذخیره…' : 'تأیید و ساخت نسخه'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          با ذخیره، نسخه جدید فرمول <span className="font-medium">{TABS.find((t) => t.key === tab)?.label}</span> ساخته و
          نسخه فعلی غیرفعال می‌شود.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          این تغییر روی پرونده‌های جاری اثری ندارد و فقط روی پرونده‌های جدید یا محاسبات بعدی CEI اعمال می‌شود.
        </p>
      </Modal>
    </div>
  )
}

// تبدیل مقادیر رشته‌ای فرم به عدد قبل از ارسال
function normalizeParams(params) {
  const out = {}
  for (const [k, v] of Object.entries(params)) out[k] = Number(v)
  return out
}
