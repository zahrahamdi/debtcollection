import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Upload, Download, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  uploadCases,
  uploadPayments,
  assignCases,
  reassignCases,
  fetchBulkHistory,
  errorReportUrl,
} from '../api/bulk'
import { currentUser, isAdmin } from '../utils/auth'
import { formatSqliteDateTime, jalaliDateTimeStyle, toFaDigits } from '../utils/format'

const STATUS_TONE = {
  processing: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
}

const OPERATIONS = [
  { id: 'upload_cases', label: 'بارگذاری پرونده‌ها از Excel' },
  { id: 'upload_payments', label: 'بارگذاری پرداخت‌ها از Excel' },
  { id: 'bulk_assign', label: 'تخصیص گروهی به مذاکره‌کننده' },
  { id: 'bulk_reassign', label: 'تخصیص مجدد گروهی' },
]

const UPLOAD_HANDLERS = {
  upload_cases: uploadCases,
  upload_payments: uploadPayments,
  bulk_assign: assignCases,
  bulk_reassign: reassignCases,
}

const columns = [
  'نام کاربر',
  'نام عملیات',
  'تاریخ',
  'تعداد رکوردها',
  'تعداد موفق',
  'تعداد ناموفق',
  'وضعیت',
  'دریافت گزارش',
]

const cell = 'whitespace-nowrap px-4 py-3'
const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

function countExcelRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        resolve(rows.length)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('خطا در خواندن فایل'))
    reader.readAsArrayBuffer(file)
  })
}

function BulkOperationsSidebar({
  operationType,
  onOperationChange,
  selectedOp,
  selectedFile,
  previewCount,
  uploading,
  dragOver,
  fileRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onClear,
  onUpload,
}) {
  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:w-1/4 lg:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-800">عملیات جدید</h2>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-slate-500">نوع عملیات</label>
          <select
            className={inputClass}
            value={operationType}
            onChange={(e) => onOperationChange(e.target.value)}
          >
            <option value="">انتخاب کنید…</option>
            {OPERATIONS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {selectedOp && (
          <div className="space-y-4">
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={[
                'rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
                dragOver ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-slate-50/40',
              ].join(' ')}
            >
              <Upload className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm text-slate-600">فایل مربوطه را اینجا رها کنید</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                انتخاب فایل
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onFileChange}
                className="hidden"
              />
            </div>

            {selectedFile && (
              <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                <p className="truncate font-medium text-slate-800" title={selectedFile.name}>
                  {selectedFile.name}
                </p>
                {previewCount !== null && (
                  <p className="mt-1">
                    {toFaDigits(String(previewCount))} ردیف
                    {previewCount > 1000 && (
                      <span className="mr-2 text-rose-600">(بیش از حد مجاز)</span>
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onUpload}
                disabled={!selectedFile || uploading || previewCount > 1000}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {uploading ? 'در حال بارگذاری…' : 'بارگذاری'}
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={uploading}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                پاک کردن
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

export default function BulkOperations() {
  const fileRef = useRef(null)
  const [operationType, setOperationType] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewCount, setPreviewCount] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const selectedOp = OPERATIONS.find((op) => op.id === operationType)

  const loadHistory = () => {
    setLoadingHistory(true)
    fetchBulkHistory(currentUser.name)
      .then(setHistory)
      .catch(() => toast.error('خطا در دریافت تاریخچه'))
      .finally(() => setLoadingHistory(false))
  }

  useEffect(loadHistory, [])

  if (!isAdmin()) return <Navigate to="/cases" replace />

  const resetFileState = () => {
    setSelectedFile(null)
    setPreviewCount(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onOperationChange = (value) => {
    setOperationType(value)
    resetFileState()
  }

  const processFile = async (file) => {
    setSelectedFile(file || null)
    setPreviewCount(null)
    if (!file) return

    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error('فقط فایل Excel (.xlsx / .xls) مجاز است')
      setSelectedFile(null)
      return
    }

    try {
      const count = await countExcelRows(file)
      setPreviewCount(count)
      if (count > 1000) toast.error('حداکثر ۱۰۰۰ ردیف در هر فایل قابل پردازش است')
    } catch {
      toast.error('خطا در خواندن فایل Excel')
      setSelectedFile(null)
    }
  }

  const onFileChange = async (e) => {
    await processFile(e.target.files?.[0])
  }

  const onDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const onDragLeave = () => setDragOver(false)

  const onDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    await processFile(e.dataTransfer.files?.[0])
  }

  const onClear = () => resetFileState()

  const handleUpload = async () => {
    if (!operationType) return toast.error('نوع عملیات را انتخاب کنید')
    if (!selectedFile) return toast.error('ابتدا فایل Excel را انتخاب کنید')
    if (previewCount > 1000) return toast.error('تعداد ردیف‌ها بیش از حد مجاز است')

    const uploadFn = UPLOAD_HANDLERS[operationType]
    if (!uploadFn) return

    setUploading(true)
    try {
      await uploadFn(selectedFile, currentUser.name)
      toast.success('عملیات شما با موفقیت ثبت شد. نتیجه را در تاریخچه مشاهده کنید.')
      loadHistory()
      resetFileState()
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطا در بارگذاری فایل')
    } finally {
      setUploading(false)
    }
  }

  const downloadErrorReport = (bulkId) => {
    window.open(errorReportUrl(bulkId), '_blank')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">عملیات گروهی</h1>
        <p className="mt-1 text-sm text-slate-500">ثبت عملیات جدید و مشاهده تاریخچه</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
        <BulkOperationsSidebar
          operationType={operationType}
          onOperationChange={onOperationChange}
          selectedOp={selectedOp}
          selectedFile={selectedFile}
          previewCount={previewCount}
          uploading={uploading}
          dragOver={dragOver}
          fileRef={fileRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onFileChange={onFileChange}
          onClear={onClear}
          onUpload={handleUpload}
        />

        {/* بخش چپ — تاریخچه (حدود ۷۵٪ عرض) */}
        <section className="min-w-0 lg:w-3/4 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-800">تاریخچه عملیات گروهی</h2>
            <button
              type="button"
              onClick={loadHistory}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              به‌روزرسانی
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-right text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
                  {columns.map((col) => (
                    <th key={col} className={`${cell} font-medium`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                      در حال بارگذاری…
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                      هنوز عملیاتی ثبت نشده است
                    </td>
                  </tr>
                ) : (
                  history.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className={cell}>{row.user_name}</td>
                      <td className={cell}>{row.operation_label}</td>
                      <td className={cell}>
                        <span style={jalaliDateTimeStyle}>
                          {formatSqliteDateTime(row.created_at)}
                        </span>
                      </td>
                      <td className={cell}>{toFaDigits(String(row.total_count))}</td>
                      <td className={cell}>{toFaDigits(String(row.success_count))}</td>
                      <td className={cell}>{toFaDigits(String(row.fail_count))}</td>
                      <td className={cell}>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[row.status] || 'bg-slate-100 text-slate-600'}`}
                        >
                          {row.status_label}
                        </span>
                      </td>
                      <td className={cell}>
                        {row.has_error_report ? (
                          <button
                            type="button"
                            onClick={() => downloadErrorReport(row.id)}
                            className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
                          >
                            <Download className="h-4 w-4" />
                            Excel خطاها
                          </button>
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
        </section>
      </div>
    </div>
  )
}
