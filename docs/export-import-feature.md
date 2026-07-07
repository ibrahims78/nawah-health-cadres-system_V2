# ميزة تصدير/استيراد قالب المشروع
# Project Template Export / Import Feature

> **الحالة:** مُنفَّذة  
> **الإصدار:** 1.0  
> **تاريخ التوثيق:** 2026-07-07

---

## نظرة عامة

تُتيح هذه الميزة تصدير **بنية أي مشروع وإعداداته** (بدون بيانات المستخدمين) إلى ملف `.masarat` قابل للاستيراد لإنشاء مشروع جديد مستقل تماماً.

### نمطان للتصدير

| | قالب قابل للمشاركة | نسخة كاملة للمشروع |
|---|---|---|
| **الهدف** | نشر القالب للآخرين | نسخ احتياطي / نقل بين بيئات |
| **الإعدادات العامة** | ✅ | ✅ |
| **الحقول والخطوات** | ✅ | ✅ |
| **Sheet ID / Folder ID** | ✅ | ✅ |
| **Telegram Chat ID** | ✅ | ✅ |
| **بيانات الاعتماد الحساسة** | ❌ | ✅ (مشفّرة بكلمة مرور) |
| **بيانات المستخدمين** | ❌ | ❌ |
| **الملفات المرفوعة** | ❌ | ❌ |

---

## API Endpoints

### تصدير المشروع
```
POST /api/projects/:id/template-export
Content-Type: application/json
```

**Body (JSON):**
| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | `"template"` \| `"backup"` | No (default: `template`) | نمط التصدير |
| `password` | `string` | Yes (backup only) | كلمة مرور لتشفير الاعتمادات (8+ أحرف) |

> ملاحظة: Endpoint من نوع POST (وليس GET) لضمان عدم ظهور كلمة المرور في URL أو سجلات الخادم.

**Response:** ملف JSON بامتداد `.masarat` مرفق كـ `Content-Disposition: attachment`.

**Permissions:** `requireEditorOrAdmin` + `requireProjectOwnership`

---

### معاينة ملف الاستيراد (Validation بدون إنشاء)
```
POST /api/projects/import/preview
Content-Type: multipart/form-data
```

**Body (form-data):**
| Field | Type | Required |
|---|---|---|
| `file` | `.masarat` file | Yes |
| `password` | string | Yes (for backup files) |

**Response (200):**
```json
{
  "ok": true,
  "preview": {
    "projectName": "نموذج التسجيل",
    "mode": "backup",
    "fieldCount": 12,
    "steps": ["البيانات الشخصية", "المستندات", "المراجعة"],
    "hasCredentials": true,
    "integrations": {
      "googleSheets": true,
      "telegram": false,
      "drive": false
    },
    "warnings": ["Telegram chat ID موجود لكن bot token غير مضمّن"]
  }
}
```

---

### استيراد المشروع (إنشاء فعلي)
```
POST /api/projects/import
Content-Type: multipart/form-data
```

**Body (form-data):**
| Field | Type | Required |
|---|---|---|
| `file` | `.masarat` file | Yes |
| `password` | string | Yes (for backup files) |

**Response (200):**
```json
{
  "ok": true,
  "project": {
    "id": "uuid-new-project",
    "name": "نموذج التسجيل"
  }
}
```

**Permissions:** `requireEditorOrAdmin`

**ملاحظة:** الاستيراد يُنشئ مشروعاً جديداً دائماً بـ UUID جديد — لا يُعدّل أي مشروع موجود.

---

## بنية ملف `.masarat`

```jsonc
{
  "_meta": {
    "version": "1.0",
    "platform": "masarat",
    "exportedAt": "2026-07-07T12:00:00.000Z",
    "mode": "template" | "backup",
    "encryption": null | {
      "kdf": "pbkdf2",
      "digest": "sha256",
      "iterations": 100000,
      "keyLengthBytes": 32,
      "saltHex": "a3f9bc..."   // 16-byte random salt, hex-encoded
    }
  },
  "project": {
    "name": "نموذج تسجيل الموظفين",
    "description": "...",
    "formTitle": "سجّل بياناتك",
    "formSubtitle": "...",
    "invitationCode": "STAFF-ABC123",
    "editTokenHours": 48,
    "formEnabled": true,
    "formDisabledMessage": null,
    "steps": ["البيانات الشخصية", "المستندات", "المراجعة"]
  },
  "fields": [
    {
      "key": "full_name",
      "label": "الاسم الكامل",
      "fieldType": "text",
      "isRequired": true,
      "isVisible": true,
      "options": null,
      "stepNumber": 1,
      "orderIndex": 0,
      "placeholder": "أدخل اسمك الكامل",
      "validationMin": null,
      "validationMax": null,
      "validationRegex": null,
      "validationMessage": null,
      "conditions": null,
      "conditionOperator": "AND",
      "visibleTo": "all",
      "isReadOnly": false,
      "isFullWidth": false,
      "allowedFileTypes": null,
      "maxFileSizeMb": null
    }
    // ... rest of fields
  ],
  "integrations": {
    // Always exported (non-sensitive):
    "googleSheetId": "1BxiMVs0...",
    "importSheetId": null,
    "googleSheetName": "بيانات",
    "googleServiceAccountEmail": "bot@project.iam.gserviceaccount.com",
    "googleDriveFolderId": null,
    "driveRootFolderId": null,
    "driveSyncEnabled": false,
    "telegramChatId": "-1001234567890",
    "driveOAuthClientId": "123456.apps.googleusercontent.com",

    // Sensitive — null in template mode, AES-256-GCM encrypted in backup mode:
    "googleServiceAccountKeyEnc": null | "base64(iv+authTag+encrypted)",
    "telegramBotTokenEnc": null | "base64(iv+authTag+encrypted)",
    "driveOAuthClientSecretEnc": null | "base64(iv+authTag+encrypted)",
    "driveOAuthRefreshTokenEnc": null | "base64(iv+authTag+encrypted)"
  }
}
```

---

## آلية التشفير (نمط Backup)

### التصدير
```
1. جلب الاعتماد المُشفَّر من DB  →  decrypt(encVal)  →  plaintext
2. توليد salt عشوائي (16 bytes)
3. اشتقاق مفتاح: PBKDF2(password, salt, iterations=100000, keyLen=32, digest=sha256)
4. تشفير: AES-256-GCM(plaintext, derivedKey)  →  base64(iv + authTag + ciphertext)
5. تخزين salt في _meta.encryption.saltHex
```

### الاستيراد
```
1. قراءة salt من _meta.encryption.saltHex
2. اشتقاق المفتاح: PBKDF2(password, salt, ...)
3. فك تشفير: AES-256-GCM decrypt(encField, derivedKey)  →  plaintext
4. إعادة تشفير بمفتاح البيئة: encrypt(plaintext)  →  يُحفظ في DB
```

---

## قواعد الاستيراد

1. **مشروع جديد دائماً** — يتم إنشاء UUID جديد بغض النظر عن النمط
2. **لا تعارض** — المشاريع الموجودة لا تُعدَّل أبداً
3. **الإعدادات قابلة للتعديل** — بعد الاستيراد يصبح المشروع مشروعاً عادياً كاملاً
4. **تحقق Zod** — بنية الملف تخضع للتحقق قبل أي إنشاء
5. **حد حجم الملف** — 10 MB (يكفي لآلاف الحقول)
6. **الفشل الجزئي** — إما أن تنجح العملية كاملة أو تفشل كاملة (لا إنشاء جزئي)

---

## ما لا يُصدَّر أبداً

| البيانات | السبب |
|---|---|
| سجلات المستخدمين (الردود) | بيانات وليست إعدادات |
| الملفات المرفوعة في `uploads/` | بيانات مستخدمين |
| سجل النشاط (audit log) | تاريخي لا قيمة له كقالب |
| معرّف المشروع (id) | يتولّد جديداً عند الاستيراد |
| `createdBy` | المشروع المُستورَد ينتسب للمستخدم الحالي |

---

## الفرق بين التصدير/الاستيراد وNسخ الاحتياطي الكامل

| | تصدير/استيراد قالب | نسخ احتياطي كامل (مستقبلاً) |
|---|---|---|
| وحدة العملية | مشروع واحد | كامل المنصة |
| النتيجة | مشروع جديد دائماً | استعادة كل شيء كما كان |
| يشمل بيانات المستخدمين | ❌ | ✅ |
| يشمل الملفات المرفوعة | ❌ | ✅ |
| يُلغي ما هو موجود | ❌ أبداً | ✅ إذا اختار المدير |

---

## الملفات المُنفَّذة

| الملف | التغيير |
|---|---|
| `server/routes/projects.ts` | endpoints: `GET /:id/template-export`, `POST /import/preview`, `POST /import` |
| `client/src/pages/admin/ProjectImport.tsx` | صفحة الاستيراد |
| `client/src/pages/admin/ProjectExport.tsx` | قسم تصدير القالب |
| `client/src/App.tsx` | مسار `/admin/projects/import` |
| `client/src/pages/admin/Projects.tsx` | زر "استيراد مشروع" |
