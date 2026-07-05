import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { forgotPassword } from '../api/auth'
import { PASSWORD_RULES } from '../utils/auth'
import { Check, X } from 'lucide-react'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('رمز عبور و تکرار آن یکسان نیستند')
      return
    }
    setLoading(true)
    try {
      await forgotPassword(email.trim(), password, confirm)
      toast.success('رمز عبور با موفقیت تغییر کرد')
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.error ?? 'خطا در تغییر رمز عبور')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-center text-xl font-bold text-slate-800">بازیابی رمز عبور</h1>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ایمیل</label>
            <input
              type="email"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">رمز عبور جدید</label>
            <input
              type="password"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <ul className="mt-2 space-y-1">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(password)
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
            <label className="mb-1 block text-xs font-medium text-slate-500">تکرار رمز عبور جدید</label>
            <input
              type="password"
              dir="ltr"
              className={`${inputClass} text-left`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'در حال ذخیره…' : 'تغییر رمز عبور'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-brand-600 hover:text-brand-700">
            بازگشت به ورود
          </Link>
        </p>
      </div>
    </div>
  )
}
