<div align="center">

# 🗂️ مسارات — Masarat Sheet2Site
### حوّل أي ملف إكسل إلى موقع تسجيل بيانات كامل، مع مزامنة تلقائية مع Google

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat-square)](https://orm.drizzle.team)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**منصة متعددة المشاريع** لتحويل أي هيكل بيانات (ملف إكسل) إلى نموذج تسجيل ويب متعدد الخطوات، بلوحة تحكم إدارية كاملة، ورفع ملفات آمن، ومزامنة مع Google Sheets و Google Drive.

**A multi-project platform that turns any spreadsheet structure into a full multi-step web registration form** — with an admin dashboard, secure file uploads, and live Google Sheets / Google Drive sync.

[العربية](#-نظرة-عامة) • [English](#-overview) • [التثبيت](#-التثبيت-والتشغيل--installation) • [API](#-api-endpoints)

</div>

---

## 📋 نظرة عامة

**مسارات** منصة رقمية تتيح لأي جهة إنشاء عدد غير محدود من "المشاريع" (نماذج تسجيل بيانات)، كل مشروع بحقوله وخطواته وإعداداته الخاصة — دون كتابة سطر كود واحد:

- **ارفع ملف إكسل** يحتوي على أعمدة بياناتك → تتولّى المنصة استنتاج الحقول تلقائيًا وإنشاء نموذج تسجيل جاهز فورًا
- **صمّم النموذج بصريًا** — أضف/عدّل الحقول، اجعلها مشروطة، وزّعها على خطوات متعددة، حدد من يراها
- **شارك رابط التسجيل العام** مع المستخدمين المستهدفين (موظفين، متقدمين، مستفيدين... إلخ)
- **تابع البيانات الواردة لحظيًا** من لوحة تحكم إدارية كاملة، مع مزامنة تلقائية إلى Google Sheets ونسخ الملفات المرفوعة إلى Google Drive

### لمن هذه المنصة؟

- **لمنشئ المشروع (Admin/Editor):** يحوّل ملف إكسل إلى موقع تسجيل بيانات كامل في دقائق، ويدير عدة مشاريع مستقلة في آنٍ واحد
- **للمستخدم النهائي:** يعبئ نموذج تسجيل بسيط متعدد الخطوات، مع إمكانية رفع ملفات ومرفقات، وتعديل بياناته لاحقًا عبر رابط شخصي مؤقت
- **للمشرف (Viewer):** يطّلع على كل البيانات ويصدّرها دون صلاحية تعديل

---

## 🌟 المميزات الرئيسية

### 🔄 تحويل إكسل إلى موقع (جوهر المنصة)
- ✅ **استيراد ملف إكسل/CSV** واستنتاج الحقول والأنواع تلقائيًا (نص، رقم، تاريخ، قوائم منسدلة...)
- ✅ **استيراد بيانات موجودة مسبقًا** من Google Sheets مباشرة إلى مشروع جديد
- ✅ **بناء نموذج متعدد الخطوات** بمصمم حقول مرئي بالسحب والإفلات

### 🧩 إدارة متعددة المشاريع
- 📁 **عدد غير محدود من المشاريع** المستقلة، كل واحد بنموذجه وحقوله وصلاحياته
- 🧠 **حقول مخصصة ديناميكية** لكل مشروع (نص، رقم، تاريخ، قائمة، ملف، رقم تسلسلي تلقائي...)
- 🔀 **حقول شرطية** — إظهار/إخفاء حقل حسب قيمة حقل آخر (AND/OR)
- 🔒 **صلاحيات عرض للحقول** حسب الدور (الكل / مدير فقط / محرر فقط)

### 📎 رفع الملفات الآمن
- ✅ **رفع مرفقات ضمن النموذج** (صور، مستندات) بحدود حجم ونوع قابلة للتخصيص لكل حقل
- ✅ **تحقق صارم من نوع الملف الفعلي** (وليس فقط الامتداد) لمنع رفع ملفات خبيثة
- ✅ **نسخ تلقائي إلى Google Drive** مع تحكم بمجلد الحفظ الجذري لكل مشروع
- 🔐 **وصول محمي بالكامل** — كل ملف مرتبط بصلاحية صاحب المشروع فقط، بلا وصول غير مصرح به بين المشاريع

### 📊 لوحة التحكم الإدارية
- 📈 **إحصائيات وتوزيعات مباشرة** لكل مشروع (يومي/أسبوعي/شهري، رسوم بيانية تفاعلية)
- 📄 **سجل تدقيق كامل (Audit Log)** لكل تعديل/حذف على أي سجل
- 🔍 **بحث + تصفية + تحديد متعدد + حذف دفعي** للسجلات
- 📤 **تصدير Excel** لكل مشروع مع اختيار الحقول

### 🔗 التكاملات
- 🔗 **Google Sheets** — مزامنة ثنائية الاتجاه (تصدير/استيراد) لكل مشروع
- 🗂️ **Google Drive** — رفع ومزامنة الملفات المرفقة تلقائيًا
- 📱 **Telegram** — إشعار فوري عند كل تسجيل جديد
- 📧 **SMTP** — دعوات المستخدمين وإشعارات البريد الإلكتروني (قابلة للتهيئة لكل مشروع)

### 🔐 الأمان والجودة
- 🔐 **تشفير AES-256-GCM** لمفاتيح الخدمات الحساسة (Google، Telegram) قبل تخزينها
- 🛡️ **صلاحيات دقيقة (RBAC)** على مستوى المشروع: مدير / محرر (مالك المشروع) / مشاهد
- 🚫 **حماية من الوصول غير المصرح به (IDOR)** على جميع مسارات البيانات والملفات
- ⏱️ **Rate Limiting** على كل نقاط الدخول الحساسة (تسجيل الدخول، رفع الملفات، الاستيراد...)
- 🌙 **Dark / Light Mode**
- 🌍 **ثنائي اللغة بالكامل:** عربي (RTL) + إنجليزي

---

## 🔍 Overview

**Masarat (مسارات)** is a multi-project platform that turns any spreadsheet into a fully functional, multi-step public registration website — no code required. Upload an Excel file, let the platform infer the form fields, customize the flow visually, and share the public registration link. Every submission (including file attachments) is tracked in a secure admin dashboard and can sync live to Google Sheets and Google Drive.

Unlike a single-form system, Masarat supports **unlimited independent projects**, each with its own fields, steps, visibility rules, invitation code, and integrations — making it suitable for HR onboarding, event registration, survey collection, or any structured data intake workflow.

---

## 🛠️ التقنيات المستخدمة | Tech Stack

| الطبقة | التقنية |
|--------|---------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS |
| **UI Components** | Radix UI, shadcn/ui, Lucide Icons, Recharts |
| **State Management** | TanStack Query v5 |
| **Routing** | Wouter |
| **Forms** | React Hook Form + Zod |
| **Backend** | Node.js, Express 4, TypeScript, tsx |
| **Database** | PostgreSQL + Drizzle ORM (JSONB dynamic records) |
| **Auth** | Express Session + bcryptjs, role-based access control |
| **File Uploads** | Multer + file-type (magic-byte validation) |
| **Integrations** | Google Sheets API, Google Drive API, Telegram Bot API, Nodemailer |
| **Security** | Helmet, CORS allowlist, express-rate-limit, AES-256-GCM (crypto) |
| **Excel Import/Export** | ExcelJS |

---

## 📁 بنية المشروع | Project Structure

```
masarat-sheet2site/
├── client/                      # React Frontend
│   └── src/
│       ├── components/          # UI Components (shadcn/ui)
│       ├── context/              # Auth + Language contexts
│       ├── lib/                  # queryClient, apiRequest helpers
│       └── pages/
│           ├── Setup.tsx         # First-run admin setup wizard
│           ├── AdminRegister.tsx # Accept invitation → create account
│           ├── ProjectRegister.tsx  # Public multi-step registration form
│           ├── ProjectEditForm.tsx  # Self-service edit via personal token
│           └── admin/
│               ├── Login.tsx
│               ├── Projects.tsx          # Project list
│               ├── CreateProject.tsx     # Create project / import Excel
│               ├── ProjectDashboard.tsx  # Stats + distributions
│               ├── ProjectSettings.tsx   # Fields, integrations, audit log
│               ├── ProjectRecords.tsx    # Records list/search/bulk actions
│               ├── ProjectRecordDetails.tsx
│               ├── ProjectRecordEdit.tsx
│               ├── ProjectAddRecord.tsx
│               ├── ProjectExport.tsx
│               └── GlobalSettings.tsx    # System-wide settings, users
├── server/                      # Express Backend
│   ├── index.ts                 # Entry point, DB init, protected /uploads route
│   ├── db.ts                    # Database connection
│   ├── middleware/
│   │   ├── auth.ts              # Session auth, RBAC middleware
│   │   └── upload.ts            # Multer config + file-type validation
│   ├── routes/
│   │   ├── auth.ts              # Setup, login/logout, invitations
│   │   ├── projects.ts          # Projects, fields, records, stats, audit-log, sync
│   │   └── pform.ts             # Public form submit/edit/draft/upload
│   └── services/
│       ├── crypto.ts            # AES-256-GCM encryption for secrets
│       ├── projectSheets.ts     # Google Sheets sync
│       ├── driveStorage.ts      # Google Drive file sync
│       ├── telegram.ts          # Telegram notifications
│       ├── email.ts             # SMTP email
│       └── recordInsert.ts      # Dynamic record insertion
├── shared/
│   └── schema.ts                # Drizzle schema (projects, projectFields, projectRecords, audit log) + Zod validators
├── docs/                        # Feature plans & audit reports
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## ⚡ التثبيت والتشغيل | Installation

### المتطلبات | Prerequisites

- Node.js 18+
- PostgreSQL 14+

### 1. استنساخ المستودع

```bash
git clone https://github.com/ibrahims78/masarat-sheet2site.git
cd masarat-sheet2site
```

### 2. تثبيت الحزم

```bash
npm install
```

### 3. إعداد متغيرات البيئة

أنشئ ملف `.env` في جذر المشروع:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/masarat

# Session & Encryption (required)
SESSION_SECRET=your-strong-random-secret-here
ENCRYPTION_KEY=32-byte-hex-key-for-aes-256-gcm

# Optional: Google Sheets / Drive Integration (configured per-project via the admin dashboard)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account", ...}

# Optional: Telegram Notifications (configured per-project)
TELEGRAM_BOT_TOKEN=your-bot-token

# Optional: Email (SMTP) — configurable per-project in admin settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
```

### 4. تشغيل التطبيق

```bash
npm run dev       # تشغيل الخادم والواجهة معاً
npm run server    # الخادم فقط (Express على المنفذ 3001)
npm run client    # الواجهة فقط (Vite على المنفذ 5000)
```

### 5. الإعداد الأولي

افتح المتصفح على `http://localhost:5000` — ستُوجَّه تلقائيًا إلى **معالج الإعداد** لإنشاء حساب المدير الأول، ثم يمكنك إنشاء أول مشروع واستيراد ملف إكسل فورًا.

---

## 🗂️ سير العمل | Workflow

```
1. سجّل الدخول كمدير وأنشئ مشروعًا جديدًا
      ↓ ارفع ملف إكسل → استنتاج الحقول تلقائيًا (أو ابدأ من الصفر)
2. خصّص الحقول: النوع، الشروط، الخطوات، من يراها
      ↓
3. فعّل التكاملات (Google Sheets / Drive / Telegram) إن رغبت
      ↓
4. شارك رابط التسجيل العام مع المستخدمين المستهدفين
      ↓
5. المستخدم يعبئ النموذج متعدد الخطوات (مع رفع الملفات إن وجدت)
      ↓
✅ تسجيل ناجح + رابط تعديل شخصي مؤقت
      ↓
6. تابع البيانات لحظيًا من لوحة التحكم — مزامنة تلقائية مع Google
```

---

## 🔐 نظام الأدوار | Role System

| الدور | الصلاحيات |
|-------|-----------|
| **Admin (مدير)** | وصول كامل لكل المشاريع: إنشاء/تعديل/حذف + إدارة المستخدمين + الإعدادات العامة |
| **Editor (محرر)** | وصول كامل فقط للمشاريع التي أنشأها هو (إنشاء، تعديل، حذف، إعدادات، تكاملات) |
| **Viewer (مشاهد)** | عرض وتصدير جميع المشاريع، دون صلاحية تعديل أو حذف |

---

## 📡 API Endpoints (ملخّص)

### المصادقة والإعداد
| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/api/auth/setup-required` | هل النظام يحتاج إعدادًا أوليًا؟ |
| `POST` | `/api/auth/setup` | إنشاء حساب المدير الأول |
| `POST` | `/api/auth/login` / `/logout` | تسجيل الدخول / الخروج |
| `GET` | `/api/auth/me` | بيانات المستخدم الحالي |
| `POST` | `/api/auth/register-invite` | قبول دعوة وإنشاء حساب |

### المشاريع والحقول والسجلات
| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET`/`POST` | `/api/projects` | قائمة المشاريع / إنشاء مشروع |
| `POST` | `/api/projects/parse-excel` | استنتاج حقول من ملف إكسل مرفوع |
| `GET`/`PATCH`/`DELETE` | `/api/projects/:id` | عرض / تعديل / حذف مشروع |
| `GET`/`POST` | `/api/projects/:id/fields` | حقول المشروع الديناميكية |
| `GET`/`POST` | `/api/projects/:id/records` | سجلات المشروع (بحث، تصفية، صفحات) |
| `PATCH`/`DELETE` | `/api/projects/:id/records/:recordId` | تعديل/حذف سجل |
| `GET` | `/api/projects/:id/stats` `/stats/distributions` | إحصائيات وتوزيعات |
| `GET` | `/api/projects/:id/export` | تصدير Excel |
| `GET` | `/api/projects/:id/audit-log` | سجل التدقيق |
| `POST` | `/api/projects/:id/sync-drive` `/import-from-sheets` `/export-to-sheets` | مزامنة Google |

### النموذج العام
| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/api/pform/:projectId/info` | بيانات النموذج العام |
| `POST` | `/api/pform/:projectId/upload` | رفع ملف مرفق أثناء التعبئة |
| `POST` | `/api/pform/:projectId/submit` | إرسال التسجيل |
| `GET`/`PATCH` | `/api/pform/:projectId/edit/:token` | عرض/تعديل عبر رابط شخصي مؤقت |

> القائمة الكاملة موثّقة داخل الكود في `server/routes/*.ts`.

---

## 🚀 النشر | Deployment

### متغيرات بيئة الإنتاج

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=strong-production-secret
ENCRYPTION_KEY=32-byte-hex-key
```

### بناء للإنتاج

```bash
npm run build
npm start
```

---

## 🤝 المساهمة | Contributing

المساهمات مرحب بها! يُرجى:

1. Fork المستودع
2. إنشاء branch جديد: `git checkout -b feature/amazing-feature`
3. Commit التغييرات: `git commit -m 'feat: add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. فتح Pull Request

---

## 📄 الرخصة | License

هذا المشروع مرخص تحت رخصة **MIT** — راجع ملف [LICENSE](LICENSE) للتفاصيل.

---

<div align="center">

صُنع بـ ❤️ — **مسارات (Masarat Sheet2Site)**

</div>
