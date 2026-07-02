import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { projects, projectFields, projectRecords, projectAuditLog } from "../../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { appendRecordToSheet, updateRecordRow } from "../services/projectSheets.js";
import { decrypt } from "../services/crypto.js";
import rateLimit from "express-rate-limit";

const router = Router();

const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "محاولات كثيرة — حاول بعد 15 دقيقة" } });

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
    res.status(500).json({ error: err.message });
  }
});

// POST verify invitation code
router.post("/:projectId/verify-code", verifyLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const { code } = req.body;
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
    res.status(500).json({ error: err.message });
  }
});

// POST submit form
router.post("/:projectId/submit", submitLimiter, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
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

    const [maxSeq] = await db.select({ max: sql<number>`COALESCE(MAX(sequential_number), 0)` })
      .from(projectRecords).where(eq(projectRecords.projectId, pid));
    const seqNum = (maxSeq?.max || 0) + 1;

    const [record] = await db.insert(projectRecords).values({
      projectId: pid,
      data: req.body,
      sequentialNumber: seqNum,
      tokenExpiresAt,
      submittedAt: new Date(),
    }).returning();

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: record.id,
      changedBy: "employee",
      action: "create",
      changesJson: req.body,
    });

    // Google Sheets (non-blocking)
    appendRecordToSheet(pid, record.data as any, seqNum).then(async (rowIndex) => {
      if (rowIndex) {
        await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, record.id));
      }
    }).catch(console.error);

    // Telegram notification (non-blocking)
    if (proj.telegramBotTokenEnc && proj.telegramChatId) {
      const sendTelegram = async () => {
        const token = decrypt(proj.telegramBotTokenEnc!);
        if (!token) return;
        const data = req.body as Record<string, any>;
        const preview = Object.entries(data).slice(0, 4).map(([, v]) => `• ${v}`).join("\n");
        const msg = `📋 *تسجيل جديد — ${proj.name}*\n\n${preview}\n\n🕒 ${new Date().toLocaleString("ar-SY", { timeZone: "Asia/Damascus" })}`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: proj.telegramChatId, text: msg, parse_mode: "Markdown" }),
        });
      };
      sendTelegram().catch(console.error);
    }

    (req.session as any)[`code_${pid}`] = false;
    res.json({ ok: true, editToken: record.editToken, recordId: record.id, tokenHours });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// PATCH update by edit token
router.patch("/:projectId/edit/:token", async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.projectId);
    const token = String(req.params.token);
    const [existing] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.projectId, pid), eq(projectRecords.editToken, token as any)));
    if (!existing) return res.status(404).json({ error: "الرابط غير صالح" });
    if (existing.tokenExpiresAt && existing.tokenExpiresAt < new Date()) {
      return res.status(410).json({ error: "انتهت صلاحية رابط التعديل" });
    }

    const [updated] = await db.update(projectRecords)
      .set({ data: req.body, updatedAt: new Date() })
      .where(eq(projectRecords.id, existing.id))
      .returning();

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: existing.id,
      changedBy: "employee",
      action: "update",
      changesJson: req.body,
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
