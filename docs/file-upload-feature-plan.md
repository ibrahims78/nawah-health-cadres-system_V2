# خطة تطوير ميزة رفع الملفات مع التكامل الكامل مع Google Drive
## منصة مسارات — Healthcare Staff Management System

**تاريخ الإعداد:** 2026-07-04  
**الحالة:** مسودة خطة عمل — لم يُنفَّذ بعد  
**المعِدّ:** تقرير تقني — Replit Agent  
**الهدف:** تحويل ميزة رفع الملفات من حالتها الهيكلية الحالية إلى ميزة إنتاجية موثوقة مع تخزين دائم على Google Drive وتنظيم آلي بمجلد مخصَّص لكل مشروع.

---

## 1. التشخيص الحالي

### ما يعمل حالياً
- النوع `file` مُعرَّف في `shared/schema.ts` ضمن enum الأنواع المتاحة للمسؤول
- مكوّن `FileField.tsx` يرفع الملف فور اختياره عبر `POST /api/pform/:id/upload`
- الـ endpoint يحفظ الملف على قرص الخادم في `/uploads/`
- الـ URL يُخزَّن في `project_records.data` (JSONB) ويُصدَّر إلى Google Sheets

### المشاكل المُكتشَفة (6 ثغرات وظيفية)

| الكود | المشكلة | الخطورة |
|---|---|---|
| P1 | المستخدم العام لا يستطيع فتح ملفه بعد الإرسال (`/uploads` محمي بجلسة) | 🔴 حرج |
| P2 | صفحة التعديل الذاتي (`ProjectEditForm.tsx`) لا تعرض حقل الملف نهائياً | 🔴 حرج |
| P3 | رابط الملف في Google Sheet نسبي (`/uploads/uuid.pdf`) وغير قابل للفتح | 🟠 عالٍ |
| P4 | الملفات لا تُحذف عند حذف السجل — تراكم يتيم على القرص | 🟠 عالٍ |
| P5 | التخزين على قرص الخادم مؤقت — يُفقَد عند إعادة التشغيل أو النشر | 🔴 حرج في الإنتاج |
| P6 | لا قيود على نوع الملف أو حجمه على مستوى كل حقل | 🟡 متوسط |

---

## 2. بنية Google Drive المقترحة

### هيكل المجلدات

```
📁 مسارات (Root — يُحدَّد بـ google_drive_root_folder_id في إعدادات النظام)
├── 📁 مشروع: إدارة كوادر المختبرات [project-uuid-1]
│   ├── 📁 سجل: أحمد محمد سالم [record-uuid-a]
│   │   ├── 📄 الشهادة_الجامعية.pdf
│   │   └── 🖼 الصورة_الشخصية.jpg
│   ├── 📁 سجل: فاطمة علي حسن [record-uuid-b]
│   │   └── 📄 السيرة_الذاتية.pdf
│   └── 📁 uploads_temp (ملفات انتظار الربط بسجل)
├── 📁 مشروع: تسجيل الممرضين [project-uuid-2]
│   └── ...
└── 📁 _system_logs (سجلات الرفع والأخطاء — اختياري)
```

### مبدأ التنظيم
- **مجلد واحد لكل مشروع** — يُنشأ تلقائياً عند أول رفع ملف في المشروع (أو عند تفعيل الميزة يدوياً من إعدادات المشروع)
- **مجلد فرعي لكل سجل** — يُنشأ تلقائياً عند إرسال النموذج باسم المسجَّل أو بـ UUID السجل
- **تسمية الملفات:** `{اسم_الحقل}_{الاسم_الأصلي}.{امتداد}` مع الحفاظ على الاسم الأصلي للقراءة البشرية
- **الرابط المُخزَّن في DB:** رابط Drive المباشر (`https://drive.google.com/file/d/{fileId}/view`) بدلاً من مسار `/uploads/`

---

## 3. المتطلبات التقنية

### إعداد Google Service Account (مرة واحدة)
```
Google Cloud Console:
  ✅ تفعيل Google Drive API
  ✅ إنشاء Service Account
  ✅ تحميل مفتاح JSON
  ✅ منح Service Account صلاحية Editor على المجلد الجذر
```

### Replit Secrets المطلوبة
```
GOOGLE_SERVICE_ACCOUNT_KEY   — محتوى ملف JSON للـ service account (كاملاً)
APP_BASE_URL                 — الـ URL الإنتاجي للمنصة (للروابط المطلقة في Sheets)
```

### تعديلات Schema (قاعدة البيانات)
```sql
-- إضافة لجدول projects (موجود جزئياً)
google_drive_folder_id   TEXT  -- مجلد الـ Drive الخاص بهذا المشروع (يُملأ عند أول تفعيل)
drive_upload_enabled     BOOLEAN DEFAULT false  -- تبديل تشغيل/إيقاف الميزة لكل مشروع

-- إضافة لجدول project_fields (لقيود الحقل)
allowed_file_types       TEXT[]  -- ["image/*", "application/pdf"] — null = كل الأنواع
max_file_size_mb         INTEGER -- 1..10 — null = الحد العام (10MB)

-- إضافة لجدول project_records
drive_files              JSONB   -- { fieldKey: { fileId, driveUrl, originalName, mimeType, uploadedAt } }
```

---

## 4. خطة التنفيذ — 5 مراحل

---

### المرحلة الأولى — إصلاح UX الحرج (لا Google Drive بعد)
**الهدف:** جعل الميزة الحالية تعمل بشكل صحيح قبل إضافة Drive  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** لا يوجد

#### المهام

**1.1 — إصلاح رؤية الملفات للمستخدم العام**

- **الملف:** `client/src/components/FileField.tsx`
- **التعديل:** إضافة prop اختيارية `authSuffix?: string` تُلحَق بالـ URL:
  ```
  href={value + (authSuffix ? authSuffix : "")}
  ```
- **الملف:** `client/src/pages/ProjectRegister.tsx`
- **التعديل:** بعد الحصول على `editToken`، تمرير:
  ```
  authSuffix={`?token=${editToken}&project=${projectId}`}
  ```
- **الملف:** `server/index.ts`
- **التحقق:** route `/uploads/:filename` يدعم أصلاً `?token=&project=` — لا تعديل مطلوب

**1.2 — إضافة file field في صفحة التعديل الذاتي**

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

#### اختبار المرحلة الأولى ✅

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T1.1 | إرسال نموذج برفع ملف → فتح رابط المراجعة | الملف يُفتح بدون طلب تسجيل دخول |
| T1.2 | فتح رابط التعديل الذاتي لسجل فيه حقل file | حقل الملف يظهر مع الملف المرفوع سابقاً |
| T1.3 | تعديل الملف من صفحة التعديل وإرسال | الملف الجديد يُحفظ ويظهر في قاعدة البيانات |
| T1.4 | فتح الرابط بدون token | يُعاد توجيه إلى 401 |

**توثيق المرحلة:** تُكتب نتائج الاختبارات في `docs/test-reports/phase-1-results.md`  
**شرط الانتقال:** اجتياز T1.1 و T1.2 و T1.3 بنجاح 100%

---

### المرحلة الثانية — تكامل Google Drive (الرفع)
**الهدف:** رفع الملفات مباشرةً إلى Drive بدلاً من قرص الخادم  
**المدة المقدَّرة:** يومان  
**التبعيات:** إتمام إعداد Service Account + Secrets

#### المهام

**2.1 — Drive Upload Service**

- **الملف الجديد:** `server/services/driveStorage.ts`
- **الوظائف:**

```typescript
// إنشاء مجلد للمشروع إذا لم يكن موجوداً
ensureProjectFolder(projectId: string, projectName: string): Promise<string>
// فولدر ID يُخزَّن في projects.google_drive_folder_id

// إنشاء مجلد فرعي للسجل
ensureRecordFolder(projectFolderId: string, recordLabel: string, recordId: string): Promise<string>
// الاسم: "{recordLabel} [{recordId.slice(0,8)}]"

// رفع ملف إلى Drive
uploadFileToDrive(params: {
  localFilePath: string;   // المسار المؤقت من multer
  fileName: string;        // الاسم المُعرَض
  mimeType: string;        // MIME من file-type
  folderId: string;        // مجلد السجل أو المشروع
}): Promise<{ fileId: string; driveUrl: string; webContentLink: string }>

// حذف ملف من Drive
deleteFileFromDrive(fileId: string): Promise<void>
```

**2.2 — تعديل upload endpoints**

- **الملف:** `server/routes/pform.ts` (رفع المستخدم العام)
- **المنطق الجديد:**
  ```
  multer يحفظ مؤقتاً على القرص
      ↓
  validateMimeType (موجود)
      ↓
  if (project.driveUploadEnabled && project.googleDriveRootFolderId):
      driveStorage.ensureProjectFolder()
      driveStorage.uploadFileToDrive()
      fs.unlink(tempFile)  ← حذف المؤقت
      return { url: driveUrl, driveFileId }
  else:
      return { url: "/uploads/filename" }  ← السلوك الحالي
  ```

- **الملف:** `server/routes/projects.ts` (رفع المسؤول)
- **نفس المنطق** مع إضافة مجلد السجل إذا كان السياق متاحاً

**2.3 — ربط الملف بالسجل بعد الإرسال**

- **الملف:** `server/routes/pform.ts` — route إرسال النموذج النهائي
- **بعد حفظ السجل:** تحريك الملفات من `uploads_temp` إلى مجلد السجل في Drive:
  ```
  driveStorage.ensureRecordFolder(projectFolderId, applicantName, recordId)
  driveStorage.moveFilesToRecordFolder(fileIds, recordFolderId)
  // تحديث drive_files في project_records
  ```

**2.4 — تعديل قاعدة البيانات**

Migration جديد:
```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS drive_upload_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE project_records
  ADD COLUMN IF NOT EXISTS drive_files JSONB DEFAULT '{}';
```

#### اختبار المرحلة الثانية ✅

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T2.1 | تفعيل `driveUploadEnabled` لمشروع + رفع ملف | مجلد المشروع يُنشأ في Drive تلقائياً |
| T2.2 | إرسال نموذج مكتمل | مجلد السجل يُنشأ + الملف ينتقل إليه |
| T2.3 | فتح رابط Drive المُعاد | الملف يُفتح مباشرةً من Drive |
| T2.4 | رفع ملف بدون تفعيل Drive | السلوك الحالي (قرص الخادم) يعمل كالمعتاد |
| T2.5 | Drive غير متاح (Service Account خاطئ) | رسالة خطأ واضحة + fallback محلي |
| T2.6 | فحص Drive مباشرة | الملف موجود في المجلد الصحيح بالاسم الصحيح |

**توثيق المرحلة:** `docs/test-reports/phase-2-results.md`  
**شرط الانتقال:** اجتياز T2.1 → T2.6 + التحقق اليدوي من Drive

---

### المرحلة الثالثة — إصلاح Google Sheets وحذف الملفات
**الهدف:** إصلاح P3 (روابط الـ Sheet) و P4 (تنظيف الحذف)  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** المرحلتان 1 و2

#### المهام

**3.1 — روابط مطلقة في Google Sheets**

- **الملف:** `server/services/projectSheets.ts`
- **دالة مساعدة جديدة:**
  ```typescript
  function resolveFieldValue(field: ProjectField, value: any, driveFiles: Record<string, any>): string {
    if (field.fieldType !== "file" || !value) return String(value ?? "");

    // إذا كان Drive مُفعَّلاً: استخدم رابط Drive
    const driveFile = driveFiles?.[field.key];
    if (driveFile?.driveUrl) return driveFile.driveUrl;

    // Fallback: رابط مطلق للتخزين المحلي
    const baseUrl = process.env.APP_BASE_URL || "";
    return baseUrl + String(value);
  }
  ```
- **التطبيق:** في `appendRecordToSheet` و `updateRecordRow`:
  ```typescript
  const row = [String(seqNum), ...fields.map(f =>
    resolveFieldValue(f, recordData[f.key], record.driveFiles)
  )];
  ```

**3.2 — حذف الملفات عند حذف السجل**

- **الملف:** `server/routes/projects.ts`
- **في route حذف السجل الفردي:**
  ```typescript
  // استخراج fileIds من drive_files قبل الحذف
  const driveFiles = record.driveFiles || {};
  const fileIds = Object.values(driveFiles)
    .filter(f => f?.fileId)
    .map(f => f.fileId);

  // حذف من Drive
  await Promise.allSettled(fileIds.map(id => driveStorage.deleteFileFromDrive(id)));

  // حذف مجلد السجل إذا أصبح فارغاً
  if (record.driveFolderId) {
    await driveStorage.deleteEmptyFolder(record.driveFolderId);
  }

  // حذف الملفات المحلية (التخزين غير Drive)
  const localUrls = Object.values(recordData)
    .filter(v => String(v).startsWith("/uploads/"));
  localUrls.forEach(url => fs.unlink(path.join(uploadsDir, path.basename(String(url))), () => {}));
  ```
- **في route الحذف الجماعي (`bulkDelete`):** نفس المنطق مُطبَّق على كل سجل

**3.3 — إضافة `APP_BASE_URL` إلى Replit Secrets**

- الاسم: `APP_BASE_URL`
- القيمة في التطوير: `https://{REPLIT_DEV_DOMAIN}`
- القيمة في الإنتاج: النطاق الإنتاجي الثابت

#### اختبار المرحلة الثالثة ✅

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T3.1 | إرسال نموذج + فتح Google Sheet | خلية الملف تحتوي على رابط Drive قابل للنقر |
| T3.2 | نفس الاختبار بدون Drive (تخزين محلي) | خلية تحتوي على URL مطلق كامل |
| T3.3 | حذف سجل فيه ملف Drive | الملف يختفي من Drive (التحقق يدوياً) |
| T3.4 | حذف سجل فيه ملف محلي | الملف يُحذف من `/uploads/` |
| T3.5 | حذف جماعي لسجلات متعددة | جميع ملفات المجموعة تُحذف |

**توثيق المرحلة:** `docs/test-reports/phase-3-results.md`  
**شرط الانتقال:** اجتياز T3.1 و T3.3 + فحص يدوي للـ Sheet والـ Drive

---

### المرحلة الرابعة — إعدادات الحقل وتجربة المسؤول
**الهدف:** التحكم الدقيق لكل حقل + تحسين لوحة الإدارة  
**المدة المقدَّرة:** يومان  
**التبعيات:** المراحل 1 و2 و3

#### المهام

**4.1 — قيود مخصَّصة لكل حقل file**

Migration إضافي:
```sql
ALTER TABLE project_fields
  ADD COLUMN IF NOT EXISTS allowed_file_types TEXT[],
  ADD COLUMN IF NOT EXISTS max_file_size_mb   INTEGER;
```

- **في إعدادات المشروع (ProjectSettings.tsx):** عند اختيار نوع `file`، تظهر خيارات إضافية:
  - ✅ صور (jpg, png, webp, gif)
  - ✅ ملفات PDF
  - ✅ ملفات Office (doc, docx, xls, xlsx)
  - ✅ ملفات نصية (txt)
  - حجم أقصى: [slider 1-10 MB]

- **في FileField.tsx:** تطبيق القيود في `accept` attribute وفحص `file.size` قبل الرفع

- **في server/routes/pform.ts:** إعادة استخدام إعدادات الحقل لتخصيص multer fileFilter ديناميكياً

**4.2 — معاينة الملفات في لوحة الإدارة**

- **في جدول السجلات (ProjectRecords.tsx):**
  - خلايا حقل `file`: صورة مصغرة للصور، أيقونة PDF للملفات، زر "فتح في Drive"
  - عمود إحصائي: عدد الملفات لكل سجل

- **في صفحة تفاصيل السجل:**
  - شريط ملفات مرفقة بكل الملفات المرفوعة مع اسمها ونوعها وحجمها وتاريخ الرفع
  - زر "فتح في Drive" يفتح المجلد المباشر للسجل

**4.3 — تبديل تفعيل Drive لكل مشروع من إعدادات المشروع**

- مفتاح تشغيل/إيقاف في إعدادات المشروع:
  ```
  [ ] تفعيل التخزين على Google Drive لملفات هذا المشروع
      🔗 مجلد Drive: [رابط المجلد] (يظهر بعد أول رفع)
  ```

#### اختبار المرحلة الرابعة ✅

| الاختبار | الخطوات | النتيجة المتوقعة |
|---|---|---|
| T4.1 | تحديد "صور فقط" لحقل + رفع PDF | رسالة رفض واضحة |
| T4.2 | ضبط حجم أقصى 2MB + رفع ملف 5MB | رفع مرفوض قبل الإرسال |
| T4.3 | فتح جدول السجلات الإدارة | الصور تظهر كـ thumbnail، بقية الملفات كأيقونات |
| T4.4 | النقر على أيقونة "Drive" لسجل | المجلد يُفتح مباشرةً في Drive |

**توثيق المرحلة:** `docs/test-reports/phase-4-results.md`  
**شرط الانتقال:** اجتياز جميع الاختبارات

---

### المرحلة الخامسة — الاختبار الشامل والتوثيق النهائي
**الهدف:** اختبار كامل للنظام كوحدة متكاملة قبل الإطلاق الإنتاجي  
**المدة المقدَّرة:** يوم واحد  
**التبعيات:** اجتياز المراحل 1-4 كاملةً

#### سيناريوهات الاختبار الشامل

**السيناريو A — دورة حياة كاملة لسجل واحد**
```
1. مسؤول يُنشئ مشروعاً جديداً مع تفعيل Drive
2. مسؤول يُضيف حقل file (صور فقط، حجم أقصى 3MB)
3. مستخدم يفتح النموذج ويرفع صورة شخصية
4. مستخدم يُرسِل النموذج
   ✅ الصورة في Drive ضمن مجلد المشروع/مجلد السجل
   ✅ Google Sheet يحتوي رابط Drive في الخلية المقابلة
   ✅ صفحة النجاح تُظهر رابطاً قابلاً للنقر
5. مستخدم يفتح رابط التعديل ويُغيِّر الصورة
   ✅ الصورة القديمة تُحذف من Drive
   ✅ الصورة الجديدة تُرفَع بنفس المجلد
   ✅ الـ Sheet يُحدَّث
6. مسؤول يحذف السجل
   ✅ الملف يختفي من Drive
   ✅ مجلد السجل يُحذف إذا فرغ
```

**السيناريو B — اختبار الحدود والأخطاء**
```
1. رفع ملف مخالف للامتداد (رفض — M-04 MIME validation)
2. رفع ملف أكبر من الحد المسموح (رفض — في الـ client والـ server)
3. انتهاء صلاحية Drive token أثناء الرفع (fallback محلي + إشعار في logs)
4. رفع من عدة متصفحات بنفس edit token (FIFO — آخر رفع يربح)
5. محاولة وصول /uploads بـ token منتهي الصلاحية (401)
```

**السيناريو C — اختبار الأداء**
```
1. رفع 10 ملفات لـ 10 سجلات بشكل متزامن
   ✅ لا تعارضات في أسماء الملفات (UUID)
   ✅ جميع الملفات وصلت Drive
   ✅ Google Sheets صحيح لجميع السجلات
2. قياس وقت الاستجابة: رفع ملف 10MB → يجب أن يكمل خلال 30 ثانية
```

**السيناريو D — Fallback (بدون Drive)**
```
1. إلغاء تفعيل Drive لمشروع
2. تأكيد أن الرفع يعمل محلياً
3. تأكيد أن الـ Sheet يحتوي URL مطلق وليس نسبياً
4. تأكيد أن المستخدم يرى الملف بعد الإرسال (auth params)
```

#### قائمة التحقق النهائية قبل الإطلاق

```
الأمان:
  ☐ MIME validation fail-closed يعمل (M-04)
  ☐ edit token auth على /uploads يعمل
  ☐ لا file paths traversal ممكنة
  ☐ Service Account credentials في Secrets (ليس في الكود)
  ☐ Drive files لا تُشارَك علناً (إعداد permissions صحيح)

الوظيفة:
  ☐ رفع من نموذج التسجيل → Drive → Sheet → معاينة
  ☐ رفع من صفحة التعديل الذاتي → Drive → Sheet
  ☐ رفع من لوحة المسؤول → Drive → Sheet
  ☐ حذف سجل → حذف ملف من Drive
  ☐ حذف مشروع → (تحذير) ملفات Drive لا تُحذف تلقائياً
  ☐ Fallback محلي يعمل عند إيقاف Drive

الأداء:
  ☐ ملف 10MB يُرفع خلال ≤ 30 ثانية
  ☐ رسائل تقدم الرفع تظهر للمستخدم

التوثيق:
  ☐ replit.md مُحدَّث
  ☐ README يوثِّق إعداد Service Account
  ☐ تقارير اختبار المراحل 1-4 مكتملة
  ☐ هذا الملف مُحدَّث بالنتائج الفعلية
```

**توثيق المرحلة الخامسة:** `docs/test-reports/phase-5-final-report.md`

---

## 5. ترتيب التنفيذ والجدول الزمني

```
اليوم 1:    المرحلة 1 (إصلاح UX الحرج)
            ↓ اختبار + توثيق ✅

اليوم 2-3:  المرحلة 2 (Google Drive - الرفع)
            ↓ اختبار + توثيق ✅

اليوم 4:    المرحلة 3 (Sheets + حذف الملفات)
            ↓ اختبار + توثيق ✅

اليوم 5-6:  المرحلة 4 (إعدادات الحقل + Admin UX)
            ↓ اختبار + توثيق ✅

اليوم 7:    المرحلة 5 (الاختبار الشامل + إطلاق)
```

**إجمالي:** 7 أيام عمل من الكود الموجود إلى إنتاج مكتمل.

---

## 6. مخاطر وتخفيف

| الخطر | الاحتمال | التأثير | التخفيف |
|---|---|---|---|
| انتهاء Drive API quota | منخفض | عالٍ | Fallback محلي + تنبيه بالبريد |
| تغيُّر Service Account permissions | منخفض | عالٍ | اختبار دوري + monitoring |
| حذف مجلد Drive من الـ UI يدوياً | متوسط | متوسط | حفظ fileId في DB لاستعادة الملف |
| ملفات كبيرة تُبطئ النموذج | متوسط | متوسط | رفع تدريجي مع progress bar |
| فشل Drive أثناء submission | منخفض | عالٍ | Fallback + إعادة محاولة async |

---

## 7. ملاحظات الحالة الراهنة

> **هذا الملف وثيقة تخطيط فقط — لم يُنفَّذ أي كود بعد.**  
> كل مرحلة تحتاج موافقة وتنفيذاً منفصلاً قبل الانتقال للتالية.  
> تُضاف نتائج الاختبارات في `docs/test-reports/` عند إتمام كل مرحلة.

| المرحلة | الحالة |
|---|---|
| المرحلة 1 — إصلاح UX | ⏳ لم تبدأ |
| المرحلة 2 — Google Drive Upload | ⏳ لم تبدأ |
| المرحلة 3 — Sheets + حذف | ⏳ لم تبدأ |
| المرحلة 4 — إعدادات + Admin UX | ⏳ لم تبدأ |
| المرحلة 5 — الاختبار الشامل | ⏳ لم تبدأ |
