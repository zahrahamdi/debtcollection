import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, Search, X, ChevronRight, ChevronLeft, FolderOpen } from 'lucide-react'
import { fetchDebtors } from '../api/debtors'
import { formatRial, formatMobile, toEnDigits, toFaDigits } from '../utils/format'
import DebtorDetailSidebar from '../components/sidebar/DebtorDetailSidebar'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

const emptyFilters = {
  mobile: '',
  national_code: '',
  province: '',
  first_name: '',
  last_name: '',
  min_claims: '',
  max_claims: '',
  min_penalty: '',
  max_penalty: '',
}

const GENDER_LABELS = { male: 'مرد', female: 'زن' }

const cell = 'whitespace-nowrap px-4 py-3'

export default function Debtors() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const loadDebtors = useCallback(
    (currentPage = page, activeFilters = filters) => {
      setLoading(true)
      const payload = { ...activeFilters }
      ;['min_claims', 'max_claims', 'min_penalty', 'max_penalty'].forEach((k) => {
        if (payload[k] !== '') payload[k] = Number(toEnDigits(payload[k]))
      })
      if (payload.mobile) payload.mobile = toEnDigits(payload.mobile).replace(/\D/g, '')

      fetchDebtors(payload, currentPage)
        .then(({ data, count, total_pages }) => {
          setRows(data)
          setTotal(count)
          setTotalPages(total_pages)
          setError(null)
        })
        .catch((err) => {
          console.error(err)
          setError('خطا در دریافت لیست بدهکاران')
        })
        .finally(() => setLoading(false))
    },
    [filters, page]
  )

  useEffect(() => {
    loadDebtors(1, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = () => {
    setPage(1)
    loadDebtors(1, filters)
  }

  const handleReset = () => {
    setFilters(emptyFilters)
    setPage(1)
    loadDebtors(1, emptyFilters)
  }

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    loadDebtors(newPage, filters)
  }

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">بدهکاران</h2>
        <p className="mt-1 text-sm text-slate-400">
          مجموع: {toFaDigits(total)} بدهکار
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter className="h-4 w-4 text-brand-500" />
          فیلتر بدهکاران
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">شماره موبایل</label>
            <input value={filters.mobile} onChange={set('mobile')} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">کد ملی</label>
            <input value={filters.national_code} onChange={set('national_code')} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">استان</label>
            <input value={filters.province} onChange={set('province')} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">نام</label>
            <input value={filters.first_name} onChange={set('first_name')} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">نام خانوادگی</label>
            <input value={filters.last_name} onChange={set('last_name')} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">مجموع مطالبات از</label>
            <input value={filters.min_claims} onChange={set('min_claims')} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">مجموع مطالبات تا</label>
            <input value={filters.max_claims} onChange={set('max_claims')} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">مجموع جریمه از</label>
            <input value={filters.min_penalty} onChange={set('min_penalty')} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">مجموع جریمه تا</label>
            <input value={filters.max_penalty} onChange={set('max_penalty')} className={inputClass} dir="ltr" />
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
              <th className={cell}>نام و نام خانوادگی</th>
              <th className={cell}>شماره تماس</th>
              <th className={cell}>کد ملی</th>
              <th className={cell}>جنسیت</th>
              <th className={cell}>استان</th>
              <th className={cell}>شهر</th>
              <th className={cell}>تعداد پرونده</th>
              <th className={cell}>مجموع بدهی دیجی‌پی</th>
              <th className={cell}>مجموع مطالبات</th>
              <th className={cell}>مجموع جریمه</th>
              <th className={cell}>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                  بدهکاری یافت نشد
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={[
                    'cursor-pointer border-b border-slate-50 text-slate-700 hover:bg-slate-50/50',
                    selectedId === row.id ? 'bg-brand-50/40' : '',
                  ].join(' ')}
                >
                  <td className={`${cell} font-medium`}>
                    {row.first_name} {row.last_name}
                  </td>
                  <td className={cell}>{formatMobile(row.mobile)}</td>
                  <td className={cell}>{toFaDigits(row.national_code)}</td>
                  <td className={cell}>{GENDER_LABELS[row.gender] || '—'}</td>
                  <td className={cell}>{row.province || '—'}</td>
                  <td className={cell}>{row.city || '—'}</td>
                  <td className={cell}>{toFaDigits(row.case_count ?? 0)}</td>
                  <td className={cell}>{formatRial(row.total_outstanding_debt)}</td>
                  <td className={cell}>{formatRial(row.total_claims)}</td>
                  <td className={cell}>{formatRial(row.total_penalty)}</td>
                  <td className={cell} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/cases?national_code=${encodeURIComponent(row.national_code)}`)
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      مشاهده پرونده‌ها
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <button
            type="button"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm text-slate-600">
            صفحه {toFaDigits(page)} از {toFaDigits(totalPages)}
          </span>
          <button
            type="button"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      <DebtorDetailSidebar
        debtorId={selectedId}
        refreshToken={refreshToken}
        onClose={() => setSelectedId(null)}
        onUpdated={() => {
          loadDebtors(page, filters)
          setRefreshToken((x) => x + 1)
        }}
      />
    </div>
  )
}
