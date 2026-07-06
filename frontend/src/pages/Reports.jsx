import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate } from 'react-router-dom'
import { format, startOfMonth, endOfMonth } from 'date-fns-jalali'
import {
  Filter,
  RefreshCw,
  Info,
  ChevronUp,
  ChevronDown,
  Trophy,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  LabelList,
} from 'recharts'
import {
  fetchCasesReport,
  fetchStrategiesPerformance,
  fetchStrategiesCost,
  fetchNegotiatorsReport,
} from '../api/reports'
import { fetchSegments } from '../api/segments'
import { fetchStrategies } from '../api/strategies'
import { fetchNegotiators } from '../api/negotiators'
import CostByActionChart from '../components/charts/CostByActionChart'
import ActionDistributionPieChart from '../components/charts/ActionDistributionPieChart'
import {
  CHART_FONT,
  ChartContainer,
  HorizontalBarValueLabel,
  createCategoryYAxisTick,
  estimateCategoryAxisWidth,
  formatChartAxisNumber,
  formatChartPercent,
  numericAxisTickProps,
} from '../components/charts/chartUtils'
import { useAuth } from '../context/AuthContext'
import { formatRial, toEnDigits, toFaDigits, orDash } from '../utils/format'
import { CASE_STATUS, cooperationTypeLabel } from '../utils/constants'

const BRAND = '#0040FF'
const GREEN = '#10b981'
const RED = '#ef4444'
const PIE_COLORS = ['#0040FF', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b']

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

function currentJalaliMonthRange() {
  const now = new Date()
  return {
    from_date: format(startOfMonth(now), 'yyyy/MM/dd'),
    to_date: format(endOfMonth(now), 'yyyy/MM/dd'),
  }
}

function pct(value) {
  if (value === null || value === undefined) return '—'
  return `${toFaDigits(value)}٪`
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function formatRatioDecimal(ratio) {
  if (ratio == null || ratio === undefined) return '—'
  return toFaDigits(Number(ratio).toFixed(2))
}

function getSegmentOptions(segments, creditType) {
  if (creditType === 'loan') return segments.loan || []
  if (creditType === 'bnpl') return segments.bnpl || []
  return [...(segments.loan || []), ...(segments.bnpl || [])]
}

function pieOutsideLabel({ cx, cy, midAngle, outerRadius, percent }) {
  if (percent < 0.03) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 28
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill="#334155"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
      fontFamily={CHART_FONT}
      style={{ direction: 'ltr' }}
    >
      {formatChartPercent(Number((percent * 100).toFixed(1)))}
    </text>
  )
}

function ReportPieChart({ data, tooltipFormatter, height = 400 }) {
  if (!data?.length) return <EmptyChart />
  return (
    <ChartContainer style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 24, right: 140, bottom: 24, left: 24 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="38%"
          cy="50%"
          outerRadius={120}
          labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
          label={pieOutsideLabel}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Legend layout="vertical" align="right" verticalAlign="middle" />
        <Tooltip formatter={tooltipFormatter || ((v) => formatChartAxisNumber(v))} />
      </PieChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

function InfoHint({ text, className = '' }) {
  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const updatePos = () => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    })
  }

  const show = () => {
    updatePos()
    setOpen(true)
  }

  const hide = () => setOpen(false)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`inline-flex shrink-0 rounded-full p-0.5 text-brand-500 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200 ${className}`}
        aria-label="راهنما"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2.5 text-[10px] font-normal leading-relaxed text-slate-600 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}

function ColumnHint({ label, hint }) {
  if (!hint) return label
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoHint text={hint} />
    </span>
  )
}

function StatCard({ label, value, sub, loading, infoHint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <p className="flex items-center gap-1 text-xs text-slate-400">
        {label}
        {infoHint && <InfoHint text={infoHint} />}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <>
          <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        </>
      )}
    </div>
  )
}

function EmptyChart({ message = 'داده‌ای برای نمایش وجود ندارد' }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-400">
      {message}
    </div>
  )
}

function CreatedDateHint() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
      <span>فیلتر بازه زمانی بر اساس تاریخ ایجاد پرونده است.</span>
    </p>
  )
}

function ActionDateHint() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
      <span>فیلتر بازه زمانی بر اساس تاریخ اجرای اقدام است.</span>
    </p>
  )
}

function ChartTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {valueFormatter ? valueFormatter(p.value) : toFaDigits(p.value)}
        </p>
      ))}
    </div>
  )
}

function DateRangeFields({ from, to, onFrom, onTo }) {
  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-slate-400">از تاریخ</label>
        <input type="text" value={from} onChange={onFrom} className={inputClass} dir="ltr" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">تا تاریخ</label>
        <input type="text" value={to} onChange={onTo} className={inputClass} dir="ltr" />
      </div>
    </>
  )
}

function CreditTypeSelect({ value, onChange, required = false }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">نوع اعتبار</label>
      <select value={value} onChange={onChange} className={inputClass} required={required}>
        {!required && <option value="">همه</option>}
        <option value="loan">وام</option>
        <option value="bnpl">BNPL</option>
      </select>
    </div>
  )
}

function FilterPanel({ children, hint, onApply, loading, applyLabel = 'اعمال فیلتر' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
        <Filter className="h-4 w-4 text-brand-500" />
        فیلترها
      </div>
      {children}
      {hint}
      <button
        type="button"
        onClick={onApply}
        disabled={loading}
        className="mt-3 flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {applyLabel}
      </button>
    </div>
  )
}

function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey
  return (
    <button
      type="button"
      onClick={() =>
        onSort({
          key: sortKey,
          dir: active && sort.dir === 'asc' ? 'desc' : 'asc',
        })
      }
      className="inline-flex items-center gap-1 hover:text-slate-700"
    >
      {label}
      {active ? (
        sort.dir === 'asc' ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )
      ) : null}
    </button>
  )
}

export default function Reports() {
  const { isAdmin } = useAuth()
  const [mainTab, setMainTab] = useState('cases')
  const [strategySubTab, setStrategySubTab] = useState('performance')
  const monthRange = currentJalaliMonthRange()

  const [casesFilters, setCasesFilters] = useState({
    ...monthRange,
    credit_type: '',
    segment_id: '',
    case_status: '',
  })

  const [perfFilters, setPerfFilters] = useState({
    ...monthRange,
    credit_type: '',
    segment_id: '',
    strategy_id: '',
  })

  const [costFilters, setCostFilters] = useState({
    ...monthRange,
    credit_type: '',
    strategy_id: '',
  })

  const [negFilters, setNegFilters] = useState({
    negotiator_id: '',
    cooperation_type: '',
  })

  const [segments, setSegments] = useState({ loan: [], bnpl: [] })
  const [strategies, setStrategies] = useState([])
  const [negotiators, setNegotiators] = useState([])

  const [casesData, setCasesData] = useState(null)
  const [perfData, setPerfData] = useState(null)
  const [costData, setCostData] = useState(null)
  const [negData, setNegData] = useState(null)

  const [loadingCases, setLoadingCases] = useState(false)
  const [loadingPerf, setLoadingPerf] = useState(false)
  const [loadingCost, setLoadingCost] = useState(false)
  const [loadingNeg, setLoadingNeg] = useState(false)

  const [negSort, setNegSort] = useState({ key: 'success_rate', dir: 'desc' })

  useEffect(() => {
    fetchSegments().then(setSegments).catch(console.error)
    fetchStrategies().then(setStrategies).catch(console.error)
    fetchNegotiators().then(setNegotiators).catch(console.error)
  }, [])

  const casesSegmentOptions = useMemo(
    () => getSegmentOptions(segments, casesFilters.credit_type),
    [segments, casesFilters.credit_type]
  )
  const perfSegmentOptions = useMemo(
    () => getSegmentOptions(segments, perfFilters.credit_type),
    [segments, perfFilters.credit_type]
  )

  const loadCases = useCallback(() => {
    setLoadingCases(true)
    fetchCasesReport({
      from_date: toEnDigits(casesFilters.from_date),
      to_date: toEnDigits(casesFilters.to_date),
      credit_type: casesFilters.credit_type || undefined,
      segment_id: casesFilters.segment_id || undefined,
      case_status: casesFilters.case_status || undefined,
    })
      .then(setCasesData)
      .catch(console.error)
      .finally(() => setLoadingCases(false))
  }, [casesFilters])

  const loadPerformance = useCallback(() => {
    setLoadingPerf(true)
    fetchStrategiesPerformance({
      from_date: toEnDigits(perfFilters.from_date),
      to_date: toEnDigits(perfFilters.to_date),
      credit_type: perfFilters.credit_type || undefined,
      segment_id: perfFilters.segment_id || undefined,
      strategy_id: perfFilters.strategy_id || undefined,
    })
      .then(setPerfData)
      .catch(console.error)
      .finally(() => setLoadingPerf(false))
  }, [perfFilters])

  const loadCost = useCallback(() => {
    setLoadingCost(true)
    fetchStrategiesCost({
      from_date: toEnDigits(costFilters.from_date),
      to_date: toEnDigits(costFilters.to_date),
      credit_type: costFilters.credit_type || undefined,
      strategy_id: costFilters.strategy_id || undefined,
    })
      .then(setCostData)
      .catch(console.error)
      .finally(() => setLoadingCost(false))
  }, [costFilters])

  const loadNegotiators = useCallback(() => {
    setLoadingNeg(true)
    fetchNegotiatorsReport({
      negotiator_id: negFilters.negotiator_id || undefined,
      cooperation_type: negFilters.cooperation_type || undefined,
    })
      .then(setNegData)
      .catch(console.error)
      .finally(() => setLoadingNeg(false))
  }, [negFilters])

  useEffect(() => {
    loadCases()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const negComparison = useMemo(() => {
    const rows = negData?.negotiators_comparison ?? []
    return [...rows].sort((a, b) => {
      const k = negSort.key
      const av = a[k] ?? 0
      const bv = b[k] ?? 0
      if (typeof av === 'string') return negSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return negSort.dir === 'asc' ? av - bv : bv - av
    })
  }, [negData, negSort])

  const negTotals = useMemo(() => {
    const rows = negData?.negotiators_comparison ?? []
    if (!rows.length) return null
    return {
      totalCalls: rows.reduce((s, r) => s + (r.total_calls || 0), 0),
      avgSuccess: rows.reduce((s, r) => s + (r.success_rate || 0), 0) / rows.length,
      totalCost: rows.reduce((s, r) => s + (r.total_cost || 0), 0),
      avgPromise:
        rows.filter((r) => r.promise_fulfillment_rate != null).length > 0
          ? rows
              .filter((r) => r.promise_fulfillment_rate != null)
              .reduce((s, r) => s + r.promise_fulfillment_rate, 0) /
            rows.filter((r) => r.promise_fulfillment_rate != null).length
          : null,
    }
  }, [negData])

  const statusChartData =
    casesData?.cases_by_status
      ?.filter((s) => s.count > 0)
      .map((s) => ({ name: s.label, count: Number(s.count) || 0 })) ?? []

  const trendData =
    casesData?.daily_trend?.map((d) => ({
      date: d.date,
      created: d.created_count,
      paid_full: d.paid_full_count ?? d.paid_count ?? 0,
    })) ?? []

  const reasonChartData =
    negData?.no_payment_reasons?.map((r) => ({ name: r.reason, value: r.count })) ?? []

  const statusYAxisWidth = useMemo(
    () => estimateCategoryAxisWidth(statusChartData.map((d) => d.name)),
    [statusChartData]
  )

  if (!isAdmin()) return <Navigate to="/cases" replace />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">گزارشات</h2>
        <p className="mt-1 text-sm text-slate-400">تحلیل پرونده‌ها، استراتژی‌ها و مذاکره‌کنندگان</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {[
          ['cases', 'پرونده‌ها'],
          ['strategies', 'استراتژی‌ها'],
          ['negotiators', 'مذاکره‌کنندگان'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMainTab(id)
              if (id === 'negotiators' && !negData) loadNegotiators()
              if (id === 'strategies' && !perfData) loadPerformance()
            }}
            className={[
              'px-4 py-2.5 text-sm font-medium transition-colors',
              mainTab === id
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-400 hover:text-slate-600',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ===== تب پرونده‌ها ===== */}
      {mainTab === 'cases' && (
        <div className="space-y-6">
          <FilterPanel onApply={loadCases} loading={loadingCases} hint={<CreatedDateHint />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DateRangeFields
                from={casesFilters.from_date}
                to={casesFilters.to_date}
                onFrom={(e) => setCasesFilters((f) => ({ ...f, from_date: e.target.value }))}
                onTo={(e) => setCasesFilters((f) => ({ ...f, to_date: e.target.value }))}
              />
              <CreditTypeSelect
                value={casesFilters.credit_type}
                onChange={(e) => setCasesFilters((f) => ({ ...f, credit_type: e.target.value, segment_id: '' }))}
              />
              <div>
                <label className="mb-1 block text-xs text-slate-400">سگمنت</label>
                <select
                  value={casesFilters.segment_id}
                  onChange={(e) => setCasesFilters((f) => ({ ...f, segment_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">همه</option>
                  {casesSegmentOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">وضعیت پرونده</label>
                <select
                  value={casesFilters.case_status}
                  onChange={(e) => setCasesFilters((f) => ({ ...f, case_status: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">همه</option>
                  {Object.entries(CASE_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </FilterPanel>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="تعداد پرونده ایجادشده" value={toFaDigits(casesData?.total_cases ?? 0)} loading={loadingCases} />
            <StatCard
              label="پرداخت شده"
              value={toFaDigits(casesData?.paid_cases ?? 0)}
              sub={`نرخ وصول: ${pct(casesData?.collection_rate)}`}
              loading={loadingCases}
            />
            <StatCard label="سوخت شده" value={toFaDigits(casesData?.burned_cases ?? 0)} loading={loadingCases} />
            <StatCard label="در انتظار حقوقی" value={toFaDigits(casesData?.legal_cases ?? 0)} loading={loadingCases} />
            <StatCard
              label="پرونده‌های در حال پیگیری"
              value={toFaDigits(casesData?.active_followup_cases ?? 0)}
              loading={loadingCases}
            />
            <StatCard
              label="مبلغ کل هزینه‌ها"
              value={`${formatRial(casesData?.total_cost)} ریال`}
              loading={loadingCases}
            />
            <StatCard
              label="مبلغ کل وصول‌شده"
              value={`${formatRial(casesData?.total_collected)} ریال`}
              loading={loadingCases}
            />
            <StatCard
              label="میانگین زمان تا پرداخت"
              value={
                casesData?.avg_days_to_payment != null
                  ? `${toFaDigits(casesData.avg_days_to_payment)} روز`
                  : '—'
              }
              loading={loadingCases}
              infoHint="میانگین فاصله بین تاریخ ایجاد پرونده و تاریخ اولین پرداخت، فقط برای پرونده‌های پرداخت‌شده. مثلاً اگر یک پرونده ۵.۵ روز بعد از ایجاد پرداخت شده باشد، همین عدد نمایش داده می‌شود."
            />
            <StatCard
              label="نسبت هزینه به وصول"
              value={formatRatioDecimal(casesData?.cost_to_collection_ratio)}
              loading={loadingCases}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
            <h3 className="mb-4 text-sm font-bold text-slate-700">تعداد پرونده در هر وضعیت</h3>
            {loadingCases ? (
              <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ) : statusChartData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ChartContainer style={{ height: Math.max(320, statusChartData.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={statusChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 80, left: statusYAxisWidth, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 'auto']} tick={numericAxisTickProps()} tickFormatter={formatChartAxisNumber} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={statusYAxisWidth}
                    tick={createCategoryYAxisTick(statusYAxisWidth)}
                  />
                  <Tooltip content={<ChartTooltip valueFormatter={formatChartAxisNumber} />} />
                  <Bar dataKey="count" name="تعداد" fill={BRAND} radius={[0, 4, 4, 0]} minPointSize={3}>
                    <LabelList
                      dataKey="count"
                      content={(props) => (
                        <HorizontalBarValueLabel {...props} formatter={formatChartAxisNumber} />
                      )}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
            <h3 className="mb-4 text-sm font-bold text-slate-700">روند ایجاد و پرداخت</h3>
            {loadingCases ? (
              <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ) : trendData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ChartContainer style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 20, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ ...numericAxisTickProps(), fontSize: 10 }} />
                  <YAxis tick={numericAxisTickProps()} tickFormatter={formatChartAxisNumber} />
                  <Tooltip content={<ChartTooltip valueFormatter={formatChartAxisNumber} />} />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="ایجاد" stroke={BRAND} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="paid_full" name="پرداخت کامل" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
        </div>
      )}

      {/* ===== تب استراتژی‌ها ===== */}
      {mainTab === 'strategies' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              ['performance', 'عملکرد استراتژی‌ها'],
              ['cost', 'هزینه و وصول'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setStrategySubTab(id)
                  if (id === 'performance') loadPerformance()
                  if (id === 'cost') loadCost()
                }}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-medium',
                  strategySubTab === id
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {strategySubTab === 'performance' && (
            <div className="space-y-4">
              <FilterPanel onApply={loadPerformance} loading={loadingPerf} hint={<CreatedDateHint />}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DateRangeFields
                    from={perfFilters.from_date}
                    to={perfFilters.to_date}
                    onFrom={(e) => setPerfFilters((f) => ({ ...f, from_date: e.target.value }))}
                    onTo={(e) => setPerfFilters((f) => ({ ...f, to_date: e.target.value }))}
                  />
                  <CreditTypeSelect
                    value={perfFilters.credit_type}
                    onChange={(e) => setPerfFilters((f) => ({ ...f, credit_type: e.target.value, segment_id: '' }))}
                  />
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">سگمنت</label>
                    <select
                      value={perfFilters.segment_id}
                      onChange={(e) => setPerfFilters((f) => ({ ...f, segment_id: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">همه</option>
                      {perfSegmentOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">استراتژی</label>
                    <select
                      value={perfFilters.strategy_id}
                      onChange={(e) => setPerfFilters((f) => ({ ...f, strategy_id: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">همه</option>
                      {strategies.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </FilterPanel>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-bold text-slate-700">مقایسه استراتژی‌ها</h3>
                </div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[700px] text-right text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 text-xs text-slate-500">
                        <th className="px-4 py-3">استراتژی</th>
                        <th className="px-4 py-3">سگمنت</th>
                        <th className="px-4 py-3">پرونده</th>
                        <th className="px-4 py-3"><ColumnHint label="نرخ تبدیل" hint="درصد پرونده‌های تخصیص‌یافته به این استراتژی که به وضعیت پرداخت‌شده رسیده‌اند." /></th>
                        <th className="px-4 py-3">میانگین روز</th>
                        <th className="px-4 py-3">هزینه کل</th>
                        <th className="px-4 py-3">مبلغ وصول‌شده</th>
                        <th className="px-4 py-3">نسبت هزینه به وصول</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingPerf ? (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">در حال بارگذاری…</td></tr>
                      ) : (perfData?.strategies_comparison ?? []).length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">داده‌ای یافت نشد</td></tr>
                      ) : (
                        perfData.strategies_comparison.map((row) => (
                          <tr key={row.strategy_id} className="border-t border-slate-50">
                            <td className="px-4 py-3 font-medium">{row.title}</td>
                            <td className="px-4 py-3">{orDash(row.segment)}</td>
                            <td className="px-4 py-3">{toFaDigits(row.total_cases)}</td>
                            <td className="px-4 py-3">{pct(row.success_rate)}</td>
                            <td className="px-4 py-3">
                              {row.avg_days_to_payment != null ? `${toFaDigits(row.avg_days_to_payment)} روز` : '—'}
                            </td>
                            <td className="px-4 py-3">{formatRial(row.total_cost)}</td>
                            <td className="px-4 py-3">{formatRial(row.total_collected)}</td>
                            <td className="px-4 py-3">{formatRatioDecimal(row.cost_to_collection_ratio)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-700">نتایج A/B Test</h3>
                {loadingPerf ? null : (perfData?.ab_test_results ?? []).filter(
                  (ab) => ab.strategy_a?.title && ab.strategy_b?.title
                ).length === 0 ? (
                  <EmptyChart message="سناریوی A/B Test تعریف نشده است" />
                ) : (
                  perfData.ab_test_results
                    .filter((ab) => ab.strategy_a?.title && ab.strategy_b?.title)
                    .map((ab) => (
                    <div key={ab.scenario_name} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                      <h4 className="mb-3 font-bold text-slate-800">{ab.scenario_name}</h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[{ key: 'a', data: ab.strategy_a }, { key: 'b', data: ab.strategy_b }].map(({ key, data }) => (
                          <div
                            key={key}
                            className={[
                              'relative rounded-xl border p-3',
                              ab.winner === key ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50',
                            ].join(' ')}
                          >
                            {ab.winner === key && (
                              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                <Trophy className="h-3 w-3" />
                                برنده
                              </span>
                            )}
                            <p className="mb-2 text-sm font-medium text-slate-700">
                              استراتژی {key.toUpperCase()}: {data.title}
                            </p>
                            <dl className="space-y-1 text-xs text-slate-600">
                              <div className="flex justify-between"><dt>نرخ تبدیل</dt><dd>{pct(data.success_rate)}</dd></div>
                              <div className="flex justify-between">
                                <dt>میانگین زمان</dt>
                                <dd>{data.avg_days != null ? `${toFaDigits(data.avg_days)} روز` : '—'}</dd>
                              </div>
                              <div className="flex justify-between"><dt>هزینه</dt><dd>{formatRial(data.cost)}</dd></div>
                            </dl>
                          </div>
                        ))}
                      </div>
                      {ab.winner == null && (
                        <p className="mt-3 text-center text-xs text-slate-500">
                          داده کافی برای تعیین برنده وجود ندارد
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {strategySubTab === 'cost' && (
            <div className="space-y-4">
              <FilterPanel onApply={loadCost} loading={loadingCost} hint={<ActionDateHint />}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DateRangeFields
                    from={costFilters.from_date}
                    to={costFilters.to_date}
                    onFrom={(e) => setCostFilters((f) => ({ ...f, from_date: e.target.value }))}
                    onTo={(e) => setCostFilters((f) => ({ ...f, to_date: e.target.value }))}
                  />
                  <CreditTypeSelect
                    value={costFilters.credit_type}
                    onChange={(e) => setCostFilters((f) => ({ ...f, credit_type: e.target.value }))}
                  />
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">استراتژی</label>
                    <select
                      value={costFilters.strategy_id}
                      onChange={(e) => setCostFilters((f) => ({ ...f, strategy_id: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">همه</option>
                      {strategies.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </FilterPanel>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatCard
                  label="مبلغ کل هزینه‌ها"
                  value={`${formatRial(costData?.summary?.total_cost)} ریال`}
                  loading={loadingCost}
                />
                <StatCard
                  label="مبلغ کل وصول‌شده"
                  value={`${formatRial(costData?.summary?.total_collected)} ریال`}
                  loading={loadingCost}
                />
                <StatCard
                  label="نسبت هزینه به وصول"
                  value={formatRatioDecimal(costData?.summary?.cost_to_collection_ratio)}
                  loading={loadingCost}
                />
                <StatCard
                  label="هزینه پیامک‌ها"
                  value={`${formatRial(costData?.summary?.total_sms_cost)} ریال`}
                  loading={loadingCost}
                />
                <StatCard
                  label="هزینه تماس‌های خودکار"
                  value={`${formatRial(costData?.summary?.total_autocall_cost)} ریال`}
                  loading={loadingCost}
                />
                <StatCard
                  label="هزینه تماس مذاکره‌کننده"
                  value={`${formatRial(costData?.summary?.total_negotiator_cost)} ریال`}
                  loading={loadingCost}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                  <h3 className="mb-4 text-sm font-bold text-slate-700">توزیع هزینه</h3>
                  {loadingCost ? (
                    <div className="h-[400px] animate-pulse rounded-xl bg-slate-100" />
                  ) : !(costData?.cost_distribution?.some((d) => d.value > 0)) ? (
                    <EmptyChart />
                  ) : (
                    <ActionDistributionPieChart
                      distribution={costData.cost_distribution}
                      tooltipFormatter={(v) => formatRial(v)}
                    />
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                  <h3 className="mb-4 text-sm font-bold text-slate-700">توزیع دفعات وصول</h3>
                  {loadingCost ? (
                    <div className="h-[400px] animate-pulse rounded-xl bg-slate-100" />
                  ) : !(costData?.collection_distribution?.some((d) => d.value > 0)) ? (
                    <EmptyChart />
                  ) : (
                    <ActionDistributionPieChart
                      distribution={costData.collection_distribution}
                      tooltipFormatter={(v) => `${toFaDigits(String(v))} وصول`}
                    />
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                <h3 className="mb-4 text-sm font-bold text-slate-700">هزینه و وصول به تفکیک اقدام</h3>
                {loadingCost ? (
                  <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
                ) : !(costData?.action_stats?.length) ? (
                  <EmptyChart />
                ) : (
                  <CostByActionChart actionStats={costData.action_stats} />
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
                <div className="overflow-auto">
                  <table className="w-full min-w-[800px] text-right text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 text-xs text-slate-500">
                        <th className="px-4 py-3">نوع اقدام</th>
                        <th className="px-4 py-3">تعداد اجرا</th>
                        <th className="px-4 py-3">هزینه کل</th>
                        <th className="px-4 py-3">
                          <ColumnHint
                            label="تعداد وصول"
                            hint="تعداد دفعاتی که پرداخت (جزئی یا کامل) انجام شده و به آخرین اجرای همان اقدام قبل از پرداخت نسبت داده شده — هر پرداخت جداگانه شمرده می‌شود."
                          />
                        </th>
                        <th className="px-4 py-3">مبلغ وصول</th>
                        <th className="px-4 py-3">نسبت هزینه به وصول</th>
                        <th className="px-4 py-3">
                          <ColumnHint
                            label="نرخ تبدیل"
                            hint="تعداد اجراهای یکتایی که حداقل یک وصول داشته ÷ تعداد کل اجرا. اگر بعد از یک اجرا دو بار پرداخت شود، در نرخ تبدیل یک‌بار شمرده می‌شود (در «تعداد وصول» دو‌بار)."
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(costData?.action_stats ?? []).map((row) => (
                        <tr key={row.action_type} className="border-t border-slate-50">
                          <td className="px-4 py-3">{row.label}</td>
                          <td className="px-4 py-3">{toFaDigits(row.execution_count)}</td>
                          <td className="px-4 py-3">{formatRial(row.total_cost)}</td>
                          <td className="px-4 py-3">{toFaDigits(String(row.payment_count ?? 0))}</td>
                          <td className="px-4 py-3">{formatRial(row.total_collected)}</td>
                          <td className="px-4 py-3">{formatRatioDecimal(row.cost_to_collection_ratio)}</td>
                          <td className="px-4 py-3">{pct(row.conversion_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== تب مذاکره‌کنندگان ===== */}
      {mainTab === 'negotiators' && (
        <div className="space-y-4">
          <FilterPanel onApply={loadNegotiators} loading={loadingNeg}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">مذاکره‌کننده</label>
                <select
                  value={negFilters.negotiator_id}
                  onChange={(e) => setNegFilters((f) => ({ ...f, negotiator_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">همه</option>
                  {negotiators.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">نوع همکاری</label>
                <select
                  value={negFilters.cooperation_type}
                  onChange={(e) => setNegFilters((f) => ({ ...f, cooperation_type: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">همه</option>
                  <option value="internal">داخلی</option>
                  <option value="outsourced">برون‌سپاری</option>
                </select>
              </div>
            </div>
          </FilterPanel>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="کل تماس‌ها" value={toFaDigits(negTotals?.totalCalls ?? 0)} loading={loadingNeg} />
            <StatCard label="میانگین نرخ وصول پرونده" value={negTotals ? pct(round2(negTotals.avgSuccess)) : pct(0)} loading={loadingNeg} infoHint="درصد پرونده‌های تخصیص‌یافته به هر مذاکره‌کننده که پرداخت شده‌اند — نه نرخ پاسخ تماس." />
            <StatCard label="مجموع هزینه تماس‌ها" value={`${formatRial(negTotals?.totalCost ?? 0)} ریال`} loading={loadingNeg} />
            <StatCard
              label="میانگین نرخ وفای به تعهد"
              value={negTotals ? pct(negTotals.avgPromise != null ? round2(negTotals.avgPromise) : null) : '—'}
              loading={loadingNeg}
              infoHint="نرخ وفای به تعهد = تعهدات fulfilled ÷ (fulfilled + broken). تعهدات pending در این محاسبه دخیل نیستند."
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="overflow-auto">
              <table className="w-full min-w-[900px] text-right text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-xs text-slate-500">
                    <th className="px-4 py-3">نام</th>
                    <th className="px-4 py-3">نوع همکاری</th>
                    <th className="px-4 py-3"><SortHeader label="پرونده فعال" sortKey="active_cases" sort={negSort} onSort={setNegSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="تماس" sortKey="total_calls" sort={negSort} onSort={setNegSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="نرخ وصول" sortKey="success_rate" sort={negSort} onSort={setNegSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="میانگین مدت" sortKey="avg_call_duration" sort={negSort} onSort={setNegSort} /></th>
                    <th className="px-4 py-3"><SortHeader label="هزینه" sortKey="total_cost" sort={negSort} onSort={setNegSort} /></th>
                    <th className="px-4 py-3"><ColumnHint label="وفا / تعهد" hint="تعداد تعهدات پرداخت محقق‌شده (وفا) به‌نسبت کل تعهدات گرفته‌شده (تعهد). مثلاً ۲/۴ یعنی از ۴ تعهد، ۲ مورد پرداخت شده." /></th>
                  </tr>
                </thead>
                <tbody>
                  {loadingNeg ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">در حال بارگذاری…</td></tr>
                  ) : negComparison.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">داده‌ای یافت نشد</td></tr>
                  ) : (
                    negComparison.map((row) => (
                      <tr key={row.id} className="border-t border-slate-50">
                        <td className="px-4 py-3 font-medium">{row.name}</td>
                        <td className="px-4 py-3">{cooperationTypeLabel(row.cooperation_type)}</td>
                        <td className="px-4 py-3">{toFaDigits(row.active_cases)}</td>
                        <td className="px-4 py-3">{toFaDigits(row.total_calls)}</td>
                        <td className="px-4 py-3">{pct(row.success_rate)}</td>
                        <td className="px-4 py-3">
                          {row.avg_call_duration != null ? `${toFaDigits(row.avg_call_duration)} دقیقه` : '—'}
                        </td>
                        <td className="px-4 py-3">{formatRial(row.total_cost)}</td>
                        <td className="px-4 py-3">
                          {row.promise_fulfillment_rate != null ? (
                            <>
                              {toFaDigits(row.promises_fulfilled)}/
                              {toFaDigits((row.promises_fulfilled || 0) + (row.promises_broken || 0))}{' '}
                              ({pct(row.promise_fulfillment_rate)})
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
            <h3 className="mb-4 text-sm font-bold text-slate-700">دلایل عدم پرداخت</h3>
            {loadingNeg ? (
              <div className="h-[400px] animate-pulse rounded-xl bg-slate-100" />
            ) : reasonChartData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ReportPieChart data={reasonChartData} />
            )}
            <div className="mt-4 overflow-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-xs text-slate-500">
                    <th className="px-4 py-3">دلیل</th>
                    <th className="px-4 py-3">تعداد</th>
                    <th className="px-4 py-3">درصد</th>
                  </tr>
                </thead>
                <tbody>
                  {(negData?.no_payment_reasons ?? []).length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">داده‌ای یافت نشد</td></tr>
                  ) : (
                    negData.no_payment_reasons.map((row) => (
                      <tr key={row.reason} className="border-t border-slate-50">
                        <td className="px-4 py-3">{row.reason}</td>
                        <td className="px-4 py-3">{toFaDigits(row.count)}</td>
                        <td className="px-4 py-3">{pct(row.percent)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
