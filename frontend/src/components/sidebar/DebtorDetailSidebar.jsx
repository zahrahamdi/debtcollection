import { useEffect, useState } from 'react'
import { X, Plus, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchDebtorById, addPhoneNumber } from '../../api/debtors'
import { formatMobile, formatRial, orDash, toEnDigits, toFaDigits } from '../../utils/format'

const SOURCE_LABELS = {
  digipay: 'دیجی‌پی',
  digikala: 'دیجی‌کالا',
  inquiry: 'استعلام',
  manual: 'وارد شده دستی',
}

const GENDER_LABELS = { male: 'مرد', female: 'زن' }

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || '—'
}

function SectionTitle({ children }) {
  return (
    <h4 className="mb-2 mt-5 border-r-2 border-brand-500 pr-2 text-sm font-bold text-slate-700">
      {children}
    </h4>
  )
}

function validatePhone(raw) {
  const digits = toEnDigits(raw).replace(/\D/g, '')
  if (digits.length !== 11) return 'شماره موبایل باید ۱۱ رقم باشد'
  if (!digits.startsWith('09')) return 'شماره موبایل باید با ۰۹ شروع شود'
  return null
}

function allPhones(debtor) {
  if (!debtor) return []
  const list = [...(debtor.phone_numbers || [])]
  const main = debtor.mobile ? toEnDigits(debtor.mobile).replace(/\D/g, '') : ''
  if (main && !list.some((p) => toEnDigits(p.phone).replace(/\D/g, '') === main)) {
    list.unshift({ id: 'main', phone: debtor.mobile, source: 'digipay' })
  }
  return list
}

export default function DebtorDetailSidebar({ debtorId, refreshToken, onClose, onUpdated }) {
  const open = Boolean(debtorId)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [addingPhone, setAddingPhone] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    if (!debtorId) return
    setLoading(true)
    fetchDebtorById(debtorId)
      .then(setDetail)
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت جزئیات بدهکار')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!debtorId) {
      setDetail(null)
      return
    }
    setAddingPhone(false)
    setNewPhone('')
    setPhoneError('')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debtorId, refreshToken])

  const handleAddPhone = async () => {
    const err = validatePhone(newPhone)
    if (err) return setPhoneError(err)
    setSaving(true)
    setPhoneError('')
    try {
      await addPhoneNumber(debtorId, toEnDigits(newPhone).replace(/\D/g, ''))
      toast.success('شماره تماس اضافه شد')
      setNewPhone('')
      setAddingPhone(false)
      load()
      onUpdated?.()
    } catch (e) {
      setPhoneError(e.response?.data?.error || 'خطا در افزودن شماره')
    } finally {
      setSaving(false)
    }
  }

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
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <div className="text-base font-bold text-slate-800">
                  {detail.first_name} {detail.last_name}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  کد ملی {orDash(detail.national_code)}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50"
                aria-label="بستن"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 px-5 pb-5">
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">جنسیت</span>
                  <span className="font-medium text-slate-700">
                    {GENDER_LABELS[detail.gender] || orDash(detail.gender)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">تعداد پرونده</span>
                  <span className="font-medium text-slate-700">
                    {toFaDigits(detail.case_count ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">مجموع مطالبات</span>
                  <span className="font-medium text-slate-700">
                    {formatRial(detail.total_claims)} ریال
                  </span>
                </div>
              </div>

              <SectionTitle>شماره‌های تماس</SectionTitle>
              <ul className="space-y-2">
                {allPhones(detail).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-slate-700">{formatMobile(p.phone)}</span>
                    <span className="text-xs text-slate-400">{sourceLabel(p.source)}</span>
                  </li>
                ))}
                {allPhones(detail).length === 0 && (
                  <p className="text-xs text-slate-400">شماره‌ای ثبت نشده</p>
                )}
              </ul>

              {!addingPhone ? (
                <button
                  type="button"
                  onClick={() => setAddingPhone(true)}
                  className="mt-3 flex items-center gap-2 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  <Plus className="h-4 w-4" />
                  افزودن شماره تماس جدید
                </button>
              ) : (
                <div className="mt-3 rounded-xl border border-slate-200 p-3">
                  <label className="mb-1 flex items-center gap-1 text-xs text-slate-500">
                    <Phone className="h-3.5 w-3.5" />
                    شماره موبایل (۱۱ رقم، ۰۹...)
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => {
                      setNewPhone(e.target.value)
                      setPhoneError('')
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    dir="ltr"
                    placeholder="09123456789"
                  />
                  {phoneError && (
                    <p className="mt-1 text-xs text-rose-500">{phoneError}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleAddPhone}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {saving ? 'در حال ذخیره…' : 'تایید'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingPhone(false)
                        setNewPhone('')
                        setPhoneError('')
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              )}

              <SectionTitle>آدرس‌ها</SectionTitle>
              {detail.addresses?.length ? (
                <ul className="space-y-3">
                  {detail.addresses.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm"
                    >
                      <p className="text-slate-700">{a.address}</p>
                      <div className="mt-1 flex justify-between text-xs text-slate-400">
                        <span>{sourceLabel(a.source)}</span>
                        {a.postal_code && (
                          <span>کد پستی: {toFaDigits(a.postal_code)}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">آدرسی ثبت نشده</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
