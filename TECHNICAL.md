# مستند فنی — سیستم وصول مطالبات دیجی‌پی

این سند برای توسعه‌دهندگان است: معماری، ساختار فایل‌ها، منطق اصلی backend/frontend، و مرجع API.

> مرجع نیازمندی محصول: [PRD-DigiPay.md](./PRD-DigiPay.md) (بخش‌های ۵.۹، ۵.۱۰ و **۱۰**)

---

## فهرست

1. [نمای کلی معماری](#۱-نمای-کلی-معماری)
2. [Backend — ساختار و لایه‌ها](#۲-backend--ساختار-و-لایه‌ها)
3. [Frontend — ساختار](#۳-frontend--ساختار)
4. [موتور استرategی (Strategy Engine)](#۴-موتور-استراتژی-strategy-engine)
5. [جریان‌های اصلی داده](#۵-جریان‌های-اصلی-داده)
6. [API Reference](#۶-api-reference)
7. [دیتابیس](#۷-دیتابیس)
8. [تاریخ، زمان و وضعیت اقدام](#۸-تاریخ-زمان-و-وضعیت-اقدام)
9. [متغیرهای محیطی و اسکریپت‌ها](#۹-متغیرهای-محیطی-و-اسکریپت‌ها)
10. [احراز هویت و دسترسی](#۱۰-احراز-هویت-و-دسترسی)
11. [تست، Refactor و بدهی فنی](#۱۱-تست-refactor-و-بدهی-فنی)

---

## ۱. نمای کلی معماری

```
┌─────────────────┐     HTTP/JSON      ┌──────────────────────────────────┐
│  React (Vite)   │ ◄── Bearer JWT ──► │  Express (port 3000)             │
│  port 5173      │                    │  middleware → routes → services  │
└─────────────────┘                    └──────────────┬───────────────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────┐
                    │                               │                       │
              database.sqlite              node-cron (1 min)          Kavenegar SMS
                    │                               │
                    │                    strategy-engine.service.js
                    │                    payment-import (resume)
                    └───────────────────────────────┘
```

**چرخه حیات یک پرونده (خلاصه):**

```
Excel/Sheet → case-import → CEI → سگمنت → استراتژی
    → pending_strategy_start → [اقدام ۱ → ۲ → … → N]
    → paid | burned | pending_legal_assignment | استراتژی جدید (شکست + CEI boost)
```

**۱۵ وضعیت پرونده** — مرجع کامل: `frontend/src/utils/constants.js` → `CASE_STATUS` و PRD بخش ۶.۱.

---

## ۲. Backend — ساختار و لایه‌ها

```
backend/src/
├── server.js                 # initDatabase → createApp → listen → startScheduler
├── app.js                    # mount routes + authenticate / requireAdmin
├── middleware/
│   └── auth.middleware.js    # authenticate, authorize, requireAdmin
├── routes/
│   ├── auth.routes.js        # register, login, forgot-password, me
│   ├── users.routes.js       # مدیریت ادمین‌ها (admin)
│   ├── cases.js              # ⚠ fat route (~850 خط)
│   ├── reports.js            # ⚠ fat route (~1400 خط)
│   └── …                     # debtors, bulk, strategies, …
├── services/
│   ├── auth.service.js       # JWT, bcrypt, RBAC helpers ★
│   ├── strategy-engine.service.js
│   ├── case-import.service.js
│   ├── payment-import.service.js
│   ├── bulk-assign.service.js
│   ├── sms.service.js
│   ├── scheduler.js
│   └── debtor-cleanup.service.js
├── utils/
│   └── requestUser.js        # getActorName(req) از req.user
└── db/
    ├── database.js           # sql.js + migrateSchema
    ├── schema.sql
    ├── seed.js               # دمو + users/roles/permissions
    ├── cei.js, dateUtil.js, segmentUtil.js, strategyActions.js, lastAction.js
```

### ۲.۴ Mounting و Auth در `app.js`

| Prefix | Middleware |
|--------|------------|
| `/api/health`, `/api/auth` | بدون authenticate |
| `/api/cases`, `/api/debtors`, `/api/negotiators`, `/api/gsheet` | `authenticate` |
| `/api/settings`, `/api/cei-formulas`, `/api/segments`, `/api/strategies`, `/api/ab-tests`, `/api/bulk`, `/api/reports`, `/api/users` | `authenticate` + `requireAdmin` |
| `POST/PUT /api/negotiators` | `requireAdmin` داخل router |

**نکته:** middleware `authorize(resource, action)` تعریف شده ولی **هنوز روی routeها اعمال نشده** — فقط admin/non-admin.

### ۲.۵ لایه‌های ناقص (بدهی معماری)

| ماژول | مشکل | refactor پیشنهادی |
|--------|------|-------------------|
| `routes/cases.js` | منطق assign/call-outcome در route | `services/cases.service.js` |
| `routes/reports.js` | SQL و aggregation در route | `services/reports.service.js` |
| Error handling | بدون middleware مرکزی | `middleware/errorHandler.js` |
| Transactions | assign/call-outcome چند `run()` بدون transaction | wrap در service |

---

### ۲.۱ لایه دیتابیس (`database.js`)

- از **sql.js** (SQLite WASM) به‌جای `better-sqlite3` (مشکل build روی Windows).
- فایل: `backend/database.sqlite`
- هر `run()` → `persist()` روی فایل.
- Migration سبک در `migrateSchema()` (ستون‌های جدید با `ALTER TABLE IF NOT EXISTS`).
- **مهم:** sql.js مقدار `undefined` را bind نمی‌کند — `sanitizeParams()` همه `undefined` را به `null` تبدیل می‌کند.
- Migration `repeat_on_results`: پیش‌فرض SMS → `["ارسال نشد"]`، Autocall → `["پاسخگو نبود","اشغال بود"]`، Negotiator → `["پاسخگو نبود"]`.

### ۲.۲ سرویس‌های کلیدی

| سرویس | مسئولیت |
|--------|---------|
| `case-import.service.js` | پردازش هر ردیف Excel: ایجاد/آپدیت پرونده، CEI، سگمنت، استراتژی، منطق ۵.۴ PRD (Skip اقدام، respite) |
| `strategy-engine.service.js` | اجرای اقدام‌های خودکار، تکرار شرطی (`repeat_on_results`)، عبور به اقدام بعدی، شکست استراتژی |
| `payment-import.service.js` | ثبت پرداخت جزئی/کامل، به‌روزرسانی مالی، resume استراتژی |
| `sms.service.js` | `sendSms` (Kavenegar یا `SMS_MOCK`), placeholder `{نام_کاربر}`, `{مبلغ_مطالبات}`, `{لینک_پرداخت}`. **نتیجه delivery** در موتور استراتژی جداگانه Mock می‌شود. |

### ۲.۳ `lastAction.js` — آخرین اقدام پرونده

**فایل:** `backend/src/db/lastAction.js` — مرجع PRD بخش **۵.۱۱**

| تابع | کار |
|------|-----|
| `buildLastActionMap(caseIds)` | batch resolve برای `GET /cases` |
| `resolveLastAction(caseId)` | resolve تک‌پرونده |
| `actionTypeToLabel(type)` | `action_type` → برچسب فارسی |

**`ACTION_TYPE_LABELS`:** شامل `negotiator_call: 'تماس مذاکره‌کننده'` (نام واحد در کل سیستم)

**منطق resolve:**

1. آخرین `case_actions` (بیشترین `id`)
2. اگر آخرین «تخصیص به مذاکره‌کننده» در `case_history` جدیدتر → `last_action = تخصیص به مذاکره‌کننده`
3. `executeNegotiatorCallAction` فقط `next_action` را ست می‌کند — **`last_action` ست نمی‌شود**

---

## ۳. Frontend — ساختار

```
frontend/src/
├── main.jsx, App.jsx
├── routes/
│   ├── AppRoutes.jsx         # ProtectedRoute + Login/Register/Waiting
│   └── navItems.js           # sidebar + adminOnly
├── pages/
│   ├── Login.jsx, Register.jsx, ForgotPassword.jsx, WaitingForRole.jsx ★
│   ├── Cases.jsx, Strategies.jsx, BulkOperations.jsx, Reports.jsx
│   ├── History.jsx, Debtors.jsx, Installments.jsx, Negotiators.jsx
│   └── AdminPanel.jsx        # + AdminUsersSettings (مدیریت ادمین‌ها)
├── components/
│   ├── ProtectedRoute.jsx    # token / role / adminOnly ★
│   ├── charts/, reports/, table/, sidebar/, modal/, admin/
├── api/
│   ├── client.js             # axios + Bearer interceptor + 401 redirect ★
│   ├── auth.js, users.js     # login, register, مدیریت ادمین ★
│   └── reports.js, cases.js, …
└── utils/
    ├── auth.js               # getToken, isAdmin, hasPermission, logout ★
```

**نمودارها (Recharts):** کانتینر LTR (`ChartContainer`) برای جلوگیری از clip در RTL؛ محور عددی با ارقام لاتین؛ برچسب فارسی با `foreignObject`. رنگ ثابت اقدامات در `actionPieConfig.js`.

**صفحه گزارشات (`Reports.jsx`):**

| تب | محتوا | API |
|----|--------|-----|
| پرونده‌ها | KPI، bar وضعیت، line روند | `GET /reports/cases` |
| استراتژی‌ها → عملکرد | جدول + مقایسه A/B | `GET /reports/strategies/performance` |
| استراتژی‌ها → هزینه/وصول | pie توزیع، bar اقدام، جدول | `GET /reports/strategies/cost` |
| استراتژی‌ها → Funnel | React Flow | `GET /reports/funnel` |
| مذاکره‌کنندگان | جدول + pie دلایل عدم پرداخت | `GET /reports/negotiators` |

هر تب فیلتر مستقل دارد (بازه شمسی، نوع اعتبار، …). دسترسی: `isAdmin()` — در غیر این صورت `<Navigate to="/cases" />`.

**اتصال API:** `frontend/src/api/client.js` → `baseURL: http://localhost:3000/api`

**UI سازنده استراتژی:** `StrategyActionsBuilder.jsx` — dropdown چندانتخابی (`RepeatResultsMultiSelect`) برای `repeat_on_results`؛ گزینه‌ها per `action_type` از `REPEAT_RESULTS_BY_TYPE`.

**مدال ثبت خروجی تماس:** `CallOutcomeModal.jsx`

| `call_status` | فیلد `call_duration` |
|---------------|----------------------|
| `پاسخگو نبود` | `disabled`، مقدار خالی، ارسال `0` |
| `پاسخگو بود` / `ناسزا گفت` | فعال، اجباری، `min=1` |

---

## ۴. موتور استراتژی (Strategy Engine)

**فایل:** `backend/src/services/strategy-engine.service.js`  
**Trigger:** `scheduler.js` — `cron.schedule('* * * * *', …)` هر ۱ دقیقه

### ۴.۱ وضعیت‌های قابل پردازش توسط موتور

| وضعیت | معنی |
|--------|------|
| `pending_strategy_start` | شروع اولین اقدام استراتژی |
| `pending_strategy_continue` | پایان یک اقدام — آماده شروع **اقدام بعدی** |
| `pending_sms_retry` | انتظار ارسال مجدد همان پیامک |
| `pending_autocall_retry` | انتظار تماس خودکار مجدد |
| `pending_sms_result` | پیامک موفق — انتظار `wait_next_minutes` قبل از اقدام بعدی |
| `pending_autocall_result` | اتوکال موفق — انتظار `wait_next_minutes` قبل از اقدام بعدی |

وضعیت‌های مذاکره (`pending_negotiator_*`, `in_negotiation`, `pending_negotiator_recall`) توسط route `call-outcome` و `processNegotiatorResultDueCase` مدیریت می‌شوند.

### ۴.۲ انواع اقدام استراتژی

| `action_type` | اجرا |
|---------------|------|
| `warning_sms` | ارسال SMS (Kavenegar یا شبیه‌سازی) + نتیجه Mock تصادفی |
| `threatening_sms` | همان منطق warning_sms |
| `warning_autocall` | شبیه‌سازی تماس (تأخیر ۱–۳ ثانیه) + نتیجه Mock تصادفی |
| `threatening_autocall` | همان منطق warning_autocall |
| `negotiator_call` | `pending_negotiator_assignment` یا `pending_negotiator_call` |

### ۴.۳ فیلدهای پیشرفت روی پرونده

| فیلد | نقش |
|------|-----|
| `current_action_seq` | `seq` اقدام استراتژی در حال اجرا (از `strategy_actions.seq`) |
| `current_action_repeat` | تعداد تلاش‌های انجام‌شده روی **همان** اقدام |
| `max_call_count` | سقف تماس مذاکره (= `max_repeat` اقدام negotiator_call) |
| `cei_boost` | مجموع افزایش CEI ناشی از شکست استراتژی |
| `next_action_date` | زمان اجرای بعدی (Gregorian `YYYY-MM-DD HH:mm:ss`) |

### ۴.۴ `repeat_on_results` — تکرار شرطی

**فایل‌های مرجع:** `strategyActions.js` (parse/validate/serialize)، `strategy-engine.service.js` (`executeAutomatedAction`)، `cases.js` (`call-outcome`)

| قانون | رفتار |
|--------|--------|
| لیست **خالی** | هیچ نتیجه‌ای تکرار نمی‌شود → مستقیم عبور به اقدام بعدی (یا wait_next در صورت موفقیت) |
| نتیجه **در لیست** و `attemptsMade < max_repeat` | تکرار همان اقدام با `wait_repeat_minutes` |
| نتیجه در لیست و سقف پر | `advanceAfterExhaustion` یا `handleStrategyFailure` |
| نتیجه **خارج از لیست** | بدون تکرار → اقدام بعدی |

**نتایج مجاز (برچسب فارسی — JSON در DB):**

```javascript
// backend/src/db/strategyActions.js → REPEAT_RESULTS_BY_TYPE
warning_sms / threatening_sms:     ['ارسال شد', 'ارسال نشد']
warning_autocall / threatening_autocall: ['پاسخگو بود', 'پاسخگو نبود', 'اشغال بود']
negotiator_call:                   ['پاسخگو بود', 'پاسخگو نبود', 'ناسزا گفت']
```

### ۴.۵ منطق تکرار (SMS / Autocall)

```
max_repeat = حداکثر تعداد کل اجرای همان اقدام (مثلاً ۳)

shouldRetry = repeat_on_results.includes(outcome) && attemptsMade < max_repeat

تلاش ۱: repeat 0→1, pending_sms_retry (اگر shouldRetry)
...
تلاش ۳: repeat 2→3 → سقف پر → advanceAfterExhaustion یا handleStrategyFailure
```

- شمارنده از `current_action_repeat` وقتی `current_action_seq === action.seq`
- قبل از ارسال SMS: اگر `attemptsBefore >= max_repeat` → بدون ارسال، مستقیم advance
- **نتیجه Mock (weighted random)** پس از اجرای اقدام:
  - **پیامک:** ۸۵٪ «ارسال شد» · ۱۵٪ «ارسال نشد»
  - **تماس خودکار:** ۴۰٪ «پاسخگو بود» · ۴۰٪ «پاسخگو نبود» · ۲۰٪ «اشغال بود»
- پیامک از Kavenegar ارسال می‌شود (`SMS_MOCK=false`) یا فقط در لاگ شبیه‌سازی می‌شود (`SMS_MOCK=true`); نتیجه delivery در هر دو حالت Mock بالا تصمیم‌گیری می‌کند.

### ۴.۶ عبور به اقدام بعدی / شکست

```
advanceAfterExhaustion:
  اگر اقدام بعدی وجود دارد → pending_strategy_continue + next_action_date
  اگر آخرین اقدام بود    → handleStrategyFailure
```

**شکست استراتژی (`handleStrategyFailure`):**

1. اگر آخرین سگمنت → `pending_legal_assignment`
2. وگرنه: CEI boost متناسب → سگمنت بعدی → استراتژی جدید → `pending_strategy_start`
3. ثبت marker `strategy_failure` در `case_actions` + history
4. `strategy_failure_count` در پاسخ `GET /cases/:id`

### ۴.۷ دیاگرام — پیامک با `repeat_on_results = ["ارسال نشد"]`

```mermaid
stateDiagram-v2
  [*] --> pending_strategy_start
  pending_strategy_start --> pending_sms_retry: ارسال نشد (در لیست تکرار)
  pending_sms_retry --> pending_sms_retry: ارسال نشد
  pending_sms_retry --> pending_strategy_continue: سقف تکرار + اقدام بعدی
  pending_sms_retry --> pending_legal_assignment: سقف + آخرین اقدام + آخرین سگمنت
  pending_strategy_continue --> pending_sms_retry: اقدام بعدی = SMS
  pending_sms_retry --> pending_sms_result: ارسال شد
  pending_sms_result --> pending_strategy_continue: سررسید wait_next
```

---

## ۵. جریان‌های اصلی داده

### ۵.۱ ورود پرونده از Excel

**Route:** `POST /api/bulk/upload-cases`  
**Service:** `case-import.service.js`

برای هر ردیف:

1. اعتبارسنجی ستون‌ها و مقادیر
2. اگر `paid`/`burned` → خطا یا فقط آپدیت مالی
3. پرونده جدید → CEI → سگمنت → استراتژی (با A/B Test) → `pending_strategy_start`
4. پرونده فعال + افزایش مطالبات → CEI مجدد، منطق تغییر سگمنت/استراتژی (بخش ۵.۴ PRD)
5. ثبت `case_history` در هر مرحله

### ۵.۲ ثبت خروجی تماس مذاکره‌کننده

**Route:** `POST /api/cases/:id/call-outcome`  
**File:** `routes/cases.js` · **UI:** `CallOutcomeModal.jsx`

**اعتبارسنجی `call_duration`:**

```javascript
const isNoAnswer = call_status === 'پاسخگو نبود' || call_status === 'no_answer';
const callDuration = isNoAnswer ? 0 : Number(call_duration);
// اگر !isNoAnswer → callDuration باید > 0
```

**هزینه تماس:**

```javascript
cost = isNoAnswer ? 0 : Math.round((hourly_wage * callDuration) / 60);
```

- سقف تماس: `current_action_repeat >= max_call_count` → 400
- **`shouldRetryNegotiator`:** `repeat_on_results.includes(call_status)` و سقف پر نشده → `pending_negotiator_recall` + `wait_repeat_minutes`
- **پاسخگو نبود** ولی **خارج از** `repeat_on_results` (یا سقف پر) → `next_action_date = now` برای عبور موتور به اقدام بعدی / شکست
- در آخرین تماس مجاز → `next_action_date = now` (بدون زمان‌بندی تماس بعدی)
- ثبت `case_actions` (`negotiator_call`) + `last_action = 'تماس مذاکره‌کننده'` + `promises` (در صورت تعهد) + SMS عدم پاسخگویی

### ۵.۳ آپلود پرداخت

**Route:** `POST /api/bulk/upload-payments`  
**Service:** `payment-import.service.js`

- پرداخت کامل → `paid`
- پرداخت جزئی → به‌روزرسانی مالی + زمان‌بندی resume استراتژی
- `processDuePartialPaymentResumes()` در هر tick موتور

### ۵.۴ تخصیص پرونده

**Route:** `POST /api/cases/:id/assign` · **`bulk-assign.service.js`**

- بررسی ظرفیت مذاکره‌کننده
- یک بدهکار = یک مذاکره‌کننده فعال
- **تخصیص اولیه:** `last_action = 'تخصیص به مذاکره‌کننده'`, `last_action_date = todayJalali()` + `case_history`
- **تخصیص مجدد:** فقط `assigned_negotiator_id` — `last_action` از resolve باقی می‌ماند
- history: «تخصیص به مذاکره‌کننده» / «تخصیص مجدد»

---

## ۶. API Reference

پایه: `http://localhost:3000/api`

### Health

| Method | Path | Auth | توضیح |
|--------|------|------|--------|
| GET | `/health` | — | `{ ok: true }` |

### Auth — `/auth`

| Method | Path | Auth | Body | توضیح |
|--------|------|------|------|--------|
| POST | `/register` | — | `first_name`, `last_name`, `username`, `email`, `password` | ثبت‌نام بدون نقش |
| POST | `/login` | — | `username`, `password` | JWT 8h + user + roles + permissions |
| POST | `/forgot-password` | — | `email`, `new_password`, `confirm_password` | تغییر رمز (دمو — بدون OTP) |
| GET | `/me` | Bearer | — | کاربر جاری |
| POST | `/logout` | — | — | stateless — client token را پاک می‌کند |

### Users — `/users` (admin)

| Method | Path | Query / Body | توضیح |
|--------|------|--------------|--------|
| GET | `/` | `has_role`, `without_role=negotiator` | لیست کاربران |
| POST | `/:id/assign-admin` | — | تخصیص نقش admin |
| DELETE | `/:id/remove-admin` | — | حذف admin (نه سوپر ادمین / نه آخرین admin) |

### Cases — `/cases`

| Method | Path | Query / Body | توضیح |
|--------|------|--------------|--------|
| GET | `/` | … | لیست paginated — `last_action` از `buildLastActionMap` (نه فیلد خام DB) |
| GET | `/:id` | — | جزئیات + actions + … — `last_action` resolve شده |
| GET | `/:id/history` | `operation`, `user_name`, `from_date`, `to_date` | Audit Trail پرونده |
| GET | `/:id/installments` | — | اقساط پرونده |
| POST | `/:id/assign` | `{ negotiator_id }` | تخصیص / تخصیص مجدد — `user_name` از token |
| POST | `/:id/call-outcome` | `{ call_status, call_duration?, … }` | ثبت خروجی تماس — `call_duration` اجباری فقط برای «پاسخگو بود» / «ناسزا گفت»؛ برای «پاسخگو نبود» → ۰ و هزینه ۰ |

### Debtors — `/debtors`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | لیست با فیلتر |
| GET | `/:id` | جزئیات + پرونده‌ها + شماره‌ها |
| POST | `/:id/phone-numbers` | افزودن شماره تماس |

### Negotiators — `/negotiators`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | لیست + آمار محاسباتی |
| POST | `/` | ایجاد |
| PUT | `/:id` | ویرایش |

### Segments — `/segments`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | لیست |
| POST | `/` | ایجاد (بررسی overlap) |
| PUT | `/:id` | ویرایش |
| DELETE | `/:id` | حذف |

### Strategies — `/strategies`

| Method | Path | Body | توضیح |
|--------|------|------|--------|
| GET | `/` | — | لیست + A/B info |
| GET | `/:id` | — | جزئیات + actions |
| POST | `/` | `{ title, credit_type, segment_id, actions[] }` | ایجاد |
| PUT | `/:id` | `{ actions[] }` | ویرایش (title/segment در edit قفل) |
| DELETE | `/:id` | — | حذف |

**ساختار یک action در body:**

```json
{
  "action_type": "warning_sms",
  "body_text": "کاربر گرامی {نام_کاربر} …",
  "allowed_from": "09:00",
  "allowed_to": "18:00",
  "wait_next_minutes": 1440,
  "wait_repeat_minutes": 60,
  "max_repeat": 3,
  "repeat_on_results": ["ارسال نشد"],
  "cost": 500,
  "avg_call_duration": 5
}
```

### A/B Tests — `/ab-tests`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | لیست |
| POST | `/` | ایجاد سناریو (+ دو استراتژی) |
| DELETE | `/:id` | حذف |

### CEI Formulas — `/cei-formulas`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | نسخه فعال + history |
| PUT | `/` | نسخه جدید |
| POST | `/test` | `{ credit_id }` — پیش‌نمایش CEI |

### Settings — `/settings`

| Method | Path | توضیح |
|--------|------|--------|
| GET | `/` | key→value |
| GET | `/history` | `?key=` |
| PUT | `/` | `{ key: value, … }` |

### Bulk — `/bulk`

| Method | Path | Body (multipart) | توضیح |
|--------|------|------------------|--------|
| POST | `/upload-cases` | `file` | Excel پرونده — `user_name` از token |
| POST | `/upload-payments` | `file` | Excel پرداخت |
| POST | `/assign-cases` | `file` | تخصیص گروهی |
| POST | `/reassign-cases` | `file` | تخصیص مجدد |
| POST | `/delete-all-except-mobile` | `{ mobile }` | پاکسازی DB |
| POST | `/delete-debtor-by-mobile` | `{ mobile }` | حذف یک بدهکار |
| GET | `/history` | — | تاریخچه عملیات گروهی |
| GET | `/error-report/:id` | — | دانلود خطاهای bulk |

### Reports — `/reports`

| Method | Path | Query (نمونه) | توضیح |
|--------|------|---------------|--------|
| GET | `/cases` | `from_date`, `to_date`, `credit_type`, `segment_id`, `province` | KPI پرونده، `cases_by_status`, `daily_trend` (فقط پرداخت کامل) |
| GET | `/funnel` | `credit_type` (اجباری), `from_date`, `to_date`, `strategy_id`, `segment_id` | مراحل funnel + خروجی‌های paid/partial/failure |
| GET | `/strategies/performance` | فیلتر تاریخ اقدام + اعتبار/سگمنت/استراتژی | جدول استراتژی + مقایسه A/B |
| GET | `/strategies/cost` | فیلتر تاریخ اقدام | `action_stats`, `cost_distribution`, `collection_distribution` |
| GET | `/negotiators` | `negotiator_id`, `cooperation_type` | `negotiators_comparison`, `no_payment_reasons` |
| GET | `/meta` | — | استان‌ها و متادیتا |
| GET | `/summary` | — | **deprecated** — استفاده از `/cases` |
| GET | `/action-conversion` | — | **deprecated** |
| GET | `/ab-tests` | — | **deprecated** — داخل `/strategies/performance` |

**نکات محاسباتی:**
- `cost_to_collection_ratio` = `total_cost / total_collected` (عدد اعشاری، نه درصد)
- Funnel: تشخیص خروجی هر مرحله با `firstOutcomeAfterAction` و پرداخت/شکست استراتژی
- `success_rate` مذاکره‌کننده = `paid_cases / total_cases × 100`

### Google Sheet — `/gsheet`

| Method | Path | توضیح |
|--------|------|--------|
| POST | `/test` | اعتبارسنجی URL (دمو — سینک کامل پیاده نشده) |

---

## ۷. دیتابیس

فایل schema: `backend/src/db/schema.sql`

### جداول اصلی

| جدول | نقش |
|------|-----|
| `debtors`, `phone_numbers`, `addresses` | بدهکار |
| `cases` | پرونده وصول — قلب سیستم |
| `segments`, `strategies`, `strategy_actions` | سگمنت و استراتژی |
| `ab_tests` | A/B Test |
| `case_actions` | سابقه اقدامات (seq زمانی global) |
| `case_history` | Audit Trail |
| `promises` | تعهد پرداخت (PTP) |
| `installments`, `payments` | اقساط و پرداخت |
| `negotiators` | موجودیت عملیاتی + `user_id` → `users` |
| `users`, `roles`, `user_roles`, `permissions`, `role_permissions` | احراز هویت و RBAC ★ |
| `cei_formulas`, `settings`, `settings_history` | پیکربندی + audit |
| `bulk_operations` | لاگ آپلودهای گروهی |

**Schema drift (بدهی):** API اقساط فیلدهای `penalty_waiver`, `bank_settlement`, `guarantee_withdrawal` را برمی‌گرداند ولی در `schema.sql` تعریف نشده‌اند — همیشه 0.

### فیلدهای مهم `cases`

```
case_status, current_action_seq, current_action_repeat, max_call_count
next_action, next_action_date, action_status
cei, cei_boost, segment_id, strategy_id
assigned_negotiator_id, call_count, case_cost
```

### فیلدهای `strategy_actions`

```
seq, action_type, body_text
allowed_from, allowed_to
wait_next_minutes      — فاصله قبل از اقدام بعدی (دقیقه)
wait_repeat_minutes    — فاصله بین تکرار همان اقدام (دقیقه)
max_repeat             — سقف کل اجرای همان اقدام (همه انواع)
repeat_on_results      — JSON array برچسب فارسی — نتایج مشمول تکرار
cost, avg_call_duration
```

---

## ۸. تاریخ، زمان و وضعیت اقدام

**فایل:** `backend/src/db/dateUtil.js`

| تابع | کار |
|------|-----|
| `nowDatetime()` | `YYYY-MM-DD HH:mm:ss` — برای `next_action_date` |
| `todayJalali()` | تاریخ شمسی برای نمایش |
| `computeNextActionDate(waitMinutes, nextAction)` | now + wait + رعایت بازه مجاز |
| `calcActionStatus(next_action_date)` | `waiting` / `due_today` / `overdue` |
| `isActionDue(next_action_date)` | آیا موتور باید اجرا کند؟ |

---

## ۹. متغیرهای محیطی و اسکریپت‌ها

### `.env`

| متغیر | پیش‌فرض | توضیح |
|--------|---------|--------|
| `JWT_SECRET` | — | **اجباری production** — کلید امضای JWT |
| `PORT` | 3000 | پورت سرور |
| `KAVENEGAR_API_KEY` | — | کلید API |
| `KAVENEGAR_SENDER` | — | خط فرستنده |
| `SMS_MOCK` | — | `true` = بدون API واقعی |

### اسکریپت‌های `backend/scripts/`

| فایل | کار |
|------|-----|
| `inspect-case.js` | دیباگ پرونده با `credit_id` — وضعیت، history، actions |
| `delete-debtor-by-mobile.js` | حذف بدهکار |
| `delete-all-except-mobile.js` | پاکسازی |
| `seed-zahra-hamdi-cases.js` | seed تست |
| `add-payment-test-cases.js` | پرونده تست پرداخت |
| `clear-ab-tests.js` | پاک کردن A/B tests |

---

## پیوست — نگاشت وضعیت در UI

مرجع: `frontend/src/utils/constants.js` → `CASE_STATUS`, `ACTION_TYPE`, `HISTORY_OPERATIONS`

### وضعیت‌های پرونده (۱۵)

`pending_cei` · `pending_strategy` · `pending_strategy_start` · `pending_strategy_continue` · `pending_sms_result` · `pending_sms_retry` · `pending_autocall_result` · `pending_autocall_retry` · `pending_negotiator_assignment` · `pending_negotiator_call` · `pending_negotiator_recall` · `in_negotiation` · `pending_legal_assignment` · `paid` · `burned`

### عملیات مهم history

- `اجرای پیامک` / `اجرای پیامک (شبیه‌سازی)` / `ارسال ناموفق پیامک — تلاش مجدد`
- `اجرای تماس خودکار` / `تماس خودکار ناموفق — تلاش مجدد`
- `عبور به اقدام بعدی استراتژی` / `پایان استراتژی` / `شکست استراتژی`
- `بازگشت به تماس مذاکره‌کننده` / `ثبت خروجی تماس`
- `تخصیص به مذاکره‌کننده` / `تخصیص مجدد`
- `پرداخت کامل بدهی` / `پرداخت جزئی بدهی` / `ادامه استراتژی پس از پرداخت جزئی`

لیست کامل: آرایه `HISTORY_OPERATIONS` در `constants.js` (۳۲+ عملیات).

---

## ۱۰. احراز هویت و دسترسی

### ۱۰.۱ پیاده‌سازی فعلی

| قابلیت | وضعیت |
|--------|--------|
| Login / Register / Forgot password | ✅ |
| JWT (8h) + bcrypt | ✅ |
| جداول `users`, `roles`, `permissions` | ✅ |
| `authenticate` middleware | ✅ |
| `requireAdmin` روی admin routes | ✅ |
| `authorize(resource, action)` | ⚠️ تعریف شده، **اعمال نشده** |
| SSO production | ❌ برنامه آینده |

### ۱۰.۲ Backend

**فایل‌ها:** `services/auth.service.js` · `middleware/auth.middleware.js` · `routes/auth.routes.js` · `routes/users.routes.js`

```javascript
// loadUserAuthPayload → roles[], permissions[], negotiator_id
signToken(userId)  // JWT 8h
getActorName(req)   // first_name + last_name در history/settings/bulk
```

**Seed admin:** `zahra.hamdi` / `Admin@1234` · `is_super_admin=1` · لینک به negotiator زهرا حمیدی

**Permissions در seed:** admin → همه؛ negotiator → subset (cases:view/assign, debtors, call_outcome, …)

### ۱۰.۳ Frontend

**صفحات:** `Login`, `Register`, `ForgotPassword`, `WaitingForRole`  
**Guard:** `ProtectedRoute` — token → role → adminOnly  
**Utils:** `utils/auth.js` — `getToken`, `isAdmin`, `hasPermission`, `logout`  
**API:** `api/auth.js`, `api/client.js` (Bearer + 401 redirect)

**کنترل UI:** عمدتاً `isAdmin()` — `hasPermission()` هنوز استفاده نشده.

### ۱۰.۴ بدهی امنیتی (باید قبل از production بسته شود)

| # | موضوع | شدت |
|---|--------|-----|
| 1 | `authorize()` روی assign/call-outcome/debtors enforce نشده | CRITICAL |
| 2 | call-outcome: backend مالکیت پرونده negotiator را چک نمی‌کند | CRITICAL |
| 3 | forgot-password بدون OTP/token | HIGH |
| 4 | register باز — کاربر بدون نقش به API دسترسی دارد | HIGH |
| 5 | JWT_SECRET fallback در کد | MEDIUM |

### ۱۰.۵ نقش‌ها (PRD §۳.۳)

| نقش | دسترسی خلاصه |
|-----|--------------|
| admin | همه صفحات admin + bulk + گزارشات |
| negotiator | بدهکاران، پرونده‌ها، اقساط، تاریخچه؛ تماس **فقط** پرونده خود (UI ✅ / API ⚠️) |

جدول کامل: [PRD §۳.۳](./PRD-DigiPay.md#۳۳-جدول-دسترسیها).

---

## ۱۱. تست، Refactor و بدهی فنی

### ۱۱.۱ وضعیت تست

| لایه | وضعیت |
|------|--------|
| Unit (Vitest) | ❌ |
| Integration (supertest) | ❌ |
| Component (RTL) | ❌ |
| E2E (Playwright) | ❌ |

`backend/package.json`: `"test": "Error: no test specified"`

### ۱۱.۲ پلن پیشنهادی (ترکیبی refactor + test)

| فاز | مدت | کار | تست همراه |
|-----|-----|-----|-----------|
| 0 | ۳ روز | Vitest setup، schema installments، disable cron در test | ~20 unit |
| 1 | ۱ هفته | enforce RBAC، call-outcome ownership | ~25 integration |
| 2 | ۲ هفته | `cases.service`, `reports.service` | unit + int per PR |
| 3 | ۱ هفته | GSheet decision، AB test UI، legacy negotiator users | E2E smoke |
| 4 | ۱ هفته | Playwright regression + CI | 8–10 spec |

### ۱۱.۳ بدهی فنی اولویت‌دار

| ID | موضوع | شدت |
|----|--------|-----|
| R1 | Fat routes (`cases`, `reports`) | HIGH |
| R2 | RBAC dead code (`authorize` unused) | CRITICAL |
| R3 | Schema drift installments | HIGH |
| R4 | Scheduler همیشه on — DB non-deterministic | HIGH |
| R5 | No global error handler / transactions | MEDIUM |
| R6 | GSheet sync UI بدون backend | HIGH |
| R7 | AB test: create only، no list/delete UI | MEDIUM |
| R8 | Legacy negotiators بدون `user_id` | MEDIUM |
| R9 | `GET /cases` in-memory pagination | MEDIUM |
| R10 | PRD §۳.۴ outdated | LOW |

### ۱۱.۴ ابزارهای پیشنهادی

- Backend: **Vitest** + **supertest**
- Frontend: **Vitest** + **React Testing Library**
- E2E: **Playwright**
- CI: GitHub Actions — unit → integration → e2e (main)

---

### Frontend — `normalizeLastActionLabel`

`constants.js` — تبدیل legacy «تماس تلفنی مذاکره‌کننده» → «تماس مذاکره‌کننده» در `CasesTable` و `CaseDetailSidebar`.

---

*آخرین به‌روزرسانی: احراز هویت JWT/RBAC · مدیریت ادمین‌ها · audit معماری و پلن تست*
