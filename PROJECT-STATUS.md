# وضعیت پروژه — سیستم وصول مطالبات دیجی‌پی

---

## ۱. ساختار فایل‌های Backend

```
backend/
├── package.json                  پیکربندی پکیج‌ها، اسکریپت‌ها (start / dev / seed)
├── database.sqlite               فایل دیتابیس SQLite (خودکار ساخته می‌شود)
└── src/
    ├── server.js                 نقطه ورود: مقداردهی دیتابیس، راه‌اندازی سرور روی پورت ۳۰۰۰
    ├── app.js                    ساخت و پیکربندی Express، اتصال تمام routeها
    ├── db/
    │   ├── database.js           لایه اتصال sql.js: initDatabase / query / run / persist
    │   ├── schema.sql            تعریف کامل جداول و ایندکس‌های دیتابیس
    │   ├── seed.js               داده‌های اولیه (seed) برای تست دمو
    │   ├── cei.js                موتور محاسبه CEI (فرمول وام + BNPL)
    │   ├── segmentUtil.js        کمک‌توابع سگمنت: toInterval, intervalsOverlap, validateCondition
    │   └── strategyActions.js    کمک‌توابع اکشن‌های استراتژی: getActions, validateActions, replaceActions
    └── routes/
        ├── health.js             GET /api/health — تست سلامت سرور
        ├── cases.js              پرونده‌ها: لیست، جزئیات، تخصیص، ثبت خروجی تماس
        ├── negotiators.js        مذاکره‌کنندگان: لیست، ایجاد، ویرایش
        ├── strategies.js         استراتژی‌ها: لیست، جزئیات، ایجاد، ویرایش، حذف
        ├── segments.js           سگمنت‌ها: لیست، ایجاد، ویرایش، حذف
        ├── cei.js                فرمول CEI: خواندن، ذخیره نسخه جدید، تست پیش‌نمایش
        ├── abTests.js            سناریوهای A/B Test: لیست، ایجاد، حذف
        ├── settings.js           تنظیمات: خواندن، ویرایش، تاریخچه
        └── gsheet.js             تست اتصال آدرس Google Sheet (دمو — فقط validation)
```

---

## ۲. ساختار فایل‌های Frontend

```
frontend/
├── package.json                  پیکربندی پکیج‌ها و اسکریپت‌ها (dev / build / preview)
├── index.html                    نقطه ورود HTML (RTL، فونت وزیرمتن)
├── vite.config.js                پیکربندی Vite (پلاگین React)
├── tailwind.config.js            پیکربندی Tailwind CSS (رنگ brand، فونت، shadow)
├── postcss.config.js             پیکربندی PostCSS
├── eslint.config.js              پیکربندی ESLint
└── src/
    ├── main.jsx                  نقطه ورود React: BrowserRouter + Toaster
    ├── App.jsx                   ریشه: Layout + AppRoutes
    ├── index.css                 استایل‌های پایه Tailwind
    │
    ├── routes/
    │   ├── AppRoutes.jsx         تعریف تمام routeها با React Router
    │   └── navItems.js           آیتم‌های منوی کناری (icon, label, to, adminOnly)
    │
    ├── pages/
    │   ├── Cases.jsx             ✅ صفحه پرونده‌ها — جدول + فیلتر + سایدبار + مدال‌ها
    │   ├── Negotiators.jsx       ✅ صفحه مذاکره‌کنندگان — جدول + ایجاد + ویرایش
    │   ├── Strategies.jsx        ✅ صفحه استراتژی‌ها — جدول + ایجاد + ویرایش + A/B Test
    │   ├── AdminPanel.jsx        ✅ ادمین پنل — منوی بخش‌ها + محتوای هر بخش
    │   ├── Debtors.jsx           ⏳ Placeholder — هنوز پیاده‌سازی نشده
    │   ├── Installments.jsx      ⏳ Placeholder — هنوز پیاده‌سازی نشده
    │   ├── History.jsx           ⏳ Placeholder — هنوز پیاده‌سازی نشده
    │   ├── BulkOperations.jsx    ⏳ Placeholder — هنوز پیاده‌سازی نشده
    │   ├── Reports.jsx           ⏳ Placeholder — هنوز پیاده‌سازی نشده
    │   └── PlaceholderPage.jsx   کامپوننت عمومی «به‌زودی»
    │
    ├── components/
    │   ├── layout/
    │   │   ├── Layout.jsx        قالب کلی: Header + Sidebar + محتوا
    │   │   ├── Header.jsx        نوار بالا (نام کاربر، نقش)
    │   │   └── Sidebar.jsx       منوی کناری با navItems
    │   │
    │   ├── table/
    │   │   ├── CasesTable.jsx    جدول پرونده‌ها (ستون‌ها، badge، منوی عملیات)
    │   │   ├── CasesFilters.jsx  فیلترهای جدول پرونده‌ها
    │   │   ├── Badge.jsx         کامپوننت badge رنگی (tone-based)
    │   │   └── RowActionsMenu.jsx منوی عملیات هر سطر (تخصیص، ثبت تماس، ...)
    │   │
    │   ├── sidebar/
    │   │   └── CaseDetailSidebar.jsx  سایدبار جزئیات پرونده (اطلاعات + سابقه اقدامات + تعهدات)
    │   │
    │   ├── modal/
    │   │   ├── Modal.jsx         کامپوننت پایه مدال (portal، header، footer)
    │   │   ├── CallOutcomeModal.jsx  مدال ثبت خروجی تماس مذاکره‌کننده
    │   │   └── AssignModal.jsx   مدال تخصیص / تخصیص مجدد پرونده
    │   │
    │   └── admin/
    │       ├── GeneralSettings.jsx      تنظیمات عمومی (سقف PTP، فاصله پرداخت جزئی)
    │       ├── CaseCreationRules.jsx    شرایط ایجاد پرونده (حداقل DPD)
    │       ├── CeiSettings.jsx          فرمول CEI (ویرایش پارامتر + تست پیش‌نمایش + تاریخچه نسخه)
    │       ├── SegmentsSettings.jsx     تعریف سگمنت‌ها (ایجاد + ویرایش + حذف)
    │       ├── GoogleSheetSettings.jsx  تنظیمات اتصال Google Sheet
    │       ├── StrategyActionsBuilder.jsx  بیلدر اکشن‌های استراتژی (drag-free)
    │       └── AbTestModal.jsx          مدال ایجاد سناریو A/B Test
    │
    ├── api/
    │   ├── client.js             تنظیم axios (baseURL: http://localhost:3000/api)
    │   ├── cases.js              fetchCases, fetchCaseById, assignCase, submitCallOutcome
    │   ├── negotiators.js        fetchNegotiators, createNegotiator, updateNegotiator
    │   ├── strategies.js         fetchStrategies, fetchStrategyById, createStrategy, updateStrategy, deleteStrategy
    │   ├── segments.js           fetchSegments, createSegment, updateSegment, deleteSegment
    │   ├── cei.js                fetchCeiFormulas, saveCeiFormula, testCeiPreview
    │   ├── abTests.js            fetchAbTests, createAbTest, deleteAbTest
    │   ├── settings.js           fetchSettings, updateSettings, fetchSettingsHistory
    │   └── gsheet.js             testGsheetConnection
    │
    └── utils/
        ├── auth.js               currentUser (mock) + isAdmin()
        ├── constants.js          برچسب فارسی وضعیت‌ها، انواع اقدام، نوع اعتبار، ...
        └── format.js             toFaDigits, formatRial, orDash, ...
```

---

## ۳. جداول دیتابیس و فیلدهای هر جدول

### negotiators — مذاکره‌کنندگان
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| name | TEXT | نام |
| status | TEXT | `active` / `inactive` |
| cooperation_type | TEXT | `internal` / `outsourced` |
| capacity | INTEGER | ظرفیت کاری |
| hourly_wage | INTEGER | حقوق ساعتی (ریال) |
| created_at | TEXT | تاریخ ایجاد |

### debtors — بدهکاران
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| first_name | TEXT | نام |
| last_name | TEXT | نام خانوادگی |
| national_code | TEXT UNIQUE | کد ملی |
| gender | TEXT | `male` / `female` |
| mobile | TEXT | شماره موبایل اصلی |
| province | TEXT | استان |
| city | TEXT | شهر |
| customer_rank | TEXT | رتبه مشتری |
| created_at | TEXT | تاریخ ایجاد |

### phone_numbers — شماره‌های تماس
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| debtor_id | INTEGER FK | شناسه بدهکار |
| phone | TEXT | شماره تماس |
| source | TEXT | `digipay` / `digikala` / `inquiry` / `manual` |
| created_at | TEXT | تاریخ ثبت |

### addresses — آدرس‌های بدهکار
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| debtor_id | INTEGER FK | شناسه بدهکار |
| address | TEXT | آدرس |
| postal_code | TEXT | کد پستی |
| source | TEXT | `digipay` / `digikala` / `inquiry` / `manual` |
| created_at | TEXT | تاریخ ثبت |

### segments — سگمنت‌ها
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| title | TEXT | عنوان سگمنت |
| credit_type | TEXT | `loan` / `bnpl` |
| condition_type | TEXT | `between` / `lt` / `lte` / `gt` / `gte` |
| cei_x | REAL | مقدار اول شرط CEI |
| cei_y | REAL | مقدار دوم (فقط برای between) |
| created_at | TEXT | تاریخ ایجاد |

### strategies — استراتژی‌ها
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| title | TEXT | عنوان استراتژی |
| credit_type | TEXT | `loan` / `bnpl` |
| segment_id | INTEGER FK | سگمنت مرتبط |
| created_by | TEXT | ایجادکننده |
| created_at | TEXT | تاریخ ایجاد |
| updated_at | TEXT | آخرین به‌روزرسانی |

### strategy_actions — اکشن‌های استراتژی
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| strategy_id | INTEGER FK | شناسه استراتژی |
| seq | INTEGER | ترتیب اجرا |
| action_type | TEXT | `warning_sms` / `threatening_sms` / `warning_autocall` / `threatening_autocall` / `negotiator_call` |
| body_text | TEXT | متن پیامک یا تماس |
| allowed_from | TEXT | شروع بازه مجاز (HH:MM) |
| allowed_to | TEXT | پایان بازه مجاز (HH:MM) |
| wait_days | INTEGER | روزهای انتظار قبل از اکشن بعدی |
| cost | INTEGER | هزینه هر اقدام (ریال) |
| max_repeat | INTEGER | حداکثر تکرار (فقط negotiator_call) |
| avg_call_duration | INTEGER | میانگین مدت تماس به دقیقه |

### ab_tests — سناریوهای A/B Test
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| name | TEXT | نام سناریو |
| credit_type | TEXT | `loan` / `bnpl` |
| segment_id | INTEGER FK | سگمنت مرتبط |
| strategy_a_id | INTEGER FK | استراتژی A |
| ratio_a | INTEGER | نرخ توزیع A (٪) |
| strategy_b_id | INTEGER FK | استراتژی B |
| ratio_b | INTEGER | نرخ توزیع B (٪) |
| created_at | TEXT | تاریخ ایجاد |

### cases — پرونده‌ها
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| debtor_id | INTEGER FK | بدهکار |
| credit_id | TEXT | شناسه اعتبار |
| credit_type | TEXT | `loan` / `single_installment` / `four_installment` / `bnpl` |
| supplier | TEXT | تامین‌کننده |
| guarantee_type | TEXT | `none` / `promissory_note` / `cheque` |
| debt_class | TEXT | کلاس بدهی |
| dpd | INTEGER | روزهای دیرکرد |
| credit_amount | INTEGER | مبلغ اعتبار (ریال) |
| outstanding_debt | INTEGER | بدهی غیرجاری پرداخت‌نشده |
| claims_amount | INTEGER | مطالبات (مبلغ کل غیرجاری) |
| penalty_amount | INTEGER | جریمه انباشته |
| assigned_negotiator_id | INTEGER FK | مذاکره‌کننده مسئول |
| case_status | TEXT | وضعیت پرونده (۱۱ وضعیت) |
| last_action | TEXT | آخرین اقدام |
| last_action_date | TEXT | تاریخ آخرین اقدام |
| next_action | TEXT | اقدام بعدی |
| next_action_date | TEXT | تاریخ اقدام بعدی (شمسی) |
| action_status | TEXT | `waiting` / `due_today` / `overdue` |
| cei | REAL | شاخص CEI محاسبه‌شده |
| cei_formula_version | TEXT | نسخه فرمول استفاده‌شده |
| segment_id | INTEGER FK | سگمنت |
| strategy_id | INTEGER FK | استراتژی |
| case_cost | INTEGER | هزینه پرونده (مجموع اقدامات) |
| call_count | INTEGER | تعداد تماس‌های انجام‌شده |
| max_call_count | INTEGER | حداکثر تماس مجاز |
| previous_case_id | INTEGER FK | لینک به پرونده قبلی |
| first_unpaid_no | INTEGER | شماره اولین قسط پرداخت‌نشده |
| first_unpaid_date | TEXT | تاریخ سررسید اولین قسط پرداخت‌نشده |
| last_unpaid_no | INTEGER | شماره آخرین قسط پرداخت‌نشده |
| last_unpaid_date | TEXT | تاریخ سررسید آخرین قسط پرداخت‌نشده |
| total_installments | INTEGER | تعداد کل اقساط |
| overdue_installments_count | INTEGER | تعداد اقساط سررسید گذشته |
| last_payment_date | TEXT | تاریخ آخرین پرداخت |
| last_payment_amount | INTEGER | مبلغ آخرین پرداخت |
| created_at | TEXT | تاریخ ایجاد |
| updated_at | TEXT | آخرین به‌روزرسانی |

### installments — اقساط
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| installment_number | INTEGER | شماره قسط |
| due_date | TEXT | تاریخ سررسید (شمسی) |
| amount | INTEGER | مبلغ قسط |
| penalty_balance | INTEGER | مانده جریمه |
| fee | INTEGER | کارمزد |
| status | TEXT | وضعیت قسط |
| payment_status | TEXT | `unpaid` / `paid` |
| payment_date | TEXT | تاریخ پرداخت |

### payments — پرداخت‌ها
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| amount | INTEGER | مبلغ پرداخت |
| payment_date | TEXT | تاریخ پرداخت (شمسی) |
| payment_type | TEXT | `full` / `partial` |
| created_at | TEXT | تاریخ ثبت |

### case_history — تاریخچه تغییرات (Audit Trail)
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| debtor_id | INTEGER FK | بدهکار |
| user_name | TEXT | نام کاربر یا «سیستم» |
| operation | TEXT | نام عملیات |
| case_status | TEXT | وضعیت پرونده در آن لحظه |
| next_action | TEXT | اقدام بعدی در آن لحظه |
| next_action_date | TEXT | تاریخ اقدام بعدی |
| details | TEXT | جزئیات (متن یا JSON) |
| created_at | TEXT | زمان ثبت |

### case_actions — سابقه اقدامات پرونده
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| seq | INTEGER | ترتیب اجرا |
| action_type | TEXT | نوع اقدام |
| body_text | TEXT | متن اقدام |
| result | TEXT | نتیجه اقدام |
| action_date | TEXT | تاریخ اجرا |
| cost | INTEGER | هزینه |
| call_status | TEXT | وضعیت تماس (برای negotiator_call) |
| next_call_date | TEXT | تاریخ تماس بعدی |

### promises — تعهدات پرداخت (Promise to Pay)
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| promised_date | TEXT | تاریخ سررسید تعهد |
| amount | INTEGER | مبلغ تعهد |
| status | TEXT | `pending` / `fulfilled` / `broken` |
| created_at | TEXT | تاریخ ثبت |

### case_files — فایل‌های پرونده
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| case_id | INTEGER FK | پرونده |
| name | TEXT | نام نمایشی فایل |
| file_type | TEXT | `cheque` / `contract` / `other` |
| created_at | TEXT | تاریخ ثبت |

### settings — تنظیمات عمومی (key/value)
| فیلد | نوع | توضیح |
|---|---|---|
| key | TEXT PK | کلید تنظیم |
| value | TEXT | مقدار |

کلیدهای اصلی تنظیمات:
- `min_dpd` — حداقل روزهای دیرکرد برای ایجاد پرونده (پیش‌فرض: ۶۱)
- `promise_to_pay_max_days` — سقف مهلت مجاز Promise to Pay (پیش‌فرض: ۱۰)
- `partial_payment_gap_days` — فاصله پرداخت جزئی (پیش‌فرض: ۱۰)
- `loan_cap` — حداکثر مبلغ وام برای Cap فرمول وام (پیش‌فرض: ۱,۰۰۰,۰۰۰,۰۰۰)
- `bnpl_cap` — حداکثر مبلغ برای Cap فرمول BNPL (پیش‌فرض: ۱۰۰,۰۰۰,۰۰۰)

### settings_history — تاریخچه تغییرات تنظیمات
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| key | TEXT | کلید تغییریافته |
| old_value | TEXT | مقدار قبلی |
| new_value | TEXT | مقدار جدید |
| user_name | TEXT | انجام‌دهنده |
| changed_at | TEXT | زمان تغییر |

### cei_formulas — نسخه‌های فرمول CEI
| فیلد | نوع | توضیح |
|---|---|---|
| id | INTEGER PK | شناسه |
| credit_type | TEXT | `loan` / `bnpl` |
| version | INTEGER | شماره نسخه |
| params | TEXT | پارامترها به صورت JSON |
| is_active | INTEGER | ۱ = فعال، ۰ = غیرفعال |
| change_note | TEXT | توضیح تغییر |
| user_name | TEXT | ایجادکننده |
| created_at | TEXT | تاریخ ایجاد |

---

## ۴. لیست APIهای موجود

### Health
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/health` | تست سلامت سرور |

### Cases — پرونده‌ها
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/cases` | لیست پرونده‌ها با اطلاعات بدهکار و مذاکره‌کننده |
| GET | `/api/cases/:id` | جزئیات پرونده (+ اقدامات، تعهدات، فایل‌ها، پرونده‌های دیگر بدهکار) |
| POST | `/api/cases/:id/assign` | تخصیص / تخصیص مجدد پرونده به مذاکره‌کننده |
| POST | `/api/cases/:id/call-outcome` | ثبت خروجی تماس مذاکره‌کننده |

### Negotiators — مذاکره‌کنندگان
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/negotiators` | لیست با فیلدهای محاسباتی (پرونده فعال، تماس امروز، ...) |
| POST | `/api/negotiators` | ایجاد مذاکره‌کننده جدید |
| PUT | `/api/negotiators/:id` | ویرایش (ظرفیت، وضعیت، نوع همکاری، حقوق ساعتی) |

### Segments — سگمنت‌ها
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/segments` | لیست سگمنت‌ها به تفکیک نوع اعتبار |
| POST | `/api/segments` | ایجاد سگمنت (با بررسی همپوشانی CEI) |
| PUT | `/api/segments/:id` | ویرایش سگمنت |
| DELETE | `/api/segments/:id` | حذف سگمنت (اگر پرونده فعال نداشته باشد) |

### Strategies — استراتژی‌ها
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/strategies` | لیست با عنوان سگمنت، تعداد پرونده، اطلاعات A/B Test |
| GET | `/api/strategies/:id` | جزئیات + اکشن‌های استراتژی |
| POST | `/api/strategies` | ایجاد استراتژی با اکشن‌ها |
| PUT | `/api/strategies/:id` | ویرایش استراتژی |
| DELETE | `/api/strategies/:id` | حذف (اگر پرونده باز نداشته باشد) |

### CEI Formulas — فرمول CEI
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/cei-formulas` | نسخه فعال + تاریخچه نسخه‌ها برای هر نوع اعتبار |
| PUT | `/api/cei-formulas` | ذخیره نسخه جدید فرمول (نسخه قبلی غیرفعال می‌شود) |
| POST | `/api/cei-formulas/test` | پیش‌نمایش CEI برای یک credit_id |

### AB Tests — سناریوهای A/B Test
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/ab-tests` | لیست سناریوها با عنوان سگمنت و استراتژی‌ها |
| POST | `/api/ab-tests` | ایجاد سناریو با دو استراتژی جدید |
| DELETE | `/api/ab-tests/:id` | حذف سناریو + دو استراتژی آن |

### Settings — تنظیمات
| Method | URL | توضیح |
|---|---|---|
| GET | `/api/settings` | همه تنظیمات به صورت key→value |
| GET | `/api/settings/history` | تاریخچه تغییرات (با فیلتر اختیاری ?key=...) |
| PUT | `/api/settings` | به‌روزرسانی یک یا چند تنظیم + ثبت تاریخچه |

### Google Sheet
| Method | URL | توضیح |
|---|---|---|
| POST | `/api/gsheet/test` | تست اعتبارسنجی آدرس Google Sheet (دمو) |

---

## ۵. وضعیت فعلی: چه چیزی پیاده شده و چه چیزی نیست

### ✅ پیاده‌سازی شده

**Backend:**
- ساختار کامل دیتابیس (۱۴ جدول، ایندکس‌ها، Foreign Keyها)
- موتور محاسبه CEI (فرمول وام + BNPL با پارامترهای قابل تنظیم)
- نسخه‌بندی فرمول CEI (هر ذخیره = نسخه جدید، نسخه قبلی غیرفعال)
- مدیریت مذاکره‌کنندگان (CRUD + فیلدهای محاسباتی: نرخ موفقیت، پرونده فعال، تماس امروز)
- مدیریت سگمنت‌ها (CRUD + بررسی همپوشانی CEI + بررسی نام تکراری)
- مدیریت استراتژی‌ها و اکشن‌ها (CRUD کامل)
- سناریوهای A/B Test (ایجاد با دو استراتژی جدید، حذف)
- تخصیص / تخصیص مجدد پرونده (بررسی ظرفیت، قانون یک بدهکار = یک مذاکره‌کننده)
- ثبت خروجی تماس (وضعیت تماس، دلیل عدم پرداخت، Promise to Pay، ارجاع به حقوقی، محاسبه هزینه)
- تنظیمات عمومی (key/value + تاریخچه)
- Audit Trail در case_history برای تخصیص و ثبت تماس
- تست آدرس Google Sheet (دمو — فقط validation فرمت)
- Seed داده‌های اولیه

**Frontend:**
- لایه API کامل برای همه endpointها
- صفحه پرونده‌ها: جدول با فیلتر سمت کلاینت، سایدبار جزئیات، مدال تخصیص، مدال ثبت تماس
- صفحه مذاکره‌کنندگان: جدول، مدال ایجاد/ویرایش، لینک به پرونده‌های فیلترشده
- صفحه استراتژی‌ها: جدول، مدال ایجاد/ویرایش با بیلدر اکشن، مدال A/B Test
- ادمین پنل: شرایط ایجاد پرونده، فرمول CEI، سگمنت‌ها، تنظیمات عمومی، Google Sheet
- منوی کناری با کنترل دسترسی adminOnly
- Badge رنگی، فرمت‌های عددی فارسی، سیستم toast

---

### ⏳ هنوز پیاده‌سازی نشده

**صفحات Frontend:**
- صفحه بدهکاران (Debtors) — لیست، سایدبار، افزودن شماره تماس
- صفحه اقساط (Installments) — نمایش جزئیات اقساط
- صفحه تاریخچه تغییرات (History / Audit Trail)
- صفحه عملیات گروهی (BulkOperations) — آپلود Excel، تخصیص گروهی
- صفحه گزارشات (Reports)

**Backend — APIهای ناموجود:**
- CRUD بدهکاران (debtors)
- افزودن / مدیریت شماره تماس و آدرس
- مشاهده تاریخچه پرونده (case_history)
- مشاهده اقساط یک پرونده (installments)
- ثبت پرداخت (payments)
- عملیات گروهی: آپلود Excel، تخصیص گروهی
- سینک واقعی با Google Sheet (الان فقط validation آدرس)
- گزارشات

**منطق‌های پیاده‌نشده (backend):**
- اجرای خودکار اکشن‌های استراتژی (scheduler / cron)
- منطق تغییر استراتژی پس از تغییر CEI (بخش ۵.۴ PRD)
- منطق پرداخت جزئی (recalculate CEI + next_action_date)
- منطق پرداخت کامل (تغییر وضعیت به paid)
- اعتبارسنجی قوانین ایجاد پرونده (DPD ≥ min_dpd، کلاس بدهی)
- پردازش فایل Excel (آپلود، خواندن، اعتبارسنجی، ایجاد/به‌روزرسانی پرونده)
- ارسال پیامک و تماس خودکار

**سیستم احراز هویت:**
- فعلاً mock ثابت (کاربر: زهرا حمیدی، نقش: admin)
- نقش مذاکره‌کننده پیاده‌سازی نشده

---

## ۶. پکیج‌های نصب‌شده

### Backend
| پکیج | نسخه | کاربرد |
|---|---|---|
| `express` | ^5.2.1 | فریم‌ورک سرور HTTP |
| `cors` | ^2.8.6 | مدیریت CORS |
| `dotenv` | ^17.4.2 | خواندن متغیرهای محیطی از .env |
| `sql.js` | ^1.14.1 | SQLite کامپایل‌شده به WebAssembly (به جای better-sqlite3) |
| `nodemon` | ^3.1.14 | (devDependency) ری‌استارت خودکار در حین توسعه |

> **نکته:** به دلیل مشکل نصب `better-sqlite3` روی ویندوز، از `sql.js` استفاده شده که هر بار write، دیتابیس را روی فایل ذخیره می‌کند.

### Frontend
| پکیج | نسخه | کاربرد |
|---|---|---|
| `react` | ^19.2.7 | کتابخانه UI |
| `react-dom` | ^19.2.7 | رندر در مرورگر |
| `react-router-dom` | ^7.18.0 | مسیریابی |
| `axios` | ^1.18.1 | HTTP client برای API calls |
| `react-hook-form` | ^7.80.0 | مدیریت فرم‌ها |
| `@hookform/resolvers` | ^5.4.0 | اتصال zod به react-hook-form |
| `zod` | ^4.4.3 | اعتبارسنجی schema |
| `react-hot-toast` | ^2.6.0 | نمایش toast notifications |
| `lucide-react` | ^1.21.0 | آیکون‌ها |
| `date-fns-jalali` | ^4.4.0-0 | توابع تاریخ شمسی |
| `tailwindcss` | ^3.4.19 | (devDependency) CSS utility-first |
| `vite` | ^8.1.0 | (devDependency) Build tool |
| `@vitejs/plugin-react` | ^6.0.2 | (devDependency) پشتیبانی React در Vite |

---

## اطلاعات اجرا

- **Backend:** `cd backend && npm run dev` → پورت ۳۰۰۰
- **Frontend:** `cd frontend && npm run dev` → پورت ۵۱۷۳ (پیش‌فرض Vite)
- **Seed داده:** `cd backend && npm run seed`
