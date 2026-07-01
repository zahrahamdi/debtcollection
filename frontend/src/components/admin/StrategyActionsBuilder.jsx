import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, MessageSquare, Phone, PhoneCall, ChevronDown, Check } from 'lucide-react'
import { ACTION_TYPE, actionTypeLabel } from '../../utils/constants'
import { toFaDigits } from '../../utils/format'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'
const numClass = `${inputClass} text-left`

const ACTION_OPTIONS = [
  'warning_sms',
  'threatening_sms',
  'warning_autocall',
  'threatening_autocall',
  'negotiator_call',
]
const SMS_TYPES = ['warning_sms', 'threatening_sms']
const AUTOCALL_TYPES = ['warning_autocall', 'threatening_autocall']

const REPEAT_RESULTS_BY_TYPE = {
  warning_sms: ['ارسال شد', 'ارسال نشد'],
  threatening_sms: ['ارسال شد', 'ارسال نشد'],
  warning_autocall: ['پاسخگو بود', 'پاسخگو نبود', 'اشغال بود'],
  threatening_autocall: ['پاسخگو بود', 'پاسخگو نبود', 'اشغال بود'],
  negotiator_call: ['پاسخگو بود', 'پاسخگو نبود', 'ناسزا گفت'],
}

export function normalizeStrategyAction(a) {
  let repeat_on_results = a.repeat_on_results
  if (typeof repeat_on_results === 'string') {
    try {
      repeat_on_results = JSON.parse(repeat_on_results)
    } catch {
      repeat_on_results = []
    }
  }
  if (!Array.isArray(repeat_on_results)) repeat_on_results = []
  return { ...a, repeat_on_results }
}

const PLACEHOLDERS = ['نام_کاربر', 'مبلغ_مطالبات', 'لینک_پرداخت']

const iconFor = (type) => {
  if (SMS_TYPES.includes(type)) return MessageSquare
  if (AUTOCALL_TYPES.includes(type)) return Phone
  return PhoneCall
}

const newAction = () => ({
  action_type: 'warning_sms',
  body_text: '',
  allowed_from: '09:00',
  allowed_to: '18:00',
  wait_next_minutes: 1440,
  wait_repeat_minutes: 60,
  max_repeat: 3,
  repeat_on_results: [],
  cost: 0,
  avg_call_duration: '',
})

function RepeatResultsMultiSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = value || []

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = (opt) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((x) => x !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  const summary =
    selected.length === 0
      ? 'انتخاب کنید…'
      : selected.length <= 2
        ? selected.join('، ')
        : `${selected.length} نتیجه انتخاب شده`

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-right`}
      >
        <span className={`truncate ${selected.length === 0 ? 'text-slate-400' : ''}`}>{summary}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <ul className="max-h-48 overflow-y-auto py-1">
            {options.map((opt) => {
              const checked = selected.includes(opt)
              return (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => toggle(opt)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-right text-sm transition-colors hover:bg-brand-50/80 ${
                      checked ? 'bg-brand-50/50 text-brand-800' : 'text-slate-700'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">{opt}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-slate-500 hover:text-rose-600"
              >
                پاک کردن همه
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function StrategyActionsBuilder({ actions, onChange }) {
  const update = (i, patch) => onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  const remove = (i) => onChange(actions.filter((_, idx) => idx !== i))
  const add = () => onChange([...actions, newAction()])
  const insertPlaceholder = (i, token) =>
    update(i, { body_text: `${actions[i].body_text || ''}{${token}}` })

  return (
    <div>
      <div className="mb-2">
        <span className="text-xs font-medium text-slate-500">اقدام‌های استراتژی (به ترتیب اجرا)</span>
      </div>

      {actions.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
          هنوز اقدامی اضافه نشده است.
        </p>
      )}

      <div className="space-y-3">
        {actions.map((a, i) => {
          const Icon = iconFor(a.action_type)
          const isSms = SMS_TYPES.includes(a.action_type)
          const isAuto = AUTOCALL_TYPES.includes(a.action_type)
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-slate-600">اقدام {toFaDigits(i + 1)}</span>
                <select
                  className={`${inputClass} mr-2 flex-1`}
                  value={a.action_type}
                  onChange={(e) => update(i, { action_type: e.target.value, repeat_on_results: [] })}
                >
                  {ACTION_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {actionTypeLabel(k)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="حذف اقدام"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* متن پیامک / محتوای تماس */}
              {(isSms || isAuto) && (
                <div className="mb-3">
                  <label className={labelClass}>{isSms ? 'متن پیامک' : 'محتوای تماس خودکار'}</label>
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={a.body_text || ''}
                    onChange={(e) => update(i, { body_text: e.target.value })}
                    placeholder={isSms ? 'متن پیامک…' : 'محتوای تماس…'}
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {PLACEHOLDERS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => insertPlaceholder(i, p)}
                          className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 hover:bg-brand-100"
                        >
                          {`{${p}}`}
                        </button>
                      ))}
                    </div>
                    {isSms && (
                      <span className="text-[11px] text-slate-400">
                        {toFaDigits((a.body_text || '').length)} کاراکتر
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* بازه زمانی مجاز + فاصله قبل از اقدام بعدی */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>از ساعت</label>
                  <input
                    type="time"
                    dir="ltr"
                    className={numClass}
                    value={a.allowed_from || ''}
                    onChange={(e) => update(i, { allowed_from: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>تا ساعت</label>
                  <input
                    type="time"
                    dir="ltr"
                    className={numClass}
                    value={a.allowed_to || ''}
                    onChange={(e) => update(i, { allowed_to: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>فاصله قبل از اقدام بعدی (دقیقه)</label>
                  <input
                    type="number"
                    dir="ltr"
                    min="0"
                    className={numClass}
                    value={a.wait_next_minutes ?? a.wait_minutes ?? a.wait_days ?? 0}
                    onChange={(e) => update(i, { wait_next_minutes: e.target.value })}
                  />
                </div>
              </div>

              {/* حداکثر تکرار + فاصله بین تکرار (برای همه انواع اقدام) */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>حداکثر تعداد تکرار</label>
                  <input
                    type="number"
                    dir="ltr"
                    min="1"
                    className={numClass}
                    value={a.max_repeat ?? 3}
                    onChange={(e) => update(i, { max_repeat: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>فاصله بین تکرار همان اقدام (دقیقه)</label>
                  <input
                    type="number"
                    dir="ltr"
                    min="0"
                    className={numClass}
                    value={a.wait_repeat_minutes ?? 60}
                    onChange={(e) => update(i, { wait_repeat_minutes: e.target.value })}
                  />
                </div>
              </div>

              <div className="mt-2">
                <label className={labelClass}>در صورت این نتایج، اقدام تکرار شود</label>
                <RepeatResultsMultiSelect
                  options={REPEAT_RESULTS_BY_TYPE[a.action_type] || []}
                  value={a.repeat_on_results || []}
                  onChange={(selected) => update(i, { repeat_on_results: selected })}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  چند نتیجه را از لیست انتخاب کنید. اگر هیچ‌کدام انتخاب نشود، پس از هر نتیجه مستقیم
                  به اقدام بعدی می‌رود.
                </p>
              </div>

              {/* فیلدهای اختصاصی */}
              {(isSms || isAuto) && (
                <div className="mt-2">
                  <label className={labelClass}>هزینه هر {isSms ? 'پیامک' : 'تماس'} (ریال)</label>
                  <input
                    type="number"
                    dir="ltr"
                    min="0"
                    className={numClass}
                    value={a.cost}
                    onChange={(e) => update(i, { cost: e.target.value })}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
      >
        <Plus className="h-3.5 w-3.5" />
        افزودن اقدام
      </button>
    </div>
  )
}
