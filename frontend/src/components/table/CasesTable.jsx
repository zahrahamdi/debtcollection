import Badge from './Badge'
import RowActionsMenu from './RowActionsMenu'
import { formatRial, formatJalaliDateTime, jalaliDateTimeStyle, formatMobile, orDash, toFaDigits } from '../../utils/format'
import {
  caseStatusLabel,
  caseStatusTone,
  actionStatusLabel,
  actionStatusTone,
  creditTypeLabel,
  guaranteeTypeLabel,
  normalizeLastActionLabel,
} from '../../utils/constants'

// ستون‌های گرید مطابق بخش ۳.۱ PRD
const columns = [
  'نام بدهکار',
  'کد ملی',
  'شماره تماس',
  'شناسه اعتبار',
  'نوع اعتبار',
  'تامین‌کننده',
  'مبلغ اعتبار (ریال)',
  'نوع ضمانت',
  'کلاس بدهی',
  'روزهای دیرکرد (DPD)',
  'بدهی غیرجاری پرداخت‌نشده',
  'مطالبات (کل غیرجاری)',
  'جریمه انباشته',
  'مسئول پرونده',
  'آخرین اقدام انجام‌شده',
  'وضعیت پرونده',
  'اقدام بعدی',
  'تاریخ اقدام بعدی',
  'وضعیت اقدام',
  'عملیات',
]

const cell = 'whitespace-nowrap px-4 py-3'

export default function CasesTable({
  rows,
  loading,
  selectedId,
  onRowClick,
  onViewHistory,
  onAssign,
  onReassign,
}) {
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel">
      <table className="w-full min-w-[1700px] border-collapse text-right text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
            {columns.map((c) => (
              <th key={c} className={`${cell} font-medium`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                در حال بارگذاری…
              </td>
            </tr>
          )}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                پرونده‌ای یافت نشد.
              </td>
            </tr>
          )}

          {!loading &&
            rows.map((row) => {
              const selected = row.id === selectedId
              return (
                <tr
                  key={row.id}
                  onClick={() => onRowClick(row)}
                  className={[
                    'cursor-pointer border-b border-slate-100 transition-colors',
                    selected ? 'bg-brand-50/70' : 'hover:bg-slate-50',
                  ].join(' ')}
                >
                  <td className={`${cell} font-medium text-slate-800`}>{orDash(row.debtor_name)}</td>
                  <td className={`${cell} text-slate-600`}>{toFaDigits(orDash(row.national_code))}</td>
                  <td className={`${cell} text-slate-600`}>{formatMobile(row.mobile)}</td>
                  <td className={`${cell} text-slate-600`}>{orDash(row.credit_id)}</td>
                  <td className={`${cell} text-slate-600`}>{creditTypeLabel(row.credit_type)}</td>
                  <td className={`${cell} text-slate-600`}>{orDash(row.supplier)}</td>
                  <td className={`${cell} text-slate-700`}>{formatRial(row.credit_amount)}</td>
                  <td className={`${cell} text-slate-600`}>{guaranteeTypeLabel(row.guarantee_type)}</td>
                  <td className={`${cell} text-slate-600`}>{orDash(row.debt_class)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(orDash(row.dpd))}</td>
                  <td className={`${cell} text-slate-700`}>{formatRial(row.outstanding_debt)}</td>
                  <td className={`${cell} text-slate-700`}>{formatRial(row.claims_amount)}</td>
                  <td className={`${cell} text-slate-700`}>{formatRial(row.penalty_amount)}</td>
                  <td className={`${cell} text-slate-600`}>{orDash(row.negotiator_name)}</td>
                  <td className={`${cell} text-slate-600`}>{orDash(normalizeLastActionLabel(row.last_action))}</td>
                  <td className={cell}>
                    <Badge tone={caseStatusTone(row.case_status)}>
                      {caseStatusLabel(row.case_status)}
                    </Badge>
                  </td>
                  <td className={`${cell} text-slate-600`}>{orDash(row.next_action)}</td>
                  <td className={`${cell} text-slate-600`}>
                    <span style={jalaliDateTimeStyle}>{formatJalaliDateTime(row.next_action_date)}</span>
                  </td>
                  <td className={cell}>
                    <Badge tone={actionStatusTone(row.action_status)}>
                      {actionStatusLabel(row.action_status)}
                    </Badge>
                  </td>
                  <td className={cell}>
                    <RowActionsMenu
                      row={row}
                      onViewHistory={onViewHistory}
                      onAssign={onAssign}
                      onReassign={onReassign}
                    />
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
