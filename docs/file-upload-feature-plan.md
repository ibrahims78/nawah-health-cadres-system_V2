# خطة تطوير ميزة رفع الملفات مع التكامل الكامل مع Google Drive
## منصة مسارات — Healthcare Staff Management System

**تاريخ الإعداد:** 2026-07-04  
**آخر تحديث:** 2026-07-04  
**الحالة:** مسودة خطة عمل — لم يُنفَّذ بعد  
**الهدف:** تحويل ميزة رفع الملفات من حالتها الهيكلية الحالية إلى ميزة إنتاجية موثوقة مع تخزين دائم على Google Drive وتنظيم آلي بمجلد مخصَّص لكل مشروع.

---

## 0. أين تُحفظ الملفات؟ — فهم منظومة التخزين

### التخزين الحالي (مؤقت ⚠️)

```
المستخدم يرفع ملفاً
      ↓
Multer يحفظه في /uploads/ على قرص خادم Replit
      ↓
UUID عشوائي يُستخدم اسماً للملف (مثال: 550e8400...png)
      ↓
المسار النسبي (/uploads/550e8400...png) يُخزَّن في قاعدة البيانات
```

> **⚠️ تحذير حرج:** قرص Replit **مؤقت بطبيعته**. عند كل عملية نشر (Deploy) أو إعادة تشغيل للخادم، يُمكن أن تُفقد الملفات المحفوظة في `/uploads/` نهائياً. هذا يجعل التخزين المحلي **غير مناسب للإنتاج** ويجب اعتباره مرحلة مؤقتة فقط.

### التخزين المستهدف (دائم ✅) — Google Drive

```
المستخدم يرفع ملفاً
      ↓
Multer يحفظه مؤقتاً في /tmp/ (ذاكرة مؤقتة للمعالجة فقط)
      ↓
التحقق الأمني من نوع الملف (Magic Bytes)
      ↓
رفع الملف إلى Google Drive عبر Service Account
      ↓
حذف الملف المؤقت من /tmp/ فوراً
      ↓
رابط Drive الدائم يُخزَّن في قاعدة البيانات
```

### هل يمكن إنشاء مجلد في Google Drive والحفظ فيه؟

**نعم، هذا ممكن تماماً وهو المقترح الأساسي في هذه الخطة.**

آلية العمل:
1. تُنشئ أنت مجلداً جذراً واحداً في Google Drive يدوياً وتُسمِّيه (مثال: `مسارات — ملفات المنصة`)
2. تمنح Service Account المنصة صلاحية **Editor** على هذا المجلد
3. بعد ذلك تُنشئ المنصة تلقائياً المجلدات الفرعية (مشاريع وسجلات) داخله دون أي تدخل يدوي

---

## 1. التشخيص الحالي

### ما يعمل حالياً

- النوع `file` مُعرَّف في `shared/schema.ts` ضمن enum الأنواع المتاحة للمسؤول
- مكوّن `FileField.tsx` يرفع الملف فور اختياره عبر `POST /api/pform/:id/upload`
- الـ endpoint يحفظ الملف على قرص الخادم في `/uploads/`
- التحقق الأمني من نوع الملف بطبقتين (امتداد + Magic Bytes) — آلية ناجعة ولا تحتاج تعديلاً
- الـ URL يُخزَّن في `project_records.data` (JSONB) ويُصدَّر إلى Google Sheets

### المشاكل المُكتشَفة (6 ثغرات وظيفية + 3 ثغرات تصميمية)

| الكود | المشكلة | الخطورة |
|---|---|---|
| P1 | المستخدم العام لا يستطيع فتح ملفه بعد الإرسال (`/uploads` محمي بجلسة) | 🔴 حرج |
| P2 | صفحة التعديل الذاتي (`ProjectEditForm.tsx`) لا تعرض حقل الملف نهائياً | 🔴 حرج |
| P3 | رابط الملف في Google Sheet نسبي (`/uploads/uuid.pdf`) وغير قابل للفتح | 🟠 عالٍ |
| P4 | الملفات لا تُحذف عند حذف السجل — تراكم يتيم على القرص | 🟠 عالٍ |
| P5 | التخزين على قرص الخادم مؤقت — يُفقَد عند إعادة النشر | 🔴 حرج في الإنتاج |
| P6 | لا قيود على نوع الملف أو حجمه على مستوى كل حقل | 🟡 متوسط |
| D1 | ملفات مرفوعة قبل إرسال النموذج (ثم إغلاق المتصفح) تبقى يتيمة بلا سجل | 🟠 عالٍ |
| D2 | حذف مشروع لا يُحذِّر من بقاء ملفاته في Drive | 🟠 عالٍ |
| D3 | صلاحيات ملفات Drive غير محددة — قد تكون غير قابلة للفتح عبر الرابط | 🔴 حرج |

---

## 2. بنية Google Drive المقترحة

### هيكل المجلدات

```
📁 مسارات — ملفات المنصة  ← تُنشئه يدوياً مرة واحدة
├── 📁 مشروع: إدارة كوادر المختبرات [project-uuid-1]  ← تُنشئه المنصة تلقائياً
│   ├── 📁 سجل: أحمد محمد سالم [rec-a1b2c3d4]  ← يُنشأ لحظة إرسال النموذج
│   │   ├── 📄 cv_السيرة_الذاتية.pdf
│   │   └── 🖼 photo_الصورة_الشخصية.jpg
│   ├── 📁 سجل: فاطمة علي حسن [rec-e5f6g7h8]
│   │   └── 📄 cert_الشهادة_الجامعية.pdf
│   └── 📁 _orphan_cleanup  ← ملفات مُرفوعة بلا إرسال (تُنظَّف دورياً)
├── 📁 مشروع: تسجيل الممرضين [project-uuid-2]
│   └── ...
```

### مبدأ التنظيم

- **مجلد جذر واحد** — تُنشئه أنت يدوياً وتُدخل معرِّفه في إعدادات النظام
- **مجلد واحد لكل مشروع** — يُنشأ تلقائياً عند أول رفع ملف فيه
- **مجلد فرعي لكل سجل** — يُنشأ لحظة إرسال النموذج باسم المسجَّل + أول 8 أحرف من UUID السجل
- **تسمية الملفات:** `{مفتاح_الحقل}_{الاسم_الأصلي}.{امتداد}` — للقراءة البشرية مع تجنُّب التعارض
- **الرابط المُخزَّن في DB:** `https://drive.google.com/file/d/{fileId}/view` — رابط Drive مباشر دائم
- **صلاحية الملفات:** كل ملف يُرفَع بصلاحية **"Anyone with the link can view"** حتى يعمل الرابط في Google Sheets ومن صفحة النتيجة بدون حساب Google

---

## 3. المتطلبات التقنية

### إعداد Google Service Account (مرة واحدة — خطوات يدوية)

```
1. افتح Google Cloud Console
2. أنشئ مشروعاً جديداً أو اختر مشروعاً قائماً
3. فعِّل Google Drive API من قائمة APIs & Services
4. أنشئ Service Account من IAM & Admin → Service Accounts
5. أنشئ مفتاح JSON وحمِّله (هذا ما ستضعه في Secrets)
6. في Google Drive: أنشئ مجلداً جذراً باسم "مسارات — ملفات المنصة"
7. اضغط بزر الماوس الأيمن على المجلد → Share → أضف بريد الـ Service Account بصلاحية Editor
8. انسخ معرِّف المجلد من URL المتصفح (الجزء بعد /folders/)
```

### Replit Secrets المطلوبة

```
GOOGLE_SERVICE_ACCOUNT_KEY   — محتوى ملف JSON للـ service account (كاملاً)
APP_BASE_URL                 — رابط المنصة الإنتاجي الكامل (https://your-app.replit.app)
                               يُستخدم لتوليد روابط مطلقة للملفات المحلية في Sheets
                               في التطوير: https://{REPLIT_DEV_DOMAIN}
GOOGLE_DRIVE_ROOT_FOLDER_ID  — معرِّف المجلد الجذر الذي أنشأته في الخطوة 6 أعلاه
```

> **ملاحظة:** `GOOGLE_SERVICE_ACCOUNT_KEY` هي نفس المتغير المستخدم للـ Sheets — لا داعي لإنشاء service account جديد إذا كان مُعدَّاً مسبقاً.

### تعديلات قاعدة البيانات

```sql
-- إضافة لجدول projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS drive_upload_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drive_root_folder_id TEXT;
  -- google_drive_folder_id موجود مسبقاً — يُستخدم لمجلد المشروع المُنشأ تلقائياً

-- إضافة لجدول project_fields (قيود مخصَّصة لكل حقل)
ALTER TABLE project_fields
  ADD COLUMN IF NOT EXISTS allowed_file_types TEXT[],  -- ["image/*","application/pdf"] — null = كل الأنواع
  ADD COLUMN IF NOT EXISTS max_file_size_mb   INTEGER; -- 1..50 — null = الحد العام (10MB)

-- إضافة لجدول project_records
ALTER TABLE project_records
  ADD COLUMN IF NOT EXISTS drive_files  JSONB DEFAULT '{}',
  -- { fieldKey: { fileId, driveUrl, originalName, mimeType, sizeBytes, uploadedAt, folderId } }
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
  -- معرِّف مجلد السجل في Drive (لحذفه لاحقاً)

-- جدول جديد لتتبُّع الملفات المرفوعة قبل الإرسال (لتنظيفها دورياً)
CREATE TABLE IF NOT EXISTS drive_orphan_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL,       -- Drive fileId
  folder_id    TEXT,                -- Drive folderId
  uploaded_at  TIMESTAMP DEFAULT NOW()
);
```

---

## 4. خطة التنفيذ — 5 مراحل

---

### المرحلة الأولى — إصلاح UX الحرج (تخزين محلي مؤقت)

**الهدف:** جعل الميزة الحالية تعمل بشكل صحيح قبل إضافة Drive  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** لا يوجد  
**⚠️ تنبيه مهم:** التصحيحات في هذه المرحلة تعمل على التخزين المحلي الذي يبقى **مؤقتاً**. الملفات ستُفقَد عند إعادة النشر حتى اكتمال المرحلة الثانية. لا تُطلق هذه المرحلة في بيئة الإنتاج منفردةً.

#### المهام

**1.1 — إصلاح رؤية الملفات للمستخدم العام (P1)**

- **الملف:** `client/src/components/FileField.tsx`
- **التعديل:** إضافة prop اختيارية `authSuffix?: string` تُلحَق بالـ URL:
  ```tsx
  href={value + (authSuffix ?? "")}
  ```
- **الملف:** `client/src/pages/ProjectRegister.tsx`
- **التعديل:** بعد الحصول على `editToken`، تمرير:
  ```tsx
  authSuffix={`?token=${editToken}&project=${projectId}`}
  ```
- **الملف:** `server/index.ts`
- **التحقق:** route `/uploads/:filename` يدعم `?token=&project=` — لا تعديل مطلوب

**1.2 — إضافة file field في صفحة التعديل الذاتي (P2)**

- **الملف:** `client/src/pages/ProjectEditForm.tsx`
- **التعديل:** إضافة branch في دالة renderField:
  ```tsx
  case "file":
    return <FileField
      value={formValues[f.key]}
      onChange={(url) => setFieldValue(f.key, url)}
      uploadUrl={`/api/pform/${projectId}/upload`}
      fieldKey={f.key}
      authSuffix={`?token=${editToken}&project=${projectId}`}
    />;
  ```

#### اختبار المرحلة الأولى

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T1.1 | إرسال نموذج برفع ملف → فتح رابط المراجعة | الملف يُفتح بدون تسجيل دخول |
| T1.2 | فتح رابط التعديل الذاتي لسجل فيه حقل file | حقل الملف يظهر مع الملف المرفوع سابقاً |
| T1.3 | تعديل الملف من صفحة التعديل وإرسال | الملف الجديد يُحفظ ويظهر في قاعدة البيانات |
| T1.4 | فتح `/uploads/...` بدون token | استجابة 401 |

**شرط الانتقال للمرحلة الثانية:** اجتياز T1.1 و T1.2 و T1.3 بنجاح 100%

---

### المرحلة الثانية — تكامل Google Drive (التخزين الدائم)

**الهدف:** رفع الملفات مباشرةً إلى Drive بدلاً من قرص الخادم — حلٌّ التخزين الدائم  
**المدة المقدَّرة:** يومان  
**التبعيات:** إتمام إعداد Service Account + إضافة الـ Secrets الثلاثة

#### المهام

**2.1 — Drive Storage Service**

- **الملف الجديد:** `server/services/driveStorage.ts`
- **الوظائف:**

```typescript
// إنشاء مجلد للمشروع إذا لم يكن موجوداً، والإعادة من DB إذا كان موجوداً
ensureProjectFolder(projectId: string, projectName: string): Promise<string>

// إنشاء مجلد فرعي للسجل — الاسم: "{label} [{id.slice(0,8)}]"
ensureRecordFolder(projectFolderId: string, label: string, recordId: string): Promise<string>

// رفع ملف من /tmp/ إلى Drive بصلاحية "Anyone with the link can view"
uploadFileToDrive(params: {
  localFilePath: string;
  fileName: string;
  mimeType: string;
  folderId: string;
}): Promise<{ fileId: string; driveUrl: string; sizeBytes: number }>

// نقل ملف من مجلد إلى آخر (من _orphan_cleanup إلى مجلد السجل)
moveFileToDriveFolder(fileId: string, newFolderId: string): Promise<void>

// حذف ملف من Drive (يُستخدم عند حذف السجل)
deleteFileFromDrive(fileId: string): Promise<void>

// حذف مجلد إذا أصبح فارغاً
deleteEmptyFolder(folderId: string): Promise<void>

// تنظيف ملفات _orphan_cleanup الأقدم من 48 ساعة
cleanOrphanFiles(projectFolderId: string): Promise<void>
```

**2.2 — تعديل upload endpoint**

- **الملف:** `server/routes/pform.ts` (رفع المستخدم العام)
- **المنطق الجديد:**
  ```
  multer يحفظ مؤقتاً في /tmp/
        ↓
  validateMimeType (موجود — لا تعديل)
        ↓
  if (project.driveUploadEnabled):
    driveStorage.ensureProjectFolder()
    ensureRecordFolder أو orphan folder
    driveStorage.uploadFileToDrive()
    تسجيل الملف في drive_orphan_files
    fs.unlink(tempFile)  ← حذف /tmp/ فوراً
    return { url: driveUrl, driveFileId, storage: "drive" }
  else:
    نقل الملف من /tmp/ إلى /uploads/ (السلوك الحالي)
    return { url: "/uploads/filename", storage: "local" }
  ```

- **الملف:** `server/routes/projects.ts` (رفع المسؤول)
- نفس المنطق

**2.3 — ربط الملفات بالسجل بعد الإرسال**

- **الملف:** `server/routes/pform.ts` — route إرسال النموذج النهائي
- **بعد حفظ السجل:**
  ```
  driveStorage.ensureRecordFolder(projectFolderId, applicantName, recordId)
  للملفات المُسجَّلة في drive_orphan_files:
    driveStorage.moveFileToDriveFolder(fileId, recordFolderId)
  حذفها من جدول drive_orphan_files
  تحديث drive_files و drive_folder_id في project_records
  ```

**2.4 — Cleanup Job للملفات اليتيمة**

- **الملف الجديد:** `server/jobs/driveCleanup.ts`
- يعمل كـ `setInterval` كل 6 ساعات عند بدء الخادم
- يقرأ من جدول `drive_orphan_files` ما عمره أكثر من 48 ساعة
- يحذف الملفات من Drive ثم من الجدول
- يُسجِّل العملية في console للمراجعة

```typescript
// في server/index.ts — بعد initDB():
import { startDriveCleanupJob } from "./jobs/driveCleanup.js";
startDriveCleanupJob(); // يعمل كل 6 ساعات
```

#### اختبار المرحلة الثانية

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T2.1 | تفعيل Drive لمشروع + رفع ملف | مجلد المشروع يُنشأ في Drive + ملف يظهر في `_orphan_cleanup` |
| T2.2 | إرسال النموذج كاملاً | مجلد السجل يُنشأ + الملف ينتقل إليه + يُحذف من orphan |
| T2.3 | فتح رابط Drive المُعاد | الملف يُفتح مباشرةً من Drive بدون حساب Google |
| T2.4 | رفع ملف بدون تفعيل Drive | الملف يُحفظ في `/uploads/` كالمعتاد |
| T2.5 | Service Account غير صحيح | رسالة خطأ واضحة للمستخدم + الملف لا يُرفَع |
| T2.6 | إغلاق المتصفح بعد رفع الملف دون إرسال | الملف في orphan folder — يُحذف تلقائياً بعد 48 ساعة |
| T2.7 | فحص Drive مباشرةً | الملف في المجلد الصحيح بالاسم الصحيح وصلاحية "Anyone with link" |

**شرط الانتقال:** اجتياز T2.1 → T2.7 + التحقق اليدوي من Drive وصلاحيات الملف

---

### المرحلة الثالثة — إصلاح Google Sheets وحذف الملفات

**الهدف:** إصلاح P3 (روابط الـ Sheet) و P4 (تنظيف الحذف) و D2 (حذف المشروع)  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** المرحلتان 1 و2

#### المهام

**3.1 — روابط مطلقة في Google Sheets (P3)**

- **الملف:** `server/services/projectSheets.ts`
- **دالة مساعدة جديدة:**
  ```typescript
  function resolveFieldValueForSheet(
    field: ProjectField,
    value: any,
    driveFiles: Record<string, any>
  ): string {
    if (field.fieldType !== "file" || !value) return String(value ?? "");

    // أولوية 1: رابط Drive إذا كانت الميزة مُفعَّلة
    const driveFile = driveFiles?.[field.key];
    if (driveFile?.driveUrl) return driveFile.driveUrl;

    // أولوية 2: رابط مطلق للتخزين المحلي (يتطلب APP_BASE_URL في Secrets)
    const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    if (!baseUrl) {
      console.warn("APP_BASE_URL غير مضبوط — روابط الملفات في Sheet ستكون نسبية");
    }
    return baseUrl + String(value);
  }
  ```
- **التطبيق:** في `appendRecordToSheet` و `updateRecordRow`

**3.2 — حذف الملفات عند حذف السجل (P4)**

- **الملف:** `server/routes/projects.ts`
- **في route حذف السجل الفردي:**
  ```typescript
  // 1. حذف ملفات Drive
  const driveFiles = record.driveFiles || {};
  const fileIds = Object.values(driveFiles)
    .filter((f: any) => f?.fileId)
    .map((f: any) => f.fileId);
  await Promise.allSettled(fileIds.map(id => driveStorage.deleteFileFromDrive(id)));

  // 2. حذف مجلد السجل في Drive إذا أصبح فارغاً
  if (record.driveFolderId) {
    await driveStorage.deleteEmptyFolder(record.driveFolderId);
  }

  // 3. حذف الملفات المحلية (وضع Fallback)
  const localUrls = Object.values(recordData as Record<string, any>)
    .filter(v => String(v).startsWith("/uploads/"));
  localUrls.forEach(url =>
    fs.unlink(path.join(uploadsDir, path.basename(String(url))), () => {})
  );
  ```
- **في route الحذف الجماعي (`bulkDelete`):** نفس المنطق مُطبَّق على كل سجل في المجموعة

**3.3 — تحذير صريح عند حذف مشروع (D2)**

- **الملف:** مكوّن حوار تأكيد الحذف في الـ Admin UI
- **المحتوى المُضاف:**
  ```
  ⚠️ تحذير: حذف المشروع لن يحذف ملفاته من Google Drive تلقائياً.
  يجب حذف مجلد المشروع يدوياً من Drive بعد اكتمال الحذف.
  📁 مجلد Drive: [رابط مباشر للمجلد — إن وُجد]
  
  [ ] أفهم أن الملفات في Drive تحتاج حذفاً يدوياً
  [تأكيد الحذف]  [إلغاء]
  ```
- زر "تأكيد الحذف" لا يُفعَّل إلا بعد تحديد خانة الاختيار أعلاه

#### اختبار المرحلة الثالثة

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T3.1 | إرسال نموذج + فتح Google Sheet | خلية الملف تحتوي رابط Drive قابل للنقر يفتح الملف مباشرة |
| T3.2 | نفس الاختبار بدون Drive | خلية تحتوي URL مطلق (`https://app.../uploads/...`) |
| T3.3 | حذف سجل فيه ملف Drive | الملف يختفي من Drive (تحقق يدوي) + مجلد السجل يُحذف إذا فرغ |
| T3.4 | حذف سجل فيه ملف محلي | الملف يُحذف من `/uploads/` |
| T3.5 | حذف جماعي لسجلات متعددة | جميع ملفات المجموعة تُحذف من Drive والقرص |
| T3.6 | محاولة حذف مشروع | حوار التحذير يظهر مع رابط مجلد Drive + زر مُقيَّد بخانة الاختيار |

**شرط الانتقال:** اجتياز T3.1 و T3.3 و T3.6 + فحص يدوي للـ Sheet والـ Drive

---

### المرحلة الرابعة — إعدادات الحقل وتجربة المسؤول

**الهدف:** التحكم الدقيق لكل حقل + تحسين لوحة الإدارة  
**المدة المقدَّرة:** يومان  
**التبعيات:** المراحل 1 و2 و3

#### المهام

**4.1 — قيود مخصَّصة لكل حقل file**

- **في منشئ الحقول (ProjectSettings.tsx):** عند اختيار نوع `file`، تظهر خيارات:
  - ✅ صور (jpg, png, webp, gif)
  - ✅ ملفات PDF
  - ✅ ملفات Office (doc, docx, xls, xlsx)
  - ✅ ملفات نصية (txt)
  - حجم أقصى: [Slider 1–50 MB، الافتراضي 10]

- **في FileField.tsx:** تطبيق القيود في `accept` attribute + فحص `file.size` قبل الرفع مع رسالة رفض واضحة

- **في server/routes/pform.ts:** قراءة إعدادات الحقل وتخصيص multer fileFilter ديناميكياً (رفض الخادم كطبقة ثانية)

**4.2 — معاينة الملفات في لوحة الإدارة**

- **في جدول السجلات (ProjectRecords.tsx):**
  - خلايا حقل `file`: صورة مصغرة 40×40 للصور — أيقونة PDF/Office للملفات الأخرى
  - Tooltip بالاسم الأصلي والحجم عند المرور
  - زر "فتح في Drive" ↗ مباشر إلى Drive

- **في صفحة تفاصيل السجل:**
  - بطاقة "المستندات المرفقة" بكل الملفات (الاسم / النوع / الحجم / تاريخ الرفع)
  - زر "فتح مجلد Drive" يفتح مجلد السجل كاملاً

**4.3 — تبديل تفعيل Drive من إعدادات المشروع**

```
تخزين الملفات:
  ○ تخزين محلي (مؤقت — غير مناسب للإنتاج)
  ● Google Drive  ← الخيار الموصى به
    📁 مجلد المشروع: [رابط المجلد] (يظهر بعد أول رفع)
    
  ⚠️ التبديل لا يُهاجر الملفات القديمة — فقط الرفوعات الجديدة تتأثر.
```

#### اختبار المرحلة الرابعة

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T4.1 | تحديد "صور فقط" لحقل + رفع PDF | رسالة رفض واضحة في الـ client + رفض الخادم كطبقة ثانية |
| T4.2 | ضبط حجم أقصى 2MB + رفع ملف 5MB | رفع مرفوض قبل الإرسال مع عرض الحجم المسموح |
| T4.3 | فتح جدول السجلات في الإدارة | الصور thumbnails — بقية الملفات أيقونات |
| T4.4 | النقر على أيقونة ملف | الملف يُفتح مباشرةً في Drive |

**شرط الانتقال:** اجتياز جميع الاختبارات

---

### المرحلة الخامسة — الاختبار الشامل والتوثيق النهائي

**الهدف:** اختبار كامل للنظام كوحدة متكاملة قبل الإطلاق الإنتاجي  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** اجتياز المراحل 1-4 كاملةً

#### سيناريوهات الاختبار الشامل

**السيناريو A — دورة حياة كاملة لسجل واحد**
```
1. مسؤول يُنشئ مشروعاً مع تفعيل Drive
2. مسؤول يُضيف حقل file (صور فقط، حجم أقصى 3MB)
3. مستخدم يرفع صورة شخصية في النموذج
4. مستخدم يُرسِل النموذج
   ✅ الصورة في Drive ضمن مجلد المشروع/السجل
   ✅ رابط Drive في Google Sheet قابل للنقر بدون حساب Google
   ✅ رابط قابل للنقر في صفحة نتيجة الإرسال
5. مستخدم يفتح رابط التعديل ويُغيِّر الصورة
   ✅ الصورة القديمة تُحذف من Drive
   ✅ الصورة الجديدة تُرفَع في نفس المجلد
   ✅ الـ Sheet يُحدَّث بالرابط الجديد
6. مسؤول يحذف السجل
   ✅ الملف يختفي من Drive
   ✅ مجلد السجل يُحذف
```

**السيناريو B — الحدود والأخطاء**
```
1. رفع ملف مخالف للامتداد → رفض (MIME validation fail-closed)
2. رفع ملف أكبر من الحد → رفض client + server
3. إغلاق المتصفح بعد رفع ملف دون إرسال → Cleanup Job يحذفه بعد 48 ساعة
4. Service Account بصلاحيات خاطئة → رسالة خطأ + لا رفع
5. محاولة فتح /uploads بـ token منتهي الصلاحية → 401
6. رفع متزامن من عدة متصفحات بنفس edit token → FIFO، آخر رفع يحتفظ برابطه
```

**السيناريو C — الأداء**
```
1. رفع 10 ملفات لـ 10 سجلات بشكل متزامن
   ✅ لا تعارضات في أسماء الملفات (UUID)
   ✅ جميع الملفات وصلت Drive في المجلدات الصحيحة
   ✅ Google Sheets صحيح لجميع السجلات
2. ملف 10MB → يكمل الرفع خلال ≤ 30 ثانية مع شريط تقدم
```

**السيناريو D — Fallback (بدون Drive)**
```
1. إيقاف Drive لمشروع
2. الرفع يعمل محلياً → URL مطلق في الـ Sheet (APP_BASE_URL + المسار)
3. المستخدم يرى الملف بعد الإرسال (auth token params)
```

#### قائمة التحقق النهائية قبل الإطلاق

```
الأمان:
  ☐ MIME validation fail-closed يعمل
  ☐ edit token auth على /uploads يعمل
  ☐ لا path traversal ممكنة في أسماء الملفات
  ☐ Service Account credentials في Secrets فقط — ليس في الكود
  ☐ Drive files بصلاحية "Anyone with the link can view" — لا "Public on the web"

الوظيفة:
  ☐ رفع من نموذج التسجيل → Drive → Sheet → معاينة
  ☐ رفع من صفحة التعديل الذاتي → Drive → Sheet
  ☐ رفع من لوحة المسؤول → Drive → Sheet
  ☐ حذف سجل → حذف ملف من Drive + مجلد السجل
  ☐ حذف مشروع → تحذير يدوي مع رابط مجلد Drive
  ☐ Fallback محلي يعمل عند إيقاف Drive
  ☐ Cleanup Job يحذف الملفات اليتيمة بعد 48 ساعة

الأداء:
  ☐ ملف 10MB يُرفَع خلال ≤ 30 ثانية
  ☐ شريط تقدم رفع يظهر للمستخدم

التوثيق:
  ☐ replit.md مُحدَّث بـ GOOGLE_DRIVE_ROOT_FOLDER_ID و APP_BASE_URL
  ☐ خطوات إعداد Service Account موثَّقة
  ☐ تقارير اختبار المراحل 1-4 مكتملة في docs/test-reports/
```

---

## 5. ترتيب التنفيذ والجدول الزمني

```
اليوم 1:    المرحلة 1 (إصلاح UX الحرج)
            ↓ اختبار + توثيق
            ⚠️ لا تُنشر في الإنتاج منفردةً

اليوم 2-3:  المرحلة 2 (Google Drive — التخزين الدائم)
            ↓ اختبار + توثيق
            ✅ بعد اكتمالها يمكن النشر

اليوم 4:    المرحلة 3 (Sheets + حذف الملفات + تحذير حذف المشروع)
            ↓ اختبار + توثيق

اليوم 5-6:  المرحلة 4 (إعدادات الحقل + Admin UX)
            ↓ اختبار + توثيق

اليوم 7:    المرحلة 5 (الاختبار الشامل + إطلاق)
```

**إجمالي:** 7 أيام عمل — من الكود الموجود إلى إنتاج مكتمل.

---

## 6. مخاطر وتخفيف

| الخطر | الاحتمال | التأثير | التخفيف |
|---|---|---|---|
| انتهاء Drive API quota | منخفض | عالٍ | Fallback محلي + تنبيه في logs |
| تغيُّر Service Account permissions | منخفض | عالٍ | اختبار دوري في الـ Cleanup Job |
| حذف مجلد Drive يدوياً من المستخدم | متوسط | متوسط | حفظ fileId في DB — الرابط يبقى مُعرَّفاً |
| ملفات كبيرة تُبطئ النموذج | متوسط | متوسط | شريط تقدم + timeout واضح |
| فشل Drive أثناء submission | منخفض | عالٍ | Fallback محلي + إشعار في logs + retry |
| تراكم ملفات يتيمة في Drive | متوسط | منخفض | Cleanup Job كل 6 ساعات يحذف ما عمره > 48 ساعة |
| المستخدم يُغلق المتصفح قبل الإرسال | مرتفع | منخفض | نفس الـ Cleanup Job |
| حذف مشروع دون حذف مجلد Drive | متوسط | متوسط | تحذير صريح في الـ UI + رابط مباشر للمجلد |

---

## 7. ملاحظات الحالة الراهنة

> **هذا الملف وثيقة تخطيط فقط — لم يُنفَّذ أي كود بعد.**  
> كل مرحلة تحتاج موافقة وتنفيذاً منفصلاً قبل الانتقال للتالية.  
> تُضاف نتائج الاختبارات في `docs/test-reports/` عند إتمام كل مرحلة.

| المرحلة | الحالة |
|---|---|
| المرحلة 1 — إصلاح UX | ⏳ لم تبدأ |
| المرحلة 2 — Google Drive Upload | ⏳ لم تبدأ |
| المرحلة 3 — Sheets + حذف + تحذيرات | ⏳ لم تبدأ |
| المرحلة 4 — إعدادات + Admin UX | ⏳ لم تبدأ |
| المرحلة 5 — الاختبار الشامل | ⏳ لم تبدأ |
