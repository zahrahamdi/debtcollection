import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { format, startOfMonth, endOfMonth } from 'date-fns-jalali'
import { Filter, Search, RefreshCw, BarChart3 } from 'lucide-react'
import { fetchReportsSummary, fetchActionConversion, fetchAbTestResults } from '../api/reports'
import { fetchSegments } from '../api/segments'
import { fetchNegotiators } from '../api/negotiators'
import { isAdmin } from '../utils/auth'
import { formatRial, toEnDigits, toFaDigits, orDash } from '../utils/format'
import { actionTypeLabel } from '../utils/constants'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

function currentJalaliMonthRange() {
  const now = new Date()
  return {
    from_date: format(startOfMonth(now), 'yyyy/MM/dd'),
    to_date: format(endOfMonth(now), 'yyyy/MM/dd'),
  }
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function pct(value) {
  if (value === null || value === undefined) return '—'
  return `${toFaDigits(value)}٪`
}

export default function Reports() {
  const [filters, setFilters] = useState({
    ...currentJalaliMonthRange(),
    credit_type: '',
    segment_id: '',
    negotiator_id: '',
  })
  const [segments, setSegments] = useState({ loan: [], bnpl: [] })
  const [negotiators, setNegotiators] = useState([])
  const [summary, setSummary] = useState(null)
  const [conversions, setConversions] = useState([])
  const [abTests, setAbTests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchSegments().then(setSegments).catch(console.error)
    fetchNegotiators().then(setNegotiators).catch(console.error)
  }, [])

  const segmentOptions = useMemo(() => {
    if (filters.credit_type === 'loan') return segments.loan || []
    if (filters.credit_type === 'bnpl') return segments.bnpl || []
    return [...(segments.loan || []), ...(segments.bnpl || [])]
  }, [filters.credit_type, segments])

  const loadReports = useCallback(() => {
    setLoading(true)
    setError(null)
    const payload = {
      ...filters,
      from_date: toEnDigits(filters.from_date),
      to_date: toEnDigits(filters.to_date),
      segment_id: filters.segment_id || undefined,
      negotiator_id: filters.negotiator_id || undefined,
    }

    Promise.all([
      fetchReportsSummary(payload),
      fetchActionConversion(payload),
      fetchAbTestResults(payload),
    ])
      .then(([sum, conv, ab]) => {
        setSummary(sum)
        setConversions(conv)
        setAbTests(ab)
      })
      .catch((err) => {
        console.error(err)
        setError('خطا در دریافت گزارش‌ها')
      })
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => {
    loadReports()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin()) return <Navigate to="/cases" replace />

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))

  const status = summary?.cases_by_status ?? {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">گزارشات</h2>
          <p className="mt-1 text-sm text-slate-400">خلاصه عملکرد، نرخ تبدیل و نتایج A/B Test</p>
        </div>
        <button
          type="button"
          onClick={loadReports}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          به‌روزرسانی
        </button>
      </div>

      {/* فیلترها */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter className="h-4 w-4 text-brand-500" />
          فیلتر گزارش
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-slate-400">از تاریخ</label>
            <input
              type="text"
              value={filters.from_date}
              onChange={set('from_date')}
              className={inputClass}
              dir="ltr"
              placeholder="۱۴۰۴/۰۱/۰۱"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">تا تاریخ</label>
            <input
              type="text"
              value={filters.to_date}
              onChange={set('to_date')}
              className={inputClass}
              dir="ltr"
              placeholder="۱۴۰۴/۱۲/۲۹"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">نوع اعتبار</label>
            <select value={filters.credit_type} onChange={set('credit_type')} className={inputClass}>
              <option value="">همه</option>
              <option value="loan">وام</option>
              <option value="bnpl">BNPL</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">سگمنت</label>
            <select value={filters.segment_id} onChange={set('segment_id')} className={inputClass}>
              <option value="">همه</option>
              {segmentOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">مذاکره‌کننده</label>
            <select value={filters.negotiator_id} onChange={set('negotiator_id')} className={inputClass}>
              <option value="">همه</option>
              {negotiators.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={loadReports}
          disabled={loading}
          className="mt-3 flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          اعمال فیلتر
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div className="py-16 text-center text-sm text-slate-400">در حال بارگذاری گزارش…</div>
      ) : (
        summary && (
          <>
            {/* کارت‌های آماری */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="پرونده‌های ایجادشده"
                value={toFaDigits(summary.cases_created ?? 0)}
              />
              <StatCard
                label="پرداخت شده"
                value={toFaDigits(status.paid ?? 0)}
              />
              <StatCard label="سوخت شده" value={toFaDigits(status.burned ?? 0)} />
              <StatCard
                label="در انتظار تخصیص به حقوقی"
                value={toFaDigits(status.pending_legal_assignment ?? 0)}
              />
              <StatCard
                label="مبلغ کل وصول‌شده"
                value={`${formatRial(summary.collected?.total)} ریال`}
              />
              <StatCard
                label="هزینه عملیاتی کل"
                value={`${formatRial(summary.operational_cost?.total)} ریال`}
              />
              <StatCard
                label="نسبت هزینه به وصول"
                value={pct(summary.operational_cost?.cost_to_collected_ratio)}
                sub="درصد هزینه نسبت به مبلغ وصول‌شده"
              />
              <StatCard
                label="میانگین زمان تا پرداخت"
                value={
                  summary.avg_days_to_payment != null
                    ? `${toFaDigits(summary.avg_days_to_payment)} روز`
                    : '—'
                }
              />
            </div>

            {/* جزئیات وضعیت و وصول */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <BarChart3 className="h-4 w-4 text-brand-500" />
                  پرونده در هر وضعیت
                </h3>
                <dl className="space-y-2 text-sm">
                  {[
                    ['pending_sms_result', 'در انتظار نتیجه پیامک'],
                    ['pending_autocall_result', 'در انتظار نتیجه تماس خودکار'],
                    ['pending_negotiator_assignment', 'در انتظار تخصیص به مذاکره‌کننده'],
                    ['pending_negotiator_call', 'در انتظار تماس مذاکره‌کننده'],
                    ['in_negotiation', 'در انتظار نتیجه تماس مذاکره‌کننده'],
                    ['pending_legal_assignment', 'در انتظار تخصیص به حقوقی'],
                    ['burned', 'سوخت شده'],
                    ['paid', 'پرداخت شده'],
                  ].map(([key, label]) => (
                    <div key={key} className="flex justify-between border-b border-slate-50 py-1.5">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-medium text-slate-700">{toFaDigits(status[key] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
                <h3 className="mb-3 text-sm font-bold text-slate-700">مبلغ وصول‌شده و هزینه</h3>
                <dl className="space-y-2 text-sm">
                  {[
                    ['کل', summary.collected?.total],
                    ['از طریق پیامک', summary.collected?.via_sms],
                    ['از طریق تماس خودکار', summary.collected?.via_autocall],
                    ['از طریق مذاکره', summary.collected?.via_negotiator],
                  ].map(([label, amt]) => (
                    <div key={label} className="flex justify-between border-b border-slate-50 py-1.5">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-medium text-slate-700">{formatRial(amt)} ریال</dd>
                    </div>
                  ))}
                  <div className="pt-2 text-xs font-medium text-slate-400">هزینه عملیاتی</div>
                  {[
                    ['پیامک', summary.operational_cost?.sms],
                    ['تماس خودکار', summary.operational_cost?.autocall],
                    ['تماس مذاکره‌کننده', summary.operational_cost?.negotiator],
                  ].map(([label, amt]) => (
                    <div key={label} className="flex justify-between border-b border-slate-50 py-1.5">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-medium text-slate-700">{formatRial(amt)} ریال</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            {/* نرخ تبدیل اکشن‌ها */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold text-slate-700">نرخ تبدیل اکشن‌ها</h3>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[600px] border-collapse text-right text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-xs text-slate-500">
                      <th className="px-4 py-3">نوع اکشن</th>
                      <th className="px-4 py-3">تعداد اجرا</th>
                      <th className="px-4 py-3">پرداخت بعد از اکشن</th>
                      <th className="px-4 py-3">نرخ تبدیل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          داده‌ای یافت نشد
                        </td>
                      </tr>
                    ) : (
                      conversions.map((row) => (
                        <tr key={row.action_type} className="border-t border-slate-50">
                          <td className="px-4 py-3">{actionTypeLabel(row.action_type)}</td>
                          <td className="px-4 py-3">{toFaDigits(row.executions)}</td>
                          <td className="px-4 py-3">{toFaDigits(row.payments_after)}</td>
                          <td className="px-4 py-3">{pct(row.conversion_rate)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* A/B Test */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700">نتایج A/B Test</h3>
              {abTests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
                  سناریوی A/B Test تعریف نشده است
                </div>
              ) : (
                abTests.map((scenario) => (
                  <div
                    key={scenario.id}
                    className="rounded-2xl border border-slate-200 bg-white shadow-panel"
                  >
                    <div className="border-b border-slate-100 px-4 py-3">
                      <h4 className="font-bold text-slate-800">{scenario.name}</h4>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full min-w-[640px] border-collapse text-right text-sm">
                        <thead>
                          <tr className="bg-slate-50/80 text-xs text-slate-500">
                            <th className="px-4 py-3">استراتژی</th>
                            <th className="px-4 py-3">تعداد پرونده</th>
                            <th className="px-4 py-3">پرداخت‌شده</th>
                            <th className="px-4 py-3">نرخ تبدیل</th>
                            <th className="px-4 py-3">میانگین زمان تا پرداخت</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[scenario.strategy_a, scenario.strategy_b].map((st) => (
                            <tr key={st.id} className="border-t border-slate-50">
                              <td className="px-4 py-3 font-medium">{orDash(st.name)}</td>
                              <td className="px-4 py-3">{toFaDigits(st.total_cases ?? 0)}</td>
                              <td className="px-4 py-3">{toFaDigits(st.paid_cases ?? 0)}</td>
                              <td className="px-4 py-3">{pct(st.conversion_rate)}</td>
                              <td className="px-4 py-3">
                                {st.avg_days_to_payment != null
                                  ? `${toFaDigits(st.avg_days_to_payment)} روز`
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )
      )}
    </div>
  )
}
