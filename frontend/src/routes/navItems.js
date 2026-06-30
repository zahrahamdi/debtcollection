import {
  FolderKanban,
  Users,
  Headset,
  Route,
  CalendarClock,
  History,
  Layers,
  Settings,
  BarChart3,
} from 'lucide-react'

// آیتم‌های منوی کناری. adminOnly یعنی فقط برای ادمین نمایش داده می‌شود.
export const navItems = [
  { to: '/cases', label: 'پرونده‌ها', icon: FolderKanban },
  { to: '/debtors', label: 'بدهکاران', icon: Users },
  { to: '/negotiators', label: 'مذاکره‌کنندگان', icon: Headset, adminOnly: true },
  { to: '/strategies', label: 'استراتژی‌ها', icon: Route, adminOnly: true },
  { to: '/installments', label: 'اقساط', icon: CalendarClock },
  { to: '/history', label: 'تاریخچه تغییرات', icon: History },
  { to: '/bulk-operations', label: 'عملیات گروهی', icon: Layers, adminOnly: true },
  { to: '/reports', label: 'گزارشات', icon: BarChart3, adminOnly: true },
  { to: '/admin', label: 'ادمین پنل', icon: Settings, adminOnly: true },
]
