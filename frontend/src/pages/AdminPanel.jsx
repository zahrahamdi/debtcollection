import { useState } from 'react'
import { FilePlus2, Calculator, Layers3, SlidersHorizontal, Sheet, Construction, ShieldCheck } from 'lucide-react'
import GeneralSettings from '../components/admin/GeneralSettings'
import CaseCreationRules from '../components/admin/CaseCreationRules'
import CeiSettings from '../components/admin/CeiSettings'
import SegmentsSettings from '../components/admin/SegmentsSettings'
import GoogleSheetSettings from '../components/admin/GoogleSheetSettings'
import AdminUsersSettings from '../components/admin/AdminUsersSettings'

const SECTIONS = [
  { key: 'case_creation', label: 'شرایط ایجاد پرونده بدهی', icon: FilePlus2 },
  { key: 'cei', label: 'شاخص سختی وصول (CEI)', icon: Calculator },
  { key: 'segments', label: 'تعریف سگمنت‌ها', icon: Layers3 },
  { key: 'general', label: 'تنظیمات عمومی', icon: SlidersHorizontal },
  { key: 'google_sheet', label: 'تنظیمات Google Sheet', icon: Sheet },
  { key: 'admin_users', label: 'مدیریت ادمین‌ها', icon: ShieldCheck },
]

function ComingSoon({ label }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <Construction className="h-6 w-6" />
      </div>
      <h3 className="text-base font-bold text-slate-700">{label}</h3>
      <p className="mt-2 text-sm text-slate-400">این بخش به‌زودی پیاده‌سازی می‌شود.</p>
    </div>
  )
}

export default function AdminPanel() {
  const [active, setActive] = useState('case_creation')

  const renderSection = () => {
    switch (active) {
      case 'case_creation':
        return <CaseCreationRules />
      case 'cei':
        return <CeiSettings />
      case 'segments':
        return <SegmentsSettings />
      case 'general':
        return <GeneralSettings />
      case 'google_sheet':
        return <GoogleSheetSettings />
      case 'admin_users':
        return <AdminUsersSettings />
      default:
        return <ComingSoon label={SECTIONS.find((s) => s.key === active)?.label} />
    }
  }

  return (
    <div className="flex gap-5">
      {/* محتوای بخش فعال (سمت راست — طبق PRD) */}
      <div className="min-w-0 flex-1">{renderSection()}</div>

      {/* منوی عمودی بخش‌ها (سمت چپ — طبق PRD خط ۹۴۳) */}
      <aside className="w-64 shrink-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-panel">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={[
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-medium transition-colors',
                active === key
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
              ].join(' ')}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
