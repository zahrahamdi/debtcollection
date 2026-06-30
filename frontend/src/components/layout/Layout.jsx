import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { navItems } from '../../routes/navItems'

// عنوان صفحه را بر اساس مسیر فعلی پیدا می‌کند
function usePageTitle() {
  const { pathname } = useLocation()
  const item = navItems.find((n) => pathname.startsWith(n.to))
  return item?.label ?? 'سیستم وصول مطالبات'
}

export default function Layout({ children }) {
  const title = usePageTitle()

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      {/* منوی کناری سمت راست (به دلیل dir=rtl به‌صورت طبیعی راست قرار می‌گیرد) */}
      <Sidebar />

      {/* بخش اصلی */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
