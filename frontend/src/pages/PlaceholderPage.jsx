import { Construction } from 'lucide-react'

// صفحه placeholder عمومی برای بخش‌هایی که هنوز پیاده نشده‌اند
export default function PlaceholderPage({ title, description }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <Construction className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-bold text-slate-700">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        {description ?? 'این بخش در نسخه‌های بعدی پیاده‌سازی خواهد شد.'}
      </p>
    </div>
  )
}
