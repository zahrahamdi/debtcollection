import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import Modal from './Modal'
import { assignCase } from '../../api/cases'
import { toFaDigits } from '../../utils/format'
import { cooperationTypeLabel } from '../../utils/constants'

// مدال تخصیص / تخصیص مجدد (Story 3.4 و 3.5)
export default function AssignModal({ open, onClose, caseRow, mode, negotiators, onAssigned }) {
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isReassign = mode === 'reassign'
  const currentNegId = caseRow?.assigned_negotiator_id ?? null

  const close = () => {
    if (saving) return
    setSelected(null)
    setError('')
    onClose()
  }

  const submit = async () => {
    if (!selected) return setError('یک مذاکره‌کننده را انتخاب کنید.')
    setSaving(true)
    setError('')
    try {
      await assignCase(caseRow.id, selected)
      toast.success(isReassign ? 'پرونده تخصیص مجدد یافت.' : 'پرونده تخصیص یافت.')
      setSelected(null)
      onAssigned()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error ?? 'خطا در تخصیص پرونده')
    } finally {
      setSaving(false)
    }
  }

  // فقط مذاکره‌کنندگان فعال قابل انتخاب‌اند
  const list = (negotiators ?? []).filter((n) => n.status === 'active')

  return (
    <Modal
      open={open}
      onClose={close}
      title={isReassign ? 'تخصیص مجدد پرونده' : 'تخصیص پرونده به مذاکره‌کننده'}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'در حال ثبت…' : isReassign ? 'تخصیص مجدد' : 'تخصیص'}
          </button>
        </>
      }
    >
      {caseRow && (
        <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          پرونده <span className="font-medium text-slate-700">{caseRow.credit_id}</span> —{' '}
          {caseRow.debtor_name}
          {isReassign && (
            <span className="mr-2">
              · مذاکره‌کننده فعلی:{' '}
              <span className="font-medium text-slate-700">{caseRow.negotiator_name || '—'}</span>
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">انتخاب</th>
              <th className="px-3 py-2 font-medium">نام</th>
              <th className="px-3 py-2 font-medium">نوع همکاری</th>
              <th className="px-3 py-2 font-medium">ظرفیت کل</th>
              <th className="px-3 py-2 font-medium">پرونده فعال</th>
              <th className="px-3 py-2 font-medium">ظرفیت باقیمانده</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  مذاکره‌کننده‌ی فعالی وجود ندارد.
                </td>
              </tr>
            )}
            {list.map((n) => {
              const remaining = (n.capacity ?? 0) - (n.active_cases_count ?? 0)
              const isCurrent = currentNegId === n.id
              const full = remaining <= 0 && !isCurrent
              const disabled = full || isCurrent
              const isSel = selected === n.id
              return (
                <tr
                  key={n.id}
                  onClick={() => !disabled && setSelected(n.id)}
                  className={[
                    'border-b border-slate-100 transition-colors',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50',
                    isSel ? 'bg-brand-50/70' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-2">
                    <span
                      className={[
                        'flex h-5 w-5 items-center justify-center rounded-full border',
                        isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
                      ].join(' ')}
                    >
                      {isSel && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {n.name}
                    {isCurrent && <span className="mr-1 text-[11px] text-slate-400">(فعلی)</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{cooperationTypeLabel(n.cooperation_type)}</td>
                  <td className="px-3 py-2 text-slate-700">{toFaDigits(n.capacity)}</td>
                  <td className="px-3 py-2 text-slate-700">{toFaDigits(n.active_cases_count)}</td>
                  <td className="px-3 py-2">
                    <span className={remaining <= 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      {remaining <= 0 ? 'تکمیل' : toFaDigits(remaining)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
    </Modal>
  )
}
