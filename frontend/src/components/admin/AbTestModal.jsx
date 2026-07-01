import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../modal/Modal'
import StrategyActionsBuilder from './StrategyActionsBuilder'
import { createAbTest } from '../../api/abTests'
import { fetchSegments } from '../../api/segments'
import { toFaDigits } from '../../utils/format'
import { creditTypeLabel } from '../../utils/constants'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'

const emptyForm = () => ({
  name: '',
  credit_type: 'loan',
  segment_id: '',
  strategy_a_mode: 'new',
  strategy_a_id: '',
  title_a: '',
  actions_a: [],
  ratio_a: 50,
  strategy_b_mode: 'existing',
  strategy_b_id: '',
  title_b: '',
  actions_b: [],
  ratio_b: 50,
})

function StrategySection({
  label,
  mode,
  onModeChange,
  strategyId,
  onStrategyIdChange,
  title,
  onTitleChange,
  actions,
  onActionsChange,
  ratio,
  onRatioChange,
  strategyOptions,
  segmentSelected,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-bold text-slate-700">{label}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">نرخ توزیع (٪)</span>
          <input
            type="number"
            dir="ltr"
            min="0"
            max="100"
            className={`${inputClass} w-20 text-left`}
            value={ratio}
            onChange={(e) => onRatioChange(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-sm text-slate-600">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`${label}-mode`}
            checked={mode === 'existing'}
            onChange={() => onModeChange('existing')}
          />
          انتخاب از لیست استراتژی‌های موجود
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`${label}-mode`}
            checked={mode === 'new'}
            onChange={() => onModeChange('new')}
          />
          تعریف استراتژی جدید همینجا
        </label>
      </div>

      {mode === 'existing' ? (
        <div>
          <label className={labelClass}>استراتژی</label>
          <select
            className={inputClass}
            value={strategyId}
            onChange={(e) => onStrategyIdChange(e.target.value)}
            disabled={!segmentSelected}
          >
            <option value="">انتخاب استراتژی</option>
            {strategyOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {segmentSelected && strategyOptions.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              استراتژی‌ای برای این نوع اعتبار و سگمنت یافت نشد.
            </p>
          )}
        </div>
      ) : (
        <>
          <label className={labelClass}>عنوان استراتژی</label>
          <input
            className={`${inputClass} mb-3`}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={`عنوان ${label}`}
          />
          <StrategyActionsBuilder actions={actions} onChange={onActionsChange} />
        </>
      )}
    </div>
  )
}

export default function AbTestModal({ open, onClose, strategies, onSaved }) {
  const [form, setForm] = useState(emptyForm())
  const [segments, setSegments] = useState({ loan: [], bnpl: [] })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    fetchSegments()
      .then(setSegments)
      .catch(() => toast.error('خطا در دریافت سگمنت‌ها'))
  }, [open])

  const segmentOptions = segments[form.credit_type] ?? []

  const strategyOptions = useMemo(() => {
    if (!form.segment_id) return []
    return strategies.filter(
      (s) =>
        s.credit_type === form.credit_type && Number(s.segment_id) === Number(form.segment_id)
    )
  }, [strategies, form.credit_type, form.segment_id])

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

  const validateExistingStrategy = (mode, strategyId, sideLabel) => {
    if (mode !== 'existing') return null
    if (!strategyId) return `${sideLabel}: انتخاب استراتژی از لیست اجباری است`
    const s = strategies.find((row) => Number(row.id) === Number(strategyId))
    if (!s) return `${sideLabel}: استراتژی یافت نشد`
    if (s.credit_type !== form.credit_type) {
      return `${sideLabel}: نوع اعتبار استراتژی با نوع اعتبار انتخاب‌شده هم‌خوانی ندارد`
    }
    if (Number(s.segment_id) !== Number(form.segment_id)) {
      return `${sideLabel}: سگمنت استراتژی با سگمنت انتخاب‌شده هم‌خوانی ندارد`
    }
    return null
  }

  const save = async () => {
    if (!form.name.trim()) return setError('نام سناریو اجباری است.')
    if (!form.segment_id) return setError('انتخاب سگمنت اجباری است.')

    if (form.strategy_a_mode === 'existing' && form.strategy_b_mode === 'existing') {
      return setError('نمی‌توان هر دو استراتژی را از لیست انتخاب کرد. حداقل یکی باید جدید تعریف شود.')
    }

    const errA = validateExistingStrategy(form.strategy_a_mode, form.strategy_a_id, 'استراتژی A')
    if (errA) return setError(errA)
    const errB = validateExistingStrategy(form.strategy_b_mode, form.strategy_b_id, 'استراتژی B')
    if (errB) return setError(errB)

    if (form.strategy_a_mode === 'new' && !form.title_a.trim()) {
      return setError('عنوان استراتژی A اجباری است.')
    }
    if (form.strategy_b_mode === 'new' && !form.title_b.trim()) {
      return setError('عنوان استراتژی B اجباری است.')
    }

    if (
      form.strategy_a_mode === 'existing' &&
      form.strategy_b_mode === 'existing' &&
      form.strategy_a_id === form.strategy_b_id
    ) {
      return setError('دو استراتژی یکسان نمی‌توانند انتخاب شوند.')
    }

    if (ratioSum !== 100) return setError('مجموع نرخ توزیع باید ۱۰۰٪ باشد.')

    setSaving(true)
    setError('')
    try {
      await createAbTest({
        name: form.name.trim(),
        credit_type: form.credit_type,
        segment_id: Number(form.segment_id),
        strategy_a: {
          source: form.strategy_a_mode,
          strategy_id:
            form.strategy_a_mode === 'existing' ? Number(form.strategy_a_id) : undefined,
          title: form.strategy_a_mode === 'new' ? form.title_a.trim() : undefined,
          actions: form.strategy_a_mode === 'new' ? form.actions_a : undefined,
        },
        ratio_a: Number(form.ratio_a),
        strategy_b: {
          source: form.strategy_b_mode,
          strategy_id:
            form.strategy_b_mode === 'existing' ? Number(form.strategy_b_id) : undefined,
          title: form.strategy_b_mode === 'new' ? form.title_b.trim() : undefined,
          actions: form.strategy_b_mode === 'new' ? form.actions_b : undefined,
        },
        ratio_b: Number(form.ratio_b),
      })
      toast.success('سناریوی A/B Test ایجاد شد.')
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
              onChange={(e) =>
                set({
                  credit_type: e.target.value,
                  segment_id: '',
                  strategy_a_id: '',
                  strategy_b_id: '',
                })
              }
            >
              <option value="loan">وام</option>
              <option value="bnpl">BNPL</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>سگمنت</label>
            <select
              className={inputClass}
              value={form.segment_id}
              onChange={(e) =>
                set({ segment_id: e.target.value, strategy_a_id: '', strategy_b_id: '' })
              }
            >
              <option value="">انتخاب سگمنت</option>
              {segmentOptions.map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.title} ({creditTypeLabel(seg.credit_type)})
                </option>
              ))}
            </select>
            {segmentOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                سگمنتی برای {creditTypeLabel(form.credit_type)} یافت نشد.
              </p>
            )}
          </div>
        </div>

        <StrategySection
          label="استراتژی A"
          mode={form.strategy_a_mode}
          onModeChange={(m) => set({ strategy_a_mode: m, strategy_a_id: '' })}
          strategyId={form.strategy_a_id}
          onStrategyIdChange={(v) => set({ strategy_a_id: v })}
          title={form.title_a}
          onTitleChange={(v) => set({ title_a: v })}
          actions={form.actions_a}
          onActionsChange={(a) => set({ actions_a: a })}
          ratio={form.ratio_a}
          onRatioChange={(v) => set({ ratio_a: v })}
          strategyOptions={strategyOptions}
          segmentSelected={Boolean(form.segment_id)}
        />

        <StrategySection
          label="استراتژی B"
          mode={form.strategy_b_mode}
          onModeChange={(m) => set({ strategy_b_mode: m, strategy_b_id: '' })}
          strategyId={form.strategy_b_id}
          onStrategyIdChange={(v) => set({ strategy_b_id: v })}
          title={form.title_b}
          onTitleChange={(v) => set({ title_b: v })}
          actions={form.actions_b}
          onActionsChange={(a) => set({ actions_b: a })}
          ratio={form.ratio_b}
          onRatioChange={(v) => set({ ratio_b: v })}
          strategyOptions={strategyOptions}
          segmentSelected={Boolean(form.segment_id)}
        />

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
