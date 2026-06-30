import { Filter, X, Search } from 'lucide-react'
import { CASE_STATUS, ACTION_STATUS } from '../../utils/constants'

const statusOptions = [
  'pending_cei',
  'pending_strategy',
  'pending_strategy_start',
  'pending_sms_result',
  'pending_autocall_result',
  'pending_negotiator_assignment',
  'pending_negotiator_call',
  'in_negotiation',
  'pending_legal_assignment',
  'paid',
  'burned',
]

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

export default function CasesFilters({ filters, onChange, onSearch, onReset }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value })
  const hasActive = Object.values(filters).some((v) => v)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') onSearch?.()
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Filter className="h-4 w-4 text-brand-500" />
        فیلتر پرونده‌ها
        {hasActive && (
          <button
            type="button"
            onClick={onReset}
            className="mr-auto flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500"
          >
            <X className="h-3.5 w-3.5" />
            حذف فیلترها
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* نام بدهکار */}
        <input
          className={inputClass}
          placeholder="نام بدهکار"
          value={filters.debtor_name}
          onChange={set('debtor_name')}
          onKeyDown={handleKeyDown}
        />

        {/* کد ملی */}
        <input
          className={inputClass}
          placeholder="کد ملی"
          value={filters.national_code}
          onChange={set('national_code')}
          onKeyDown={handleKeyDown}
        />

        {/* شناسه اعتبار */}
        <input
          className={inputClass}
          placeholder="شناسه اعتبار"
          value={filters.credit_id}
          onChange={set('credit_id')}
          onKeyDown={handleKeyDown}
        />

        {/* وضعیت پرونده */}
        <select className={inputClass} value={filters.case_status} onChange={set('case_status')}>
          <option value="">همه وضعیت‌های پرونده</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {CASE_STATUS[s]?.label ?? s}
            </option>
          ))}
        </select>

        {/* وضعیت اقدام */}
        <select className={inputClass} value={filters.action_status} onChange={set('action_status')}>
          <option value="">همه وضعیت‌های اقدام</option>
          {Object.entries(ACTION_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>

        {/* مسئول پرونده */}
        <input
          className={inputClass}
          placeholder="مسئول پرونده"
          value={filters.negotiator_name}
          onChange={set('negotiator_name')}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Search className="h-4 w-4" />
          جستجو
        </button>
      </div>
    </div>
  )
}
