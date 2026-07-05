import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Shield, ShieldOff } from 'lucide-react'
import { fetchUsers, assignAdmin, removeAdmin } from '../../api/users'
import Badge from '../table/Badge'

const cell = 'whitespace-nowrap px-4 py-3'

function roleLabel(roles) {
  if (roles?.includes('admin')) return 'ادمین'
  if (roles?.includes('negotiator')) return 'مذاکره‌کننده'
  return 'بدون نقش'
}

export default function AdminUsersSettings() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    fetchUsers()
      .then(setUsers)
      .catch(() => toast.error('خطا در دریافت کاربران'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleAssign = async (id) => {
    setBusyId(id)
    try {
      await assignAdmin(id)
      toast.success('نقش ادمین تخصیص یافت')
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا')
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (id) => {
    setBusyId(id)
    try {
      await removeAdmin(id)
      toast.success('نقش ادمین حذف شد')
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error ?? 'خطا')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">مدیریت ادمین‌ها</h2>
        <p className="mt-1 text-sm text-slate-400">تخصیص و حذف نقش ادمین برای کاربران سیستم</p>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel">
        <table className="w-full min-w-[800px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
              <th className={`${cell} font-medium`}>نام</th>
              <th className={`${cell} font-medium`}>نام کاربری</th>
              <th className={`${cell} font-medium`}>ایمیل</th>
              <th className={`${cell} font-medium`}>نقش</th>
              <th className={`${cell} font-medium`}>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {!loading &&
              users.map((u) => {
                const isAdminUser = u.roles?.includes('admin')
                return (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className={`${cell} font-medium text-slate-800`}>
                      <span className="inline-flex items-center gap-2">
                        {u.first_name} {u.last_name}
                        {u.is_super_admin && (
                          <Badge tone="blue">سوپر ادمین</Badge>
                        )}
                      </span>
                    </td>
                    <td className={`${cell} text-slate-600`} dir="ltr">
                      {u.username}
                    </td>
                    <td className={`${cell} text-slate-600`} dir="ltr">
                      {u.email}
                    </td>
                    <td className={cell}>{roleLabel(u.roles)}</td>
                    <td className={cell}>
                      {!isAdminUser && (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => handleAssign(u.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-60"
                        >
                          <Shield className="h-3.5 w-3.5" />
                          تخصیص نقش ادمین
                        </button>
                      )}
                      {isAdminUser && !u.is_super_admin && (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => handleRemove(u.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                        >
                          <ShieldOff className="h-3.5 w-3.5" />
                          حذف نقش ادمین
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
