import { useMemo } from 'react'
import { format, parse, getDaysInMonth } from 'date-fns-jalali'
import { toEnDigits, toFaDigits } from '../../utils/format'

const selectClass =
  'min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-500'

function parseValue(value) {
  const en = toEnDigits(value || '').trim()
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(en)) return new Date()
  const d = parse(en, 'yyyy/MM/dd', new Date())
  return Number.isNaN(d.getTime()) ? new Date() : d
}

export default function JalaliDatePicker({ value, onChange, disabled = false, className = '' }) {
  const base = parseValue(value)
  const year = Number(format(base, 'yyyy'))
  const month = Number(format(base, 'MM'))
  const day = Number(format(base, 'dd'))

  const years = useMemo(() => {
    const cy = Number(format(new Date(), 'yyyy'))
    return [cy - 1, cy, cy + 1]
  }, [])

  const daysCount = getDaysInMonth(parse(`${year}/${month}/1`, 'yyyy/M/d', new Date()))

  const setParts = (ny, nm, nd) => {
    const maxDay = getDaysInMonth(parse(`${ny}/${nm}/1`, 'yyyy/M/d', new Date()))
    const clamped = Math.min(Math.max(1, nd), maxDay)
    const dt = parse(`${ny}/${nm}/${clamped}`, 'yyyy/M/d', new Date())
    onChange(format(dt, 'yyyy/MM/dd'))
  }

  return (
    <div className={`flex gap-1 ${className}`}>
      <select
        className={selectClass}
        disabled={disabled}
        value={day}
        onChange={(e) => setParts(year, month, Number(e.target.value))}
        aria-label="روز"
      >
        {Array.from({ length: daysCount }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {toFaDigits(n)}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        disabled={disabled}
        value={month}
        onChange={(e) => setParts(year, Number(e.target.value), day)}
        aria-label="ماه"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {toFaDigits(n)}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        disabled={disabled}
        value={year}
        onChange={(e) => setParts(Number(e.target.value), month, day)}
        aria-label="سال"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {toFaDigits(y)}
          </option>
        ))}
      </select>
    </div>
  )
}
