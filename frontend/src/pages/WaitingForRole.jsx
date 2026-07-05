import { logout } from '../utils/auth'

export default function WaitingForRole() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-panel">
        <h1 className="text-lg font-bold text-slate-800">در انتظار تخصیص نقش</h1>
        <p className="mt-4 text-sm leading-8 text-slate-600">
          حساب کاربری شما ایجاد شده است.
          <br />
          لطفاً منتظر تخصیص نقش از سمت ادمین باشید.
          <br />
          در صورت نیاز با ادمین سیستم تماس بگیرید.
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-8 rounded-xl border border-slate-200 px-6 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          خروج از حساب
        </button>
      </div>
    </div>
  )
}
