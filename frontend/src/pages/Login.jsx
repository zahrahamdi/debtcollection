import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { login } from '../api/auth'
import { hasAnyRole, isAdmin } from '../utils/auth'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      toast.error('نام کاربری و رمز عبور اجباری است')
      return
    }
    setLoading(true)
    try {
      const user = await login(username.trim(), password)
      toast.success('ورود موفق')
      if (!hasAnyRole(user)) navigate('/waiting', { replace: true })
      else if (isAdmin(user)) navigate('/cases', { replace: true })
      else navigate('/cases', { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.error ?? 'خطا در ورود')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-center text-xl font-bold text-slate-800">ورود به سیستم</h1>
        <p className="mt-1 text-center text-sm text-slate-400">سیستم وصول مطالبات دیجی‌پی</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">نام کاربری</label>
            <input
              dir="ltr"
              className={`${inputClass} text-left`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">رمز عبور</label>
            <input
              type="password"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'در حال ورود…' : 'ورود'}
          </button>
        </form>

        <div className="mt-6 flex justify-between text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:text-brand-700">
            فراموشی رمز عبور
          </Link>
          <Link to="/register" className="text-brand-600 hover:text-brand-700">
            ثبت‌نام
          </Link>
        </div>
      </div>
    </div>
  )
}
