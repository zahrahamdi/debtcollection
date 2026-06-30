import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Phone,
  MessageSquare,
  PhoneCall,
  Clock,
  FileText,
  ListChecks,
  ChevronLeft,
} from 'lucide-react'
import Badge from '../table/Badge'
import { fetchCaseById } from '../../api/cases'
import { formatRial, formatDate, toFaDigits, orDash } from '../../utils/format'
import {
  caseStatusLabel,
  caseStatusTone,
  actionStatusLabel,
  actionStatusTone,
  creditTypeLabel,
  guaranteeTypeLabel,
  actionTypeLabel,
} from '../../utils/constants'

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-left text-sm font-medium text-slate-700">{value}</span>
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <h4 className="mb-2 mt-5 border-r-2 border-brand-500 pr-2 text-sm font-bold text-slate-700">
      {children}
    </h4>
  )
}

const actionIconByType = { sms: MessageSquare, autocall: Phone, call: PhoneCall }
const iconFor = (type) => actionIconByType[type] ?? Clock

// مراحلی که در آن‌ها اقدام جاری «تماس مذاکره‌کننده» است
const NEGOTIATOR_STAGES = ['in_negotiation', 'pending_negotiator_call', 'pending_negotiator_result']

// شرط مجاز بودن ثبت خروجی تماس (Story 3.3):
// پرونده در مرحله‌ی تماس مذاکره‌کننده باشد و وضعیت اقدام «معوق» یا «نوبت امروز» باشد.
function canRegisterCall(detail) {
  return (
    Boolean(detail) &&
    NEGOTIATOR_STAGES.includes(detail.case_status) &&
    ['overdue', 'due_today'].includes(detail.action_status)
  )
}

// وضعیت تعهد پرداخت (بخش ۵.۸ PRD)
function promiseLabel(detail) {
  if (detail.active_promise) {
    return `در انتظار — سررسید ${formatDate(detail.active_promise.promised_date)}`
  }
  if ((detail.broken_promises_count ?? 0) > 0) return 'نقض شده'
  return 'ندارد'
}

export default function CaseDetailSidebar({ caseId, refreshToken, onClose, onRegisterCall }) {
  const open = Boolean(caseId)
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!caseId) return
    let active = true
    setLoading(true)
    setDetail(null)
    fetchCaseById(caseId)
      .then((d) => active && setDetail(d))
      .catch((e) => console.error(e))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [caseId, refreshToken])

  // شماره اولین/آخرین قسط پرداخت‌نشده به شکل «قسط X از Y»
  const installmentOf = (no, total) =>
    no ? `قسط ${toFaDigits(no)} از ${toFaDigits(orDash(total))}` : '—'

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={onClose} />}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 w-[400px] max-w-full transform overflow-y-auto bg-white shadow-drawer transition-transform duration-300',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            در حال بارگذاری…
          </div>
        )}

        {!loading && detail && (
          <div className="flex min-h-full flex-col">
            {/* هدر */}
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <div className="text-base font-bold text-slate-800">{detail.debtor_name}</div>
                <div className="mt-1 text-xs text-slate-400">پرونده {orDash(detail.credit_id)}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                aria-label="بستن"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 px-5 pb-5">
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge tone={caseStatusTone(detail.case_status)}>
                  {caseStatusLabel(detail.case_status)}
                </Badge>
                <Badge tone={actionStatusTone(detail.action_status)}>
                  {actionStatusLabel(detail.action_status)}
                </Badge>
              </div>

              {/* اطلاعات اصلی پرونده */}
              <SectionTitle>اطلاعات پرونده</SectionTitle>
              <div className="divide-y divide-slate-50">
                <InfoRow label="نام بدهکار" value={orDash(detail.debtor_name)} />
                <InfoRow label="مسئول پرونده" value={orDash(detail.negotiator_name)} />
                <InfoRow label="نوع اعتبار" value={creditTypeLabel(detail.credit_type)} />
                <InfoRow label="نوع ضمانت" value={guaranteeTypeLabel(detail.guarantee_type)} />
                <InfoRow label="کلاس بدهی" value={orDash(detail.debt_class)} />
                <InfoRow label="استان سکونت" value={orDash(detail.province)} />
                <InfoRow label="روزهای دیرکرد (DPD)" value={toFaDigits(orDash(detail.dpd))} />
                <InfoRow label="مطالبات (ریال)" value={formatRial(detail.claims_amount)} />
                <InfoRow label="جریمه انباشته (ریال)" value={formatRial(detail.penalty_amount)} />
              </div>

              {/* اطلاعات اقساط */}
              <SectionTitle>اطلاعات اقساط</SectionTitle>
              <div className="divide-y divide-slate-50">
                <InfoRow
                  label="اولین قسط پرداخت‌نشده"
                  value={installmentOf(detail.first_unpaid_no, detail.total_installments)}
                />
                <InfoRow label="تاریخ اولین قسط" value={formatDate(detail.first_unpaid_date)} />
                <InfoRow
                  label="آخرین قسط پرداخت‌نشده"
                  value={installmentOf(detail.last_unpaid_no, detail.total_installments)}
                />
                <InfoRow label="تاریخ آخرین قسط" value={formatDate(detail.last_unpaid_date)} />
                <InfoRow
                  label="تعداد اقساط سررسید گذشته"
                  value={toFaDigits(orDash(detail.overdue_installments_count))}
                />
                <InfoRow label="تاریخ آخرین پرداخت" value={formatDate(detail.last_payment_date)} />
                <InfoRow
                  label="مبلغ آخرین پرداخت (ریال)"
                  value={formatRial(detail.last_payment_amount)}
                />
              </div>
              <button
                type="button"
                onClick={() => navigate('/installments')}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <ListChecks className="h-4 w-4" />
                مشاهده لیست اقساط
                <ChevronLeft className="h-4 w-4" />
              </button>

              {/* اقدامات و تماس‌ها */}
              <SectionTitle>اقدام و تماس</SectionTitle>
              <div className="divide-y divide-slate-50">
                <InfoRow label="آخرین اقدام انجام‌شده" value={orDash(detail.last_action)} />
                <InfoRow label="تاریخ آخرین اقدام" value={formatDate(detail.last_action_date)} />
                <InfoRow
                  label="تعداد تماس‌های انجام‌شده"
                  value={`${toFaDigits(orDash(detail.call_count))} از ${toFaDigits(orDash(detail.max_call_count))}`}
                />
              </div>

              {/* CEI و استراتژی */}
              <SectionTitle>شاخص سختی وصول و استراتژی</SectionTitle>
              <div className="divide-y divide-slate-50">
                <InfoRow label="CEI محاسبه‌شده" value={toFaDigits(orDash(detail.cei))} />
                <InfoRow label="نسخه فرمول CEI" value={orDash(detail.cei_formula_version)} />
                <InfoRow label="سگمنت پرونده" value={orDash(detail.segment_title)} />
                <InfoRow label="استراتژی فعال" value={orDash(detail.strategy_title)} />
                <InfoRow label="هزینه پرونده (ریال)" value={formatRial(detail.case_cost)} />
              </div>

              {/* تعهد پرداخت */}
              <SectionTitle>تعهد پرداخت</SectionTitle>
              <div className="divide-y divide-slate-50">
                <InfoRow label="وضعیت تعهد پرداخت" value={promiseLabel(detail)} />
                <InfoRow
                  label="تعداد تعهدات نقض‌شده"
                  value={toFaDigits(detail.broken_promises_count ?? 0)}
                />
              </div>

              {/* فایل‌های پرونده */}
              <SectionTitle>فایل‌های پرونده</SectionTitle>
              {detail.files?.length ? (
                <ul className="space-y-2">
                  {detail.files.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm text-slate-600"
                    >
                      <FileText className="h-4 w-4 text-brand-500" />
                      {f.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-xs text-slate-400">فایلی بارگذاری نشده است.</p>
              )}

              {/* پرونده‌های دیگر بدهکار */}
              <SectionTitle>پرونده‌های دیگر بدهکار</SectionTitle>
              {detail.other_cases?.length ? (
                <ul className="space-y-2">
                  {detail.other_cases.map((oc) => (
                    <li
                      key={oc.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">
                          {orDash(oc.credit_id)}
                        </span>
                        <Badge tone={caseStatusTone(oc.case_status)}>
                          {caseStatusLabel(oc.case_status)}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                        <span>{creditTypeLabel(oc.credit_type)}</span>
                        <span>مطالبات: {formatRial(oc.claims_amount)} ریال</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-xs text-slate-400">پرونده دیگری برای این بدهکار وجود ندارد.</p>
              )}

              {/* سابقه اقدامات روی پرونده */}
              <SectionTitle>سابقه اقدامات روی پرونده</SectionTitle>
              {detail.actions?.length ? (
                <ol className="space-y-3">
                  {detail.actions.map((a, idx) => {
                    const Icon = iconFor(
                      a.action_type?.includes('sms')
                        ? 'sms'
                        : a.action_type?.includes('autocall')
                          ? 'autocall'
                          : 'call'
                    )
                    const isLast = idx === detail.actions.length - 1
                    const showRegister = isLast && canRegisterCall(detail)
                    return (
                      <li key={a.id} className="flex gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">
                              اقدام {toFaDigits(idx + 1)}: {actionTypeLabel(a.action_type)}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {formatDate(a.action_date)}
                            </span>
                          </div>
                          {a.body_text && (
                            <p className="mt-1 text-xs leading-5 text-slate-500">{a.body_text}</p>
                          )}
                          {a.call_status && (
                            <p className="mt-1 text-xs text-slate-500">
                              وضعیت تماس: {a.call_status}
                            </p>
                          )}
                          <div className="mt-1 text-xs text-slate-400">
                            نتیجه: {orDash(a.result)}
                          </div>

                          {showRegister && (
                            <div className="mt-2 border-t border-slate-100 pt-2">
                              <div className="mb-2 text-[11px] text-slate-400">
                                نمایش تماس شماره {toFaDigits(detail.call_count)} از{' '}
                                {toFaDigits(detail.max_call_count)}
                              </div>
                              <button
                                type="button"
                                onClick={() => onRegisterCall(detail)}
                                className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                              >
                                <PhoneCall className="h-3.5 w-3.5" />
                                ثبت خروجی تماس
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="py-2 text-xs text-slate-400">اقدامی روی این پرونده ثبت نشده است.</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
