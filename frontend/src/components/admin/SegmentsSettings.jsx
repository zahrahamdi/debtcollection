import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  fetchSegments,
  createSegment,
  updateSegment,
  deleteSegment,
} from '../../api/segments'
import { toFaDigits } from '../../utils/format'
import Modal from '../modal/Modal'

const TABS = [
  { key: 'loan', label: 'وام' },
  { key: 'bnpl', label: 'BNPL' },
]

// انواع شرط شاخص سختی وصول (Story 11.3) — با کلمات فارسی تا در RTL به‌هم نریزد
const CONDITIONS = [
  { key: 'between', label: 'بین X و Y (بزرگ‌تر از X و کوچک‌تر مساوی Y)' },
  { key: 'lt', label: 'کوچک‌تر از X' },
  { key: 'lte', label: 'کوچک‌تر مساوی X' },
  { key: 'gt', label: 'بزرگ‌تر از X' },
  { key: 'gte', label: 'بزرگ‌تر مساوی X' },
]

const BAR_COLORS = ['bg-emerald-400', 'bg-amber-400', 'bg-rose-400', 'bg-sky-400', 'bg-brand-400', 'bg-teal-400']

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

// نمایش متنی شرط با کلمات فارسی (بدون لاتین/علامت تا در RTL به‌هم نریزد)
function conditionText(s) {
  const x = toFaDigits(s.cei_x)
  const y = toFaDigits(s.cei_y)
  switch (s.condition_type) {
    case 'between':
      return `بزرگ‌تر از ${x} و کوچک‌تر مساوی ${y}`
    case 'lt':
      return `کوچک‌تر از ${x}`
    case 'lte':
      return `کوچک‌تر مساوی ${x}`
    case 'gt':
      return `بزرگ‌تر از ${x}`
    case 'gte':
      return `بزرگ‌تر مساوی ${x}`
    default:
      return '—'
  }
}

// بازه مؤثر روی محور ۰ تا ۱۰۰ (برای نمودار)
function interval(s) {
  const x = Number(s.cei_x)
  const y = Number(s.cei_y)
  switch (s.condition_type) {
    case 'between':
      return [x, y]
    case 'lt':
    case 'lte':
      return [0, x]
    case 'gt':
    case 'gte':
      return [x, 100]
    default:
      return [0, 100]
  }
}

// نمودار بصری بازه‌ها روی خط ۰ تا ۱۰۰
function SegmentBar({ segments }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
      <div className="relative h-9 w-full rounded-lg bg-slate-100" dir="ltr">
        {segments.map((s, i) => {
          const [min, max] = interval(s)
          const left = Math.max(0, Math.min(100, min))
          const width = Math.max(0, Math.min(100, max) - left)
          return (
            <div
              key={s.id}
              className={`absolute top-0 flex h-full items-center justify-center overflow-hidden text-[11px] font-medium text-white ${BAR_COLORS[i % BAR_COLORS.length]}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${s.title}: ${conditionText(s)}`}
            >
              {s.title}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400" dir="ltr">
        <span>۰</span>
        <span>۲۵</span>
        <span>۵۰</span>
        <span>۷۵</span>
        <span>۱۰۰</span>
      </div>
      {segments.length === 0 && (
        <p className="mt-2 text-center text-xs text-slate-400">سگمنتی تعریف نشده است.</p>
      )}
    </div>
  )
}

const emptyForm = { title: '', condition_type: 'between', cei_x: '', cei_y: '' }

export default function SegmentsSettings() {
  const [data, setData] = useState({ loan: [], bnpl: [] })
  const [tab, setTab] = useState('loan')
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = () => {
    setLoading(true)
    fetchSegments()
      .then(setData)
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت سگمنت‌ها')
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const segments = data[tab] ?? []

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (s) => {
    setEditing(s)
    setForm({
      title: s.title,
      condition_type: s.condition_type,
      cei_x: s.cei_x ?? '',
      cei_y: s.cei_y ?? '',
    })
    setFormError('')
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.title.trim()) {
      setFormError('عنوان سگمنت اجباری است.')
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      title: form.title.trim(),
      credit_type: tab,
      condition_type: form.condition_type,
      cei_x: Number(form.cei_x),
      cei_y: form.condition_type === 'between' ? Number(form.cei_y) : null,
    }
    try {
      if (editing) await updateSegment(editing.id, payload)
      else await createSegment(payload)
      toast.success(editing ? 'سگمنت ویرایش شد.' : 'سگمنت ایجاد شد.')
      setModalOpen(false)
      load()
    } catch (e) {
      setFormError(e?.response?.data?.error ?? 'خطا در ذخیره سگمنت')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    try {
      await deleteSegment(deleteTarget.id)
      toast.success('سگمنت حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا در حذف سگمنت')
      setDeleteTarget(null)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">در حال بارگذاری…</div>
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800">تعریف سگمنت‌ها</h3>
          <p className="mt-1 text-sm text-slate-400">
            سگمنت‌ها بر اساس شرط CEI تعریف می‌شوند و نباید همپوشانی داشته باشند.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          افزودن سگمنت
        </button>
      </div>

      {/* تب‌ها */}
      <div className="mb-5 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
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

      {/* نمودار بصری */}
      <SegmentBar segments={segments} />

      {/* جدول سگمنت‌ها */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">عنوان سگمنت</th>
              <th className="px-4 py-3 font-medium">شرط CEI</th>
              <th className="px-4 py-3 font-medium">تعداد پرونده فعال</th>
              <th className="px-4 py-3 font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {segments.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  سگمنتی تعریف نشده است.
                </td>
              </tr>
            ) : (
              segments.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.title}</td>
                  <td className="px-4 py-3 text-slate-600">{conditionText(s)}</td>
                  <td className="px-4 py-3 text-slate-600">{toFaDigits(s.active_cases_count)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                        title="ویرایش"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(s)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* مدال ایجاد/ویرایش */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'ویرایش سگمنت' : 'افزودن سگمنت'}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">عنوان سگمنت</label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="مثال: سبک"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">شرط CEI</label>
            <select
              className={inputClass}
              value={form.condition_type}
              onChange={(e) => setForm((f) => ({ ...f, condition_type: e.target.value }))}
            >
              {CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                مقدار {form.condition_type === 'between' ? 'X' : ''}
              </label>
              <input
                type="number"
                dir="ltr"
                className={`${inputClass} text-left`}
                value={form.cei_x}
                onChange={(e) => setForm((f) => ({ ...f, cei_x: e.target.value }))}
                placeholder="۰ تا ۱۰۰"
              />
            </div>
            {form.condition_type === 'between' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">مقدار Y</label>
                <input
                  type="number"
                  dir="ltr"
                  className={`${inputClass} text-left`}
                  value={form.cei_y}
                  onChange={(e) => setForm((f) => ({ ...f, cei_y: e.target.value }))}
                  placeholder="۰ تا ۱۰۰"
                />
              </div>
            )}
          </div>

          {formError && <p className="text-sm text-rose-500">{formError}</p>}
        </div>
      </Modal>

      {/* مدال تأیید حذف */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="حذف سگمنت"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={doDelete}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              حذف
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          آیا از حذف سگمنت «{deleteTarget?.title}» مطمئن هستید؟ سگمنتی که پرونده فعال دارد قابل حذف نیست.
        </p>
      </Modal>
    </div>
  )
}
