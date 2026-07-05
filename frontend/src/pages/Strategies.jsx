import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, GitBranch } from 'lucide-react'
import {
  fetchStrategies,
  fetchStrategyById,
  createStrategy,
  updateStrategy,
  deleteStrategy,
} from '../api/strategies'
import { fetchSegments } from '../api/segments'
import StrategyActionsBuilder, { normalizeStrategyAction } from '../components/admin/StrategyActionsBuilder'
import AbTestModal from '../components/admin/AbTestModal'
import { getCurrentUser, getUserDisplayName, isAdmin } from '../utils/auth'
import { toFaDigits, orDash } from '../utils/format'
import { creditTypeLabel } from '../utils/constants'
import Modal from '../components/modal/Modal'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400'

function formatWhen(value) {
  if (!value) return '—'
  try {
    return new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('fa-IR')
  } catch {
    return value
  }
}

const emptyForm = { title: '', credit_type: 'loan', segment_id: '', actions: [] }

export default function Strategies() {
  const [rows, setRows] = useState([])
  const [segments, setSegments] = useState({ loan: [], bnpl: [] })
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ title: '', credit_type: '' })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [abModalOpen, setAbModalOpen] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([fetchStrategies(), fetchSegments()])
      .then(([s, seg]) => {
        setRows(s)
        setSegments(seg)
      })
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت استراتژی‌ها')
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = async (s) => {
    setEditing(s)
    setForm({
      title: s.title,
      credit_type: s.credit_type,
      segment_id: String(s.segment_id ?? ''),
      actions: [],
    })
    setFormError('')
    setModalOpen(true)
    try {
      const detail = await fetchStrategyById(s.id)
      setForm((f) => ({
        ...f,
        actions: (detail?.actions ?? []).map(normalizeStrategyAction),
      }))
    } catch (e) {
      console.error(e)
    }
  }

  // با تغییر نوع اعتبار، سگمنت انتخابی ریست می‌شود
  const onCreditTypeChange = (ct) => setForm((f) => ({ ...f, credit_type: ct, segment_id: '' }))

  // سگمنت‌هایی که قبلاً استراتژی دارند (قانون: هر سگمنت حداکثر یک استراتژی مستقل)
  const occupiedSegmentIds = new Set(rows.map((r) => r.segment_id))
  // در حالت ایجاد فقط سگمنت‌های خالی؛ در حالت ویرایش سگمنت قفل است پس کامل نمایش داده می‌شود
  const segmentOptions = (segments[form.credit_type] ?? []).filter(
    (seg) => editing || !occupiedSegmentIds.has(seg.id)
  )

  // فیلتر سمت کلاینت: عنوان استراتژی + نوع اعتبار
  const filtered = rows.filter(
    (r) =>
      (filters.title ? String(r.title ?? '').includes(filters.title.trim()) : true) &&
      (filters.credit_type ? r.credit_type === filters.credit_type : true)
  )

  const save = async () => {
    if (!form.title.trim()) return setFormError('عنوان استراتژی اجباری است.')
    if (!form.segment_id) return setFormError('انتخاب سگمنت اجباری است.')
    setSaving(true)
    setFormError('')
    const payload = {
      title: form.title.trim(),
      credit_type: form.credit_type,
      segment_id: Number(form.segment_id),
      created_by: getUserDisplayName(getCurrentUser()),
      actions: form.actions,
    }
    try {
      if (editing) await updateStrategy(editing.id, payload)
      else await createStrategy(payload)
      toast.success(editing ? 'استراتژی ویرایش شد.' : 'استراتژی ایجاد شد.')
      setModalOpen(false)
      load()
    } catch (e) {
      setFormError(e?.response?.data?.error ?? 'خطا در ذخیره استراتژی')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    try {
      await deleteStrategy(deleteTarget.id)
      toast.success('استراتژی حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا در حذف استراتژی')
      setDeleteTarget(null)
    }
  }

  const columns = [
    'عنوان استراتژی',
    'سگمنت',
    'نوع اعتبار',
    'تعداد پرونده فعال',
    'نرخ موفقیت',
    'سناریو A/B Test',
    'نرخ توزیع',
    'ایجادکننده',
    'تاریخ ایجاد',
    'آخرین به‌روزرسانی',
    'عملیات',
  ]

  const formatSuccessRate = (rate) =>
    rate == null || rate === '' ? '—' : `${toFaDigits(Number(rate).toFixed(1))}٪`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">استراتژی‌ها</h2>
          <p className="mt-1 text-sm text-slate-400">مجموع: {toFaDigits(filtered.length)} استراتژی</p>
        </div>
        {isAdmin() && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" />
              ایجاد استراتژی
            </button>
            <button
              type="button"
              onClick={() => setAbModalOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <GitBranch className="h-4 w-4" />
              ایجاد سناریو A/B Test
            </button>
          </div>
        )}
      </div>

      {/* فیلترها */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className={inputClass}
            placeholder="عنوان استراتژی"
            value={filters.title}
            onChange={(e) => setFilters((f) => ({ ...f, title: e.target.value }))}
          />
          <select
            className={inputClass}
            value={filters.credit_type}
            onChange={(e) => setFilters((f) => ({ ...f, credit_type: e.target.value }))}
          >
            <option value="">همه انواع اعتبار</option>
            <option value="loan">وام</option>
            <option value="bnpl">BNPL</option>
          </select>
        </div>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel">
        <table className="w-full min-w-[1000px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-4 py-3 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  استراتژی‌ای یافت نشد.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{s.title}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{orDash(s.segment_title)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{creditTypeLabel(s.credit_type)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{toFaDigits(s.active_cases_count)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatSuccessRate(s.success_rate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{orDash(s.ab_name)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {s.ab_ratio != null ? `${toFaDigits(s.ab_ratio)}٪` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{orDash(s.created_by)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatWhen(s.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatWhen(s.updated_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
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
              ))}
          </tbody>
        </table>
      </div>

      {/* مدال ایجاد/ویرایش */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'ویرایش استراتژی' : 'ایجاد استراتژی'}
        maxWidth="max-w-2xl"
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
          {editing && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              در حالت ویرایش، عنوان، نوع اعتبار و سگمنت قابل تغییر نیستند؛ فقط اقدام‌ها را می‌توانید ویرایش کنید.
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">عنوان استراتژی</label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="مثال: استراتژی سبک وام"
              disabled={Boolean(editing)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">نوع اعتبار</label>
            <select
              className={inputClass}
              value={form.credit_type}
              onChange={(e) => onCreditTypeChange(e.target.value)}
              disabled={Boolean(editing)}
            >
              <option value="loan">وام</option>
              <option value="bnpl">BNPL</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">سگمنت</label>
            <select
              className={inputClass}
              value={form.segment_id}
              onChange={(e) => setForm((f) => ({ ...f, segment_id: e.target.value }))}
              disabled={Boolean(editing)}
            >
              <option value="">انتخاب سگمنت</option>
              {segmentOptions.map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.title}
                </option>
              ))}
            </select>
            {!editing && segmentOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {(segments[form.credit_type] ?? []).length === 0
                  ? 'برای این نوع اعتبار هنوز سگمنتی تعریف نشده است.'
                  : 'همه‌ی سگمنت‌های این نوع اعتبار قبلاً استراتژی دارند. برای دو استراتژی از سناریوی A/B Test استفاده کنید.'}
              </p>
            )}
          </div>

          {/* بیلدر اقدام‌ها */}
          <div className="border-t border-slate-100 pt-4">
            <StrategyActionsBuilder
              actions={form.actions}
              onChange={(actions) => setForm((f) => ({ ...f, actions }))}
            />
          </div>

          {formError && <p className="text-sm text-rose-500">{formError}</p>}
        </div>
      </Modal>

      {/* مدال سناریو A/B Test */}
      <AbTestModal
        open={abModalOpen}
        onClose={() => setAbModalOpen(false)}
        strategies={rows}
        onSaved={load}
      />

      {/* مدال تأیید حذف */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="حذف استراتژی"
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
          آیا از حذف استراتژی «{deleteTarget?.title}» مطمئن هستید؟ استراتژی دارای پرونده باز قابل حذف نیست.
        </p>
      </Modal>
    </div>
  )
}
