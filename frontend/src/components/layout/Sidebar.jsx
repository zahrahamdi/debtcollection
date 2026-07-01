import { NavLink } from 'react-router-dom'
import { navItems } from '../../routes/navItems'
import { isAdmin } from '../../utils/auth'

export default function Sidebar() {
  const items = navItems.filter((item) => !item.adminOnly || isAdmin())

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* برند */}
      <div className="flex items-center gap-3 px-5 py-5">
        <img src="/dp-logo.svg" alt="دیجی‌پی" className="h-9 w-9 shrink-0" />
        <div className="leading-tight">
          <div className="text-sm font-bold text-slate-800">دیجی‌پی</div>
          <div className="text-xs text-slate-400">وصول مطالبات</div>
        </div>
      </div>

      {/* منو */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-5 py-4 text-xs text-slate-400">
        نسخه دمو ۱.۰
      </div>
    </aside>
  )
}
