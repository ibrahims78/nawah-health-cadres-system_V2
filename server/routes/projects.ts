import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { projects, projectFields, projectRecords, projectAuditLog, users, userInvitations, systemSettings, projectCollaborators, projectFieldSchema, createProjectSchema, updateProjectSchema, updateUserRoleSchema, globalSettingsSchema, createUserSchema, bulkDeleteSchema } from "../../shared/schema.js";
import { eq, desc, count, gte, and, ilike, or, gt, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEditorOrAdmin } from "../middleware/auth.js";
import { encrypt, decrypt } from "../services/crypto.js";
import { insertRecordAtomic } from "../services/recordInsert.js";
import { appendRecordToSheet, updateRecordRow, deleteRecordRow, testProjectSheetsConnection, fixProjectSheetHeaders, checkProjectSheetColumns, importFromProjectSheet, exportToProjectSheet, extractSpreadsheetId } from "../services/projectSheets.js";
import { testTelegramBot, getTelegramUpdates, setWebhook } from "../services/telegram.js";
import { getProjectChats, hasProjectChats } from "../services/telegramChatCache.js";
import { getTelegramWebhookSecret } from "../routes/pform.js";

/** استخراج عنوان التطبيق الأساسي للـ Webhook */
function getAppBaseUrl(req: Request): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",");
  if (domains?.length) return `https://${domains[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `${req.protocol}://${req.get("host")}`;
}
import { sendInvitationEmail, testEmailConnection } from "../services/email.js";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { fileUpload, publicFileUrl, validateMimeType, validateFieldRestrictions, uploadsDir, organizeUploadedFile } from "../middleware/upload.js";
import { handleError } from "../utils/errorHandler.js";
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "crypto";
import { z } from "zod";
import fs from "fs";
import path from "path";
import * as driveStorage from "../services/driveStorage.js";
import rateLimit from "express-rate-limit";

const router = Router();
const parseExcelLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: "محاولات كثيرة — حاول لاحقاً" } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── PROJECT ACCESS GUARDS ────────────────────────────────────

/** STRICT — admin, project owner, or collaborator with permission="full".
 *  Used for irreversible/sensitive operations (delete project, update settings & credentials). */
async function requireProjectOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role = (req.session as any)?.role;
  if (role === "admin") { next(); return; }
  const userId = (req.session as any)?.userId;
  const pid = String(req.params.id);
  try {
    const [proj] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, pid));
    if (!proj) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
    if (proj.createdBy === userId) { next(); return; }
    // Collaborator with full permission is treated as an owner
    const [collab] = await db
      .select({ permission: projectCollaborators.permission })
      .from(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, pid), eq(projectCollaborators.userId, userId)));
    if (collab?.permission === "full") { next(); return; }
    res.status(403).json({ error: "لا تملك صلاحية تعديل هذا المشروع" });
  } catch (err: any) {
    handleError(res, err);
  }
}

/** BROAD — admin, project owner, or granted collaborator.
 *  Used for content operations: records, fields, uploads, exports, integration usage. */
async function requireProjectEditAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role = (req.session as any)?.role;
  if (role === "admin") { next(); return; }
  const userId = (req.session as any)?.userId;
  const pid = String(req.params.id);
  try {
    const [proj] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, pid));
    if (!proj) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
    if (proj.createdBy === userId) { next(); return; }
    const [collab] = await db.select({ id: projectCollaborators.id })
      .from(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, pid), eq(projectCollaborators.userId, userId)));
    if (collab) { next(); return; }
    res.status(403).json({ error: "لا تملك صلاحية تعديل هذا المشروع" });
  } catch (err: any) {
    handleError(res, err);
  }
}

/** READ-ONLY — admin, viewer, project owner, or granted collaborator. */
async function requireProjectReadAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role = (req.session as any)?.role;
  if (role === "admin" || role === "viewer") { next(); return; }
  const userId = (req.session as any)?.userId;
  const pid = String(req.params.id);
  try {
    const [proj] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, pid));
    if (!proj) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
    if (proj.createdBy === userId) { next(); return; }
    const [collab] = await db.select({ id: projectCollaborators.id })
      .from(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, pid), eq(projectCollaborators.userId, userId)));
    if (collab) { next(); return; }
    res.status(403).json({ error: "لا تملك صلاحية عرض هذا المشروع" });
  } catch (err: any) {
    handleError(res, err);
  }
}

// ─── PROJECTS CRUD ───────────────────────────────────────────

const PROJECT_LIST_COLUMNS = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  createdBy: projects.createdBy,
  createdAt: projects.createdAt,
  formEnabled: projects.formEnabled,
  formTitle: projects.formTitle,
  steps: projects.steps,
  updatedAt: projects.updatedAt,
  driveSyncEnabled: projects.driveSyncEnabled,
  driveRootFolderId: projects.driveRootFolderId,
  googleDriveFolderId: projects.googleDriveFolderId,
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const role = (req.session as any).role;
    const userId = (req.session as any).userId;
    let list;
    if (role === "editor") {
      // Own projects + projects where this editor was granted collaborator access
      list = await db
        .select(PROJECT_LIST_COLUMNS)
        .from(projects)
        .leftJoin(
          projectCollaborators,
          and(eq(projectCollaborators.projectId, projects.id), eq(projectCollaborators.userId, userId))
        )
        .where(or(eq(projects.createdBy, userId), sql`${projectCollaborators.id} IS NOT NULL`))
        .orderBy(desc(projects.createdAt));
    } else {
      list = await db.select(PROJECT_LIST_COLUMNS).from(projects).orderBy(desc(projects.createdAt));
    }
    res.json(list);
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── STATIC ROUTES (must come before /:id to avoid shadowing) ───

// Public branding endpoint — no auth required (returns only safe display fields)
router.get("/app-info", async (_req, res) => {
  try {
    const [s] = await db.select({
      appName: systemSettings.appName,
      appLogoUrl: systemSettings.appLogoUrl,
      defaultLanguage: systemSettings.defaultLanguage,
    }).from(systemSettings).where(eq(systemSettings.id, "singleton"));
    res.json(s ?? { appName: "مسارات" });
  } catch {
    res.json({ appName: "مسارات" });
  }
});

router.get("/global-settings", requireAdmin, async (_req, res) => {
  try {
    const [s] = await db.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
    if (!s) return res.json({});
    const { smtpPassEnc, ...safe } = s;
    res.json({ ...safe, hasSmtpPass: !!smtpPassEnc });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.get("/users-list", requireAdmin, async (_req, res) => {
  const list = await db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users);
  res.json(list);
});

// ─── DYNAMIC ROUTES ───────────────────────────────────────────

const PROJECT_SAFE_COLUMNS = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  createdBy: projects.createdBy,
  createdAt: projects.createdAt,
  invitationCode: projects.invitationCode,
  editTokenHours: projects.editTokenHours,
  formEnabled: projects.formEnabled,
  formDisabledMessage: projects.formDisabledMessage,
  formTitle: projects.formTitle,
  formSubtitle: projects.formSubtitle,
  steps: projects.steps,
  googleSheetId: projects.googleSheetId,
  importSheetId: projects.importSheetId,
  googleSheetName: projects.googleSheetName,
  googleServiceAccountEmail: projects.googleServiceAccountEmail,
  googleDriveFolderId: projects.googleDriveFolderId,
  telegramChatId: projects.telegramChatId,
  updatedAt: projects.updatedAt,
  hasGoogleKey: sql<boolean>`(${projects.googleServiceAccountKeyEnc} is not null)`,
  hasTelegramToken: sql<boolean>`(${projects.telegramBotTokenEnc} is not null)`,
  driveOAuthClientId: projects.driveOAuthClientId,
  driveOAuthConnected: sql<boolean>`(${projects.driveOAuthRefreshTokenEnc} is not null)`,
  // Participant tracking
  participantsEnabled: projects.participantsEnabled,
  participantNameField: projects.participantNameField,
  participantEditHours: projects.participantEditHours,
  participantAllowOpen: projects.participantAllowOpen,
  // Automated reminders
  reminderEnabled: projects.reminderEnabled,
  reminderIntervalDays: projects.reminderIntervalDays,
  reminderMaxCount: projects.reminderMaxCount,
  confirmationEmailEnabled: projects.confirmationEmailEnabled,
};

router.get("/:id", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const [proj] = await db.select(PROJECT_SAFE_COLUMNS).from(projects).where(eq(projects.id, String(req.params.id)));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    res.json(proj);
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { name, description, formTitle, formSubtitle, invitationCode, steps } = parsed.data;
    const { fields } = req.body;

    const [proj] = await db.insert(projects).values({
      name,
      description,
      formTitle: formTitle || name,
      formSubtitle,
      // L-02: Use a cryptographically random suffix instead of a predictable year-based code
      invitationCode: invitationCode || (() => {
        const prefix = name.replace(/\s+/g, "-").toUpperCase().slice(0, 8);
        const suffix = randomBytes(3).toString("hex").toUpperCase();
        return `${prefix}-${suffix}`;
      })(),
      steps: steps || ["البيانات الأساسية", "البيانات التفصيلية", "المراجعة"],
      createdBy: (req.session as any).userId,
    }).returning();

    if (fields && fields.length > 0) {
      const fieldRows = fields.map((f: any, idx: number) => ({
        projectId: proj.id,
        key: f.key,
        label: f.label,
        fieldType: f.fieldType || "text",
        isRequired: f.isRequired || false,
        isVisible: f.isVisible !== false,
        options: f.options || null,
        stepNumber: f.stepNumber || 1,
        orderIndex: f.orderIndex ?? idx,
        placeholder: f.placeholder || null,
        allowedFileTypes: Array.isArray(f.allowedFileTypes) && f.allowedFileTypes.length > 0 ? f.allowedFileTypes : null,
        maxFileSizeMb: f.maxFileSizeMb ? Number(f.maxFileSizeMb) : null,
        // Advanced field options — configured via FieldEditor in CreateProject wizard (Phase 2)
        validationMin: f.validationMin ?? null,
        validationMax: f.validationMax ?? null,
        validationRegex: f.validationRegex || null,
        validationMessage: f.validationMessage || null,
        conditions: Array.isArray(f.conditions) && f.conditions.length > 0 ? f.conditions : null,
        conditionOperator: (f.conditionOperator === "OR" || f.conditionOperator === "AND") ? f.conditionOperator : null,
        visibleTo: (["admin", "editor"].includes(f.visibleTo)) ? f.visibleTo : "all",
        isReadOnly: !!f.isReadOnly,
        isFullWidth: !!f.isFullWidth,
      }));
      await db.insert(projectFields).values(fieldRows);
    }

    res.json({ ok: true, project: proj });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.patch("/global-settings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = globalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const body = parsed.data;
    const update: any = { updatedAt: new Date() };
    const plain = ["appName", "appLogoUrl", "defaultLanguage", "timezone", "invitationExpiryHours",
      "smtpHost", "smtpPort", "smtpUser", "smtpFromName"] as const;
    for (const f of plain) { if (f in body) update[f] = (body as any)[f]; }
    if (body.smtpPass) update.smtpPassEnc = encrypt(body.smtpPass);
    await db.update(systemSettings).set(update).where(eq(systemSettings.id, "singleton"));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.patch("/:id", requireEditorOrAdmin, requireProjectOwnership, async (req: Request, res: Response) => {
  try {
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const body = parsed.data as any;
    const update: any = { updatedAt: new Date() };

    const plainFields = ["name", "description", "formTitle", "formSubtitle", "invitationCode",
      "editTokenHours", "formEnabled", "formDisabledMessage", "steps",
      "googleSheetId", "importSheetId", "googleSheetName", "googleServiceAccountEmail",
      "googleDriveFolderId", "driveRootFolderId", "telegramChatId",
      "driveOAuthClientId",
      "participantsEnabled", "participantNameField", "participantEditHours", "participantAllowOpen",
      "reminderEnabled", "reminderIntervalDays", "reminderMaxCount", "confirmationEmailEnabled"];

    for (const field of plainFields) {
      if (field in body) update[field] = body[field];
    }

    if ("googleSheetId" in update && update.googleSheetId) {
      update.googleSheetId = extractSpreadsheetId(update.googleSheetId);
    }
    if ("importSheetId" in update && update.importSheetId) {
      update.importSheetId = extractSpreadsheetId(update.importSheetId);
    }
    if ("driveRootFolderId" in update && update.driveRootFolderId) {
      // Extract folder ID from full Drive URL e.g. https://drive.google.com/drive/folders/FOLDER_ID
      const folderMatch = String(update.driveRootFolderId).match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (folderMatch) update.driveRootFolderId = folderMatch[1];
    }

    if (body.googleServiceAccountKey) update.googleServiceAccountKeyEnc = encrypt(body.googleServiceAccountKey);
    if (body.telegramBotToken) update.telegramBotTokenEnc = encrypt(body.telegramBotToken);
    if (body.driveOAuthClientSecret) update.driveOAuthClientSecretEnc = encrypt(body.driveOAuthClientSecret);

    // If Client ID changed, invalidate any stored refresh token (it belongs to old credentials)
    if ("driveOAuthClientId" in update) {
      const [cur] = await db.select({ driveOAuthClientId: projects.driveOAuthClientId })
        .from(projects).where(eq(projects.id, String(req.params.id)));
      if (cur && cur.driveOAuthClientId !== update.driveOAuthClientId) {
        update.driveOAuthRefreshTokenEnc = null;
      }
    }

    await db.update(projects).set(update).where(eq(projects.id, String(req.params.id)));

    // تسجيل Webhook تلقائياً عند حفظ Bot Token جديد
    // (Telegram يحتاج أن يعرف عنوان التطبيق ليرسل رسائل /start من المشاركين)
    if (body.telegramBotToken) {
      const baseUrl = getAppBaseUrl(req);
      const webhookUrl = `${baseUrl}/api/pform/telegram-webhook`;
      setWebhook(body.telegramBotToken, webhookUrl, getTelegramWebhookSecret()).catch((err) => {
        console.error("[setWebhook] فشل تسجيل Webhook:", err);
      });
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.delete("/:id", requireEditorOrAdmin, requireProjectOwnership, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);

    // Fetch all records before cascade deletion for file cleanup
    const allRecords = await db.select({
      data: projectRecords.data,
      driveFiles: projectRecords.driveFiles,
      driveFolderId: projectRecords.driveFolderId,
      syncStatus: projectRecords.syncStatus,
    }).from(projectRecords).where(eq(projectRecords.projectId, pid));

    // Delete project (cascade deletes records, fields, audit logs, etc.)
    await db.delete(projects).where(eq(projects.id, pid));

    // Async cleanup of local files and Drive files (non-blocking)
    // Handles both flat (/uploads/uuid.ext) and organised (/uploads/project/folder/uuid.ext) paths.
    for (const rec of allRecords) {
      if (rec.data && typeof rec.data === "object") {
        Object.values(rec.data as Record<string, any>).forEach(val => {
          if (typeof val === "string" && val.startsWith("/uploads/")) {
            const relativePath = val.slice("/uploads/".length);
            const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
            const filePath = path.join(uploadsDir, normalized);
            if (filePath.startsWith(uploadsDir + path.sep)) fs.unlink(filePath, () => {});
          }
        });
      }
      if (rec.syncStatus === "synced" && rec.driveFiles && typeof rec.driveFiles === "object") {
        const df = rec.driveFiles as Record<string, any>;
        Object.values(df).filter(f => f?.fileId)
          .forEach((f: any) => driveStorage.deleteFileFromDrive(pid, f.fileId).catch(console.error));
        if (rec.driveFolderId) {
          driveStorage.deleteFolderFromDrive(pid, rec.driveFolderId).catch(console.error);
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── EXCEL PARSE ─────────────────────────────────────────────

router.post("/parse-excel", requireEditorOrAdmin, parseExcelLimiter, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(req.file.buffer);
    await workbook.xlsx.read(stream as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: "الملف لا يحتوي على أوراق عمل" });

    const headers: string[] = [];
    const sampleData: string[][] = [];

    worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      headers.push(String(cell.value || "").trim());
    });

    for (let r = 2; r <= Math.min(4, worksheet.rowCount); r++) {
      const row: string[] = [];
      worksheet.getRow(r).eachCell({ includeEmpty: true }, (cell, colNum) => {
        row[colNum - 1] = String(cell.value || "").trim();
      });
      sampleData.push(row);
    }

    const columns = headers.map((h, idx) => ({
      originalLabel: h,
      label: h,
      key: `field_${idx + 1}`,
      fieldType: "text",
      isRequired: false,
      isVisible: true,
      stepNumber: 1,
      orderIndex: idx,
      samples: sampleData.map(row => row[idx] || "").filter(Boolean).slice(0, 3),
    }));

    res.json({ columns, totalRows: worksheet.rowCount - 1 });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── FILE UPLOADS (admin — for add/edit record forms) ─────────

// M-04: validateMimeType checks magic-bytes; validateFieldRestrictions enforces per-field limits.
// After validation passes, file is moved from flat uploads/ into uploads/{project-slug}/{upload-folder}/
router.post("/:id/upload", requireEditorOrAdmin, requireProjectEditAccess, (req: Request, res: Response, next: NextFunction) => {
  const pid = String(req.params.id);
  fileUpload.single("file")(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "فشل رفع الملف" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    // Build the final response — organise into subfolders if uploadFolder provided
    const buildResponse = async () => {
      const uploadFolder = String(req.body.uploadFolder || "").trim();
      if (uploadFolder) {
        try {
          const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, pid));
          if (proj?.name) {
            const relPath = organizeUploadedFile(req.file!.filename, proj.name, uploadFolder);
            return res.json({ url: `/uploads/${relPath}`, originalName: req.file!.originalname });
          }
        } catch {
          // Fall through to flat path on any error
        }
      }
      res.json({ url: publicFileUrl(req.file!.filename), originalName: req.file!.originalname });
    };

    await validateMimeType(req, res, async () => {
      const fieldKey = String(req.body.fieldKey || "");
      if (fieldKey) {
        const [fieldCfg] = await db.select({
          allowedFileTypes: projectFields.allowedFileTypes,
          maxFileSizeMb: projectFields.maxFileSizeMb,
        }).from(projectFields).where(and(eq(projectFields.projectId, pid), eq(projectFields.key, fieldKey)));
        if (fieldCfg && (fieldCfg.allowedFileTypes || fieldCfg.maxFileSizeMb)) {
          await validateFieldRestrictions(req, res, buildResponse, fieldCfg.allowedFileTypes, fieldCfg.maxFileSizeMb);
          return;
        }
      }
      await buildResponse();
    });
  });
});

// ─── PROJECT FIELDS ──────────────────────────────────────────

router.get("/:id/fields", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const fields = await db.select().from(projectFields)
      .where(eq(projectFields.projectId, String(req.params.id)))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);
    res.json(fields);
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/:id/fields", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const rawFields: any[] = req.body.fields;
    if (!Array.isArray(rawFields)) return res.status(400).json({ error: "fields must be an array" });

    const fieldsResult = rawFields.map((f: any) => projectFieldSchema.safeParse(f));
    const firstError = fieldsResult.find(r => !r.success);
    if (firstError && !firstError.success) {
      return res.status(400).json({ error: firstError.error.errors[0].message });
    }

    await db.delete(projectFields).where(eq(projectFields.projectId, String(req.params.id)));
    if (rawFields.length > 0) {
      await db.insert(projectFields).values(rawFields.map((f: any, idx: number) => ({
        projectId: String(req.params.id),
        key: f.key,
        label: f.label,
        fieldType: f.fieldType || "text",
        isRequired: f.isRequired || false,
        isVisible: f.isVisible !== false,
        options: f.options || null,
        stepNumber: f.stepNumber || 1,
        orderIndex: f.orderIndex ?? idx,
        placeholder: f.placeholder || null,
        validationMin: f.validationMin ?? null,
        validationMax: f.validationMax ?? null,
        validationRegex: f.validationRegex ?? null,
        validationMessage: f.validationMessage ?? null,
        conditions: Array.isArray(f.conditions) ? f.conditions : [],
        conditionOperator: f.conditionOperator === "OR" ? "OR" : "AND",
        visibleTo: ["admin", "editor"].includes(f.visibleTo) ? f.visibleTo : "all",
        isReadOnly: !!f.isReadOnly,
        isFullWidth: !!f.isFullWidth,
        // Per-field file restrictions (null = use global defaults)
        allowedFileTypes: Array.isArray(f.allowedFileTypes) && f.allowedFileTypes.length > 0 ? f.allowedFileTypes : null,
        maxFileSizeMb: f.maxFileSizeMb ? Number(f.maxFileSizeMb) : null,
      })));
    }
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── PROJECT RECORDS ─────────────────────────────────────────

router.get("/:id/records", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || "";

    let allRecords = await db.select().from(projectRecords)
      .where(eq(projectRecords.projectId, String(req.params.id)))
      .orderBy(desc(projectRecords.submittedAt));

    // Full-text search
    if (search) {
      const s = search.toLowerCase();
      allRecords = allRecords.filter(r => {
        const data = r.data as Record<string, any>;
        return Object.values(data).some(v => String(v || "").toLowerCase().includes(s));
      });
    }

    // Field-level filters: filter_<key>=value
    for (const [qKey, qVal] of Object.entries(req.query)) {
      if (!qKey.startsWith("filter_") || !qVal) continue;
      const fieldKey = qKey.slice(7);
      const filterVal = String(qVal).toLowerCase();
      allRecords = allRecords.filter(r => {
        const d = r.data as Record<string, any>;
        return String(d[fieldKey] ?? "").toLowerCase().includes(filterVal);
      });
    }

    // Date range filter on submittedAt
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;
    if (dateFrom) {
      const from = new Date(dateFrom);
      allRecords = allRecords.filter(r => r.submittedAt && r.submittedAt >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      allRecords = allRecords.filter(r => r.submittedAt && r.submittedAt <= to);
    }

    const total = allRecords.length;
    const data = allRecords.slice(offset, offset + limit);
    res.json({ data, total, page, limit });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/:id/records", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ editTokenHours: projects.editTokenHours }).from(projects).where(eq(projects.id, pid));
    const tokenHours = proj?.editTokenHours ?? 48;
    const tokenExpiresAt = new Date(Date.now() + tokenHours * 60 * 60 * 1000);

    // Collect autoincrement field keys so insertRecordAtomic can fill them inside the lock
    const autoFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'autoincrement'`));
    const autoIncrementKeys = autoFields.map(f => f.key);

    // Atomically assign sequential number and insert (advisory lock prevents duplicates)
    const record = await insertRecordAtomic(pid, req.body, tokenExpiresAt, autoIncrementKeys);
    const seqNum = record.sequential_number;
    const finalData = record.enriched_data; // includes auto-filled autoincrement values

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: record.id,
      changedBy: (req.session as any).userId || "admin",
      action: "create",
      changesJson: finalData,
    });

    appendRecordToSheet(pid, finalData as any, seqNum).then(async (rowIndex) => {
      if (rowIndex) {
        await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, record.id));
      }
    }).catch(console.error);

    res.json({ ok: true, record });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.get("/:id/records/:recordId", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const [record] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.id, String(req.params.recordId)), eq(projectRecords.projectId, String(req.params.id))));
    if (!record) return res.status(404).json({ error: "السجل غير موجود" });

    const logs = await db.select().from(projectAuditLog)
      .where(eq(projectAuditLog.recordId, record.id))
      .orderBy(desc(projectAuditLog.changedAt)).limit(20);

    res.json({ record, auditLog: logs });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.patch("/:id/records/:recordId", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [existing] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.id, String(req.params.recordId)), eq(projectRecords.projectId, pid)));
    if (!existing) return res.status(404).json({ error: "السجل غير موجود" });

    // Strip autoincrement fields from the incoming payload — they are immutable after creation
    const autoFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'autoincrement'`));
    const safeBody: Record<string, any> = { ...req.body };
    for (const { key } of autoFields) {
      if (key in (existing.data as any)) {
        // Restore the original autoincrement value from the existing record
        safeBody[key] = (existing.data as any)[key];
      } else {
        delete safeBody[key];
      }
    }

    const [updated] = await db.update(projectRecords)
      .set({ data: safeBody, updatedAt: new Date() })
      .where(eq(projectRecords.id, String(req.params.recordId)))
      .returning();

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: String(req.params.recordId),
      changedBy: (req.session as any).userId,
      action: "update",
      changesJson: safeBody,
    });

    if (updated.sheetsRowIndex) {
      updateRecordRow(pid, updated.sheetsRowIndex, updated.data as any, updated.sequentialNumber || 0).catch(console.error);
    } else {
      appendRecordToSheet(pid, updated.data as any, updated.sequentialNumber || 0).then(async (rowIndex) => {
        if (rowIndex) {
          await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, updated.id));
        }
      }).catch(console.error);
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.delete("/:id/records/:recordId", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const rid = String(req.params.recordId);
    const [rec] = await db.select({
      sheetsRowIndex: projectRecords.sheetsRowIndex,
      data: projectRecords.data,
      driveFiles: projectRecords.driveFiles,
      driveFolderId: projectRecords.driveFolderId,
      syncStatus: projectRecords.syncStatus,
    }).from(projectRecords).where(and(eq(projectRecords.id, rid), eq(projectRecords.projectId, pid)));
    if (!rec) return res.status(404).json({ error: "السجل غير موجود" });
    await db.delete(projectRecords).where(and(eq(projectRecords.id, rid), eq(projectRecords.projectId, pid)));

    // Clean up local uploaded files (best-effort, non-blocking)
    // Handles both flat paths (/uploads/uuid.ext) and organised paths (/uploads/project/folder/uuid.ext)
    if (rec.data && typeof rec.data === "object") {
      Object.values(rec.data as Record<string, any>).forEach(val => {
        if (typeof val === "string" && val.startsWith("/uploads/")) {
          const relativePath = val.slice("/uploads/".length); // strip leading /uploads/
          const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
          const filePath = path.join(uploadsDir, normalized);
          // Safety: only delete inside uploadsDir
          if (filePath.startsWith(uploadsDir + path.sep)) {
            fs.unlink(filePath, () => {});
          }
        }
      });
    }

    // Clean up Drive files/folder (best-effort, non-blocking)
    if (rec.syncStatus === "synced" && rec.driveFiles && typeof rec.driveFiles === "object") {
      const driveFiles = rec.driveFiles as Record<string, any>;
      const fileIds = Object.values(driveFiles)
        .filter(f => f && f.fileId)
        .map((f: any) => f.fileId as string);
      fileIds.forEach(fileId => driveStorage.deleteFileFromDrive(pid, fileId).catch(console.error));
      if (rec.driveFolderId) {
        driveStorage.deleteFolderFromDrive(pid, rec.driveFolderId).catch(console.error);
      }
    }

    if (rec?.sheetsRowIndex) {
      const deletedRow = rec.sheetsRowIndex;
      deleteRecordRow(String(req.params.id), deletedRow).then(ok => {
        if (ok) {
          db.update(projectRecords)
            .set({ sheetsRowIndex: sql`${projectRecords.sheetsRowIndex} - 1` })
            .where(and(eq(projectRecords.projectId, String(req.params.id)), gt(projectRecords.sheetsRowIndex, deletedRow)))
            .catch(console.error);
        }
      }).catch(console.error);
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/:id/records/bulk-delete", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const { ids } = parsed.data;
    const pid = String(req.params.id);

    // Fetch records before deletion to allow file cleanup
    const toDelete = ids.length > 0
      ? await db.select({
          id: projectRecords.id,
          data: projectRecords.data,
          driveFiles: projectRecords.driveFiles,
          driveFolderId: projectRecords.driveFolderId,
          syncStatus: projectRecords.syncStatus,
        }).from(projectRecords).where(and(
          inArray(projectRecords.id, ids),
          eq(projectRecords.projectId, pid),
        ))
      : [];

    // Delete from DB (scoped to project to prevent cross-project IDOR)
    for (const rid of ids) {
      await db.delete(projectRecords).where(and(eq(projectRecords.id, rid), eq(projectRecords.projectId, pid)));
    }

    // Async cleanup of local and Drive files (non-blocking)
    // Handles both flat (/uploads/uuid.ext) and organised (/uploads/project/folder/uuid.ext) paths.
    for (const rec of toDelete) {
      if (rec.data && typeof rec.data === "object") {
        Object.values(rec.data as Record<string, any>).forEach(val => {
          if (typeof val === "string" && val.startsWith("/uploads/")) {
            const relativePath = val.slice("/uploads/".length);
            const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
            const filePath = path.join(uploadsDir, normalized);
            if (filePath.startsWith(uploadsDir + path.sep)) fs.unlink(filePath, () => {});
          }
        });
      }
      if (rec.syncStatus === "synced" && rec.driveFiles && typeof rec.driveFiles === "object") {
        const df = rec.driveFiles as Record<string, any>;
        Object.values(df).filter(f => f?.fileId)
          .forEach((f: any) => driveStorage.deleteFileFromDrive(pid, f.fileId).catch(console.error));
        if (rec.driveFolderId) {
          driveStorage.deleteFolderFromDrive(pid, rec.driveFolderId).catch(console.error);
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── STATS ───────────────────────────────────────────────────

router.get("/:id/stats", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const pid = String(req.params.id);

    const [total] = await db.select({ count: count() }).from(projectRecords).where(eq(projectRecords.projectId, pid));
    const [today] = await db.select({ count: count() }).from(projectRecords).where(and(eq(projectRecords.projectId, pid), gte(projectRecords.submittedAt, startOfDay)));
    const [week] = await db.select({ count: count() }).from(projectRecords).where(and(eq(projectRecords.projectId, pid), gte(projectRecords.submittedAt, startOfWeek)));
    const [month] = await db.select({ count: count() }).from(projectRecords).where(and(eq(projectRecords.projectId, pid), gte(projectRecords.submittedAt, startOfMonth)));

    // Daily submissions for last 14 days
    const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 13);
    const recentRecords = await db.select({ submittedAt: projectRecords.submittedAt })
      .from(projectRecords)
      .where(and(eq(projectRecords.projectId, pid), gte(projectRecords.submittedAt, twoWeeksAgo)));

    const dailyCounts: Record<string, number> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - 13 + i);
      const key = d.toISOString().slice(0, 10);
      dailyCounts[key] = 0;
    }
    for (const r of recentRecords) {
      if (r.submittedAt) {
        const key = r.submittedAt.toISOString().slice(0, 10);
        if (key in dailyCounts) dailyCounts[key]++;
      }
    }

    const dailyTrend = Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));

    res.json({
      total: Number(total?.count || 0),
      today: Number(today?.count || 0),
      week: Number(week?.count || 0),
      month: Number(month?.count || 0),
      dailyTrend,
    });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── EXPORT ──────────────────────────────────────────────────

router.get("/:id/export", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string) || "xlsx";
    const pid = String(req.params.id);
    const customFilename = req.query.filename as string;
    const columnsParam = req.query.columns as string;
    const groupByKey = req.query.groupBy as string;

    const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, pid));
    const allFields = await db.select().from(projectFields)
      .where(eq(projectFields.projectId, pid))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    // Filter to requested columns only
    const selectedKeys = columnsParam ? columnsParam.split(",").map(s => s.trim()).filter(Boolean) : null;
    const fields = selectedKeys
      ? allFields.filter(f => selectedKeys.includes(f.key))
      : allFields;

    // Fetch records with filters
    let allRecords = await db.select().from(projectRecords)
      .where(eq(projectRecords.projectId, pid))
      .orderBy(desc(projectRecords.submittedAt));

    // Field-level filters
    for (const [qKey, qVal] of Object.entries(req.query)) {
      if (!qKey.startsWith("filter_") || !qVal) continue;
      const fieldKey = qKey.slice(7);
      const fv = String(qVal).toLowerCase();
      allRecords = allRecords.filter(r => {
        const d = r.data as Record<string, any>;
        return String(d[fieldKey] ?? "").toLowerCase().includes(fv);
      });
    }

    // Date range
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;
    if (dateFrom) {
      const from = new Date(dateFrom);
      allRecords = allRecords.filter(r => r.submittedAt && r.submittedAt >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      allRecords = allRecords.filter(r => r.submittedAt && r.submittedAt <= to);
    }

    const safeFilename = (customFilename || proj?.name || "بيانات")
      .replace(/[^a-zA-Z0-9_\u0600-\u06FF\s\-]/g, "").trim();

    if (format === "csv") {
      const headers = ["م", ...fields.map(f => f.label)];
      const rows = allRecords.map((r, i) => {
        const data = r.data as Record<string, any>;
        return [String(r.sequentialNumber || i + 1), ...fields.map(f => String(data[f.key] ?? ""))];
      });
      const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeFilename)}.csv"`);
      res.send("\ufeff" + csv);
      return;
    }

    const workbook = new ExcelJS.Workbook();

    const styleHeaderRow = (sheet: ExcelJS.Worksheet) => {
      const hr = sheet.getRow(1);
      hr.height = 30;
      hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      hr.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Arial" };
      hr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    };

    const addSheetData = (sheetName: string, records: typeof allRecords) => {
      const ws = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true }] });
      ws.columns = [
        { header: "م", key: "seq", width: 8 },
        ...fields.map(f => ({ header: f.label, key: f.key, width: 22 })),
        { header: "تاريخ التسجيل", key: "_date", width: 16 },
      ];
      styleHeaderRow(ws);
      for (const [i, r] of records.entries()) {
        const data = r.data as Record<string, any>;
        const rowData: any = { seq: r.sequentialNumber || i + 1 };
        for (const f of fields) rowData[f.key] = data[f.key] ?? "";
        rowData._date = r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : "";
        ws.addRow(rowData);
      }
    };

    if (groupByKey) {
      // Group records by the field value and create a sheet per group
      const groupMap = new Map<string, typeof allRecords>();
      for (const r of allRecords) {
        const d = r.data as Record<string, any>;
        const groupVal = String(d[groupByKey] ?? "غير محدد");
        if (!groupMap.has(groupVal)) groupMap.set(groupVal, []);
        groupMap.get(groupVal)!.push(r);
      }
      // Summary sheet first
      addSheetData("الكل", allRecords);
      for (const [groupVal, groupRecords] of groupMap) {
        addSheetData(groupVal, groupRecords);
      }
    } else {
      addSheetData(proj?.name || "بيانات", allRecords);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeFilename)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── STATS DISTRIBUTIONS ─────────────────────────────────────

router.get("/:id/stats/distributions", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const selectFields = await db.select({ key: projectFields.key, label: projectFields.label })
      .from(projectFields)
      .where(and(
        eq(projectFields.projectId, pid),
        sql`field_type IN ('select', 'radio')`,
        eq(projectFields.isVisible, true)
      ))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    const allRecords = await db.select({ data: projectRecords.data })
      .from(projectRecords)
      .where(eq(projectRecords.projectId, pid));

    const distributions: Record<string, { value: string; count: number }[]> = {};
    for (const field of selectFields.slice(0, 5)) {
      const counts: Record<string, number> = {};
      for (const r of allRecords) {
        const d = r.data as Record<string, any>;
        const val = d[field.key];
        if (val != null && String(val).trim()) {
          const k = String(val).trim();
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      distributions[field.key] = Object.entries(counts)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    }

    res.json({ distributions, fields: selectFields });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── SHEET TOOLS ─────────────────────────────────────────────

router.post("/:id/fix-sheet-headers", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  const result = await fixProjectSheetHeaders(String(req.params.id));
  res.json(result);
});

router.post("/:id/check-sheet-columns", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  const result = await checkProjectSheetColumns(String(req.params.id));
  res.json(result);
});

router.post("/:id/import-from-sheets", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  const { syncDeleted, dryRun } = req.body;
  const result = await importFromProjectSheet(String(req.params.id), !!syncDeleted, !!dryRun);
  res.json(result);
});

router.post("/:id/export-to-sheets", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  const result = await exportToProjectSheet(String(req.params.id));
  res.json(result);
});

// ─── SETTINGS ACTIONS ────────────────────────────────────────

router.post("/:id/test-sheets", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  const result = await testProjectSheetsConnection(String(req.params.id));
  res.json(result);
});

router.post("/:id/test-telegram", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const { token, chatId } = req.body;
    let botToken = token;
    if (!botToken) {
      const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc }).from(projects).where(eq(projects.id, String(req.params.id)));
      if (proj?.telegramBotTokenEnc) botToken = decrypt(proj.telegramBotTokenEnc);
    }
    if (!botToken) return res.status(400).json({ error: "لم يتم إدخال Bot Token" });
    const result = await testTelegramBot(botToken, chatId);
    res.json(result);
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/:id/telegram-updates", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    let botToken = token;
    if (!botToken) {
      const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc }).from(projects).where(eq(projects.id, String(req.params.id)));
      if (proj?.telegramBotTokenEnc) botToken = decrypt(proj.telegramBotTokenEnc);
    }
    if (!botToken) return res.status(400).json({ ok: false, message: "أدخل Bot Token أولاً" });

    // ── Strategy 1: read from project-scoped webhook cache (zero side-effects) ─
    // Messages delivered to the Webhook are consumed immediately and never appear
    // in getUpdates. The webhook handler stores chats per-project so admins only
    // see chats from their own project's bot.
    const projectId = String(req.params.id);
    if (hasProjectChats(projectId)) {
      const chats = getProjectChats(projectId);
      return res.json({ ok: true, chats });
    }

    // ── Strategy 2: fallback to getUpdates (only when webhook cache is empty) ──
    // This handles the rare case where the Webhook was never hit yet. We must
    // delete the webhook first (Telegram forbids simultaneous use), then
    // re-register it immediately after.
    const baseUrl = getAppBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/pform/telegram-webhook`;
    const result = await getTelegramUpdates(botToken, webhookUrl, getTelegramWebhookSecret());

    if (!result.ok || !result.chats?.length) {
      return res.json({
        ok: false,
        message: "أرسل أي رسالة للبوت على تيليغرام ثم اضغط «جلب Chat ID» مرة أخرى",
      });
    }

    res.json(result);
  } catch (err: any) {
    handleError(res, err, "GET /telegram-updates");
  }
});

router.post("/test-email", requireEditorOrAdmin, async (req: Request, res: Response) => {
  const { host, port, user, pass } = req.body;
  const result = await testEmailConnection(
    host || user || pass ? { host, port: Number(port) || 587, user, pass } : undefined
  );
  res.json(result);
});

router.post("/send-invitation", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, role } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: "بريد إلكتروني غير صالح" });
    }
    const validRoles = ["admin", "editor", "viewer"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: "الدور المحدد غير صالح" });
    }
    // Check if user already exists with this email
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existingUser) {
      return res.status(409).json({ error: "يوجد مستخدم بهذا البريد الإلكتروني بالفعل" });
    }
    const [s] = await db.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
    const expiryHours = s?.invitationExpiryHours ?? 72;
    const appName = s?.appName || "مسارات";
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    await db.insert(userInvitations).values({
      email, role: role || "viewer",
      inviteToken: token,
      invitedBy: (req.session as any).userId,
      expiresAt,
    });

    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost || req.get("host") || "";
    const protocol = req.secure || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    const appUrl = `${protocol}://${host}`;

    const sent = await sendInvitationEmail(email, token, role || "viewer", appUrl, expiryHours, appName);
    res.json({ ok: true, inviteUrl: `${appUrl}/admin/register/${token}`, emailSent: sent });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/create-user", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const { fullName, email, password, role } = parsed.data;
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash(password, 12);
    const [user] = await db.insert(users).values({ fullName, email, passwordHash: hash, role: role || "viewer", mustChangePassword: true }).returning({ id: users.id });
    res.json({ ok: true, userId: user.id });
  } catch (err: any) {
    if (err.code === "23505") { res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" }); return; }
    handleError(res, err);
  }
});

router.post("/reset-password/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const bcrypt = await import("bcryptjs");
    const { password } = req.body;
    const hash = await bcrypt.default.hash(password, 12);
    await db.update(users).set({ passwordHash: hash, mustChangePassword: true }).where(eq(users.id, String(req.params.userId)));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.patch("/users/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = updateUserRoleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { fullName, email, role } = parsed.data;
    const upd: any = { role };
    if (fullName) upd.fullName = fullName;
    if (email) upd.email = email;
    await db.update(users).set(upd).where(eq(users.id, String(req.params.userId)));
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
    handleError(res, err);
  }
});

// ─── AUDIT LOG ───────────────────────────────────────────────

router.get("/:id/audit-log", requireAuth, requireProjectReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await db.select({
      id: projectAuditLog.id,
      recordId: projectAuditLog.recordId,
      changedBy: projectAuditLog.changedBy,
      action: projectAuditLog.action,
      changedAt: projectAuditLog.changedAt,
      changesJson: projectAuditLog.changesJson,
      userName: users.fullName,
    })
    .from(projectAuditLog)
    .leftJoin(users, sql`${projectAuditLog.changedBy} = ${users.id}::text`)
    .where(eq(projectAuditLog.projectId, pid))
    .orderBy(desc(projectAuditLog.changedAt))
    .limit(limit);
    res.json(logs);
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── DRIVE SYNC ──────────────────────────────────────────────

router.get("/:id/sync-stats", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const allRecords = await db.select({
      syncStatus: projectRecords.syncStatus,
      data: projectRecords.data,
    }).from(projectRecords).where(eq(projectRecords.projectId, pid));

    // Only count records that actually have file uploads
    const fileFields = await db.select({ key: projectFields.key })
      .from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'file'`));
    const fileKeys = fileFields.map(f => f.key);
    const hasFileFields = fileKeys.length > 0;

    const recordsWithFiles = hasFileFields
      ? allRecords.filter(r => {
          const d = r.data as Record<string, any>;
          return fileKeys.some(k => d[k] && String(d[k]).startsWith("/uploads/"));
        })
      : [];

    const stats = { local: 0, synced: 0, failed: 0, syncing: 0, total: 0, hasFileFields };
    for (const r of recordsWithFiles) {
      stats.total++;
      const s = r.syncStatus || "local";
      if (s === "local") stats.local++;
      else if (s === "synced") stats.synced++;
      else if (s === "sync_failed") stats.failed++;
      else if (s === "syncing") stats.syncing++;
    }

    res.json(stats);
  } catch (err: any) {
    handleError(res, err);
  }
});

router.post("/:id/sync-drive", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const mode: "keep_local" | "delete_local" = req.body.mode || "keep_local";
    const retryFailed: boolean = req.body.retryFailed === true;

    // Load project and validate Drive setup
    const [proj] = await db.select().from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    const hasSA    = !!proj.googleServiceAccountKeyEnc;
    const hasOAuth = !!(proj.driveOAuthRefreshTokenEnc && proj.driveOAuthClientId && proj.driveOAuthClientSecretEnc);
    if (!hasSA && !hasOAuth) {
      return res.status(400).json({ error: "لم يتم إعداد Google Drive — أضف Service Account أو أكمل ربط OAuth2 (Client ID + Secret + تفويض)" });
    }
    const rootFolderId = proj.driveRootFolderId || proj.googleDriveFolderId;
    if (!rootFolderId) {
      return res.status(400).json({ error: "لم يتم تحديد مجلد Drive الجذر. أضفه في إعدادات Google Drive." });
    }

    // Get file fields
    const fileFields = await db.select({ key: projectFields.key })
      .from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'file'`));
    const fileKeys = fileFields.map(f => f.key);
    if (fileKeys.length === 0) {
      return res.json({ ok: true, synced: 0, failed: 0, failedRecords: [], message: "لا يوجد حقول ملفات في هذا المشروع" });
    }

    // Find records to sync
    const statusFilter = retryFailed
      ? ["local", "sync_failed"]
      : ["local"];
    const allRecords = await db.select().from(projectRecords)
      .where(eq(projectRecords.projectId, pid));
    const toSync = allRecords.filter(r => {
      const s = r.syncStatus || "local";
      if (!statusFilter.includes(s)) return false;
      const d = r.data as Record<string, any>;
      return fileKeys.some(k => d[k] && String(d[k]).startsWith("/uploads/"));
    });

    if (toSync.length === 0) {
      return res.json({ ok: true, synced: 0, failed: 0, failedRecords: [], message: "لا يوجد ملفات تحتاج مزامنة" });
    }

    // Ensure project folder exists in Drive
    let projectFolderId: string;
    try {
      projectFolderId = await driveStorage.ensureProjectFolder(pid, proj.name, rootFolderId);
    } catch (err: any) {
      return res.status(500).json({ error: `فشل في الوصول إلى Google Drive: ${err.message}` });
    }

    let synced = 0;
    let failed = 0;
    const failedRecords: { id: string; error: string }[] = [];

    for (const record of toSync) {
      try {
        // Mark as syncing
        await db.update(projectRecords)
          .set({ syncStatus: "syncing" } as any)
          .where(eq(projectRecords.id, record.id));

        const recordData = record.data as Record<string, any>;

        // Determine folder label from sequential number or record ID
        const seqNum = record.sequentialNumber;
        const folderLabel = seqNum ? `السجل ${seqNum}` : `سجل ${record.id.slice(0, 8)}`;

        // Ensure record sub-folder
        const recordFolderId = await driveStorage.ensureRecordFolder(pid, projectFolderId, folderLabel, record.id);

        // Upload each file field
        const existingDriveFiles = (record.driveFiles as Record<string, any>) || {};
        const updatedDriveFiles: Record<string, any> = { ...existingDriveFiles };
        const updatedData = { ...recordData };
        const localFilesToDelete: string[] = []; // relative paths from uploadsDir root

        for (const fieldKey of fileKeys) {
          const fileUrl = recordData[fieldKey];
          if (!fileUrl || !String(fileUrl).startsWith("/uploads/")) continue;

          // displayName uses the leaf filename; localRelPath is the full relative path for reading
          const localFilename = path.basename(String(fileUrl));
          const localRelPath = String(fileUrl).slice("/uploads/".length);
          const mimeType = driveStorage.guessMimeType(localFilename);

          const { fileId, driveUrl } = await driveStorage.uploadLocalFileToDrive(pid, {
            localFilename: localRelPath, // full relative path so the service finds nested files
            displayName: localFilename,  // basename shown in Drive
            mimeType,
            folderId: recordFolderId,
          });

          updatedDriveFiles[fieldKey] = { fileId, driveUrl, originalName: localFilename, syncedAt: new Date().toISOString() };
          updatedData[fieldKey] = driveUrl;

          if (mode === "delete_local") {
            localFilesToDelete.push(localRelPath);
          }
        }

        // Persist sync results to DB
        const updatePayload: Record<string, any> = {
          driveFiles: updatedDriveFiles,
          driveFolderId: recordFolderId,
          syncStatus: "synced",
          updatedAt: new Date(),
        };
        // When deleting local files, also update data so Drive URLs replace broken /uploads/ paths
        if (mode === "delete_local") {
          updatePayload.data = updatedData;
        }
        await db.update(projectRecords)
          .set(updatePayload as any)
          .where(eq(projectRecords.id, record.id));

        // Update Google Sheets row with Drive URLs
        if (record.sheetsRowIndex) {
          updateRecordRow(pid, record.sheetsRowIndex, updatedData, record.sequentialNumber || 0).catch(console.error);
        }

        // Delete local files if requested (localFilesToDelete contains relative paths from uploadsDir)
        if (mode === "delete_local") {
          for (const relPath of localFilesToDelete) {
            const normalized = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
            const filePath = path.join(uploadsDir, normalized);
            if (filePath.startsWith(uploadsDir + path.sep)) fs.unlink(filePath, () => {});
          }
        }

        synced++;
      } catch (err: any) {
        console.error(`[sync-drive] Failed record ${record.id}:`, err);
        await db.update(projectRecords)
          .set({ syncStatus: "sync_failed" } as any)
          .where(eq(projectRecords.id, record.id));
        failed++;
        failedRecords.push({ id: record.id, error: err.message || "خطأ غير معروف" });
      }
    }

    res.json({ ok: true, synced, failed, failedRecords });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── PER-RECORD DRIVE SYNC ───────────────────────────────────

router.post("/:id/records/:recordId/sync-drive", requireEditorOrAdmin, requireProjectEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const rid = String(req.params.recordId);
    const mode: "keep_local" | "delete_local" = req.body.mode || "keep_local";

    const [proj] = await db.select().from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    const hasSA2    = !!proj.googleServiceAccountKeyEnc;
    const hasOAuth2 = !!(proj.driveOAuthRefreshTokenEnc && proj.driveOAuthClientId && proj.driveOAuthClientSecretEnc);
    if (!hasSA2 && !hasOAuth2) {
      return res.status(400).json({ error: "لم يتم إعداد Google Drive — أضف Service Account أو أكمل ربط OAuth2 (Client ID + Secret + تفويض)" });
    }
    const rootFolderId = proj.driveRootFolderId || proj.googleDriveFolderId;
    if (!rootFolderId) {
      return res.status(400).json({ error: "لم يتم تحديد مجلد Drive الجذر. أضفه في إعدادات Drive." });
    }

    const [record] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.id, rid), eq(projectRecords.projectId, pid)));
    if (!record) return res.status(404).json({ error: "السجل غير موجود" });

    const fileFields = await db.select({ key: projectFields.key })
      .from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'file'`));
    const fileKeys = fileFields.map(f => f.key);
    const recordData = record.data as Record<string, any>;

    const filesToSync = fileKeys.filter(k => recordData[k] && String(recordData[k]).startsWith("/uploads/"));
    if (filesToSync.length === 0) {
      return res.json({ ok: true, synced: 0, message: "لا يوجد ملفات محلية في هذا السجل" });
    }

    await db.update(projectRecords).set({ syncStatus: "syncing" } as any).where(eq(projectRecords.id, rid));

    const projectFolderId = await driveStorage.ensureProjectFolder(pid, proj.name, rootFolderId);
    const folderLabel = record.sequentialNumber ? `السجل ${record.sequentialNumber}` : `سجل ${rid.slice(0, 8)}`;
    const recordFolderId = await driveStorage.ensureRecordFolder(pid, projectFolderId, folderLabel, rid);

    const existingDriveFiles = (record.driveFiles as Record<string, any>) || {};
    const updatedDriveFiles: Record<string, any> = { ...existingDriveFiles };
    const updatedData = { ...recordData };
    const localFilesToDelete: string[] = [];

    for (const fieldKey of filesToSync) {
      const fileUrl = String(recordData[fieldKey]);
      const localFilename = path.basename(fileUrl);          // basename for display name in Drive
      const localRelPath  = fileUrl.slice("/uploads/".length); // full relative path for reading
      const mimeType = driveStorage.guessMimeType(localFilename);
      const { fileId, driveUrl } = await driveStorage.uploadLocalFileToDrive(pid, {
        localFilename: localRelPath, // full relative path so the service finds nested files
        displayName: localFilename,  // basename shown in Drive
        mimeType,
        folderId: recordFolderId,
      });
      updatedDriveFiles[fieldKey] = { fileId, driveUrl, originalName: localFilename, syncedAt: new Date().toISOString() };
      updatedData[fieldKey] = driveUrl;
      if (mode === "delete_local") localFilesToDelete.push(localRelPath); // full path for unlink
    }

    const updatePayload: Record<string, any> = {
      driveFiles: updatedDriveFiles,
      driveFolderId: recordFolderId,
      syncStatus: "synced",
      updatedAt: new Date(),
    };
    if (mode === "delete_local") updatePayload.data = updatedData;
    await db.update(projectRecords).set(updatePayload as any).where(eq(projectRecords.id, rid));

    if (record.sheetsRowIndex) {
      updateRecordRow(pid, record.sheetsRowIndex, updatedData, record.sequentialNumber || 0).catch(console.error);
    }
    if (mode === "delete_local") {
      for (const relPath of localFilesToDelete) {
        const normalized = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(uploadsDir, normalized);
        if (filePath.startsWith(uploadsDir + path.sep)) fs.unlink(filePath, () => {});
      }
    }

    res.json({ ok: true, synced: filesToSync.length });
  } catch (err: any) {
    await db.update(projectRecords)
      .set({ syncStatus: "sync_failed" } as any)
      .where(eq(projectRecords.id, String(req.params.recordId)))
      .catch(() => {});
    handleError(res, err);
  }
});

// ─── COLLABORATORS (admin only) ──────────────────────────────────────────────

// GET /:id/collaborators — list editors who have been granted access
router.get("/:id/collaborators", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const list = await db
      .select({
        id: projectCollaborators.id,
        userId: projectCollaborators.userId,
        fullName: users.fullName,
        email: users.email,
        grantedBy: projectCollaborators.grantedBy,
        permission: projectCollaborators.permission,
        createdAt: projectCollaborators.createdAt,
      })
      .from(projectCollaborators)
      .innerJoin(users, eq(users.id, projectCollaborators.userId))
      .where(eq(projectCollaborators.projectId, pid));
    res.json(list);
  } catch (err: any) {
    handleError(res, err);
  }
});

// POST /:id/collaborators — grant an editor access to this project
router.post("/:id/collaborators", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const { userId, permission } = req.body;
    if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId مطلوب" });
    const perm = permission === "full" ? "full" : "edit";

    // Must be an editor
    const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });
    if (target.role !== "editor") return res.status(400).json({ error: "يمكن منح الوصول للمحررين فقط" });

    // Must not already be the project owner
    const [proj] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (proj.createdBy === userId) return res.status(400).json({ error: "هذا المستخدم هو صاحب المشروع بالفعل" });

    await db.insert(projectCollaborators)
      .values({ projectId: pid, userId, grantedBy: (req.session as any).userId, permission: perm })
      .onConflictDoNothing();

    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// PATCH /:id/collaborators/:userId — change permission level (edit ↔ full)
router.patch("/:id/collaborators/:userId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const uid = String(req.params.userId);
    const { permission } = req.body;
    if (permission !== "edit" && permission !== "full") {
      return res.status(400).json({ error: "قيمة permission غير صالحة (edit أو full)" });
    }
    await db.update(projectCollaborators)
      .set({ permission })
      .where(and(eq(projectCollaborators.projectId, pid), eq(projectCollaborators.userId, uid)));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// DELETE /:id/collaborators/:userId — revoke access
router.delete("/:id/collaborators/:userId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const uid = String(req.params.userId);
    await db.delete(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, pid), eq(projectCollaborators.userId, uid)));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

router.delete("/users/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const uid = String(req.params.userId);

    // Prevent deleting the last admin
    const adminUsers = await db.select({ count: count() }).from(users).where(eq(users.role, "admin"));
    if (Number(adminUsers[0]?.count || 0) <= 1) {
      const [target] = await db.select().from(users).where(eq(users.id, uid));
      if (target?.role === "admin") return res.status(400).json({ error: "لا يمكن حذف آخر مدير" });
    }

    // ── Cascade cleanup ──────────────────────────────────────────────────────
    // 1. Load all projects created by this user
    const userProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.createdBy, uid));

    const projectIds = userProjects.map(p => p.id);

    if (projectIds.length > 0) {
      // 2. Load all records belonging to those projects (to delete their local files)
      const allRecords = await db
        .select({ data: projectRecords.data })
        .from(projectRecords)
        .where(inArray(projectRecords.projectId, projectIds));

      // 3. Delete local files for every record (best-effort, non-blocking)
      for (const rec of allRecords) {
        if (rec.data && typeof rec.data === "object") {
          Object.values(rec.data as Record<string, any>).forEach(val => {
            if (typeof val === "string" && val.startsWith("/uploads/")) {
              const relativePath = val.slice("/uploads/".length);
              const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
              const filePath = path.join(uploadsDir, normalized);
              if (filePath.startsWith(uploadsDir + path.sep)) fs.unlink(filePath, () => {});
            }
          });
        }
      }

      // 4. Delete the projects — DB cascades to projectFields, projectRecords, projectAuditLog
      await db.delete(projects).where(inArray(projects.id, projectIds));
    }

    // 5. Delete the user account itself
    await db.delete(users).where(eq(users.id, uid));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// ─── TEMPLATE EXPORT / IMPORT ────────────────────────────────

/** Encrypt plaintext with a password-derived AES-256-GCM key */
function encryptWithBackupKey(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/** Decrypt base64-encoded AES-256-GCM ciphertext with a password-derived key */
function decryptWithBackupKey(encBase64: string, key: Buffer): string {
  const buf = Buffer.from(encBase64, "base64");
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

/** Derive a 32-byte AES key from password + hex salt using PBKDF2-SHA256 */
function deriveBackupKey(password: string, saltHex: string): Buffer {
  return pbkdf2Sync(password, Buffer.from(saltHex, "hex"), 100_000, 32, "sha256");
}

/** Zod schema for validating the structure of a .masarat import file */
const importFileSchema = z.object({
  _meta: z.object({
    version: z.string(),
    platform: z.literal("masarat"),
    mode: z.enum(["template", "backup"]),
    encryption: z.object({
      kdf: z.literal("pbkdf2"),
      saltHex: z.string().min(1),
      iterations: z.number().int().positive(),
    }).nullable().optional(),
  }),
  project: z.object({
    name: z.string().min(1, "اسم المشروع مطلوب"),
    description: z.string().nullable().optional(),
    formTitle: z.string().nullable().optional(),
    formSubtitle: z.string().nullable().optional(),
    invitationCode: z.string().nullable().optional(),
    editTokenHours: z.number().nullable().optional(),
    formEnabled: z.boolean().nullable().optional(),
    formDisabledMessage: z.string().nullable().optional(),
    steps: z.array(z.string()).nullable().optional(),
  }),
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    fieldType: z.string().default("text"),
    isRequired: z.boolean().nullable().optional(),
    isVisible: z.boolean().nullable().optional(),
    options: z.any().optional(),
    stepNumber: z.number().nullable().optional(),
    orderIndex: z.number().nullable().optional(),
    placeholder: z.string().nullable().optional(),
    validationMin: z.number().nullable().optional(),
    validationMax: z.number().nullable().optional(),
    validationRegex: z.string().nullable().optional(),
    validationMessage: z.string().nullable().optional(),
    conditions: z.any().optional(),
    conditionOperator: z.string().nullable().optional(),
    visibleTo: z.string().nullable().optional(),
    isReadOnly: z.boolean().nullable().optional(),
    isFullWidth: z.boolean().nullable().optional(),
    allowedFileTypes: z.any().optional(),
    maxFileSizeMb: z.number().nullable().optional(),
  })).default([]),
  integrations: z.object({
    googleSheetId: z.string().nullable().optional(),
    importSheetId: z.string().nullable().optional(),
    googleSheetName: z.string().nullable().optional(),
    googleServiceAccountEmail: z.string().nullable().optional(),
    googleDriveFolderId: z.string().nullable().optional(),
    driveRootFolderId: z.string().nullable().optional(),
    driveSyncEnabled: z.boolean().nullable().optional(),
    telegramChatId: z.string().nullable().optional(),
    driveOAuthClientId: z.string().nullable().optional(),
    googleServiceAccountKeyEnc: z.string().nullable().optional(),
    telegramBotTokenEnc: z.string().nullable().optional(),
    driveOAuthClientSecretEnc: z.string().nullable().optional(),
    driveOAuthRefreshTokenEnc: z.string().nullable().optional(),
  }).optional(),
});

// ─── POST /:id/template-export — Export project structure as .masarat file ───
// POST (not GET) so the backup password travels in the request body, never in the URL.
router.post("/:id/template-export", requireEditorOrAdmin, requireProjectOwnership, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const mode = (req.body?.mode as string) === "backup" ? "backup" : "template";
    const password = req.body?.password as string | undefined;

    if (mode === "backup" && (!password || password.length < 8)) {
      return res.status(400).json({ error: "كلمة مرور النسخ الاحتياطي يجب أن تكون 8 أحرف على الأقل" });
    }

    const [proj] = await db.select().from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const fields = await db
      .select().from(projectFields)
      .where(eq(projectFields.projectId, pid))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    const exportData: any = {
      _meta: {
        version: "1.0",
        platform: "masarat",
        exportedAt: new Date().toISOString(),
        mode,
        encryption: null,
      },
      project: {
        name: proj.name,
        description: proj.description,
        formTitle: proj.formTitle,
        formSubtitle: proj.formSubtitle,
        invitationCode: proj.invitationCode,
        editTokenHours: proj.editTokenHours,
        formEnabled: proj.formEnabled,
        formDisabledMessage: proj.formDisabledMessage,
        steps: proj.steps,
      },
      fields: fields.map(f => ({
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        isVisible: f.isVisible,
        options: f.options,
        stepNumber: f.stepNumber,
        orderIndex: f.orderIndex,
        placeholder: f.placeholder,
        validationMin: f.validationMin,
        validationMax: f.validationMax,
        validationRegex: f.validationRegex,
        validationMessage: f.validationMessage,
        conditions: f.conditions,
        conditionOperator: f.conditionOperator,
        visibleTo: f.visibleTo,
        isReadOnly: f.isReadOnly,
        isFullWidth: f.isFullWidth,
        allowedFileTypes: f.allowedFileTypes,
        maxFileSizeMb: f.maxFileSizeMb,
      })),
      integrations: {
        googleSheetId: proj.googleSheetId,
        importSheetId: proj.importSheetId,
        googleSheetName: proj.googleSheetName,
        googleServiceAccountEmail: proj.googleServiceAccountEmail,
        googleDriveFolderId: proj.googleDriveFolderId,
        driveRootFolderId: proj.driveRootFolderId,
        driveSyncEnabled: proj.driveSyncEnabled,
        telegramChatId: proj.telegramChatId,
        driveOAuthClientId: proj.driveOAuthClientId,
        // Sensitive — null in template mode, re-encrypted in backup mode
        googleServiceAccountKeyEnc: null as string | null,
        telegramBotTokenEnc: null as string | null,
        driveOAuthClientSecretEnc: null as string | null,
        driveOAuthRefreshTokenEnc: null as string | null,
      },
    };

    if (mode === "backup" && password) {
      const saltHex = randomBytes(16).toString("hex");
      const backupKey = deriveBackupKey(password, saltHex);

      exportData._meta.encryption = {
        kdf: "pbkdf2",
        digest: "sha256",
        iterations: 100_000,
        keyLengthBytes: 32,
        saltHex,
      };

      const reEncrypt = (encVal: string | null | undefined): string | null => {
        if (!encVal) return null;
        const plain = decrypt(encVal);
        if (!plain) return null;
        return encryptWithBackupKey(plain, backupKey);
      };

      exportData.integrations.googleServiceAccountKeyEnc = reEncrypt(proj.googleServiceAccountKeyEnc);
      exportData.integrations.telegramBotTokenEnc = reEncrypt(proj.telegramBotTokenEnc);
      exportData.integrations.driveOAuthClientSecretEnc = reEncrypt(proj.driveOAuthClientSecretEnc);
      exportData.integrations.driveOAuthRefreshTokenEnc = reEncrypt(proj.driveOAuthRefreshTokenEnc);
    }

    const safeName = (proj.name || "project")
      .replace(/[^a-zA-Z0-9\u0600-\u06FF_\- ]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const filename = `${safeName}_${mode}_${new Date().toISOString().split("T")[0]}.masarat`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.json(exportData);
  } catch (err: any) {
    handleError(res, err);
  }
});

/** Shared helper: parse + validate an uploaded .masarat file, optionally decrypt credentials */
async function parseImportFile(
  fileBuffer: Buffer,
  password?: string
): Promise<{
  parsed: z.infer<typeof importFileSchema>;
  decryptedCreds: {
    googleServiceAccountKey: string | null;
    telegramBotToken: string | null;
    driveOAuthClientSecret: string | null;
    driveOAuthRefreshToken: string | null;
  };
}> {
  let raw: unknown;
  try {
    raw = JSON.parse(fileBuffer.toString("utf8"));
  } catch {
    throw new Error("ملف غير صالح — تعذّر قراءة JSON");
  }

  const result = importFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`بنية الملف غير صحيحة: ${result.error.errors[0].message}`);
  }

  const parsed = result.data;
  const creds = { googleServiceAccountKey: null as string | null, telegramBotToken: null as string | null, driveOAuthClientSecret: null as string | null, driveOAuthRefreshToken: null as string | null };

  if (parsed._meta.mode === "backup" && parsed._meta.encryption) {
    if (!password) throw new Error("هذا الملف نسخة احتياطية مشفّرة — كلمة المرور مطلوبة");
    const enc = parsed._meta.encryption;
    let backupKey: Buffer;
    try {
      backupKey = deriveBackupKey(password, enc.saltHex);
    } catch {
      throw new Error("فشل اشتقاق مفتاح التشفير");
    }

    const tryDecrypt = (encVal: string | null | undefined): string | null => {
      if (!encVal) return null;
      try { return decryptWithBackupKey(encVal, backupKey); }
      catch { throw new Error("كلمة المرور غير صحيحة أو الملف تالف"); }
    };

    creds.googleServiceAccountKey = tryDecrypt(parsed.integrations?.googleServiceAccountKeyEnc);
    creds.telegramBotToken = tryDecrypt(parsed.integrations?.telegramBotTokenEnc);
    creds.driveOAuthClientSecret = tryDecrypt(parsed.integrations?.driveOAuthClientSecretEnc);
    creds.driveOAuthRefreshToken = tryDecrypt(parsed.integrations?.driveOAuthRefreshTokenEnc);
  }

  return { parsed, decryptedCreds: creds };
}

// ─── POST /import/preview — Validate file and return preview (no DB changes) ───
router.post("/import/preview", requireEditorOrAdmin, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "الملف مطلوب" });
    if (req.file.size > 10 * 1024 * 1024) return res.status(400).json({ error: "حجم الملف كبير جداً (الحد 10 MB)" });

    const password = req.body.password as string | undefined;
    const { parsed } = await parseImportFile(req.file.buffer, password);

    const integ = parsed.integrations || {};
    const warnings: string[] = [];

    if (integ.telegramChatId && !integ.telegramBotTokenEnc) {
      warnings.push("Telegram chat ID موجود لكن bot token غير مضمّن — أضفه من إعدادات المشروع بعد الاستيراد");
    }
    if ((integ.googleSheetId || integ.googleServiceAccountEmail) && !integ.googleServiceAccountKeyEnc) {
      warnings.push("إعدادات Google Sheets موجودة لكن Service Account Key غير مضمّن — أضفه من إعدادات المشروع بعد الاستيراد");
    }

    res.json({
      ok: true,
      preview: {
        projectName: parsed.project.name,
        mode: parsed._meta.mode,
        fieldCount: parsed.fields.length,
        steps: (parsed.project.steps as string[]) || [],
        hasCredentials: parsed._meta.mode === "backup",
        integrations: {
          googleSheets: !!(integ.googleSheetId || integ.googleServiceAccountEmail),
          telegram: !!(integ.telegramChatId),
          drive: !!(integ.googleDriveFolderId || integ.driveRootFolderId || integ.driveOAuthClientId),
        },
        warnings,
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "فشل التحقق من الملف" });
  }
});

// ─── POST /import — Create a new project from a .masarat file ───
router.post("/import", requireEditorOrAdmin, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "الملف مطلوب" });
    if (req.file.size > 10 * 1024 * 1024) return res.status(400).json({ error: "حجم الملف كبير جداً (الحد 10 MB)" });

    const password = req.body.password as string | undefined;
    const { parsed, decryptedCreds } = await parseImportFile(req.file.buffer, password);

    const { project: p, fields: rawFields, integrations: integ = {} } = parsed;
    const userId = (req.session as any).userId;

    // Build project insert
    const projectInsert: any = {
      name: p.name,
      description: p.description ?? null,
      formTitle: p.formTitle || p.name,
      formSubtitle: p.formSubtitle ?? null,
      invitationCode: p.invitationCode || (() => {
        const prefix = p.name.replace(/\s+/g, "-").toUpperCase().slice(0, 8);
        const suffix = randomBytes(3).toString("hex").toUpperCase();
        return `${prefix}-${suffix}`;
      })(),
      editTokenHours: p.editTokenHours ?? 48,
      formEnabled: p.formEnabled ?? true,
      formDisabledMessage: p.formDisabledMessage ?? null,
      steps: p.steps ?? ["البيانات الأساسية", "البيانات التفصيلية", "المراجعة"],
      createdBy: userId,
      // Non-sensitive integration settings
      googleSheetId: integ.googleSheetId ?? null,
      importSheetId: integ.importSheetId ?? null,
      googleSheetName: integ.googleSheetName ?? "بيانات",
      googleServiceAccountEmail: integ.googleServiceAccountEmail ?? null,
      googleDriveFolderId: integ.googleDriveFolderId ?? null,
      driveRootFolderId: integ.driveRootFolderId ?? null,
      driveSyncEnabled: integ.driveSyncEnabled ?? false,
      telegramChatId: integ.telegramChatId ?? null,
      driveOAuthClientId: integ.driveOAuthClientId ?? null,
    };

    // Re-encrypt sensitive credentials with this environment's key
    if (decryptedCreds.googleServiceAccountKey) {
      projectInsert.googleServiceAccountKeyEnc = encrypt(decryptedCreds.googleServiceAccountKey);
    }
    if (decryptedCreds.telegramBotToken) {
      projectInsert.telegramBotTokenEnc = encrypt(decryptedCreds.telegramBotToken);
    }
    if (decryptedCreds.driveOAuthClientSecret) {
      projectInsert.driveOAuthClientSecretEnc = encrypt(decryptedCreds.driveOAuthClientSecret);
    }
    if (decryptedCreds.driveOAuthRefreshToken) {
      projectInsert.driveOAuthRefreshTokenEnc = encrypt(decryptedCreds.driveOAuthRefreshToken);
    }

    // Atomic: create project + insert fields in a single transaction
    const newProj = await db.transaction(async (tx) => {
      const [proj] = await tx.insert(projects).values(projectInsert).returning();

      if (rawFields.length > 0) {
        const fieldRows = rawFields.map((f, idx) => ({
          projectId: proj.id,
          key: f.key,
          label: f.label,
          fieldType: f.fieldType || "text",
          isRequired: f.isRequired ?? false,
          isVisible: f.isVisible !== false,
          options: f.options ?? null,
          stepNumber: f.stepNumber ?? 1,
          orderIndex: f.orderIndex ?? idx,
          placeholder: f.placeholder ?? null,
          validationMin: f.validationMin ?? null,
          validationMax: f.validationMax ?? null,
          validationRegex: f.validationRegex ?? null,
          validationMessage: f.validationMessage ?? null,
          conditions: f.conditions ?? null,
          conditionOperator: (f.conditionOperator as "AND" | "OR") ?? "AND",
          visibleTo: (f.visibleTo as "all" | "admin" | "editor") ?? "all",
          isReadOnly: f.isReadOnly ?? false,
          isFullWidth: f.isFullWidth ?? false,
          allowedFileTypes: Array.isArray(f.allowedFileTypes) && f.allowedFileTypes.length > 0 ? f.allowedFileTypes : null,
          maxFileSizeMb: f.maxFileSizeMb ?? null,
        }));
        await tx.insert(projectFields).values(fieldRows);
      }

      return proj;
    });

    res.json({ ok: true, project: { id: newProj.id, name: newProj.name } });
  } catch (err: any) {
    // Known validation errors from parseImportFile throw with a user-facing message
    if (err.message && !err.code) return res.status(400).json({ error: err.message });
    handleError(res, err);
  }
});

export default router;
