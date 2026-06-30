import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Upload, Download, FileSpreadsheet, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { uploadCases, fetchBulkHistory, errorReportUrl } from '../api/bulk'
import { currentUser, isAdmin } from '../utils/auth'
import { toFaDigits } from '../utils/format'

const STATUS_TONE = {
  processing: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
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

function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('fa-IR')
  } catch {
    return iso
  }
}

export default function BulkOperations() {
  const fileRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewCount, setPreviewCount] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const loadHistory = () => {
    setLoadingHistory(true)
    fetchBulkHistory(currentUser.name)
      .then(setHistory)
      .catch(() => toast.error('خطا در دریافت تاریخچه'))
      .finally(() => setLoadingHistory(false))
  }

  useEffect(loadHistory, [])

  if (!isAdmin()) return <Navigate to="/cases" replace />

  const onFileChange = async (e) => {
    const file = e.target.files?.[0]
    setSelectedFile(file || null)
    setLastResult(null)
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

  const handleUpload = async () => {
    if (!selectedFile) return toast.error('ابتدا فایل Excel را انتخاب کنید')
    if (previewCount > 1000) return toast.error('تعداد ردیف‌ها بیش از حد مجاز است')

    setUploading(true)
    try {
      const result = await uploadCases(selectedFile, currentUser.name)
      setLastResult(result)
      toast.success('عملیات شما با موفقیت ثبت شد. نتیجه را در تاریخچه مشاهده کنید.')
      loadHistory()
      setSelectedFile(null)
      setPreviewCount(null)
      if (fileRef.current) fileRef.current.value = ''
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
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-800">عملیات گروهی</h1>
        <p className="mt-1 text-sm text-slate-500">
          بارگذاری پرونده‌ها از فایل Excel و مشاهده تاریخچه عملیات
        </p>
      </div>

      {/* آپلود پرونده‌ها */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-slate-800">بارگذاری پرونده‌ها از Excel</h2>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">فایل Excel</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onFileChange}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || uploading || previewCount > 1000}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'در حال بارگذاری…' : 'بارگذاری'}
          </button>
        </div>

        {previewCount !== null && (
          <p className="mt-3 text-sm text-slate-600">
            پیش‌نمایش:{' '}
            <span className="font-medium text-slate-800">{toFaDigits(String(previewCount))}</span>{' '}
            ردیف
            {previewCount > 1000 && (
              <span className="mr-2 text-rose-600">(بیش از حد مجاز)</span>
            )}
          </p>
        )}

        {lastResult && (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-800">نتیجه آخرین بارگذاری</p>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>
                موفق:{' '}
                <span className="font-medium text-emerald-700">
                  {toFaDigits(String(lastResult.success_count))}
                </span>{' '}
                ({toFaDigits(String(lastResult.created))} ایجاد،{' '}
                {toFaDigits(String(lastResult.updated))} به‌روزرسانی)
              </li>
              <li>
                خطا:{' '}
                <span className="font-medium text-rose-700">
                  {toFaDigits(String(lastResult.fail_count))}
                </span>
              </li>
            </ul>
            {lastResult.has_error_report && (
              <button
                type="button"
                onClick={() => downloadErrorReport(lastResult.bulk_id)}
                className="mt-3 inline-flex items-center gap-1.5 text-brand-600 hover:text-brand-700"
              >
                <Download className="h-4 w-4" />
                دانلود فایل Excel خطاها
              </button>
            )}
          </div>
        )}
      </section>

      {/* تاریخچه */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                    <td className={cell}>{formatDateTime(row.created_at)}</td>
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
  )
}
