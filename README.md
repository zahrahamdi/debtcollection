<<<<<<< HEAD
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
| [TECHNICAL.md](./TECHNICAL.md) | **مستند فنی:** معماری، auth، APIها، موتور استراتژی، گزارشات، بدهی فنی |
| [PRD-DigiPay.md](./PRD-DigiPay.md) | نیازمندی‌های محصول (شامل **بخش ۱۰** — تکمیل‌های نسخه دمو) |
| [PROJECT-STATUS.md](./PROJECT-STATUS.md) | وضعیت پیاده‌سازی و ساختار فایل‌ها |
| [case-status-diagram.html](./case-status-diagram.html) | **دیاگرام تعاملی** وضعیت پرونده و جدول اکشن → انتقال |

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
cp .env.example .env
npm run dev     # http://localhost:5173 (پورت ثابت — strictPort)
```

فرانت‌اند از `VITE_API_URL` در `frontend/.env` استفاده می‌کند (پیش‌فرض: `http://localhost:3000/api`).

---

## تنظیمات محیطی

### Backend (`backend/.env`)

```env
PORT=3000
JWT_SECRET=digipay-jwt-secret-2024   # اجباری در production
KAVENEGAR_API_KEY=                   # برای ارسال واقعی پیامک
KAVENEGAR_SENDER=                    # خط فرستنده کاوه‌نگار
SMS_MOCK=true                        # true = بدون API واقعی
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3000/api
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
| `npm run clear-all-cases` | حذف همه پرونده‌ها و بدهکاران (داده دمو از نو) |
| `npm run clear-ab-tests` | پاک کردن سناریوهای A/B |
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
│   │   ├── middleware/            # authenticate, authorize, requireAdmin, requireCallOutcomeAccess
│   │   ├── routes/                # REST API (thin handlers)
│   │   ├── services/              # cases, reports, strategy engine, import, auth, SMS
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
│       ├── api/                   # axios + auth interceptor (VITE_API_URL)
│       └── utils/auth.js          # JWT, roles, hasPermission, logout
├── google-sheet-samples/          # نمونه TSV: cases، payments، bulk-assign، bulk-reassign
├── case-status-diagram.html       # دیاگرام وضعیت پرونده (مرورگر)
├── PRD-DigiPay.md
├── PROJECT-STATUS.md
├── TECHNICAL.md
└── README.md
```

---

## قابلیت‌های اصلی

- **پرونده‌ها:** لیست با **pagination سمت سرور** (SQL `LIMIT`/`OFFSET`)، فیلتر SQL، جزئیات، تخصیص، ثبت خروجی تماس
- **استراتژی:** تعریف اقدام‌های ترتیبی (پیامک / اتوکال / مذاکره) با `wait_next_minutes`، `wait_repeat_minutes`، `max_repeat` و **`repeat_on_results`** (تکرار شرطی)
- **موتور استراتژی:** اجرای خودکار هر ۱ دقیقه، تکرار فقط برای نتایج انتخاب‌شده، عبور به اقدام بعدی، **شکست استراتژی** و CEI boost
- **عملیات گروهی:** آپلود Excel پرونده، پرداخت، تخصیص / تخصیص مجدد + **دانلود فایل نمونه** از UI
- **CEI و سگمنت:** فرمول نسخه‌دار، تخصیص استراتژی، A/B Test، **Respite Time** (تأخیر تغییر استراتژی تا پایان `next_action_date`)
- **گزارشات (`/reports`):** سه تب — **پرونده‌ها**، **استراتژی‌ها** (عملکرد با **نسبت‌دهی tenure**، هزینه/وصول، Funnel)، **مذاکره‌کنندگان**
- **احراز هویت:** ثبت‌نام، ورود، JWT، نقش admin/negotiator، پنل مدیریت ادمین‌ها، صفحه انتظار نقش
- **تاریخچه:** Audit Trail با جزئیات فارسی (`historyDetails.js`) — شامل «پرداخت جزئی قبل از سررسید تعهد»
- **بدهکاران / اقساط:** لیست بدهکار، شماره تماس، اقساط پرونده

---

## API — خلاصه

| مسیر | کاربرد |
|------|--------|
| `GET /api/health` | سلامت سرور |
| `POST /api/auth/login` | ورود — JWT |
| `POST /api/auth/register` | ثبت‌نام — JWT + `has_role: false` → `/waiting` |
| `GET /api/auth/me` | کاربر جاری |
| `GET /api/users` | لیست کاربران (`authorize('admin_panel','view')`) |
| `GET /api/cases` | لیست paginated — `page`, `limit`, فیلتر SQL |
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

**Login، Register، JWT، RBAC و `authorize()` روی routeهای حساس پیاده شده‌اند.**

| لایه | وضعیت |
|------|--------|
| Frontend | `/login`, `/register`, `/forgot-password`, `/waiting` · `ProtectedRoute` · `hasPermission()` در Cases/Sidebar/RowActions |
| Backend | `authenticate` روی `/api/*` · `authorize(resource, action)` روی bulk/reports/settings/users/… · `requireCallOutcomeAccess` روی call-outcome |
| Audit | `user_name` از `req.user` — دیگر از body فرانت نیست |

**ورود admin (بعد از `npm run seed`):** `zahra.hamdi` / `Admin@1234` (سوپر ادمین)

**ثبت‌نام:** JWT با `has_role: false` برمی‌گردد → فرانت به `/waiting` ریدایرکت می‌کند.

**باقی‌مانده:** forgot-password بدون OTP · کاربر بدون نقش هنوز به APIهای عمومی دسترسی دارد (تا enforce کامل register).

جزئیات: [TECHNICAL.md §۱۰](./TECHNICAL.md#۱۰-احراز-هویت-و-دسترسی) · [PRD §۳.۴](./PRD-DigiPay.md#۳۴-پیاده‌سازی-دسترسی-در-نسخه-دمو)

---

## تست و کیفیت (برنامه)

Unit / Integration / E2E **هنوز پیاده نشده** — refactor سرویس (`cases.service`, `reports.service`) و RBAC انجام شده؛ مرجع: [TECHNICAL.md §۱۱](./TECHNICAL.md#۱۱-تست-refactor-و-بدهی-فنی).

---

## نکات

- `.env` و `database.sqlite` را commit نکنید.
- `SMS_MOCK=true` → پیامک واقعی ارسال نمی‌شود (فقط لاگ)؛ **نتیجه delivery** همچنان Mock است
- `SMS_MOCK=false` + کلید کاوه‌نگار → ارسال واقعی؛ نتیجه delivery همچنان Mock (تا اتصال webhook)
- Google Sheet در دمو: فقط `POST /api/gsheet/test` (اعتبارسنجی URL — سینک کامل نیست)
- لاگ موتور: `[strategy-engine]` و `[sms]` در ترمینال backend
- برچسب UI: **«اقدام»** (نه «اکشن») — فیلتر تاریخچه محدود به ۵ نوع اقدام

جزئیات جریان وضعیت‌ها: [case-status-diagram.html](./case-status-diagram.html) · [TECHNICAL.md — موتور استراتژی](./TECHNICAL.md#۴-موتور-استراتژی-strategy-engine).

---

## گزارشات — خلاصه منطق

### عملکرد استراتژی‌ها

شاخص‌ها بر اساس **بازه اجرای واقعی** هر استراتژی روی هر پرونده (`strategy-attribution.service.js`)، نه فقط `strategy_id` فعلی:

| شاخص | منطق |
|------|------|
| تعداد پرونده | هر پرونده‌ای که حداقل یک‌بار روی آن استراتژی اجرا شده (سبک→سنگین = در هر دو) |
| نرخ تبدیل | پرونده‌هایی با **پرداخت کامل** داخل همان بازه ÷ کل پرونده‌های آن استراتژی |
| میانگین روز / هزینه | همه پرونده‌های اجراشده در آن بازه |
| وصول | فقط پرداخت‌هایی که timestamp آن‌ها داخل همان بازه است |

### هزینه و وصول به تفکیک اقدام

| ستون | منطق |
|------|------|
| تعداد اجرا | همه اجراهای آن نوع اقدام در بازه فیلتر |
| تعداد وصول | هر پرداخت (جزئی/کامل) به **آخرین اجرای همان نوع اقدام** قبل از پرداخت نسبت داده می‌شود |
| نرخ تبدیل | اجراهای **یکتا** که حداقل یک وصول داشته ÷ تعداد اجرا — اگر بعد از یک اجرا دو بار پرداخت شود، در نرخ تبدیل **یک‌بار** شمرده می‌شود |

جزئیات: [TECHNICAL.md §۵.۵](./TECHNICAL.md#۵۵-گزارشات-reports).

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| `404` روی bulk | backend را ری‌استارت کنید |
| `[sms] خطا: 403` | API Key و خط فرستنده کاوه‌نگار |
| پرونده گیر کرده / پیامک تکراری | `node scripts/inspect-case.js <credit_id>` — جزئیات در TECHNICAL.md |
| `401` بعد از login | backend را ری‌استارت کنید؛ `JWT_SECRET` در `.env` |
| seed خطا می‌دهد | `npm install` در backend؛ سپس `npm run seed` |
=======
# debtcollection



## Getting started

To make it easy for you to get started with GitLab, here's a list of recommended next steps.

Already a pro? Just edit this README.md and make it your own. Want to make it easy? [Use the template at the bottom](#editing-this-readme)!

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/topics/git/add_files/#add-files-to-a-git-repository) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin https://repo.mydigipay.info/product/debtcollection.git
git branch -M master
git push -uf origin master
```

## Integrate with your tools

- [ ] [Set up project integrations](https://repo.mydigipay.info/product/debtcollection/-/settings/integrations)

## Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Set auto-merge](https://docs.gitlab.com/user/project/merge_requests/auto_merge/)

## Test and Deploy

Use the built-in continuous integration in GitLab.

- [ ] [Get started with GitLab CI/CD](https://docs.gitlab.com/ee/ci/quick_start/)
- [ ] [Analyze your code for known vulnerabilities with Static Application Security Testing (SAST)](https://docs.gitlab.com/ee/user/application_security/sast/)
- [ ] [Deploy to Kubernetes, Amazon EC2, or Amazon ECS using Auto Deploy](https://docs.gitlab.com/ee/topics/autodevops/requirements.html)
- [ ] [Use pull-based deployments for improved Kubernetes management](https://docs.gitlab.com/ee/user/clusters/agent/)
- [ ] [Set up protected environments](https://docs.gitlab.com/ee/ci/environments/protected_environments.html)

***

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thanks to [makeareadme.com](https://www.makeareadme.com/) for this template.

## Suggestions for a good README

Every project is different, so consider which of these sections apply to yours. The sections used in the template are suggestions for most open source projects. Also keep in mind that while a README can be too long and detailed, too long is better than too short. If you think your README is too long, consider utilizing another form of documentation rather than cutting out information.

## Name
Choose a self-explaining name for your project.

## Description
Let people know what your project can do specifically. Provide context and add a link to any reference visitors might be unfamiliar with. A list of Features or a Background subsection can also be added here. If there are alternatives to your project, this is a good place to list differentiating factors.

## Badges
On some READMEs, you may see small images that convey metadata, such as whether or not all the tests are passing for the project. You can use Shields to add some to your README. Many services also have instructions for adding a badge.

## Visuals
Depending on what you are making, it can be a good idea to include screenshots or even a video (you'll frequently see GIFs rather than actual videos). Tools like ttygif can help, but check out Asciinema for a more sophisticated method.

## Installation
Within a particular ecosystem, there may be a common way of installing things, such as using Yarn, NuGet, or Homebrew. However, consider the possibility that whoever is reading your README is a novice and would like more guidance. Listing specific steps helps remove ambiguity and gets people to using your project as quickly as possible. If it only runs in a specific context like a particular programming language version or operating system or has dependencies that have to be installed manually, also add a Requirements subsection.

## Usage
Use examples liberally, and show the expected output if you can. It's helpful to have inline the smallest example of usage that you can demonstrate, while providing links to more sophisticated examples if they are too long to reasonably include in the README.

## Support
Tell people where they can go to for help. It can be any combination of an issue tracker, a chat room, an email address, etc.

## Roadmap
If you have ideas for releases in the future, it is a good idea to list them in the README.

## Contributing
State if you are open to contributions and what your requirements are for accepting them.

For people who want to make changes to your project, it's helpful to have some documentation on how to get started. Perhaps there is a script that they should run or some environment variables that they need to set. Make these steps explicit. These instructions could also be useful to your future self.

You can also document commands to lint the code or run tests. These steps help to ensure high code quality and reduce the likelihood that the changes inadvertently break something. Having instructions for running tests is especially helpful if it requires external setup, such as starting a Selenium server for testing in a browser.

## Authors and acknowledgment
Show your appreciation to those who have contributed to the project.

## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.
>>>>>>> 1dae8d820fc7fc39d25518c3eec005bc16082e2d
