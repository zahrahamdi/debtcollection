import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X } from 'lucide-react'
import { register } from '../api/auth'
import { PASSWORD_RULES } from '../utils/auth'
import { useAuth } from '../context/AuthContext'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

export default function Register() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    password: '',
    confirm_password: '',
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm_password) {
      toast.error('رمز عبور و تکرار آن یکسان نیستند')
      return
    }
    setLoading(true)
    try {
      const result = await register({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      if (result?.data?.has_role === false) {
        await refreshUser()
        navigate('/waiting', { replace: true })
        return
      }
      setSuccess(true)
    } catch (err) {
      toast.error(err?.response?.data?.error ?? 'خطا در ثبت‌نام')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-panel">
          <p className="text-sm leading-7 text-slate-600">
            ثبت‌نام شما با موفقیت انجام شد. منتظر تخصیص نقش از سمت ادمین باشید.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            بازگشت به ورود
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-center text-xl font-bold text-slate-800">ثبت‌نام</h1>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">نام</label>
              <input className={inputClass} value={form.first_name} onChange={set('first_name')} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">نام خانوادگی</label>
              <input className={inputClass} value={form.last_name} onChange={set('last_name')} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">نام کاربری (انگلیسی)</label>
            <input
              dir="ltr"
              className={`${inputClass} text-left`}
              value={form.username}
              onChange={set('username')}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ایمیل</label>
            <input
              type="email"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={form.email}
              onChange={set('email')}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">رمز عبور</label>
            <input
              type="password"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={form.password}
              onChange={set('password')}
            />
            <ul className="mt-2 space-y-1">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(form.password)
                return (
                  <li key={rule.key} className="flex items-center gap-2 text-xs text-slate-500">
                    {ok ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-rose-400" />
                    )}
                    {rule.label}
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">تکرار رمز عبور</label>
            <input
              type="password"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={form.confirm_password}
              onChange={set('confirm_password')}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'در حال ثبت…' : 'ثبت‌نام'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          حساب دارید؟{' '}
          <Link to="/login" className="text-brand-600 hover:text-brand-700">
            ورود
          </Link>
        </p>
      </div>
    </div>
  )
}
