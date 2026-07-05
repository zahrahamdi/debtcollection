import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Pencil } from 'lucide-react'
import { fetchNegotiators, createNegotiator, updateNegotiator } from '../api/negotiators'
import { fetchUsers } from '../api/users'
import { isAdmin } from '../utils/auth'
import { toFaDigits, formatRial } from '../utils/format'
import { cooperationTypeLabel, negotiatorStatusLabel } from '../utils/constants'
import Badge from '../components/table/Badge'
import Modal from '../components/modal/Modal'

const columns = [
  'نام مذاکره‌کننده',
  'وضعیت',
  'نوع همکاری',
  'حقوق ساعتی (ریال)',
  'ظرفیت کاری',
  'پرونده‌های فعال',
  'تماس‌های امروز',
  'اقدامات معوق',
  'نرخ موفقیت',
  'عملیات',
]

const cell = 'whitespace-nowrap px-4 py-3'
const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400'
const labelClass = 'mb-1 block text-xs font-medium text-slate-500'

const emptyForm = { user_id: '', cooperation_type: 'internal', capacity: '', hourly_wage: '', status: 'active' }

export default function Negotiators() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [eligibleUsers, setEligibleUsers] = useState([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    fetchNegotiators()
      .then(setRows)
      .catch((e) => {
        console.error(e)
        toast.error('خطا در دریافت مذاکره‌کنندگان')
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const loadEligibleUsers = () => {
    fetchUsers({ without_role: 'negotiator' })
      .then(setEligibleUsers)
      .catch(() => toast.error('خطا در دریافت کاربران'))
  }

  const goToCases = (n) => navigate(`/cases?negotiator=${encodeURIComponent(n.name)}`)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    loadEligibleUsers()
    setModalOpen(true)
  }

  const openEdit = (n) => {
    setEditing(n)
    setForm({
      user_id: String(n.user_id || ''),
      cooperation_type: n.cooperation_type,
      capacity: String(n.capacity ?? ''),
      hourly_wage: String(n.hourly_wage ?? ''),
      status: n.status,
    })
    setFormError('')
    setModalOpen(true)
  }

  const selectedUser = eligibleUsers.find((u) => String(u.id) === String(form.user_id))

  const save = async () => {
    if (!editing && !form.user_id) return setFormError('انتخاب کاربر اجباری است.')
    if (form.capacity === '' || Number(form.capacity) < 0 || !Number.isInteger(Number(form.capacity)))
      return setFormError('ظرفیت کاری باید عدد صحیح نامنفی باشد.')
    if (!Number.isInteger(Number(form.hourly_wage)) || Number(form.hourly_wage) <= 0)
      return setFormError('حقوق ساعتی باید عدد صحیح مثبت باشد.')

    setSaving(true)
    setFormError('')
    try {
      if (editing) {
        await updateNegotiator(editing.id, {
          capacity: Number(form.capacity),
          status: form.status,
          cooperation_type: form.cooperation_type,
          hourly_wage: Number(form.hourly_wage),
        })
      } else {
        await createNegotiator({
          user_id: Number(form.user_id),
          cooperation_type: form.cooperation_type,
          capacity: Number(form.capacity),
          hourly_wage: Number(form.hourly_wage),
        })
      }
      toast.success(editing ? 'مذاکره‌کننده ویرایش شد.' : 'مذاکره‌کننده ایجاد شد.')
      setModalOpen(false)
      load()
    } catch (e) {
      setFormError(e?.response?.data?.error ?? 'خطا در ذخیره مذاکره‌کننده')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">مذاکره‌کنندگان</h2>
          <p className="mt-1 text-sm text-slate-400">مجموع: {toFaDigits(rows.length)} مذاکره‌کننده</p>
        </div>
        {isAdmin() && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            افزودن مذاکره‌کننده
          </button>
        )}
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-panel">
        <table className="w-full min-w-[1000px] border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500">
              {columns.map((c) => (
                <th key={c} className={`${cell} font-medium`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  در حال بارگذاری…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                  مذاکره‌کننده‌ای تعریف نشده است.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => goToCases(n)}
                  className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                >
                  <td className={`${cell} font-medium text-slate-800`}>{n.name}</td>
                  <td className={cell}>
                    <Badge tone={n.status === 'active' ? 'green' : 'gray'}>
                      {negotiatorStatusLabel(n.status)}
                    </Badge>
                  </td>
                  <td className={`${cell} text-slate-600`}>{cooperationTypeLabel(n.cooperation_type)}</td>
                  <td className={`${cell} text-slate-700`}>{formatRial(n.hourly_wage)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(n.capacity)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(n.active_cases_count)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(n.today_calls)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(n.overdue_actions)}</td>
                  <td className={`${cell} text-slate-700`}>{toFaDigits(n.success_rate)}٪</td>
                  <td className={cell}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(n)
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                      title="ویرایش"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'ویرایش مذاکره‌کننده' : 'افزودن مذاکره‌کننده'}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {editing ? (
            <div>
              <label className={labelClass}>نام مذاکره‌کننده</label>
              <input className={inputClass} value={editing.name} disabled />
            </div>
          ) : (
            <>
              <div>
                <label className={labelClass}>کاربر</label>
                <select
                  className={inputClass}
                  value={form.user_id}
                  onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                >
                  <option value="">انتخاب کاربر…</option>
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.first_name} {u.last_name} ({u.username})
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  کاربر باید ابتدا در سیستم ثبت‌نام کرده باشد و هنوز نقش مذاکره‌کننده نداشته باشد.
                  بعد از تخصیص، نقش مذاکره‌کننده به او داده می‌شود.
                </p>
              </div>
              {selectedUser && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <div>
                    {selectedUser.first_name} {selectedUser.last_name}
                  </div>
                  <div dir="ltr" className="text-xs text-slate-400">
                    {selectedUser.email}
                  </div>
                </div>
              )}
            </>
          )}
          <div>
            <label className={labelClass}>نوع همکاری</label>
            <select
              className={inputClass}
              value={form.cooperation_type}
              onChange={(e) => setForm((f) => ({ ...f, cooperation_type: e.target.value }))}
            >
              <option value="internal">داخلی</option>
              <option value="outsourced">برون‌سپاری</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>ظرفیت کاری</label>
              <input
                type="number"
                dir="ltr"
                min="0"
                className={`${inputClass} text-left`}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>حقوق ساعتی (ریال)</label>
              <input
                type="number"
                dir="ltr"
                min="1"
                className={`${inputClass} text-left`}
                value={form.hourly_wage}
                onChange={(e) => setForm((f) => ({ ...f, hourly_wage: e.target.value }))}
              />
              {form.hourly_wage && (
                <p className="mt-1 text-[11px] text-slate-400">{formatRial(form.hourly_wage)} ریال</p>
              )}
            </div>
          </div>
          {editing && (
            <div>
              <label className={labelClass}>وضعیت</label>
              <select
                className={inputClass}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="active">فعال</option>
                <option value="inactive">غیرفعال</option>
              </select>
            </div>
          )}
          {!editing && (
            <p className="text-[11px] text-slate-400">وضعیت مذاکره‌کننده‌ی جدید به‌صورت پیش‌فرض «فعال» است.</p>
          )}
          {formError && <p className="text-sm text-rose-500">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
