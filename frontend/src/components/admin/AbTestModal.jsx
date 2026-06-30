import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../modal/Modal'
import StrategyActionsBuilder from './StrategyActionsBuilder'
import { createAbTest } from '../../api/abTests'
import { toFaDigits } from '../../utils/format'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'

const emptyForm = () => ({
  name: '',
  credit_type: 'loan',
  segment_id: '',
  title_a: '',
  actions_a: [],
  ratio_a: 50,
  title_b: '',
  actions_b: [],
  ratio_b: 50,
})

export default function AbTestModal({ open, onClose, segments, strategies, onSaved }) {
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // سگمنت‌های خالی (بدون استراتژی) — سناریو فقط روی این‌ها قابل تعریف است
  const occupied = useMemo(() => new Set(strategies.map((s) => s.segment_id)), [strategies])
  const segmentOptions = (segments[form.credit_type] ?? []).filter((seg) => !occupied.has(seg.id))

  const ratioSum = Number(form.ratio_a || 0) + Number(form.ratio_b || 0)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const reset = () => {
    setForm(emptyForm())
    setError('')
  }
  const close = () => {
    if (saving) return
    reset()
    onClose()
  }

  const save = async () => {
    if (!form.name.trim()) return setError('نام سناریو اجباری است.')
    if (!form.segment_id) return setError('انتخاب سگمنت اجباری است.')
    if (!form.title_a.trim() || !form.title_b.trim())
      return setError('عنوان هر دو استراتژی اجباری است.')
    if (ratioSum !== 100) return setError('مجموع نرخ توزیع باید ۱۰۰٪ باشد.')

    setSaving(true)
    setError('')
    try {
      await createAbTest({
        name: form.name.trim(),
        credit_type: form.credit_type,
        segment_id: Number(form.segment_id),
        strategy_a: { title: form.title_a.trim(), actions: form.actions_a },
        ratio_a: Number(form.ratio_a),
        strategy_b: { title: form.title_b.trim(), actions: form.actions_b },
        ratio_b: Number(form.ratio_b),
      })
      toast.success('سناریوی A/B Test و دو استراتژی آن ایجاد شد.')
      reset()
      onSaved()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error ?? 'خطا در ایجاد سناریو')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="ایجاد سناریو A/B Test"
      maxWidth="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={close}
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
            {saving ? 'در حال ذخیره…' : 'ذخیره سناریو'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass}>نام سناریو</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="مثال: مقایسه‌ی استراتژی متوسط"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>نوع اعتبار</label>
            <select
              className={inputClass}
              value={form.credit_type}
              onChange={(e) => set({ credit_type: e.target.value, segment_id: '' })}
            >
              <option value="loan">وام</option>
              <option value="bnpl">BNPL</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>سگمنت (بدون استراتژی)</label>
            <select
              className={inputClass}
              value={form.segment_id}
              onChange={(e) => set({ segment_id: e.target.value })}
            >
              <option value="">انتخاب سگمنت</option>
              {segmentOptions.map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.title}
                </option>
              ))}
            </select>
            {segmentOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                سگمنت خالی برای این نوع اعتبار وجود ندارد.
              </p>
            )}
          </div>
        </div>

        {/* استراتژی اول */}
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">استراتژی اول</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">نرخ توزیع (٪)</span>
              <input
                type="number"
                dir="ltr"
                min="0"
                max="100"
                className={`${inputClass} w-20 text-left`}
                value={form.ratio_a}
                onChange={(e) => set({ ratio_a: e.target.value })}
              />
            </div>
          </div>
          <label className={labelClass}>عنوان استراتژی</label>
          <input
            className={`${inputClass} mb-3`}
            value={form.title_a}
            onChange={(e) => set({ title_a: e.target.value })}
            placeholder="عنوان استراتژی اول"
          />
          <StrategyActionsBuilder actions={form.actions_a} onChange={(a) => set({ actions_a: a })} />
        </div>

        {/* استراتژی دوم */}
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">استراتژی دوم</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">نرخ توزیع (٪)</span>
              <input
                type="number"
                dir="ltr"
                min="0"
                max="100"
                className={`${inputClass} w-20 text-left`}
                value={form.ratio_b}
                onChange={(e) => set({ ratio_b: e.target.value })}
              />
            </div>
          </div>
          <label className={labelClass}>عنوان استراتژی</label>
          <input
            className={`${inputClass} mb-3`}
            value={form.title_b}
            onChange={(e) => set({ title_b: e.target.value })}
            placeholder="عنوان استراتژی دوم"
          />
          <StrategyActionsBuilder actions={form.actions_b} onChange={(a) => set({ actions_b: a })} />
        </div>

        {/* اندیکاتور مجموع نرخ */}
        <div
          className={[
            'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium',
            ratioSum === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
          ].join(' ')}
        >
          مجموع نرخ توزیع: {toFaDigits(ratioSum)}٪ / ۱۰۰٪
          {ratioSum === 100 ? ' ✓' : ' (باید ۱۰۰ باشد)'}
        </div>

        {error && <p className="text-sm text-rose-500">{error}</p>}
      </div>
    </Modal>
  )
}
