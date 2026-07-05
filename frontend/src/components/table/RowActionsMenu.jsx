import { useState, useRef, useEffect } from 'react'
import { MoreVertical, History, UserPlus, Repeat, Scale } from 'lucide-react'
import { hasPermission } from '../../utils/auth'

// منوی عملیات هر ردیف (بخش ۳.۱ PRD)
export default function RowActionsMenu({ row, onViewHistory, onAssign, onReassign }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const canManageAssign = hasPermission('cases', 'reassign')
  const canAssign = row.case_status === 'pending_negotiator_assignment'
  const canReassign = Boolean(row.assigned_negotiator_id)

  const items = [
    {
      label: 'مشاهده تاریخچه تغییرات',
      icon: History,
      onClick: () => onViewHistory?.(row),
      show: true,
    },
    {
      label: 'تخصیص به مذاکره‌کننده',
      icon: UserPlus,
      onClick: () => onAssign?.(row),
      show: canManageAssign,
      disabled: !canAssign,
    },
    {
      label: 'تخصیص مجدد',
      icon: Repeat,
      onClick: () => onReassign?.(row),
      show: canManageAssign,
      disabled: !canReassign,
    },
    {
      label: 'تخصیص به حقوقی',
      icon: Scale,
      onClick: () => {},
      show: true,
      disabled: true, // طبق PRD فعلاً غیرفعال
    },
  ].filter((i) => i.show)

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="عملیات"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map(({ label, icon: Icon, onClick, disabled }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => {
                onClick()
                setOpen(false)
              }}
              className={[
                'flex w-full items-center gap-2 px-3 py-2 text-right text-sm',
                disabled
                  ? 'cursor-not-allowed text-slate-300'
                  : 'text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
