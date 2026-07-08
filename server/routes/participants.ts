import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import {
  projects, projectParticipants, projectRecords, projectFields,
  insertParticipantSchema, updateParticipantSchema,
} from "../../shared/schema.js";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { handleError } from "../utils/errorHandler.js";
import { decrypt } from "../services/crypto.js";
import { notifyParticipant, getBotUsername } from "../services/telegram.js";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Access Guards (copied pattern from projects.ts) ─────────
import { projectCollaborators } from "../../shared/schema.js";

async function requireParticipantEditAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  } catch (err: any) { handleError(res, err); }
}

async function requireParticipantReadAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  } catch (err: any) { handleError(res, err); }
}

// ─── Helper: compute participant status ──────────────────────
function getStatus(p: {
  firstOpenedAt: Date | null;
  submittedAt: Date | null;
  participantEditHours: number;
}): "unopened" | "opened" | "submitted_editable" | "submitted_locked" {
  if (!p.submittedAt && !p.firstOpenedAt) return "unopened";
  if (!p.submittedAt && p.firstOpenedAt) return "opened";
  const editDeadline = new Date(p.submittedAt!.getTime() + p.participantEditHours * 60 * 60 * 1000);
  if (new Date() < editDeadline) return "submitted_editable";
  return "submitted_locked";
}

// ─── GET /api/projects/:id/participants ──────────────────────
router.get("/", requireAuth, requireParticipantReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({
      participantEditHours: projects.participantEditHours,
      telegramBotTokenEnc: projects.telegramBotTokenEnc,
    }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const editHours = proj.participantEditHours ?? 48;
    const list = await db.select().from(projectParticipants)
      .where(eq(projectParticipants.projectId, pid))
      .orderBy(desc(projectParticipants.addedAt));

    const result = list.map(p => ({
      ...p,
      status: getStatus({ firstOpenedAt: p.firstOpenedAt, submittedAt: p.submittedAt, participantEditHours: editHours }),
      participantLink: `/p/${pid}/p/${p.token}`,
    }));

    res.json(result);
  } catch (err: any) { handleError(res, err); }
});

// ─── GET /api/projects/:id/participants/stats ────────────────
router.get("/stats", requireAuth, requireParticipantReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ participantEditHours: projects.participantEditHours }).from(projects).where(eq(projects.id, pid));
    const editHours = proj?.participantEditHours ?? 48;

    const list = await db.select({
      submittedAt: projectParticipants.submittedAt,
      firstOpenedAt: projectParticipants.firstOpenedAt,
      telegramChatId: projectParticipants.telegramChatId,
    }).from(projectParticipants).where(eq(projectParticipants.projectId, pid));

    const now = new Date();
    let unopened = 0, opened = 0, submittedEditable = 0, submittedLocked = 0, withTelegram = 0;
    for (const p of list) {
      const st = getStatus({ firstOpenedAt: p.firstOpenedAt, submittedAt: p.submittedAt, participantEditHours: editHours });
      if (st === "unopened") unopened++;
      else if (st === "opened") opened++;
      else if (st === "submitted_editable") submittedEditable++;
      else submittedLocked++;
      if (p.telegramChatId) withTelegram++;
    }
    res.json({
      total: list.length,
      unopened,
      opened,
      submittedEditable,
      submittedLocked,
      submitted: submittedEditable + submittedLocked,
      withTelegram,
    });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants ─────────────────────
router.post("/", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const parsed = insertParticipantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { name, identifier, identifierType, prefillData, notes } = parsed.data;

    const [p] = await db.insert(projectParticipants).values({
      projectId: pid,
      name,
      identifier: identifier || null,
      identifierType: identifierType || "email",
      prefillData: prefillData || {},
      notes: notes || null,
    }).returning();

    res.json({ ok: true, participant: { ...p, status: "unopened", participantLink: `/p/${pid}/p/${p.token}` } });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/import ──────────────
router.post("/import", requireAuth, requireParticipantEditAccess, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع ملف" });

    // Get project fields for prefill mapping
    const fields = await db.select({ key: projectFields.key, label: projectFields.label })
      .from(projectFields).where(eq(projectFields.projectId, pid));
    const fieldByLabel = Object.fromEntries(fields.map(f => [f.label.trim().toLowerCase(), f.key]));

    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(req.file.buffer);
    await workbook.xlsx.read(stream as any);
    const ws = workbook.worksheets[0];
    if (!ws) return res.status(400).json({ error: "لم يتم العثور على ورقة بيانات في الملف" });

    // Parse header row
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNum) => {
      headers[colNum - 1] = String(cell.value || "").trim();
    });

    if (headers.length === 0) return res.status(400).json({ error: "الملف لا يحتوي على رأسيات" });

    // Identify name and identifier columns (case-insensitive)
    const nameColIdx = headers.findIndex(h => ["name", "الاسم", "اسم", "full name", "الاسم الكامل"].includes(h.toLowerCase()));
    const identifierColIdx = headers.findIndex(h => ["identifier", "email", "البريد", "البريد الإلكتروني", "phone", "الهاتف", "رقم الهاتف", "national_id", "رقم الهوية"].includes(h.toLowerCase()));

    const rows: ExcelJS.Row[] = [];
    ws.eachRow((row, rowNum) => { if (rowNum > 1) rows.push(row); });

    const IMPORT_LIMIT = 200;
    if (rows.length > IMPORT_LIMIT) {
      return res.status(400).json({ error: `الحد الأقصى للاستيراد ${IMPORT_LIMIT} مشارك في المرة الواحدة` });
    }

    const overwrite = req.body.overwriteDuplicates === "true" || req.body.overwriteDuplicates === true;
    let added = 0, updated = 0, skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const getCellVal = (idx: number): string => {
        if (idx < 0) return "";
        const cell = row.getCell(idx + 1);
        return String(cell.value ?? "").trim();
      };

      const name = nameColIdx >= 0 ? getCellVal(nameColIdx) : getCellVal(0);
      if (!name) { errors.push(`السطر ${rowNum}: الاسم مطلوب`); skipped++; continue; }

      const identifier = identifierColIdx >= 0 ? getCellVal(identifierColIdx) : "";

      // Build prefill data from other columns
      const prefillData: Record<string, any> = {};
      headers.forEach((h, idx) => {
        if (idx === nameColIdx || idx === identifierColIdx) return;
        const fieldKey = fieldByLabel[h.toLowerCase()] || h;
        const val = getCellVal(idx);
        if (val) prefillData[fieldKey] = val;
      });

      // Check for duplicates by name + identifier
      const existing = identifier
        ? await db.select({ id: projectParticipants.id, token: projectParticipants.token })
            .from(projectParticipants)
            .where(and(
              eq(projectParticipants.projectId, pid),
              sql`LOWER(${projectParticipants.identifier}) = LOWER(${identifier})`,
            ))
        : await db.select({ id: projectParticipants.id, token: projectParticipants.token })
            .from(projectParticipants)
            .where(and(
              eq(projectParticipants.projectId, pid),
              sql`LOWER(${projectParticipants.name}) = LOWER(${name})`,
            ));

      if (existing.length > 0) {
        if (overwrite) {
          await db.update(projectParticipants)
            .set({ name, prefillData })
            .where(eq(projectParticipants.id, existing[0].id));
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      await db.insert(projectParticipants).values({
        projectId: pid,
        name,
        identifier: identifier || null,
        prefillData,
      });
      added++;
    }

    res.json({ ok: true, added, updated, skipped, errors: errors.slice(0, 20) });
  } catch (err: any) { handleError(res, err); }
});

// ─── GET /api/projects/:id/participants/export ───────────────
router.get("/export", requireAuth, requireParticipantReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ name: projects.name, participantEditHours: projects.participantEditHours })
      .from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const editHours = proj.participantEditHours ?? 48;
    const list = await db.select().from(projectParticipants)
      .where(eq(projectParticipants.projectId, pid))
      .orderBy(desc(projectParticipants.addedAt));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("المشاركون");

    const statusLabel = (s: string) => {
      if (s === "unopened") return "لم يُفتح";
      if (s === "opened") return "فُتح ولم يُعبَّأ";
      if (s === "submitted_editable") return "مُسجَّل (قابل للتعديل)";
      return "مُسجَّل (مغلق)";
    };

    ws.columns = [
      { header: "الاسم", key: "name", width: 25 },
      { header: "المُعرِّف", key: "identifier", width: 25 },
      { header: "نوع المُعرِّف", key: "identifierType", width: 15 },
      { header: "الحالة", key: "status", width: 20 },
      { header: "تاريخ أول فتح", key: "firstOpenedAt", width: 22 },
      { header: "تاريخ التسجيل", key: "submittedAt", width: 22 },
      { header: "Telegram مُفعَّل", key: "hasTelegram", width: 16 },
      { header: "رابط الدعوة", key: "participantLink", width: 50 },
      { header: "ملاحظات", key: "notes", width: 30 },
    ];

    ws.getRow(1).font = { bold: true, size: 12 };

    for (const p of list) {
      const st = getStatus({ firstOpenedAt: p.firstOpenedAt, submittedAt: p.submittedAt, participantEditHours: editHours });
      ws.addRow({
        name: p.name,
        identifier: p.identifier || "",
        identifierType: p.identifierType || "",
        status: statusLabel(st),
        firstOpenedAt: p.firstOpenedAt ? p.firstOpenedAt.toLocaleString("ar-SY") : "",
        submittedAt: p.submittedAt ? p.submittedAt.toLocaleString("ar-SY") : "",
        hasTelegram: p.telegramChatId ? "✓ نعم" : "✗ لا",
        participantLink: (() => {
          const domains = process.env.REPLIT_DOMAINS?.split(",");
          const base = domains?.length
            ? `https://${domains[0].trim()}`
            : process.env.REPLIT_DEV_DOMAIN
              ? `https://${process.env.REPLIT_DEV_DOMAIN}`
              : `${req.protocol}://${req.get("host")}`;
          return `${base}/p/${pid}/p/${p.token}`;
        })(),
        notes: p.notes || "",
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="participants-${pid}.xlsx"`);
    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/bulk-delete ─────────
router.post("/bulk-delete", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "لم يتم تحديد مشاركين" });
    await db.delete(projectParticipants)
      .where(and(eq(projectParticipants.projectId, pid), inArray(projectParticipants.id, ids)));
    res.json({ ok: true });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/notify-all ──────────
router.post("/notify-all", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({
      name: projects.name,
      telegramBotTokenEnc: projects.telegramBotTokenEnc,
    }).from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!proj.telegramBotTokenEnc) return res.status(400).json({ error: "البوت غير مُفعَّل" });

    const botToken = decrypt(proj.telegramBotTokenEnc);
    if (!botToken) return res.status(400).json({ error: "مفتاح البوت غير صالح" });

    const { message } = req.body;
    if (!message || !String(message).trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

    // Get participants who have Telegram and haven't submitted yet
    const targets = await db.select().from(projectParticipants)
      .where(and(
        eq(projectParticipants.projectId, pid),
        sql`${projectParticipants.telegramChatId} IS NOT NULL`,
        sql`${projectParticipants.submittedAt} IS NULL`,
      ));

    let sent = 0, failed = 0;
    for (const p of targets) {
      const result = await notifyParticipant(botToken, p.telegramChatId!, String(message));
      if (result.ok) {
        sent++;
        await db.update(projectParticipants).set({
          lastNotifiedAt: new Date(),
          notifyCount: (p.notifyCount ?? 0) + 1,
        }).where(eq(projectParticipants.id, p.id));
      } else { failed++; }
    }

    res.json({ ok: true, sent, failed });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/notify-batch ────────
router.post("/notify-batch", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ name: projects.name, telegramBotTokenEnc: projects.telegramBotTokenEnc })
      .from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    if (!proj.telegramBotTokenEnc) return res.status(400).json({ error: "البوت غير مُفعَّل" });

    const botToken = decrypt(proj.telegramBotTokenEnc);
    if (!botToken) return res.status(400).json({ error: "مفتاح البوت غير صالح" });

    const { ids, message } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "لم يتم تحديد مشاركين" });
    if (!message || !String(message).trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

    const targets = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.projectId, pid), inArray(projectParticipants.id, ids)));

    let sent = 0, failed = 0, noTelegram = 0;
    for (const p of targets) {
      if (!p.telegramChatId) { noTelegram++; continue; }
      const result = await notifyParticipant(botToken, p.telegramChatId, String(message));
      if (result.ok) {
        sent++;
        await db.update(projectParticipants).set({
          lastNotifiedAt: new Date(),
          notifyCount: (p.notifyCount ?? 0) + 1,
        }).where(eq(projectParticipants.id, p.id));
      } else { failed++; }
    }

    res.json({ ok: true, sent, failed, noTelegram });
  } catch (err: any) { handleError(res, err); }
});

// ─── GET /api/projects/:id/participants/bot-info ─────────────
router.get("/bot-info", requireAuth, requireParticipantReadAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc })
      .from(projects).where(eq(projects.id, pid));
    if (!proj?.telegramBotTokenEnc) return res.json({ ok: false, username: null });

    const botToken = decrypt(proj.telegramBotTokenEnc);
    if (!botToken) return res.json({ ok: false, username: null });

    const username = await getBotUsername(botToken);
    res.json({ ok: !!username, username });
  } catch (err: any) { handleError(res, err); }
});

// ─── GET /api/projects/:id/participants/:pid ─────────────────
router.get("/:pid", requireAuth, requireParticipantReadAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const participantId = String(req.params.pid);
    const [proj] = await db.select({ participantEditHours: projects.participantEditHours })
      .from(projects).where(eq(projects.id, projectId));
    const editHours = proj?.participantEditHours ?? 48;

    const [p] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    if (!p) return res.status(404).json({ error: "المشارك غير موجود" });

    res.json({ ...p, status: getStatus({ firstOpenedAt: p.firstOpenedAt, submittedAt: p.submittedAt, participantEditHours: editHours }), participantLink: `/p/${projectId}/p/${p.token}` });
  } catch (err: any) { handleError(res, err); }
});

// ─── PATCH /api/projects/:id/participants/:pid ───────────────
router.patch("/:pid", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const participantId = String(req.params.pid);
    const parsed = updateParticipantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const [existing] = await db.select({ id: projectParticipants.id })
      .from(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    if (!existing) return res.status(404).json({ error: "المشارك غير موجود" });

    const update: any = {};
    const { name, identifier, identifierType, prefillData, notes, telegramChatId } = parsed.data;
    if (name !== undefined) update.name = name;
    if (identifier !== undefined) update.identifier = identifier;
    if (identifierType !== undefined) update.identifierType = identifierType;
    if (prefillData !== undefined) update.prefillData = prefillData;
    if (notes !== undefined) update.notes = notes;
    if (telegramChatId !== undefined) update.telegramChatId = telegramChatId;

    const [updated] = await db.update(projectParticipants).set(update)
      .where(eq(projectParticipants.id, participantId)).returning();

    const [proj] = await db.select({ participantEditHours: projects.participantEditHours })
      .from(projects).where(eq(projects.id, projectId));
    const editHours = proj?.participantEditHours ?? 48;

    res.json({ ok: true, participant: { ...updated, status: getStatus({ firstOpenedAt: updated.firstOpenedAt, submittedAt: updated.submittedAt, participantEditHours: editHours }) } });
  } catch (err: any) { handleError(res, err); }
});

// ─── DELETE /api/projects/:id/participants/:pid ──────────────
router.delete("/:pid", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const participantId = String(req.params.pid);
    await db.delete(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    res.json({ ok: true });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/:pid/notify ─────────
router.post("/:pid/notify", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const participantId = String(req.params.pid);

    const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc })
      .from(projects).where(eq(projects.id, projectId));
    if (!proj?.telegramBotTokenEnc) return res.status(400).json({ error: "البوت غير مُفعَّل" });

    const botToken = decrypt(proj.telegramBotTokenEnc);
    if (!botToken) return res.status(400).json({ error: "مفتاح البوت غير صالح" });

    const [p] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    if (!p) return res.status(404).json({ error: "المشارك غير موجود" });
    if (!p.telegramChatId) return res.status(400).json({ error: "المشارك لم يُفعِّل البوت بعد" });

    const { message } = req.body;
    if (!message || !String(message).trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

    const result = await notifyParticipant(botToken, p.telegramChatId, String(message));
    if (result.ok) {
      await db.update(projectParticipants).set({
        lastNotifiedAt: new Date(),
        notifyCount: (p.notifyCount ?? 0) + 1,
      }).where(eq(projectParticipants.id, p.id));
    }

    res.json(result);
  } catch (err: any) { handleError(res, err); }
});

export default router;
