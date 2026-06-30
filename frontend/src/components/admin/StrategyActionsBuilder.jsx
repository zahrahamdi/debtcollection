import { Plus, Trash2, MessageSquare, Phone, PhoneCall } from 'lucide-react'
import { ACTION_TYPE, actionTypeLabel } from '../../utils/constants'
import { toFaDigits } from '../../utils/format'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'
const numClass = `${inputClass} text-left`

const ACTION_OPTIONS = Object.keys(ACTION_TYPE)
const SMS_TYPES = ['warning_sms', 'threatening_sms']
const AUTOCALL_TYPES = ['warning_autocall', 'threatening_autocall']
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
  wait_minutes: 1440,
  cost: 0,
  max_repeat: '',
  avg_call_duration: '',
})

export default function StrategyActionsBuilder({ actions, onChange }) {
  const update = (i, patch) => onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  const remove = (i) => onChange(actions.filter((_, idx) => idx !== i))
  const add = () => onChange([...actions, newAction()])
  const insertPlaceholder = (i, token) =>
    update(i, { body_text: `${actions[i].body_text || ''}{${token}}` })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">اقدام‌های استراتژی (به ترتیب اجرا)</span>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
        >
          <Plus className="h-3.5 w-3.5" />
          افزودن اقدام
        </button>
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
          const isNeg = a.action_type === 'negotiator_call'
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
                  onChange={(e) => update(i, { action_type: e.target.value })}
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

              {/* بازه زمانی مجاز + زمان انتظار */}
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
                  <label className={labelClass}>دقیقه‌های انتظار</label>
                  <input
                    type="number"
                    dir="ltr"
                    min="0"
                    className={numClass}
                    value={a.wait_minutes ?? a.wait_days ?? 0}
                    onChange={(e) => update(i, { wait_minutes: e.target.value })}
                  />
                </div>
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

              {isNeg && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>حداکثر تعداد تکرار</label>
                    <input
                      type="number"
                      dir="ltr"
                      min="1"
                      className={numClass}
                      value={a.max_repeat ?? ''}
                      onChange={(e) => update(i, { max_repeat: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>میانگین مدت تماس (دقیقه)</label>
                    <input
                      type="number"
                      dir="ltr"
                      min="1"
                      className={numClass}
                      value={a.avg_call_duration ?? ''}
                      onChange={(e) => update(i, { avg_call_duration: e.target.value })}
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-slate-400">
                    هزینه‌ی تماس مذاکره‌کننده هنگام ثبت تماس، بر اساس حقوق ساعتی مذاکره‌کننده × میانگین مدت تماس محاسبه می‌شود.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
