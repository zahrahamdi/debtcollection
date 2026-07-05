# سیستم وصول مطالبات دیجی‌پی (نسخه دمو)

پلتفرم مدیریت پرونده‌های وصول مطالبات: محاسبه CEI، سگمنت‌بندی، اجرای خودکار استراتژی (پیامک، تماس خودکار، مذاکره‌کننده)، عملیات گروهی Excel، گزارش‌گیری و پنل ادمین.

| لایه | تکنولوژی |
|------|-----------|
| Backend | Node.js · Express 5 · sql.js (SQLite) |
| Frontend | React 19 · Vite · Tailwind CSS · **Recharts** · **React Flow** |
| پیامک | Kavenegar (یا حالت Mock) |
| زمان‌بند | node-cron — موتور استراتژی هر ۱ دقیقه |
| احراز هویت | JWT (jsonwebtoken) · bcryptjs · RBAC (users/roles/permissions) |

## مستندات

| فایل | محتوا |
|------|--------|
| [TECHNICAL.md](./TECHNICAL.md) | **مستند فنی:** معماری، auth، APIها، موتور استراتژی، بدهی فنی |
| [PRD-DigiPay.md](./PRD-DigiPay.md) | نیازمندی‌های محصول (شامل **بخش ۱۰** — تکمیل‌های نسخه دمو) |
| [PROJECT-STATUS.md](./PROJECT-STATUS.md) | وضعیت پیاده‌سازی (ممکن است قدیمی‌تر از کد باشد) |

---

## پیش‌نیازها

- Node.js 18+
- npm

---

## راه‌اندازی سریع

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run seed    # داده دمو + کاربر admin (پس از دیتابیس خالی)
npm run dev     # http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

فرانت‌اند به `http://localhost:3000/api` متصل است (`frontend/src/api/client.js`).

---

## تنظیمات محیطی (`backend/.env`)

```env
PORT=3000
JWT_SECRET=digipay-jwt-secret-2024   # اجباری در production
KAVENEGAR_API_KEY=                   # برای ارسال واقعی پیامک
KAVENEGAR_SENDER=                    # خط فرستنده کاوه‌نگار
SMS_MOCK=true                        # true = بدون API واقعی
```

---

## اسکریپت‌های Backend

| دستور | توضیح |
|--------|--------|
| `npm run dev` | سرور + nodemon + scheduler موتور استراتژی |
| `npm run start` | اجرای production |
| `npm run seed` | داده دمو |
| `npm run delete-debtor -- 09xxxxxxxxx` | حذف بدهکار و پرونده‌هایش |
| `npm run delete-all-except -- 09xxxxxxxxx` | حذف همه به‌جز یک موبایل |
| `node scripts/inspect-case.js <credit_id>` | بررسی وضعیت یک پرونده در DB |

---

## ساختار پروژه

```
debt-collection-mng-project/
├── backend/
│   ├── src/
│   │   ├── server.js              # ورود: init DB + listen + scheduler
│   │   ├── app.js                 # Express middleware + routes
│   │   ├── db/                    # schema, database, seed, CEI, dateUtil
│   │   ├── middleware/            # authenticate, authorize, requireAdmin
│   │   ├── routes/                # REST API (+ auth.routes, users.routes)
│   │   ├── services/              # strategy engine, import, auth, SMS
│   │   └── utils/                 # requestUser (getActorName)
│   ├── scripts/                   # ابزارهای نگهداری و دیباگ
│   ├── database.sqlite            # دیتابیس محلی (در git نیست)
│   └── .env.example
├── frontend/
│   └── src/
│       ├── pages/                 # Cases, Reports, Login, Register, …
│       ├── components/
│       │   ├── charts/            # Recharts
│       │   ├── reports/           # FunnelFlowChart (React Flow)
│       │   └── ProtectedRoute.jsx # guard مسیرها
│       ├── api/                   # axios + auth interceptor
│       └── utils/auth.js          # JWT, roles, permissions
├── PRD-DigiPay.md
├── PROJECT-STATUS.md
├── TECHNICAL.md
└── README.md
```

---

## قابلیت‌های اصلی

- **پرونده‌ها:** لیست، فیلتر (۱۵ وضعیت)، جزئیات، **`last_action` از `case_actions`**، تخصیص مذاکره‌کننده، ثبت خروجی تماس
- **استراتژی:** تعریف اقدام‌های ترتیبی (پیامک / اتوکال / مذاکره) با `wait_next_minutes`، `wait_repeat_minutes`، `max_repeat` و **`repeat_on_results`** (تکرار شرطی)
- **موتور استراتژی:** اجرای خودکار هر ۱ دقیقه، تکرار فقط برای نتایج انتخاب‌شده، عبور به اقدام بعدی، **شکست استراتژی** و CEI boost
- **عملیات گروهی:** آپلود Excel پرونده، پرداخت، تخصیص / تخصیص مجدد
- **CEI و سگمنت:** فرمول نسخه‌دار، تخصیص استراتژی، A/B Test
- **گزارشات (`/reports`):** سه تب — **پرونده‌ها** (کارت KPI، نمودار وضعیت، روند ایجاد/پرداخت کامل)، **استراتژی‌ها** (عملکرد، هزینه/وصول، Funnel با React Flow)، **مذاکره‌کنندگان** (جدول + pie دلایل عدم پرداخت)
- **احراز هویت:** ثبت‌نام، ورود، JWT، نقش admin/negotiator، پنل مدیریت ادمین‌ها، صفحه انتظار نقش
- **تاریخچه:** Audit Trail با فیلتر ۵ نوع اقدام
- **بدهکاران / اقساط:** لیست بدهکار، شماره تماس، اقساط پرونده

---

## API — خلاصه

| مسیر | کاربرد |
|------|--------|
| `GET /api/health` | سلامت سرور |
| `POST /api/auth/login` | ورود — JWT |
| `POST /api/auth/register` | ثبت‌نام |
| `GET /api/auth/me` | کاربر جاری |
| `GET /api/users` | لیست کاربران (admin) |
| `GET /api/cases` | لیست پرونده‌ها |
| `GET /api/cases/:id` | جزئیات پرونده |
| `POST /api/bulk/upload-cases` | آپلود Excel پرونده |
| `POST /api/bulk/upload-payments` | آپلود Excel پرداخت |
| `GET /api/strategies` | استراتژی‌ها |
| `GET /api/cases/:id/history` | تاریخچه یک پرونده |
| `GET /api/debtors` | لیست بدهکاران |
| `GET /api/reports/cases` | گزارش پرونده‌ها (KPI، وضعیت، روند) |
| `GET /api/reports/funnel` | Funnel استراتژی |
| `GET /api/reports/strategies/performance` | عملکرد استراتژی‌ها + A/B |
| `GET /api/reports/strategies/cost` | هزینه و وصول به تفکیک اقدام |
| `GET /api/reports/negotiators` | عملکرد مذاکره‌کنندگان |
| `GET /api/reports/meta` | متادیتا (استان‌ها و …) |
| `GET /api/reports/summary` | *(deprecated)* — جایگزین: `/cases` |
| `POST /api/bulk/assign-cases` | تخصیص گروهی Excel |

لیست کامل endpointها در [TECHNICAL.md](./TECHNICAL.md#۶-api-reference).

---

## موتور استراتژی (خلاصه)

با `npm run dev`، **scheduler** هر **۱ دقیقه** `strategy-engine.service.js` را اجرا می‌کند:

1. پرونده‌های سررسید (`next_action_date`) را پیدا می‌کند
2. اقدام جاری استراتژی را اجرا می‌کند (پیامک / اتوکال / ارجاع به مذاکره)
3. اگر نتیجه در **`repeat_on_results`** باشد و `current_action_repeat < max_repeat` → تکرار همان اقدام
4. اگر لیست `repeat_on_results` خالی باشد → بدون تکرار، مستقیم عبور به اقدام بعدی
5. پس از اتمام سقف یا نتیجه خارج از لیست → `pending_strategy_continue` یا **شکست استراتژی** (CEI boost + سگمنت بعدی / حقوقی)

**نتیجه Mock (weighted random):**

| نوع | توزیع |
|-----|--------|
| پیامک | ۸۵٪ «ارسال شد» · ۱۵٪ «ارسال نشد» |
| اتوکال | ۴۰٪ «پاسخگو بود» · ۴۰٪ «پاسخگو نبود» · ۲۰٪ «اشغال بود» |

**تماس مذاکره‌کننده:** تکرار (`pending_negotiator_recall`) فقط اگر `call_status` در `repeat_on_results` اقدام negotiator_call باشد.

**مدت تماس در ثبت خروجی (`CallOutcomeModal`):**

| وضعیت | UI | Backend |
|--------|-----|---------|
| پاسخگو نبود | غیرفعال، خالی | `call_duration = 0`، هزینه = ۰ |
| پاسخگو بود / ناسزا گفت | اجباری | `cost = hourly_wage × minutes ÷ 60` |

جزئیات: [TECHNICAL.md — موتور استراتژی](./TECHNICAL.md#۴-موتور-استراتژی-strategy-engine) · [PRD بخش ۵.۹](./PRD-DigiPay.md#۵۹-پارامترهای-اقدام-استراتژی-پیاده‌سازی-نسخه-دمو)

---

## آخرین اقدام پرونده (`last_action`)

| منبع | برچسب |
|------|--------|
| آخرین `case_actions` | پیامک/اتوکال/تماس مذاکره‌کننده/پرداخت/… |
| تخصیص به مذاکره‌کننده (جدیدتر از آخر action) | تخصیص به مذاکره‌کننده |

- در `pending_negotiator_assignment` آخرین اقدام **خودکار** نمایش داده می‌شود (نه «تماس مذاکره‌کننده»).
- نام واحد: **تماس مذاکره‌کننده** (نه «تماس تلفنی مذاکره‌کننده»).
- پیاده‌سازی: `backend/src/db/lastAction.js` — جزئیات در [PRD ۵.۱۱](./PRD-DigiPay.md#۵۱۱-نمایش-آخرین-اقدام-انجام‌شده-last_action--پیاده‌سازی-نسخه-دمو).

---

## احراز هویت و دسترسی

**Login، Register، JWT و جداول `users` / `roles` / `permissions` پیاده شده‌اند.**

| لایه | وضعیت |
|------|--------|
| Frontend | `/login`, `/register`, `/forgot-password`, `/waiting` · `ProtectedRoute` · interceptor توکن |
| Backend | `authenticate` روی `/api/*` (به‌جز auth/health) · `requireAdmin` روی admin routes |
| Audit | `user_name` از `req.user` — دیگر از body فرانت نیست |

**ورود admin (بعد از `npm run seed`):** `zahra.hamdi` / `Admin@1234` (سوپر ادمین)

**بدهی فنی:** RBAC granular (`authorize`) هنوز روی همه routeها enforce نشده · `hasPermission()` در UI کم‌استفاده است.

جزئیات: [TECHNICAL.md §۱۰](./TECHNICAL.md#۱۰-احراز-هویت-و-دسترسی) · [PRD §۳.۴](./PRD-DigiPay.md#۳۴-پیاده‌سازی-دسترسی-در-نسخه-دمو)

---

## تست و کیفیت (برنامه)

Unit / Integration / E2E **هنوز پیاده نشده** — مرجع: [TECHNICAL.md §۱۱](./TECHNICAL.md#۱۱-تست-refactor-و-بدهی-فنی).

---

## نکات

- `.env` و `database.sqlite` را commit نکنید.
- `SMS_MOCK=true` → پیامک واقعی ارسال نمی‌شود (فقط لاگ)؛ **نتیجه delivery** همچنان Mock است
- `SMS_MOCK=false` + کلید کاوه‌نگار → ارسال واقعی؛ نتیجه delivery همچنان Mock (تا اتصال webhook)
- Google Sheet در دمو: فقط `POST /api/gsheet/test` (اعتبارسنجی URL — سینک کامل نیست)
- لاگ موتور: `[strategy-engine]` و `[sms]` در ترمینال backend
- برچسب UI: **«اقدام»** (نه «اکشن») — فیلتر تاریخچه محدود به ۵ نوع اقدام

جزئیات جریان وضعیت‌ها: [TECHNICAL.md — موتور استراتژی](./TECHNICAL.md#۴-موتور-استراتژی-strategy-engine).

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| `404` روی bulk | backend را ری‌استارت کنید |
| `[sms] خطا: 403` | API Key و خط فرستنده کاوه‌نگار |
| پرونده گیر کرده / پیامک تکراری | `node scripts/inspect-case.js <credit_id>` — جزئیات در TECHNICAL.md |
| `401` بعد از login | backend را ری‌استارت کنید؛ `JWT_SECRET` در `.env` |
| seed خطا می‌دهد | `npm install` در backend؛ سپس `npm run seed` |
