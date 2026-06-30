# سیستم وصول مطالبات دیجی‌پی (نسخه دمو)

پلتفرم مدیریت پرونده‌های وصول مطالبات با محاسبه CEI، سگمنت‌بندی، اجرای استراتژی (پیامک، تماس خودکار، مذاکره‌کننده) و پنل ادمین.

- **Backend:** Express + sql.js (SQLite)
- **Frontend:** React + Vite + Tailwind CSS
- **مستندات:** [PRD-DigiPay.md](./PRD-DigiPay.md) · [PROJECT-STATUS.md](./PROJECT-STATUS.md)

---

## پیش‌نیازها

- [Node.js](https://nodejs.org/) 18 یا بالاتر
- npm

---

## راه‌اندازی

### ۱. Backend

```bash
cd backend
npm install
cp .env.example .env
```

فایل `.env` را ویرایش کنید:

```env
PORT=3000
KAVENEGAR_API_KEY=your_api_key
KAVENEGAR_SENDER=your_sender_line
```

```bash
npm run seed    # داده اولیه (اختیاری — فقط دیتابیس خالی)
npm run dev     # http://localhost:3000
```

### ۲. Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

API فرانت‌اند به `http://localhost:3000/api` متصل است (`frontend/src/api/client.js`).

---

## اسکریپت‌های مفید (Backend)

| دستور | توضیح |
|--------|--------|
| `npm run dev` | سرور با nodemon + scheduler موتور استراتژی |
| `npm run start` | اجرای production |
| `npm run seed` | پر کردن دیتابیس با داده دمو |
| `npm run delete-debtor -- 09xxxxxxxxx` | حذف بدهکار و پرونده‌هایش |
| `npm run delete-all-except -- 09xxxxxxxxx` | حذف همه به‌جز یک موبایل |

---

## ساختار پروژه

```
debt-collection-mng-project/
├── backend/
│   ├── src/
│   │   ├── server.js              # ورود برنامه
│   │   ├── app.js                 # Express routes
│   │   ├── db/                    # schema, seed, CEI, dateUtil
│   │   ├── routes/                # REST API
│   │   └── services/              # import, SMS, strategy engine, scheduler
│   ├── scripts/                   # اسکریپت‌های نگهداری
│   ├── database.sqlite            # دیتابیس محلی (در git نیست)
│   └── .env.example
├── frontend/
│   └── src/                       # صفحات React، API client، کامپوننت‌ها
├── PRD-DigiPay.md
├── PROJECT-STATUS.md
└── README.md
```

---

## APIهای اصلی

| مسیر | کاربرد |
|------|--------|
| `GET /api/health` | سلامت سرور |
| `GET /api/cases` | لیست پرونده‌ها |
| `POST /api/bulk/upload-cases` | آپلود Excel پرونده |
| `GET /api/strategies` | استراتژی‌ها |
| `GET /api/segments` | سگمنت‌ها |

---

## موتور استراتژی

با بالا آمدن backend، **scheduler** هر **۱ دقیقه** موتور استراتژی را اجرا می‌کند:

- پرونده‌های «در انتظار شروع استراتژی» / «نتیجه پیامک» / «نتیجه تماس خودکار»
- ارسال پیامک واقعی از طریق [Kavenegar](https://kavenegar.com)
- انتظار بین اکشن‌ها بر اساس `wait_minutes` در `strategy_actions`

---

## نکات

- فایل `.env` و `database.sqlite` در git commit **نشوند** (در `.gitignore` هستند).
- برای تست Excel از صفحه **عملیات گروهی** (ادمین) استفاده کنید.
- کاربر دمو پیش‌فرض در فرانت‌اند: **زهرا حمیدی** (ادمین).

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| `404` روی bulk upload | backend را ری‌استارت کنید |
| `[sms] خطا در ارسال: 403` | API Key و خط فرستنده را در پنل کاوه‌نگار بررسی کنید |
| `injected env (0) from .env` | فایل `backend/.env` وجود ندارد یا خالی است |
| پرونده جلو نمی‌رود | لاگ `[strategy-engine]` و `[sms]` را در ترمینال backend ببینید |
