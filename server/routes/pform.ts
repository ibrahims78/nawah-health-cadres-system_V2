import { Router, Request, Response } from "express";
import { createHmac } from "crypto";
import { db } from "../db.js";
import { projects, projectFields, projectRecords, projectAuditLog, projectFormDrafts, projectParticipants, verifyCodeSchema, submitFormSchema } from "../../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { appendRecordToSheet, updateRecordRow } from "../services/projectSheets.js";
import { insertRecordAtomic } from "../services/recordInsert.js";
import { decrypt } from "../services/crypto.js";
import { sendParticipantConfirmationEmail } from "../services/email.js";
import rateLimit from "express-rate-limit";
import { fileUpload, publicFileUrl, validateMimeType, validateFieldRestrictions, organizeUploadedFile } from "../middleware/upload.js";
import { handleError } from "../utils/errorHandler.js";
import { storeChatForProject } from "../services/telegramChatCache.js";
import { validateAndSanitizeSubmission } from "../services/fieldValidation.js";
import { getTrustedBaseUrl } from "../utils/baseUrl.js";

const router = Router();

/**
 * Derives a stable Telegram webhook secret from SESSION_SECRET.
 * The result is a 64-char hex string — safe for Telegram's secret_token field.
 * Stable across restarts as long as SESSION_SECRET doesn't change.
 */
export function getTelegramWebhookSecret(): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update("telegram-webhook-v1")
    .digest("hex")
    .substring(0, 64);
}

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
    participantsEnabled: projects.participantsEnabled,
    participantAllowOpen: projects.participantAllowOpen,
  }).from(projects).where(eq(projects.id, pid));
  if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
  if (!proj.formEnabled) return res.status(403).json({ error: proj.formDisabledMessage || "النموذج متوقف مؤقتاً" });
  // إصلاح: عند تفعيل وضع الدعوات الحصرية، نسمح بالرفع للمشاركين الذين يحملون توكن صحيح
  // نستخدم query string (متاح قبل تشغيل multer) وليس req.body الذي يُعبَّأ بعد التحليل
  if (proj.participantsEnabled && !proj.participantAllowOpen) {
    const pToken = String(req.query.participantToken || "").trim();
    if (!pToken) {
      return res.status(403).json({ error: "التسجيل بالدعوة فقط — يرجى استخدام رابطك الشخصي" });
    }
    const [pRow] = await db.select({ id: projectParticipants.id })
      .from(projectParticipants)
      .where(and(eq(projectParticipants.token, pToken as any), eq(projectParticipants.projectId, pid)));
    if (!pRow) {
      return res.status(403).json({ error: "رابط المشارك غير صالح" });
    }
  }
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
      participantsEnabled: projects.participantsEnabled,
      participantAllowOpen: projects.participantAllowOpen,
    }).from(projects).where(eq(projects.id, pid));

    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    // إصلاح: نُرجع بيانات المشروع دائماً حتى عند التوقف (formEnabled: false)
    // حتى يتمكن العميل من عرض رسالة التوقف المخصصة بدلاً من رسالة الخطأ العامة
    if (!proj.formEnabled) {
      const { invitationCode, participantsEnabled, participantAllowOpen, ...safeProj } = proj;
      return res.json({ project: { ...safeProj, requiresCode: false }, fields: [] });
    }

    const fields = await db.select().from(projectFields)
      .where(and(eq(projectFields.projectId, pid), eq(projectFields.isVisible, true)))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    // إذا كانت ميزة المشاركين مفعّلة وكان التسجيل المفتوح مغلقاً،
    // نُرجع inviteOnly: true كإشارة للعميل — نُرجع الحقول كذلك حتى لا يتأثر نموذج التعديل
    const inviteOnly = !!(proj.participantsEnabled && !proj.participantAllowOpen);

    const { invitationCode, participantsEnabled, participantAllowOpen, ...safeProj } = proj;
    res.json({ project: { ...safeProj, requiresCode: !!(invitationCode?.trim()), inviteOnly }, fields });
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
      participantsEnabled: projects.participantsEnabled,
      participantAllowOpen: projects.participantAllowOpen,
    }).from(projects).where(eq(projects.id, pid));
    if (!projCheck) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!projCheck.formEnabled) {
      return res.status(403).json({ error: projCheck.formDisabledMessage || "النموذج متوقف مؤقتاً" });
    }
    // حظر التسجيل المفتوح عند تفعيل وضع الدعوات الحصرية
    if (projCheck.participantsEnabled && !projCheck.participantAllowOpen) {
      return res.status(403).json({ error: "التسجيل بالدعوة فقط — يرجى استخدام رابطك الشخصي" });
    }
    const needsCode = !!(projCheck?.invitationCode?.trim());
    if (needsCode && !(req.session as any)[`code_${pid}`]) {
      return res.status(401).json({ error: "يجب التحقق من رمز الدعوة أولاً" });
    }

    // Server-side enforcement of the same rules the public form applies client-side:
    // strict allowlist of defined field keys, auto-clearing of conditionally-hidden
    // fields, and required/email/min-max/regex validation — protects direct API calls.
    const validation = await validateAndSanitizeSubmission(pid, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const submittedData = validation.data;

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
    const record = await insertRecordAtomic(pid, submittedData, tokenExpiresAt, autoIncrementKeys);
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

    const validation = await validateAndSanitizeSubmission(pid, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    // Strip autoincrement + read-only fields — immutable after creation; restore from existing record
    const lockedFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(
        eq(projectFields.projectId, pid),
        sql`(${projectFields.fieldType} = 'autoincrement' OR ${projectFields.isReadOnly} = TRUE)`,
      ));
    const safeBody: Record<string, any> = { ...validation.data };
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

// ═══════════════════════════════════════════════════════════
// PARTICIPANT TOKEN ROUTES
// ═══════════════════════════════════════════════════════════

// GET participant form info via personal token
router.get("/:projectId/p/:token", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);

    const [proj] = await db.select({
      id: projects.id,
      name: projects.name,
      formTitle: projects.formTitle,
      formSubtitle: projects.formSubtitle,
      formEnabled: projects.formEnabled,
      formDisabledMessage: projects.formDisabledMessage,
      steps: projects.steps,
      participantsEnabled: projects.participantsEnabled,
      participantAllowOpen: projects.participantAllowOpen,
      participantEditHours: projects.participantEditHours,
      participantNameField: projects.participantNameField,
      telegramBotTokenEnc: projects.telegramBotTokenEnc,
    }).from(projects).where(eq(projects.id, pid));

    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!proj.formEnabled) return res.status(403).json({ error: proj.formDisabledMessage || "النموذج متوقف مؤقتاً" });
    // إصلاح: التحقق من تفعيل ميزة المشاركين قبل السماح بالوصول عبر رابط المشارك الشخصي
    if (!proj.participantsEnabled) return res.status(403).json({ error: "هذا الرابط غير متاح حالياً — تواصل مع المسؤول" });

    const [participant] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.token, token as any), eq(projectParticipants.projectId, pid)));

    if (!participant) {
      // Token not found — check if open form is allowed
      if (!proj.participantAllowOpen) {
        return res.status(403).json({ error: "هذا النموذج مخصص للمدعوين فقط" });
      }
      // Open registration — return regular form without participant features
      const fields = await db.select().from(projectFields)
        .where(and(eq(projectFields.projectId, pid), eq(projectFields.isVisible, true)))
        .orderBy(projectFields.stepNumber, projectFields.orderIndex);
      return res.json({ project: { id: proj.id, name: proj.name, formTitle: proj.formTitle, formSubtitle: proj.formSubtitle, steps: proj.steps }, fields, participant: null, canSubmit: true, canEdit: false });
    }

    // Set firstOpenedAt on first visit
    if (!participant.firstOpenedAt) {
      await db.update(projectParticipants)
        .set({ firstOpenedAt: new Date() })
        .where(eq(projectParticipants.id, participant.id));
    }

    const editHours = proj.participantEditHours ?? 48;
    const now = new Date();
    const editDeadline = participant.submittedAt
      ? new Date(participant.submittedAt.getTime() + editHours * 60 * 60 * 1000)
      : null;

    const canSubmit = !participant.submittedAt;
    const canEdit = !!participant.submittedAt && editDeadline !== null && now < editDeadline;

    if (participant.submittedAt && !canEdit) {
      // Locked — show thank-you only (no form data)
      return res.json({
        project: { id: proj.id, name: proj.name, formTitle: proj.formTitle, formSubtitle: proj.formSubtitle, steps: proj.steps },
        fields: [],
        participant: { id: participant.id, name: participant.name, telegramChatId: participant.telegramChatId },
        canSubmit: false,
        canEdit: false,
        locked: true,
      });
    }

    const fields = await db.select().from(projectFields)
      .where(and(eq(projectFields.projectId, pid), eq(projectFields.isVisible, true)))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    // Determine bot username for activation link
    let botUsername: string | null = null;
    if (proj.telegramBotTokenEnc && !participant.telegramChatId) {
      try {
        const botTok = decrypt(proj.telegramBotTokenEnc);
        if (botTok) {
          const r = await fetch(`https://api.telegram.org/bot${botTok}/getMe`, { signal: AbortSignal.timeout(5000) });
          const d = await r.json() as any;
          if (d.ok && d.result?.username) botUsername = d.result.username;
        }
      } catch { /* non-blocking */ }
    }

    // Prefill: if submitted + in edit window → use actual record data; else use prefill_data
    let prefillData: Record<string, any> = (participant.prefillData as any) || {};
    if (canEdit && participant.recordId) {
      const [rec] = await db.select({ data: projectRecords.data }).from(projectRecords)
        .where(eq(projectRecords.id, participant.recordId));
      if (rec?.data) prefillData = rec.data as any;
    }

    // إصلاح: تطبيق participantNameField — إذا حدّد المسؤول حقل الاسم، نملأه تلقائياً من اسم المشارك
    if (proj.participantNameField && participant.name) {
      prefillData = { ...prefillData, [proj.participantNameField]: participant.name };
    }

    res.json({
      project: { id: proj.id, name: proj.name, formTitle: proj.formTitle, formSubtitle: proj.formSubtitle, steps: proj.steps },
      fields,
      participant: { id: participant.id, name: participant.name, token: participant.token, telegramChatId: participant.telegramChatId },
      prefillData,
      canSubmit,
      canEdit,
      botUsername,
      editDeadline: editDeadline?.toISOString() ?? null,
    });
  } catch (err: any) { handleError(res, err); }
});

// POST submit participant form
router.post("/:projectId/p/:token/submit", submitLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);

    const [proj] = await db.select({
      name: projects.name,
      formEnabled: projects.formEnabled,
      formDisabledMessage: projects.formDisabledMessage,
      editTokenHours: projects.editTokenHours,
      participantEditHours: projects.participantEditHours,
      participantsEnabled: projects.participantsEnabled,
      telegramBotTokenEnc: projects.telegramBotTokenEnc,
      telegramChatId: projects.telegramChatId,
      confirmationEmailEnabled: projects.confirmationEmailEnabled,
    }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!proj.formEnabled) return res.status(403).json({ error: proj.formDisabledMessage || "النموذج متوقف مؤقتاً" });
    if (!proj.participantsEnabled) return res.status(403).json({ error: "هذا الرابط غير متاح حالياً — تواصل مع المسؤول" });

    const [participant] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.token, token as any), eq(projectParticipants.projectId, pid)));
    if (!participant) return res.status(404).json({ error: "رابط غير صالح" });
    if (participant.submittedAt) return res.status(409).json({ error: "سبق تعبئة النموذج — استخدم رابط التعديل" });

    const parsed = submitFormSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const validation = await validateAndSanitizeSubmission(pid, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const editHours = proj.participantEditHours ?? proj.editTokenHours ?? 48;
    const tokenExpiresAt = new Date(Date.now() + editHours * 60 * 60 * 1000);

    const autoFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`${projectFields.fieldType} = 'autoincrement'`));
    const autoIncrementKeys = autoFields.map(f => f.key);

    // إصلاح: ربط المشارك بالسجل داخل نفس الـ transaction لمنع سجلات يتيمة
    // إذا فشل تحديث المشارك، يُلغى إدخال السجل تلقائياً
    const record = await insertRecordAtomic(pid, validation.data, tokenExpiresAt, autoIncrementKeys,
      async (client, recordId) => {
        const { rowCount } = await client.query(
          `UPDATE project_participants SET record_id = $1, submitted_at = NOW() WHERE id = $2`,
          [recordId, participant.id]
        );
        // إذا لم يُحدَّث أي صف (حُذف المشارك بين القراءة والإدراج)، نُلغي العملية
        if (!rowCount || rowCount < 1) {
          throw new Error("لم يُعثر على المشارك أثناء التسجيل — يرجى المحاولة مرة أخرى");
        }
      }
    );
    const seqNum = record.sequential_number;
    const finalData = record.enriched_data;

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: record.id,
      changedBy: `participant:${participant.id}`,
      action: "create",
      changesJson: finalData,
    });

    appendRecordToSheet(pid, finalData as any, seqNum).then(async (rowIndex) => {
      if (rowIndex) await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, record.id));
    }).catch(console.error);

    // ── Confirmation email to participant (non-blocking) ──────────────────
    if (
      proj.confirmationEmailEnabled !== false &&
      participant.identifierType === "email" &&
      participant.identifier
    ) {
      const baseUrlForEmail = getTrustedBaseUrl(req);
      if (baseUrlForEmail) {
        const editLink = `${baseUrlForEmail}/p/${pid}/p/${token}`;
        sendParticipantConfirmationEmail({
          to: participant.identifier,
          participantName: participant.name,
          projectName: proj.name,
          editLink,
          editDeadlineIso: tokenExpiresAt.toISOString(),
        }).catch(console.error);
      } else {
        console.error(`[pform] تخطّي إرسال بريد التأكيد للمشارك ${participant.id} — تعذّر تحديد رابط أساسي موثوق (اضبط APP_URL).`);
      }
    }

    // Telegram notification to admin chat (non-blocking)
    if (proj.telegramBotTokenEnc && proj.telegramChatId) {
      const sendTelegram = async () => {
        const tok = decrypt(proj.telegramBotTokenEnc!);
        if (!tok) return;
        const fieldDefs = await db.select({ key: projectFields.key, label: projectFields.label }).from(projectFields).where(eq(projectFields.projectId, pid));
        const labelMap = Object.fromEntries(fieldDefs.map(f => [f.key, f.label]));
        const data = finalData as Record<string, any>;
        const escape = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").map(([k, v]) => `<b>${escape(labelMap[k] || k)}:</b> ${escape(String(v))}`).join("\n");
        const now = new Date().toLocaleString("ar-SY", { timeZone: "Asia/Damascus", dateStyle: "full", timeStyle: "medium" });
        const lines = [`🔔 <b>تسجيل جديد</b>`, `📁 المشروع: <b>${escape(proj.name)}</b>`, `👤 المشارك: <b>${escape(participant.name)}</b>`];
        if (seqNum) lines.push(`🔢 رقم السجل: <b>${seqNum}</b>`);
        if (rows) { lines.push(``); lines.push(rows); }
        lines.push(``); lines.push(`🕒 ${now}`);
        await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: proj.telegramChatId, text: lines.join("\n"), parse_mode: "HTML" }) });
      };
      sendTelegram().catch(console.error);
    }

    res.json({ ok: true, recordId: record.id, editDeadline: tokenExpiresAt.toISOString() });
  } catch (err: any) { handleError(res, err); }
});

// PATCH edit participant form
router.patch("/:projectId/p/:token/edit", submitLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);

    const [participant] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.token, token as any), eq(projectParticipants.projectId, pid)));
    if (!participant) return res.status(404).json({ error: "رابط غير صالح" });
    if (!participant.submittedAt) return res.status(400).json({ error: "لم يتم التسجيل بعد" });

    const [proj] = await db.select({ participantEditHours: projects.participantEditHours, formEnabled: projects.formEnabled, participantsEnabled: projects.participantsEnabled }).from(projects).where(eq(projects.id, pid));
    if (!proj?.formEnabled) return res.status(403).json({ error: "النموذج متوقف مؤقتاً" });
    if (!proj?.participantsEnabled) return res.status(403).json({ error: "هذا الرابط غير متاح حالياً — تواصل مع المسؤول" });

    const editHours = proj.participantEditHours ?? 48;
    const editDeadline = new Date(participant.submittedAt.getTime() + editHours * 60 * 60 * 1000);
    if (new Date() >= editDeadline) return res.status(410).json({ error: "انتهت فترة التعديل" });

    if (!participant.recordId) return res.status(400).json({ error: "لا يوجد سجل مرتبط" });

    const [existing] = await db.select().from(projectRecords).where(eq(projectRecords.id, participant.recordId));
    if (!existing) return res.status(404).json({ error: "السجل غير موجود" });

    const parsed = submitFormSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const validation = await validateAndSanitizeSubmission(pid, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    // Strip autoincrement + read-only fields
    const lockedFields = await db.select({ key: projectFields.key }).from(projectFields)
      .where(and(eq(projectFields.projectId, pid), sql`(${projectFields.fieldType} = 'autoincrement' OR ${projectFields.isReadOnly} = TRUE)`));
    const safeBody: Record<string, any> = { ...validation.data };
    for (const { key } of lockedFields) {
      if (key in (existing.data as any)) safeBody[key] = (existing.data as any)[key];
      else delete safeBody[key];
    }

    const [updated] = await db.update(projectRecords).set({ data: safeBody, updatedAt: new Date() }).where(eq(projectRecords.id, existing.id)).returning();

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: existing.id,
      changedBy: `participant:${participant.id}`,
      action: "update",
      changesJson: safeBody,
    });

    if (updated.sheetsRowIndex) {
      updateRecordRow(pid, updated.sheetsRowIndex, updated.data as any, updated.sequentialNumber || 0).catch(console.error);
    } else {
      appendRecordToSheet(pid, updated.data as any, updated.sequentialNumber || 0).then(async (rowIndex) => {
        if (rowIndex) await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, updated.id));
      }).catch(console.error);
    }

    res.json({ ok: true });
  } catch (err: any) { handleError(res, err); }
});

// POST Telegram webhook — links participant token to chat_id via /start {token}
router.post("/telegram-webhook", async (req: Request, res: Response) => {
  try {
    // إصلاح أمني: التحقق من هوية الطلب عبر X-Telegram-Bot-Api-Secret-Token
    // يمنع أي جهة خارجية من إرسال تحديثات مزيفة وربط chat_id بمشاركين آخرين
    const expectedSecret = getTelegramWebhookSecret();
    const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (receivedSecret !== expectedSecret) {
      // نُرجع 200 دائماً حتى لا يُكشف للمهاجم أن الطلب رُفض
      return res.json({ ok: true });
    }

    const update = req.body;
    const message = update?.message;
    // Require chat.id; text is optional (stickers, photos, etc. still carry chat info)
    if (!message?.chat?.id) return res.json({ ok: true });

    const chatId = String(message.chat.id);
    const text: string = (message.text || "").trim();

    // Handle /start {token} — only for text messages
    if (text.startsWith("/start ")) {
      const token = text.slice(7).trim();
      if (!token) return res.json({ ok: true });

      // Find participant by token
      const [participant] = await db.select({
        id: projectParticipants.id,
        name: projectParticipants.name,
        projectId: projectParticipants.projectId,
        telegramChatId: projectParticipants.telegramChatId,
        submittedAt: projectParticipants.submittedAt,
      }).from(projectParticipants).where(eq(projectParticipants.token, token as any));

      if (!participant) return res.json({ ok: true });

      // Cache this chat scoped to the project — used by "جلب Chat ID" in admin settings
      storeChatForProject(participant.projectId, chatId, message.chat);

      // Get project bot token for all responses
      const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc, name: projects.name })
        .from(projects).where(eq(projects.id, participant.projectId));

      const baseUrl = getTrustedBaseUrl(req);
      const formLink = baseUrl ? `${baseUrl}/p/${participant.projectId}/p/${token}` : null;

      if (proj?.telegramBotTokenEnc) {
        const botToken = decrypt(proj.telegramBotTokenEnc);
        if (botToken) {
          let replyText: string;

          // ── ربط chat_id دائماً إذا لم يكن مضبوطاً بعد ────────────────
          if (!participant.telegramChatId) {
            await db.update(projectParticipants)
              .set({ telegramChatId: chatId })
              .where(eq(projectParticipants.id, participant.id));
          }

          if (participant.submittedAt) {
            // ── الحالة: المشارك سبق له التسجيل ─────────────────────
            replyText = formLink
              ? `✅ <b>أنت مسجَّل بالفعل!</b>\n\nأهلاً <b>${participant.name}</b> — تسجيلك في <b>${proj.name}</b> مكتمل.\n\n✏️ <a href="${formLink}">اضغط هنا إذا أردت تعديل بياناتك</a>`
              : `✅ <b>أنت مسجَّل بالفعل!</b>\n\nأهلاً <b>${participant.name}</b> — تسجيلك في <b>${proj.name}</b> مكتمل.`;
          } else if (participant.telegramChatId && participant.telegramChatId === chatId) {
            // ── الحالة: إعادة تفعيل البوت (كان مرتبطاً من قبل) ────────
            replyText = formLink
              ? `🔗 <b>مرحباً مجدداً ${participant.name}!</b>\n\nما زلت مرتبطاً بالبوت — ستصلك الإشعارات هنا.\n\n📋 <a href="${formLink}">اضغط هنا لاستكمال التسجيل في ${proj.name}</a>`
              : `🔗 <b>مرحباً مجدداً ${participant.name}!</b>\n\nما زلت مرتبطاً بالبوت — ستصلك الإشعارات هنا.`;
          } else {
            // ── الحالة: تفعيل جديد ────────────────────────────────────
            replyText = formLink
              ? `✅ <b>تم التفعيل بنجاح!</b>\n\nأهلاً <b>${participant.name}</b> — ستصلك الإشعارات والتذكيرات هنا.\n\n🔗 <a href="${formLink}">اضغط هنا لفتح النموذج وتعبئة بياناتك</a>`
              : `✅ <b>تم التفعيل بنجاح!</b>\n\nأهلاً <b>${participant.name}</b> — ستصلك الإشعارات والتذكيرات هنا.`;
          }

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: replyText,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
          }).catch(console.error);
        }
      } else if (!participant.submittedAt) {
        // No bot token configured — still link the chat_id silently
        await db.update(projectParticipants)
          .set({ telegramChatId: chatId })
          .where(eq(projectParticipants.id, participant.id));
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[telegram-webhook]", err);
    res.json({ ok: true }); // Always 200 to Telegram
  }
});

export default router;
