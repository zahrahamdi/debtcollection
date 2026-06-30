// ثابت‌ها و نگاشت‌های نمایشی (برچسب فارسی برای کلیدهای backend)

// وضعیت‌های پرونده — مطابق بخش ۶.۱ PRD
export const CASE_STATUS = {
  pending_cei: { label: 'در انتظار محاسبه CEI', tone: 'gray' },
  pending_strategy: { label: 'در انتظار تخصیص استراتژی', tone: 'gray' },
  pending_strategy_start: { label: 'در انتظار شروع استراتژی', tone: 'gray' },
  pending_sms_result: { label: 'در انتظار نتیجه پیامک', tone: 'blue' },
  pending_autocall_result: { label: 'در انتظار نتیجه تماس خودکار', tone: 'blue' },
  pending_negotiator_assignment: { label: 'در انتظار تخصیص به مذاکره‌کننده', tone: 'amber' },
  pending_negotiator_call: { label: 'در انتظار تماس مذاکره‌کننده', tone: 'amber' },
  pending_negotiator_result: { label: 'در انتظار نتیجه تماس مذاکره‌کننده', tone: 'amber' },
  in_negotiation: { label: 'در انتظار نتیجه تماس مذاکره‌کننده', tone: 'amber' },
  pending_legal_assignment: { label: 'در انتظار تخصیص به حقوقی', tone: 'red' },
  paid: { label: 'پرداخت شده', tone: 'green' },
  burned: { label: 'سوخت شده', tone: 'red' },
}

// وضعیت اقدام — بخش ۶.۲ PRD
export const ACTION_STATUS = {
  waiting: { label: 'در انتظار', tone: 'gray' },
  due_today: { label: 'نوبت امروز', tone: 'blue' },
  overdue: { label: 'معوق', tone: 'red' },
}

// نوع اعتبار
export const CREDIT_TYPE = {
  loan: 'وام',
  bnpl: 'BNPL',
  single_installment: 'اعتبار یک‌قسطه',
  four_installment: 'اعتبار ۴ قسطه',
}

// نوع ضمانت
export const GUARANTEE_TYPE = {
  none: 'بدون ضامن',
  cheque: 'چک',
  promissory_note: 'سفته / e-note',
}

// کلاس بدهی — مقادیر مجاز فیلتر (بخش ۳.۱ PRD)
export const DEBT_CLASSES = [
  'سررسید نشده',
  'سررسید شده',
  'سررسید گذشته',
  'معوق',
  'مشکوک‌الوصول',
  'تسویه شده',
  'کسر از حقوق',
]

// نوع اقدام (سابقه اکشن‌ها) — بخش ۵.۴ و ۳.۲ PRD
export const ACTION_TYPE = {
  warning_sms: { label: 'پیامک هشدار', icon: 'sms' },
  threatening_sms: { label: 'پیامک تهدید', icon: 'sms' },
  warning_autocall: { label: 'تماس خودکار هشدار', icon: 'autocall' },
  threatening_autocall: { label: 'تماس خودکار تهدید', icon: 'autocall' },
  negotiator_call: { label: 'تماس تلفنی مذاکره‌کننده', icon: 'call' },
}

// نوع همکاری مذاکره‌کننده (Epic 2)
export const COOPERATION_TYPE = {
  internal: 'داخلی',
  outsourced: 'برون‌سپاری',
}

// وضعیت مذاکره‌کننده
export const NEGOTIATOR_STATUS = {
  active: 'فعال',
  inactive: 'غیرفعال',
}

// وضعیت تعهد پرداخت
export const PROMISE_STATUS = {
  pending: 'در انتظار',
  fulfilled: 'انجام‌شده',
  broken: 'نقض شده',
}

// رنگ‌بندی badgeها بر اساس tone
export const TONE_CLASSES = {
  gray: 'bg-slate-100 text-slate-600',
  blue: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-rose-50 text-rose-700',
}

// helperهای ترجمه
export const caseStatusLabel = (key) => CASE_STATUS[key]?.label ?? key ?? '—'
export const caseStatusTone = (key) => CASE_STATUS[key]?.tone ?? 'gray'
export const actionStatusLabel = (key) => ACTION_STATUS[key]?.label ?? key ?? '—'
export const actionStatusTone = (key) => ACTION_STATUS[key]?.tone ?? 'gray'
export const creditTypeLabel = (key) => CREDIT_TYPE[key] ?? key ?? '—'
export const guaranteeTypeLabel = (key) => GUARANTEE_TYPE[key] ?? key ?? '—'
export const actionTypeLabel = (key) => ACTION_TYPE[key]?.label ?? key ?? '—'
export const promiseStatusLabel = (key) => PROMISE_STATUS[key] ?? key ?? '—'
export const cooperationTypeLabel = (key) => COOPERATION_TYPE[key] ?? key ?? '—'
export const negotiatorStatusLabel = (key) => NEGOTIATOR_STATUS[key] ?? key ?? '—'
