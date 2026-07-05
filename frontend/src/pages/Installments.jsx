import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Filter, Search, X, ChevronRight } from 'lucide-react'
import Badge from '../components/table/Badge'
import { fetchCaseInstallments } from '../api/cases'
import {
  formatJalaliDateTime,
  formatRial,
  jalaliDateTimeStyle,
  orDash,
  toFaDigits,
} from '../utils/format'
import {
  DEBT_CLASSES,
  INSTALLMENT_STATUSES,
  paymentStatusLabel,
  paymentStatusTone,
} from '../utils/constants'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

const emptyFilters = {
  installment_status: '',
  debt_class: '',
  payment_status: '',
}

const cell = 'whitespace-nowrap px-4 py-3 align-top'

export default function Installments() {
  const [searchParams] = useSearchParams()
  const caseId = searchParams.get('case_id')

  const [rows, setRows] = useState([])
  const [caseInfo, setCaseInfo] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadInstallments = useCallback(
    (activeFilters = filters) => {
      if (!caseId) return
      setLoading(true)
      setError(null)
      fetchCaseInstallments(caseId, activeFilters)
        .then(({ rows: data, caseInfo: info }) => {
          setRows(data)
          setCaseInfo(info)
        })
        .catch((err) => {
          console.error(err)
          setError('خطا در دریافت اقساط پرونده')
          setRows([])
        })
        .finally(() => setLoading(false))
    },
    [caseId, filters]
  )

  useEffect(() => {
    if (caseId) loadInstallments(emptyFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  const handleSearch = () => loadInstallments(filters)

  const handleReset = () => {
    setFilters(emptyFilters)
    loadInstallments(emptyFilters)
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
          یک پرونده را باز کرده و «مشاهده لیست اقساط» را انتخاب کنید.
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
          <h2 className="text-xl font-bold text-slate-800">اقساط پرونده</h2>
          {caseInfo && (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
              <span>
                نام بدهکار:{' '}
                <span className="font-medium text-slate-700">{orDash(caseInfo.debtor_name)}</span>
              </span>
              <span>
                شناسه اعتبار:{' '}
                <span className="font-medium text-slate-700">{orDash(caseInfo.credit_id)}</span>
              </span>
              <span>
                مطالبات کل:{' '}
                <span className="font-medium text-slate-700">
                  {formatRial(caseInfo.claims_amount)} ریال
                </span>
              </span>
            </div>
          )}
        </div>
        <p className="text-sm text-slate-400">{toFaDigits(rows.length)} قسط</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter className="h-4 w-4 text-brand-500" />
          فیلتر اقساط
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">وضعیت قسط</label>
            <select
              value={filters.installment_status}
              onChange={set('installment_status')}
              className={inputClass}
            >
              <option value="">همه</option>
              {INSTALLMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">کلاس بدهی</label>
            <select value={filters.debt_class} onChange={set('debt_class')} className={inputClass}>
              <option value="">همه</option>
              {DEBT_CLASSES.map((dc) => (
                <option key={dc} value={dc}>
                  {dc}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">وضعیت پرداخت</label>
            <select
              value={filters.payment_status}
              onChange={set('payment_status')}
              className={inputClass}
            >
              <option value="">همه</option>
              <option value="paid">پرداخت شده</option>
              <option value="unpaid">پرداخت نشده</option>
            </select>
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
        <table className="w-full min-w-[1400px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
              <th className={cell}>شماره قسط</th>
              <th className={cell}>تاریخ سررسید</th>
              <th className={cell}>مبلغ قسط</th>
              <th className={cell}>مانده جریمه قابل پرداخت</th>
              <th className={cell}>کارمزد</th>
              <th className={cell}>بخشودگی جریمه</th>
              <th className={cell}>مجموع قابل پرداخت</th>
              <th className={cell}>تسویه با بانک</th>
              <th className={cell}>برداشت از حساب ضمانت</th>
              <th className={cell}>تاریخ پرداخت</th>
              <th className={cell}>وضعیت پرداخت</th>
              <th className={cell}>وضعیت قسط</th>
              <th className={cell}>کلاس بدهی</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-slate-400">
                  قسطی یافت نشد.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-50 text-slate-700 hover:bg-slate-50/50"
                >
                  <td className={cell}>{toFaDigits(orDash(row.installment_number))}</td>
                  <td className={cell}>
                    <span style={jalaliDateTimeStyle}>{formatJalaliDateTime(row.due_date)}</span>
                  </td>
                  <td className={cell}>{formatRial(row.amount)}</td>
                  <td className={cell}>{formatRial(row.penalty_balance)}</td>
                  <td className={cell}>{formatRial(row.fee)}</td>
                  <td className={cell}>{formatRial(row.penalty_waiver)}</td>
                  <td className={cell}>{formatRial(row.total_payable)}</td>
                  <td className={cell}>{formatRial(row.bank_settlement)}</td>
                  <td className={cell}>{formatRial(row.guarantee_withdrawal)}</td>
                  <td className={cell}>
                    <span style={jalaliDateTimeStyle}>{formatJalaliDateTime(row.payment_date)}</span>
                  </td>
                  <td className={cell}>
                    {row.payment_status ? (
                      <Badge tone={paymentStatusTone(row.payment_status)}>
                        {paymentStatusLabel(row.payment_status)}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={cell}>{orDash(row.installment_status)}</td>
                  <td className={cell}>{orDash(row.debt_class)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
