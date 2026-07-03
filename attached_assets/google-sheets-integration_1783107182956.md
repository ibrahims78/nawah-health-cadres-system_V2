# ربط Google Sheets — التصميم الكامل للآلية الجديدة

**الإصدار:** 2.0  
**تاريخ التوثيق:** يوليو 2026  
**الحالة:** مطبّق في الإنتاج

---

## 1. نظرة عامة ومبررات التغيير

### المشكلة مع الآلية القديمة

كان النظام يعتمد على قيام **التطبيق بإنشاء ملفات Google Sheet تلقائياً** عبر Drive API، مما أفضى إلى:

| المشكلة | التأثير |
|---|---|
| الملفات تُحفظ في Drive الـ Service Account (لا في Drive المستخدم) | المستخدم لا يملك الملف فعلياً |
| حصة 15GB للـ SA تنفد عند كثرة المشاريع | فشل الإنشاء + background retry jobs معقدة |
| يستلزم تفعيل Drive API + Sheets API | إعداد أطول وأكثر تعقيداً |
| مفتاح JSON يمنح صلاحية Drive كاملة | مساحة هجوم أوسع |

### الحل الجديد

المستخدم **يُنشئ الملف بنفسه** في Google Drive الخاص به، ثم **يشاركه** مع الـ Service Account. التطبيق يكتفي بالقراءة والكتابة على الملف الموجود — لا ينشئ شيئاً، لا يحتاج Drive API.

---

## 2. المتطلبات المسبقة (لكل مشروع)

### أ — إعداد Google Cloud Console (مرة واحدة لكل Service Account)

```
1. انتقل إلى https://console.cloud.google.com
2. أنشئ مشروعاً جديداً (أو اختر موجوداً)
3. APIs & Services → Enable APIs & Services
4. ابحث عن "Google Sheets API" وفعّله فقط
   ⛔ لا حاجة لـ Google Drive API بعد الآن
5. APIs & Services → Credentials → Create Credentials → Service Account
6. أدخل اسماً وصفياً (مثل: nawah-sync)
7. افتح الـ Service Account → Keys → Add Key → Create new key → JSON
8. احفظ ملف JSON في مكان آمن
```

### ب — إعداد Google Drive (لكل مشروع)

```
1. افتح drive.google.com بحسابك الشخصي/المؤسسي
2. أنشئ مجلداً باسم المشروع (اختياري لكن منظّم)
3. أنشئ ملف Google Sheet جديداً داخل المجلد
   (اسم الملف اختياري — التطبيق لا يهمه اسم الملف)
4. افتح الملف → زر "مشاركة" (Share)
5. أضف بريد الـ Service Account (client_email من ملف JSON)
   مثال: nawah-sync@my-project.iam.gserviceaccount.com
6. اختر صلاحية "محرر" (Editor) → إرسال
7. انسخ رابط الملف من شريط العنوان
```

---

## 3. إعداد الربط داخل التطبيق

### الحقول المطلوبة في صفحة إعدادات المشروع

| الحقل | القيمة | ملاحظة |
|---|---|---|
| بريد الـ Service Account | `client_email` من ملف JSON | للعرض فقط — يذكّر المستخدم بالبريد الذي شارك معه |
| مفتاح الـ Service Account (JSON) | محتوى ملف JSON كاملاً | يُشفَّر بـ AES قبل الحفظ، لا يُعرض مجدداً |
| رابط ملف الـ Sheet أو معرّفه | الرابط الكامل أو الـ ID المجرّد | التطبيق يستخرج الـ ID تلقائياً من الرابط |
| اسم التبويب | نص حر | افتراضي: "بيانات" |

### زر "التحقق من الاتصال"

يُجري 4 فحوصات متتالية:

```
① تحليل JSON والتحقق من صحته (type = service_account, private_key, client_email)
② إصلاح أحرف newline الفاسدة (\n → \\n) عند اللصق من textarea
③ استدعاء spreadsheets.get للتحقق من وجود الملف وصلاحية القراءة
④ استدعاء values.update على خلية مؤقتة للتحقق من صلاحية الكتابة
   ثم حذف القيمة المؤقتة فوراً
```

**نتائج محتملة:**

| الحالة | الرسالة |
|---|---|
| نجاح كامل | `✅ الاتصال ناجح — قراءة وكتابة مؤكّدتان` |
| JSON فاسد | `❌ ملف JSON تالف — تأكد من نسخه كاملاً` |
| نوع خاطئ | `❌ يجب أن يكون النوع service_account` |
| Sheet ID غير صالح | `❌ معرف الـ Sheet غير صالح (400)` |
| الملف غير مشارك | `❌ صلاحية مرفوضة (403) — تأكد من مشاركة الملف مع: [email]` |
| الملف محذوف | `❌ الملف غير موجود (404) — أعد إنشاء الملف وشاركه` |

---

## 4. آلية المزامنة (تدفق البيانات)

### 4.1 إضافة سجل جديد

```
المستخدم يرسل النموذج (عام أو من الأدمن)
        │
        ▼
PostgreSQL Advisory Lock (hashtext(projectId))
— يمنع التسابق بين الطلبات المتزامنة —
        │
        ▼
حساب رقم تسلسلي فريد (MAX + 1)
حساب حقول autoincrement داخل القفل
        │
        ▼
INSERT في project_records ← COMMIT ← فكّ القفل
        │
        ▼
[غير متزامن — لا ينتظر]
appendRecordToSheet(projectId, enriched_data, seqNum)
    │
    ├── ensureSheetTab() — إنشاء التبويب إن لم يوجد
    ├── ensureHeaders() — كتابة صف الترويسات إن اختلف
    ├── spreadsheets.values.append (INSERT_ROWS)
    └── حفظ sheetsRowIndex في project_records
```

### 4.2 تعديل سجل

```
PATCH /api/projects/:id/records/:recordId
        │
        ▼
تجريد حقول autoincrement من الـ body (لا تُعدَّل)
استعادة قيمها من السجل الموجود
        │
        ▼
UPDATE project_records SET data = safeBody
        │
        ▼
[غير متزامن]
إذا كان sheetsRowIndex محفوظاً:
    → updateRecordRow(rowIndex) — values.update مباشرة
إذا لم يكن محفوظاً:
    → appendRecordToSheet ثم حفظ الـ rowIndex الجديد
```

### 4.3 حذف سجل

```
DELETE /api/projects/:id/records/:recordId
        │
        ▼
حذف من project_records
        │
        ▼
[غير متزامن]
deleteRecordRow(sheetsRowIndex)
    → spreadsheets.batchUpdate (deleteDimension)
    → Google Sheets يُزيح الصفوف للأعلى تلقائياً
    → UPDATE project_records SET sheetsRowIndex = sheetsRowIndex - 1
       WHERE projectId = :id AND sheetsRowIndex > deletedRow
       (تصحيح الأرقام المحفوظة بعد الإزاحة)
```

### 4.4 إدارة الترويسات (ensureHeaders)

في كل عملية append، النظام يقرأ الصف الأول ويقارنه بحقول المشروع. إذا اختلفا، يُعيد كتابة الصف الأول. يمكن تشغيل "إصلاح الترويسات" يدوياً في حال إضافة حقول جديدة.

### 4.5 الاستيراد من الـ Sheet إلى قاعدة البيانات

```
POST /api/projects/:id/import-from-sheets
        │
        ▼
قراءة جميع الصفوف (A:ZZ)
مطابقة ترويسات الـ Sheet بأسماء حقول المشروع
        │
        ▼
لكل صف:
  ├── seqNum موجود في DB → UPDATE السجل
  ├── seqNum جديد → INSERT سجل جديد
  └── لا seqNum → تجاهل (skipped)
        │
        ▼
نتيجة: { added, updated, skipped }
```

---

## 5. هيكل قاعدة البيانات (الحقول ذات الصلة)

```sql
-- في جدول projects
googleServiceAccountEmail   TEXT        -- بريد الـ SA (مرئي، للمرجع)
googleServiceAccountKeyEnc  TEXT        -- مفتاح JSON مشفّر بـ AES-256-GCM
googleSheetId               TEXT        -- معرّف الـ Spreadsheet (الـ ID المجرّد)
googleSheetName             TEXT        -- اسم التبويب (افتراضي: "بيانات")

-- في جدول project_records
sheetsRowIndex              INTEGER     -- رقم الصف في Sheets (null = لم يُزامَن بعد)
```

---

## 6. هيكل الكود (الملفات الرئيسية)

```
server/
├── services/
│   └── projectSheets.ts          ← منطق المزامنة كاملاً
│       ├── getSheetsClient()      — بناء Google Sheets client من بيانات المشروع
│       ├── extractSpreadsheetId() — استخراج ID من رابط أو ID مجرّد
│       ├── sanitizeSheetTabName() — تنظيف اسم التبويب
│       ├── ensureSheetTab()       — التأكد من وجود التبويب
│       ├── ensureHeaders()        — مزامنة صف الترويسات
│       ├── appendRecordToSheet()  — إضافة صف جديد
│       ├── updateRecordRow()      — تعديل صف موجود
│       ├── deleteRecordRow()      — حذف صف
│       ├── testProjectSheetsConnection() — التحقق من الاتصال (قراءة + كتابة)
│       ├── fixProjectSheetHeaders()      — إصلاح الترويسات يدوياً
│       ├── checkProjectSheetColumns()    — مقارنة الأعمدة
│       └── importFromProjectSheet()      — استيراد من Sheet إلى DB
│
└── routes/
    └── projects.ts
        ├── POST /:id/test-sheets          — التحقق من الاتصال
        ├── POST /:id/fix-sheet-headers    — إصلاح الترويسات
        ├── POST /:id/check-sheet-columns  — فحص الأعمدة
        └── POST /:id/import-from-sheets   — الاستيراد

client/
└── pages/admin/
    └── ProjectSettings.tsx (تبويب Sheets)
        ├── دليل الإعداد خطوة بخطوة
        ├── نموذج الإعدادات (email, JSON key, sheet URL, tab name)
        ├── زر "التحقق من الاتصال"
        └── أدوات الصيانة (فحص أعمدة، إصلاح ترويسات، استيراد)
```

---

## 7. الاختبار

### اختبار الاتصال (من الواجهة)

```
1. أدخل بريد الـ SA + مفتاح JSON + رابط الـ Sheet
2. اضغط "حفظ الإعدادات"
3. اضغط "التحقق من الاتصال"
4. انتظر النتيجة — يجب أن تظهر:
   ✅ الاتصال ناجح — قراءة وكتابة مؤكّدتان
```

### اختبار المزامنة التلقائية

```
1. أضف سجلاً جديداً من النموذج العام أو من لوحة الأدمن
2. افتح ملف الـ Sheet في Google
3. تحقق من ظهور السجل في صف جديد خلال ثوانٍ
```

### اختبار التعديل

```
1. عدّل سجلاً موجوداً من لوحة الأدمن
2. في الـ Sheet، تحقق من تحديث نفس الصف (لا صف جديد)
```

### اختبار الاستيراد العكسي

```
1. أضف صفاً يدوياً في الـ Sheet بنفس تنسيق الترويسات
   (يجب أن يحتوي العمود الأول على رقم تسلسلي جديد)
2. في التطبيق → إعدادات المشروع → Sheets → "مزامنة الآن"
3. تحقق من ظهور السجل في قاعدة بيانات التطبيق
```

### اختبار سيناريو الخطأ (403)

```
1. أدخل بريد SA صحيح لكن لم تُشارك الملف معه
2. اضغط "التحقق من الاتصال"
3. يجب أن تظهر:
   ❌ صلاحية مرفوضة (403) — تأكد من مشاركة الملف مع: [email@...]
```

---

## 8. القيود والملاحظات

| الموضوع | التفصيل |
|---|---|
| **عدم التزامن** | المزامنة مع Sheets تعمل في الخلفية — فشلها لا يؤثر على حفظ السجل في DB |
| **sheetsRowIndex** | إذا فشلت أول عملية append، السجل يبقى في DB بدون rowIndex وسيُضاف تلقائياً عند أول تعديل |
| **إزاحة الصفوف** | عند الحذف، الأرقام المحفوظة تُصحَّح تلقائياً في DB لتعويض إزاحة Google Sheets |
| **autoincrement** | هذا النوع من الحقول يُملأ داخل Advisory Lock ولا يظهر في النماذج — قيمته دائماً MAX+1 |
| **حذف Drive API** | لا يُستخدم Drive API في الآلية الجديدة — يكفي تفعيل Sheets API فقط |
| **أمان المفتاح** | مفتاح JSON يُشفَّر بـ AES-256-GCM قبل الحفظ ولا يُعاد إرساله للواجهة أبداً |
