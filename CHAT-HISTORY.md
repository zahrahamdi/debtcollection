# سابقه‌ی چت‌ها و راهنمای ادامه‌ی کار (Chat History & Handoff)

> این فایل خلاصه‌ای از گفتگوهای من (زهرا حمدی) با دستیار Cursor روی این پروژه است.
> هدف: اگر سیستم/مسیر پروژه عوض شد یا چت‌ها در دسترس نبودند، بتوانم با دادن این فایل به دستیار، سریع کار را از همان‌جا ادامه بدهم.
>
> **آخرین به‌روزرسانی:** تیر ۱۴۰۵ (Jul 2026)

---

## ۰. چطور دوباره وصل شوم؟

1. **کد:** روی سیستم جدید کلون کنید:
   ```bash
   git clone https://repo.mydigipay.info/product/debtcollection.git
   ```
   برنچ اصلی کار: `feature/debtcollection-system` (پوش به `master` به‌خاطر protected branch رد می‌شود؛ از طریق Merge Request مرج کنید).

2. **چت‌های Cursor:** به مسیر پروژه گره خورده‌اند و در این پوشه ذخیره می‌شوند:
   ```
   C:\Users\<user>\.cursor\projects\<slug-of-project-path>\agent-transcripts\
   ```
   نام `<slug>` نسخه‌ی slug‌شده‌ی مسیر پروژه است (`:` و `\` و `.` و فاصله → `-`).
   برای حفظ چت‌ها یا **همان مسیر و نام کاربری** را نگه دارید و کل پوشه را کپی کنید، یا پوشه را با اسم متناظر مسیر جدید بسازید.

3. **این فایل:** همراه گیت منتقل می‌شود، پس حتی بدون چت‌های Cursor هم خلاصه‌ی کارها را دارید.

---

## ۱. پروژه چیست؟

**سیستم مدیریت وصول مطالبات دیجی‌پی (Debt Collection Management)** — یک اپ فول‌استک برای مدیریت پرونده‌های بدهی، محاسبه‌ی CEI، سگمنت‌بندی، تخصیص استراتژی وصول و گزارش‌گیری.

### استک فنی
- **Backend:** Node.js + Express (پورت **۳۰۰۰**)، دیتابیس `sql.js` (SQLite در حافظه/فایل)
- **Frontend:** React + Vite (پورت **۵۱۷۳**، `strictPort: true`) + TailwindCSS + Recharts + React Flow
- **احراز هویت:** JWT + RBAC (`hasPermission`, `isAdmin`)

### اسناد مرجع پروژه
- `PRD-DigiPay.md` — سند محصول (منبع اصلی الزامات)
- `PROJECT-STATUS.md` — وضعیت پیاده‌سازی
- `TECHNICAL.md` — جزئیات فنی
- `case-status-diagram.html` — دیاگرام تعاملی وضعیت پرونده

### مفاهیم کلیدی دامنه
- **CEI:** شاخص محاسبه‌شده از روی داده‌های پرونده (فرمول‌های `loan` و `bnpl`، نسخه‌بندی‌شده در `cei_formulas`).
- **Segment (سگمنت):** بازه‌ی CEI که پرونده در آن قرار می‌گیرد.
- **Strategy (استراتژی):** دنباله‌ی اقدامات وصول (پیامک هشدار/تهدید، تماس خودکار، تماس مذاکره‌کننده) که به سگمنت تخصیص می‌یابد.
- **case_events:** منبع اصلی و یکپارچه‌ی رویدادهای پرونده (`action` / `history` / `payment`). گزارش‌ها از این جدول ساخته می‌شوند.
- **Respite Time:** اگر CEI/سگمنت در حین `next_action_date` فعال عوض شود، تغییر استراتژی تا `respite_until` معوق می‌شود (`processDeferredCeiStrategyShifts`).

---

## ۲. منطق مهم: پرداخت جزئی (Partial Payment)

فایل: `backend/src/services/payment-import.service.js` — تابع `processPartialPayment`.

- **CEI و سگمنت:** همیشه و فوری به‌روز می‌شوند (`recalculateCei` + `findSegmentForCei`).
- **استراتژی:** فوری عوض نمی‌شود؛ `next_action` روی «ادامه استراتژی پس از پرداخت جزئی» می‌رود و `next_action_date` به‌اندازه‌ی `partial_payment_gap_days` (پیش‌فرض ۱۰ روز) جلو می‌رود. در سررسید، `resumePartialPaymentCase` تصمیم می‌گیرد:
  - سگمنت تغییر نکرد → `continueCurrentStrategy`
  - سگمنت سبک‌تر/سنگین‌تر شد → `assignStrategyFromStart` (استراتژی جدید از ابتدا)
- **استثناها:**
  1. فاز مذاکره‌کننده (`isInNegotiatorPhase`) → `next_action` روی «تماس مذاکره‌کننده» می‌ماند.
  2. **پرداخت جزئی قبل از سررسید تعهد** (`processPartialPaymentBeforePromiseDue`): اگر مبلغ < تعهد pending و قبل از `promised_datetime` باشد → CEI/سگمنت به‌روز، ولی استراتژی resume/تغییر نمی‌کند.

---

## ۳. خلاصه‌ی گفتگوها

### چت الف — توسعه‌ی اصلی سیستم (بزرگ‌ترین چت)
شروع با درخواست خواندن `PRD-DigiPay.md` و `PROJECT-STATUS.md` و ادامه‌ی کار مطابق آن‌ها. کارهای انجام‌شده:

- **آپلود Excel پرونده‌ها (Story 4.1):**
  - `backend/src/services/case-import.service.js` — منطق پردازش هر ردیف (validation، ساخت/آپدیت پرونده، محاسبه CEI، تخصیص استراتژی).
  - `backend/src/routes/bulk.js` — endpoints: `POST /api/bulk/upload-cases`، `GET /api/bulk/history`، `GET /api/bulk/error-report/:id`.
  - جدول `bulk_operations` در `schema.sql`.
  - `frontend/src/api/bulk.js` و `frontend/src/pages/BulkOperations.jsx` (فقط ادمین).
  - پکیج‌ها: `multer`, `xlsx` (backend)، `xlsx` (frontend برای پیش‌نمایش تعداد ردیف).
  - **نکته‌ی مهم:** برخلاف PRD Story 5.2 که CEI فقط با افزایش مطالبات دوباره محاسبه می‌شود، طبق درخواست من برای پرونده‌ی **فعال** همیشه CEI مجدداً محاسبه می‌شود.
  - رفع خطای 404 روی `/api/bulk/upload-cases` (علت: ری‌استارت‌نشدن سرور/nodemon؛ route درست ثبت شده بود).
  - هم‌خوان‌کردن نگاشت هدرهای Excel با ستون‌های واقعی فایل من (نام‌های مستعار مثل «تامین‌کننده»/«تامین کننده»، «مطالبات غیرجاری سررسید گذشته (ریال)» و ...). `normalizeHeader` پرانتز و نیم‌فاصله را هم مدیریت می‌کند.

- **به‌روزرسانی اسناد:** `README.md`, `TECHNICAL.md`, `PROJECT-STATUS.md`, `case-status-diagram.html`, `PRD-DigiPay.md` همگی با تغییرات اخیر هم‌گام شدند (Respite Time، پرداخت جزئی قبل از تعهد، `case_events`، منطق گزارشات tenure).

- **منطق گزارشات (§۵.۱۲ در PRD):** نسبت‌دهی بر اساس **tenure** (بازه‌ی واقعی اجرای هر استراتژی روی پرونده) از `case_events`، نه `strategy_id` فعلی. سرویس `strategy-attribution.service.js`.
  - **نرخ تبدیل استراتژی:** فقط **پرداخت کامل** داخل tenure.
  - **نرخ تبدیل اکشن:** اجراهای **یکتا** با ≥۱ وصول ÷ کل اجرا؛ «تعداد وصول» هر پرداخت را جدا می‌شمارد (last-touch).

### چت ب — پرسش سریع درباره‌ی پرداخت جزئی
پرسیدم آیا بعد از پرداخت جزئی سگمنت/CEI/استراتژی آپدیت می‌شود → پاسخ در بخش ۲ همین فایل خلاصه شده.

### چت ج — مشکل گیت و مهاجرت ریپو
- خطای `fatal: refusing to merge unrelated histories` هنگام `git pull origin master`.
- علت: ریپو از GitHub به GitLab (`repo.mydigipay.info`) منتقل شد؛ `master` سمت GitLab تاریخچه‌ی مستقل داشت.
- `master` protected است و force push رد می‌شود؛ کار روی برنچ `feature/debtcollection-system` انجام و پوش شد.
- راه‌حل ادغام (در صورت نیاز): `git pull origin master --allow-unrelated-histories`.

### چت د — انتقال سیستم و حفظ هیستوری (همین چت)
هدف: تعویض سیستم بدون از دست دادن کد و چت‌ها → منجر به ساخت همین فایل.

---

## ۴. وضعیت فعلی و کارهای باقی‌مانده

### ✅ انجام‌شده
- دیتابیس کامل + `case_events`
- موتور CEI، سگمنت، استراتژی، A/B Test، scheduler (هر ۱ دقیقه)
- import پرونده/پرداخت Excel، تخصیص گروهی
- Respite Time + `processDeferredCeiStrategyShifts`
- پرداخت جزئی/کامل + پرداخت جزئی قبل از سررسید تعهد
- گزارشات (KPI، funnel، عملکرد استراتژی tenure، هزینه/وصول، مذاکره‌کنندگان)
- JWT + RBAC
- همه‌ی صفحات اصلی فرانت (Cases، Reports، History، Bulk، Debtors، Installments، …)

### ⏳ باقی‌مانده / بدهی فنی
- سینک واقعی Google Sheet (فعلاً فقط validation آدرس)
- forgot-password بدون OTP
- تست خودکار (Vitest / Playwright)
- Schema drift برخی فیلدهای installments در API
- تکمیل UI سینک GSheet

---

## ۵. دستورهای مفید

```bash
# Backend
cd backend && npm install && npm run dev      # پورت 3000
cd backend && npm run seed                     # داده‌ی اولیه
cd backend && npm run clear-all-cases          # پاک کردن پرونده‌ها

# Frontend
cd frontend && npm install && npm run dev      # پورت 5173
```

- **Env فرانت:** `frontend/.env` → `VITE_API_URL=http://localhost:3000/api`
- **دیاگرام وضعیت:** `case-status-diagram.html` را در مرورگر باز کنید.
