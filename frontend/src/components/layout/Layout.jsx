import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { navItems } from '../../routes/navItems'

function usePageTitle() {
  const { pathname } = useLocation()
  const item = navItems.find((n) => pathname.startsWith(n.to))
  return item?.label ?? 'سیستم وصول مطالبات'
}

export default function Layout() {
  const title = usePageTitle()

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
