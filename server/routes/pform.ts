import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { projects, projectFields, projectRecords, projectAuditLog, projectFormDrafts, verifyCodeSchema, submitFormSchema } from "../../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { appendRecordToSheet, updateRecordRow } from "../services/projectSheets.js";
import { insertRecordAtomic } from "../services/recordInsert.js";
import { decrypt } from "../services/crypto.js";
import rateLimit from "express-rate-limit";
import { fileUpload, publicFileUrl, validateMimeType, validateFieldRestrictions, organizeUploadedFile } from "../middleware/upload.js";
import { handleError } from "../utils/errorHandler.js";

const router = Router();

const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "محاولات كثيرة — حاول بعد 15 دقيقة" } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: "محاولات كثيرة — حاول لاحقاً" } });

// POST upload a file for a public registration form field
router.post("/:projectId/upload", uploadLimiter, async (req: Request, res: Response) => {
  const pid = String(req.params.projectId);
  const [proj] = await db.select({
    name: projects.name,
    formEnabled: projects.formEnabled,
    formDisabledMessage: projects.formDisabledMessage,
    invitationCode: projects.invitationCode,
  }).from(projects).where(eq(projects.id, pid));
  if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
  if (!proj.formEnabled) return res.status(403).json({ error: proj.formDisabledMessage || "النموذج متوقف مؤقتاً" });
  // Gate upload behind invitation-code verification (same check as submit)
  const needsCode = !!(proj.invitationCode?.trim());
  if (needsCode && !(req.session as any)[`code_${pid}`]) {
    return res.status(401).json({ error: "يجب التحقق من رمز الدعوة أولاً" });
  }

  fileUpload.single("file")(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message || "فشل رفع الملف" });
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    // Build the final response — organise into subfolders if uploadFolder provided
    const buildResponse = () => {
      const uploadFolder = String(req.body.uploadFolder || "").trim();
      if (uploadFolder && proj.name) {
        try {
          const relPath = organizeUploadedFile(req.file!.filename, proj.name, uploadFolder);
          return res.json({ url: `/uploads/${relPath}`, originalName: req.file!.originalname });
        } catch {
          // Fall through to flat path on error
        }
      }
      res.json({ url: publicFileUrl(req.file!.filename), originalName: req.file!.originalname });
    };

    // M-04: Validate magic-bytes MIME type after upload to prevent extension spoofing
    await validateMimeType(req, res, async () => {
      // Per-field type/size restrictions
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
      buildResponse();
    });
  });
});

// GET project form info (public)
router.get("/:projectId/info", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const [proj] = await db.select({
      id: projects.id,
      name: projects.name,
      formTitle: projects.formTitle,
      formSubtitle: projects.formSubtitle,
      formEnabled: projects.formEnabled,
      formDisabledMessage: projects.formDisabledMessage,
      steps: projects.steps,
      invitationCode: projects.invitationCode,
    }).from(projects).where(eq(projects.id, pid));

    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const fields = await db.select().from(projectFields)
      .where(and(eq(projectFields.projectId, pid), eq(projectFields.isVisible, true)))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    const { invitationCode, ...safeProj } = proj;
    res.json({ project: { ...safeProj, requiresCode: !!(invitationCode?.trim()) }, fields });
  } catch (err: any) {
    handleError(res, err);
  }
});

// POST verify invitation code
router.post("/:projectId/verify-code", verifyLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const parsed = verifyCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { code } = parsed.data;
    const [proj] = await db.select({
      invitationCode: projects.invitationCode,
      formEnabled: projects.formEnabled,
      formDisabledMessage: projects.formDisabledMessage,
    }).from(projects).where(eq(projects.id, pid));

    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!proj.formEnabled) return res.status(403).json({ error: proj.formDisabledMessage || "النموذج متوقف مؤقتاً" });
    if (proj.invitationCode?.trim() && code?.trim() !== proj.invitationCode) {
      return res.status(401).json({ error: "رمز الدعوة غير صحيح" });
    }

    (req.session as any)[`code_${pid}`] = true;
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// POST submit form
router.post("/:projectId/submit", submitLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const parsed = submitFormSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const [projCheck] = await db.select({
      invitationCode: projects.invitationCode,
      formEnabled: projects.formEnabled,
      formDisabledMessage: projects.formDisabledMessage,
    }).from(projects).where(eq(projects.id, pid));
    if (!projCheck) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!projCheck.formEnabled) {
      return res.status(403).json({ error: projCheck.formDisabledMessage || "النموذج متوقف مؤقتاً" });
    }
    const needsCode = !!(projCheck?.invitationCode?.trim());
    if (needsCode && !(req.session as any)[`code_${pid}`]) {
      return res.status(401).json({ error: "يجب التحقق من رمز الدعوة أولاً" });
    }

    const [proj] = await db.select({
      editTokenHours: projects.editTokenHours,
      name: projects.name,
      telegramBotTokenEnc: projects.telegramBotTokenEnc,
      telegramChatId: projects.telegramChatId,
    }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const tokenHours = proj.editTokenHours ?? 48;
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
      changedBy: "employee",
      action: "create",
      changesJson: finalData,
    });

    // Google Sheets (non-blocking)
    appendRecordToSheet(pid, finalData as any, seqNum).then(async (rowIndex) => {
      if (rowIndex) {
        await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, record.id));
      }
    }).catch(console.error);

    // Telegram notification (non-blocking)
    if (proj.telegramBotTokenEnc && proj.telegramChatId) {
      const sendTelegram = async () => {
        const token = decrypt(proj.telegramBotTokenEnc!);
        if (!token) return;

        // Fetch field labels for human-readable output
        const fieldDefs = await db
          .select({ key: projectFields.key, label: projectFields.label })
          .from(projectFields)
          .where(eq(projectFields.projectId, pid));
        const labelMap = Object.fromEntries(fieldDefs.map(f => [f.key, f.label]));

        const data = finalData as Record<string, any>;
        const escape = (s: string) =>
          String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const rows = Object.entries(data)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
          .map(([k, v]) => {
            const label = escape(labelMap[k] || k);
            const val   = escape(String(v));
            return `<b>${label}:</b> ${val}`;
          })
          .join("\n");

        const now = new Date().toLocaleString("ar-SY", {
          timeZone: "Asia/Damascus",
          dateStyle: "full",
          timeStyle: "medium",
        });

        const lines: string[] = [
          `🔔 <b>تسجيل جديد</b>`,
          `📁 المشروع: <b>${escape(proj.name)}</b>`,
        ];
        if (seqNum) lines.push(`🔢 رقم السجل: <b>${seqNum}</b>`);
        if (rows) {
          lines.push(``);
          lines.push(rows);
        }
        lines.push(``);
        lines.push(`🕒 ${now}`);

        const msg = lines.join("\n");

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: proj.telegramChatId, text: msg, parse_mode: "HTML" }),
        });
      };
      sendTelegram().catch(console.error);
    }

    (req.session as any)[`code_${pid}`] = false;
    res.json({ ok: true, editToken: record.edit_token, recordId: record.id, tokenHours });
  } catch (err: any) {
    handleError(res, err);
  }
});

// GET record by edit token
router.get("/:projectId/edit/:token", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);
    const [record] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.projectId, pid), eq(projectRecords.editToken, token as any)));
    if (!record) return res.status(404).json({ error: "الرابط غير صالح" });
    if (record.tokenExpiresAt && record.tokenExpiresAt < new Date()) {
      return res.status(410).json({ error: "انتهت صلاحية رابط التعديل" });
    }
    res.json(record);
  } catch (err: any) {
    handleError(res, err);
  }
});

// PATCH update by edit token
router.patch("/:projectId/edit/:token", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);
    const parsed = submitFormSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const [existing] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.projectId, pid), eq(projectRecords.editToken, token as any)));
    if (!existing) return res.status(404).json({ error: "الرابط غير صالح" });
    if (existing.tokenExpiresAt && existing.tokenExpiresAt < new Date()) {
      return res.status(410).json({ error: "انتهت صلاحية رابط التعديل" });
    }

    // Strip autoincrement + read-only fields — immutable after creation; restore from existing record
    const lockedFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(
        eq(projectFields.projectId, pid),
        sql`(${projectFields.fieldType} = 'autoincrement' OR ${projectFields.isReadOnly} = TRUE)`,
      ));
    const safeBody: Record<string, any> = { ...req.body };
    for (const { key } of lockedFields) {
      if (key in (existing.data as any)) {
        safeBody[key] = (existing.data as any)[key];
      } else {
        delete safeBody[key];
      }
    }

    const [updated] = await db.update(projectRecords)
      .set({ data: safeBody, updatedAt: new Date() })
      .where(eq(projectRecords.id, existing.id))
      .returning();

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: existing.id,
      changedBy: "employee",
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

// GET a saved draft (server-backed autosave)
router.get("/:projectId/draft/:draftId", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const draftId = String(req.params.draftId);
    const [draft] = await db.select().from(projectFormDrafts)
      .where(and(eq(projectFormDrafts.projectId, pid), eq(projectFormDrafts.draftId, draftId)));
    if (!draft) return res.json({ draft: null });
    // Expire drafts older than 7 days
    const ageMs = Date.now() - new Date(draft.updatedAt as any).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      await db.delete(projectFormDrafts).where(eq(projectFormDrafts.id, draft.id));
      return res.json({ draft: null });
    }
    res.json({ draft: { data: draft.data, step: draft.step } });
  } catch (err: any) {
    handleError(res, err);
  }
});

// PUT upsert a draft (server-backed autosave)
router.put("/:projectId/draft/:draftId", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const draftId = String(req.params.draftId);
    const { data, step } = req.body || {};
    const [proj] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const [existing] = await db.select({ id: projectFormDrafts.id }).from(projectFormDrafts)
      .where(and(eq(projectFormDrafts.projectId, pid), eq(projectFormDrafts.draftId, draftId)));

    if (existing) {
      await db.update(projectFormDrafts)
        .set({ data: data || {}, step: step ?? 0, updatedAt: new Date() })
        .where(eq(projectFormDrafts.id, existing.id));
    } else {
      await db.insert(projectFormDrafts).values({
        projectId: pid, draftId, data: data || {}, step: step ?? 0,
      });
    }
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

// DELETE a draft (after successful submission)
router.delete("/:projectId/draft/:draftId", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const draftId = String(req.params.draftId);
    await db.delete(projectFormDrafts)
      .where(and(eq(projectFormDrafts.projectId, pid), eq(projectFormDrafts.draftId, draftId)));
    res.json({ ok: true });
  } catch (err: any) {
    handleError(res, err);
  }
});

export default router;
