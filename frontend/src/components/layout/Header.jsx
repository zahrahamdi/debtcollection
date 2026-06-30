import { Bell, Search } from 'lucide-react'
import { currentUser } from '../../utils/auth'

const roleLabel = { admin: 'ادمین وصول مطالبات', negotiator: 'مذاکره‌کننده' }

export default function Header({ title }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <h1 className="text-lg font-bold text-slate-800">{title}</h1>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label="جستجو"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label="اعلان‌ها"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 border-r border-slate-200 pr-4">
          <div className="text-left leading-tight">
            <div className="text-sm font-semibold text-slate-700">{currentUser.name}</div>
            <div className="text-xs text-slate-400">{roleLabel[currentUser.role]}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {currentUser.name?.[0] ?? 'ک'}
          </div>
        </div>
      </div>
    </header>
  )
}
