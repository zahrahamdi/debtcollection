# سیستم وصول مطالبات دیجی‌پی (نسخه دمو)

پلتفرم مدیریت پرونده‌های وصول مطالبات: محاسبه CEI، سگمنت‌بندی، اجرای خودکار استراتژی (پیامک، تماس خودکار، مذاکره‌کننده)، عملیات گروهی Excel، گزارش‌گیری و پنل ادمین.

| لایه | تکنولوژی |
|------|-----------|
| Backend | Node.js · Express 5 · sql.js (SQLite) |
| Frontend | React 19 · Vite · Tailwind CSS |
| پیامک | Kavenegar (یا حالت Mock) |
| زمان‌بند | node-cron — موتور استراتژی هر ۱ دقیقه |

## مستندات

| فایل | محتوا |
|------|--------|
| [TECHNICAL.md](./TECHNICAL.md) | **مستند فنی:** معماری، منطق کد، فایل‌ها، APIها، موتور استراتژی |
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
npm run seed    # اختیاری — فقط برای دیتابیس خالی
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
KAVENEGAR_API_KEY=          # برای ارسال واقعی پیامک
KAVENEGAR_SENDER=           # خط فرستنده کاوه‌نگار
SMS_MOCK=true               # true = بدون API واقعی، فقط لاگ در ترمینال
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
│   │   ├── routes/                # REST API
│   │   └── services/              # strategy engine, import, SMS, payment
│   ├── scripts/                   # ابزارهای نگهداری و دیباگ
│   ├── database.sqlite            # دیتابیس محلی (در git نیست)
│   └── .env.example
├── frontend/
│   └── src/                       # صفحات React، API client، کامپوننت‌ها
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
- **گزارشات:** خلاصه وضعیت، نرخ تبدیل اقدام‌ها، A/B Test
- **تاریخچه:** Audit Trail با فیلتر ۵ نوع اقدام
- **بدهکاران / اقساط:** لیست بدهکار، شماره تماس، اقساط پرونده

---

## API — خلاصه

| مسیر | کاربرد |
|------|--------|
| `GET /api/health` | سلامت سرور |
| `GET /api/cases` | لیست پرونده‌ها |
| `GET /api/cases/:id` | جزئیات پرونده |
| `POST /api/bulk/upload-cases` | آپلود Excel پرونده |
| `POST /api/bulk/upload-payments` | آپلود Excel پرداخت |
| `GET /api/strategies` | استراتژی‌ها |
| `GET /api/cases/:id/history` | تاریخچه یک پرونده |
| `GET /api/debtors` | لیست بدهکاران |
| `GET /api/reports/summary` | گزارش خلاصه |
| `GET /api/reports/action-conversion` | نرخ تبدیل اقدام‌ها |
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

## کاربر دمو

در فرانت‌اند احراز هویت واقعی وجود ندارد. کاربر mock پیش‌فرض: **زهرا حمیدی** (ادمین) — `frontend/src/utils/auth.js`.

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
| `Wrong API use … undefined` | نسخه جدید backend (sanitize پارامترهای sql.js) |
