import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileSpreadsheet, RefreshCw, ChevronRight, ChevronLeft } from 'lucide-react'
import { fetchCases } from '../api/cases'
import { fetchNegotiators } from '../api/negotiators'
import { isAdmin } from '../utils/auth'
import { toFaDigits } from '../utils/format'
import CasesFilters from '../components/table/CasesFilters'
import CasesTable from '../components/table/CasesTable'
import CaseDetailSidebar from '../components/sidebar/CaseDetailSidebar'
import CallOutcomeModal from '../components/modal/CallOutcomeModal'
import AssignModal from '../components/modal/AssignModal'

const emptyFilters = {
  debtor_name: '',
  national_code: '',
  credit_id: '',
  credit_type: '',
  case_status: '',
  action_status: '',
  negotiator_name: '',
}

export default function Cases() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({
    ...emptyFilters,
    national_code: searchParams.get('national_code') || '',
    negotiator_name: searchParams.get('negotiator') || '',
  })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [callModalCase, setCallModalCase] = useState(null)
  const [negotiators, setNegotiators] = useState([])
  const [assignTarget, setAssignTarget] = useState(null)
  const [detailRefresh, setDetailRefresh] = useState(0)

  const loadCases = useCallback(
    (currentPage = page) => {
      setLoading(true)
      fetchCases(filters, currentPage)
        .then(({ data, count, total_pages }) => {
          setRows(data)
          setTotal(count)
          setTotalPages(total_pages)
          setError(null)
        })
        .catch((err) => {
          console.error(err)
          setError('خطا در دریافت پرونده‌ها از سرور. آیا backend روی پورت ۳۰۰۰ اجراست؟')
        })
        .finally(() => setLoading(false))
    },
    [filters, page]
  )

  useEffect(() => {
    const initialFilters = {
      ...emptyFilters,
      national_code: searchParams.get('national_code') || '',
      negotiator_name: searchParams.get('negotiator') || '',
    }
    setFilters(initialFilters)
    setLoading(true)
    fetchCases(initialFilters, 1)
      .then(({ data, count, total_pages }) => {
        setRows(data)
        setTotal(count)
        setTotalPages(total_pages)
        setError(null)
      })
      .catch((err) => {
        console.error(err)
        setError('خطا در دریافت پرونده‌ها از سرور. آیا backend روی پورت ۳۰۰۰ اجراست؟')
      })
      .finally(() => setLoading(false))
    fetchNegotiators()
      .then(setNegotiators)
      .catch((e) => console.error(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = () => {
    setPage(1)
    setLoading(true)
    fetchCases(filters, 1)
      .then(({ data, count, total_pages }) => {
        setRows(data)
        setTotal(count)
        setTotalPages(total_pages)
        setError(null)
      })
      .catch(() => setError('خطا در دریافت پرونده‌ها'))
      .finally(() => setLoading(false))
  }

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    setLoading(true)
    fetchCases(filters, newPage)
      .then(({ data, count, total_pages }) => {
        setRows(data)
        setTotal(count)
        setTotalPages(total_pages)
      })
      .catch(() => setError('خطا در دریافت پرونده‌ها'))
      .finally(() => setLoading(false))
  }

  const handleResetFilters = () => {
    const reset = { ...emptyFilters }
    setFilters(reset)
    setPage(1)
    setLoading(true)
    fetchCases(reset, 1)
      .then(({ data, count, total_pages }) => {
        setRows(data)
        setTotal(count)
        setTotalPages(total_pages)
        setError(null)
      })
      .catch(() => setError('خطا در دریافت پرونده‌ها'))
      .finally(() => setLoading(false))
  }

  const handleSync = (kind) => {
    toast(`سینک ${kind} از Google Sheet در این نسخه دمو فعال نیست.`, { icon: '🔗' })
  }

  return (
    <div className="space-y-4">
      {/* نوار بالا */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">لیست پرونده‌ها</h2>
          <p className="mt-1 text-sm text-slate-400">
            مجموع نتایج: {toFaDigits(total)} پرونده
          </p>
        </div>

        {isAdmin() && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSync('پرونده‌ها')}
              className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              <RefreshCw className="h-4 w-4" />
              سینک پرونده‌ها از Google Sheet
            </button>
            <button
              type="button"
              onClick={() => handleSync('پرداخت‌ها')}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              سینک پرداخت‌ها از Google Sheet
            </button>
          </div>
        )}
      </div>

      {/* فیلترها */}
      <CasesFilters
        filters={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        onReset={handleResetFilters}
      />

      {/* خطا */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {/* جدول */}
      <CasesTable
        rows={rows}
        loading={loading}
        selectedId={selectedId}
        onRowClick={(row) => setSelectedId(row.id)}
        onViewHistory={(row) => navigate(`/history?case_id=${row.id}`)}
        onAssign={(row) => setAssignTarget({ row, mode: 'assign' })}
        onReassign={(row) => setAssignTarget({ row, mode: 'reassign' })}
      />

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <button
            type="button"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* سایدبار جزئیات */}
      <CaseDetailSidebar
        caseId={selectedId}
        refreshToken={detailRefresh}
        onClose={() => setSelectedId(null)}
        onRegisterCall={(detail) => setCallModalCase(detail)}
      />

      {/* مدال ثبت خروجی تماس */}
      <CallOutcomeModal
        open={Boolean(callModalCase)}
        caseRow={callModalCase}
        onClose={() => setCallModalCase(null)}
        onSaved={() => {
          loadCases(page)
          setDetailRefresh((x) => x + 1)
        }}
      />

      {/* مدال تخصیص */}
      <AssignModal
        open={Boolean(assignTarget)}
        caseRow={assignTarget?.row}
        mode={assignTarget?.mode}
        negotiators={negotiators}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => {
          loadCases(page)
          fetchNegotiators().then(setNegotiators).catch(() => {})
        }}
      />
    </div>
  )
}
