import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Filter, Search, X, ChevronRight, Eye } from 'lucide-react'
import Modal from '../components/modal/Modal'
import Badge from '../components/table/Badge'
import { fetchCaseHistory } from '../api/cases'
import {
  formatJalaliDateTime,
  formatNextActionDateTime,
  jalaliDateTimeStyle,
  orDash,
  toEnDigits,
  toFaDigits,
} from '../utils/format'
import { caseStatusLabel, caseStatusTone, HISTORY_OPERATIONS } from '../utils/constants'
import { formatCallOutcomeDetailLines, formatHistoryDetailsLines } from '../utils/historyDetails'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

const emptyFilters = {
  operation: '',
  user_name: '',
  from_date: '',
  to_date: '',
}

function HistoryDetailsText({ lines }) {
  if (!lines?.length) return <>—</>
  return (
    <div className="space-y-1 leading-relaxed">
      {lines.map((line, i) => (
        <div key={i}>{toFaDigits(line)}</div>
      ))}
    </div>
  )
}

function CallOutcomeDetailsModal({ open, details, onClose }) {
  const lines = formatCallOutcomeDetailLines(details)

  return (
    <Modal open={open} title="جزئیات ثبت خروجی تماس" onClose={onClose} maxWidth="max-w-md">
      <HistoryDetailsText lines={lines} />
    </Modal>
  )
}

const cell = 'whitespace-nowrap px-4 py-3 align-top'

export default function History() {
  const [searchParams] = useSearchParams()
  const caseId = searchParams.get('case_id')

  const [rows, setRows] = useState([])
  const [caseInfo, setCaseInfo] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detailModal, setDetailModal] = useState(null)

  const loadHistory = useCallback(
    (activeFilters = filters) => {
      if (!caseId) return
      setLoading(true)
      setError(null)
      const payload = {
        ...activeFilters,
        from_date: activeFilters.from_date ? toEnDigits(activeFilters.from_date) : '',
        to_date: activeFilters.to_date ? toEnDigits(activeFilters.to_date) : '',
      }
      fetchCaseHistory(caseId, payload)
        .then(({ rows: data, caseInfo: info }) => {
          setRows(data)
          setCaseInfo(info)
        })
        .catch((err) => {
          console.error(err)
          setError('خطا در دریافت تاریخچه پرونده')
          setRows([])
        })
        .finally(() => setLoading(false))
    },
    [caseId, filters]
  )

  useEffect(() => {
    if (caseId) loadHistory(emptyFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  const handleSearch = () => loadHistory(filters)

  const handleReset = () => {
    setFilters(emptyFilters)
    loadHistory(emptyFilters)
  }

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))

  if (!caseId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-panel">
        <p className="text-sm text-slate-500">
          پرونده‌ای انتخاب نشده است. از{' '}
          <Link to="/cases" className="font-medium text-brand-600 hover:text-brand-700">
            لیست پرونده‌ها
          </Link>{' '}
          یک پرونده را باز کرده و «مشاهده تاریخچه تغییرات» را انتخاب کنید.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/cases"
            className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600"
          >
            <ChevronRight className="h-4 w-4" />
            بازگشت به پرونده‌ها
          </Link>
          <h2 className="text-xl font-bold text-slate-800">تاریخچه تغییرات پرونده</h2>
          {caseInfo && (
            <p className="mt-1 text-sm text-slate-500">
              {orDash(caseInfo.debtor_name)} — شناسه اعتبار{' '}
              <span className="font-medium text-slate-700">{orDash(caseInfo.credit_id)}</span>
            </p>
          )}
        </div>
        <p className="text-sm text-slate-400">{toFaDigits(rows.length)} رکورد</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter className="h-4 w-4 text-brand-500" />
          فیلتر تاریخچه
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">نام عملیات</label>
            <select value={filters.operation} onChange={set('operation')} className={inputClass}>
              <option value="">همه</option>
              {HISTORY_OPERATIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">نام کاربر</label>
            <input
              type="text"
              value={filters.user_name}
              onChange={set('user_name')}
              placeholder="مثلاً زهرا حمیدی"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">از تاریخ</label>
            <input
              type="text"
              value={filters.from_date}
              onChange={set('from_date')}
              placeholder="۱۴۰۴/۰۱/۰۱"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">تا تاریخ</label>
            <input
              type="text"
              value={filters.to_date}
              onChange={set('to_date')}
              placeholder="۱۴۰۴/۱۲/۲۹"
              className={inputClass}
              dir="ltr"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleSearch}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Search className="h-4 w-4" />
            جستجو
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            پاک کردن
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel">
        <table className="w-full min-w-[1200px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
              <th className={cell}>شناسه اعتبار</th>
              <th className={cell}>نام بدهکار</th>
              <th className={cell}>کاربر</th>
              <th className={cell}>عملیات</th>
              <th className={cell}>تاریخ انجام</th>
              <th className={cell}>وضعیت پرونده</th>
              <th className={cell}>اقدام بعدی</th>
              <th className={cell}>تاریخ اقدام بعدی</th>
              <th className={`${cell} min-w-[220px]`}>جزئیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  رکوردی یافت نشد.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const detailLines = formatHistoryDetailsLines(row.operation, row.details, {
                  user_name: row.user_name,
                })
                const isCallOutcome = row.operation === 'ثبت خروجی تماس'

                return (
                  <tr
                    key={row.id}
                    className="border-b border-slate-50 text-slate-700 hover:bg-slate-50/50"
                  >
                    <td className={cell}>{orDash(row.credit_id)}</td>
                    <td className={cell}>{orDash(row.debtor_name)}</td>
                    <td className={cell}>{orDash(row.user_name || 'سیستم')}</td>
                    <td className={cell}>{orDash(row.operation)}</td>
                    <td className={cell}>
                      <span style={jalaliDateTimeStyle}>
                        {formatJalaliDateTime(row.created_at)}
                      </span>
                    </td>
                    <td className={cell}>
                      {row.case_status ? (
                        <Badge tone={caseStatusTone(row.case_status)}>
                          {caseStatusLabel(row.case_status)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={cell}>{orDash(row.next_action)}</td>
                    <td className={cell}>
                      <span style={jalaliDateTimeStyle}>
                        {formatNextActionDateTime(row.next_action_date)}
                      </span>
                    </td>
                    <td className={`${cell} max-w-sm whitespace-normal text-xs text-slate-600`}>
                      <HistoryDetailsText lines={detailLines} />
                      {isCallOutcome && (
                        <button
                          type="button"
                          onClick={() => setDetailModal(row)}
                          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          نمایش کامل
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <CallOutcomeDetailsModal
        open={Boolean(detailModal)}
        details={detailModal?.details}
        onClose={() => setDetailModal(null)}
      />
    </div>
  )
}
