import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const roleLabel = {
  admin: 'ادمین وصول مطالبات',
  negotiator: 'مذاکره‌کننده',
}

export default function Header({ title }) {
  const { getUserDisplayName, isAdmin, isNegotiator, logout } = useAuth()
  const name = getUserDisplayName()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  const role =
    isAdmin() ? roleLabel.admin : isNegotiator() ? roleLabel.negotiator : 'کاربر'

  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <h1 className="text-lg font-bold text-slate-800">{title}</h1>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-slate-50"
        >
          <div className="text-left leading-tight">
            <div className="text-sm font-semibold text-slate-700">{name}</div>
            <div className="text-xs text-slate-400">{role}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {name?.[0] ?? 'ک'}
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              خروج از حساب کاربری
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
