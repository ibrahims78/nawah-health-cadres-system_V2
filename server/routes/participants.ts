import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import {
  projects, projectParticipants, projectRecords, projectFields, projectAuditLog,
  insertParticipantSchema, updateParticipantSchema,
} from "../../shared/schema.js";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { handleError } from "../utils/errorHandler.js";
import { decrypt } from "../services/crypto.js";
import { notifyParticipant, getBotUsername } from "../services/telegram.js";
import { sendParticipantInviteEmail } from "../services/email.js";
import { getTrustedBaseUrl } from "../utils/baseUrl.js";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** تحقق بسيط من صيغة البريد الإلكتروني */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** هوية المستخدم الإداري الحالي لتسجيلها في سجل التدقيق */
function currentActor(req: Request): string {
  const userId = (req.session as any)?.userId;
  return userId ? `admin:${userId}` : "admin";
}

/** تأخير بسيط بين رسائل الدفعة — يتجنب تجاوز حدود Telegram (~30 رسالة/ثانية) أو SMTP */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const BATCH_SEND_DELAY_MS = 60;

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
// دعم اختياري لصفحات (page/pageSize) وبحث/تصفية على الخادم — إذا لم تُمرَّر
// معاملات pagination، تُعاد كل القائمة كما في السابق (توافق خلفي مع أي استدعاء قديم).
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

    let result = list.map(p => ({
      ...p,
      status: getStatus({ firstOpenedAt: p.firstOpenedAt, submittedAt: p.submittedAt, participantEditHours: editHours }),
      participantLink: `/p/${pid}/p/${p.token}`,
    }));

    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (search) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(search) ||
        (p.identifier || "").toLowerCase().includes(search)
      );
    }
    if (status && status !== "all") {
      result = result.filter(p => p.status === status);
    }

    const paginated = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginated) {
      // No pagination requested — preserve legacy shape (plain array).
      return res.json(result);
    }

    const total = result.length;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
    const start = (page - 1) * pageSize;
    const items = result.slice(start, start + pageSize);

    res.json({ items, total, page, pageSize });
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

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: null,
      changedBy: currentActor(req),
      action: "create",
      changesJson: { entity: "participant", participantId: p.id, name: p.name },
    });

    res.json({ ok: true, participant: { ...p, status: "unopened", participantLink: `/p/${pid}/p/${p.token}` } });
  } catch (err: any) { handleError(res, err); }
});

// ─── GET /api/projects/:id/participants/template ─────────────
router.get("/template", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db.select({ name: projects.name })
      .from(projects).where(eq(projects.id, pid));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    // Fetch dynamic project fields
    const fields = await db.select({ key: projectFields.key, label: projectFields.label, type: projectFields.fieldType })
      .from(projectFields)
      .where(eq(projectFields.projectId, pid))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);

    const wb = new ExcelJS.Workbook();
    wb.creator = "مسارات — Masarat";
    wb.created = new Date();

    const ws = wb.addWorksheet("المشاركون", {
      views: [{ rightToLeft: true }],
      pageSetup: { fitToPage: true, fitToWidth: 1 },
    });

    // ── Build columns ──────────────────────────────────────────
    // Headers MUST match the importer's recognised tokens (case-insensitive):
    //   name      → "الاسم"
    //   identifier → "المُعرِّف"
    //   notes     → "ملاحظات"
    //   custom fields → their stored label (matched via fieldByLabel map in importer)
    const cols: { header: string; key: string; width: number; note?: string }[] = [
      { header: "الاسم", key: "name", width: 28, note: "مطلوب — الاسم الكامل للمشارك" },
      { header: "المُعرِّف", key: "identifier", width: 30, note: "اختياري — بريد إلكتروني أو رقم هاتف" },
      { header: "ملاحظات", key: "notes", width: 35, note: "اختياري — ملاحظات خاصة بالمشارك" },
      ...fields.map(f => ({
        header: f.label,
        key: f.key,
        width: 28,
        note: `حقل مخصص — ${f.type}`,
      })),
    ];

    ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width }));

    // ── Style header row ───────────────────────────────────────
    const headerRow = ws.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell, colIdx) => {
      const isRequired = colIdx === 1; // الاسم
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isRequired ? "FF1E40AF" : "FF1E3A8A" }, // blue-800 / blue-900
      };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF3B82F6" } },
      };
      const colDef = cols[colIdx - 1];
      if (colDef?.note) {
        cell.note = { texts: [{ font: { size: 9 }, text: colDef.note }] };
      }
    });

    // ── Empty data rows (rows 2–21, lightly styled) ────────────
    // NO hint/example rows — any non-empty row after the header is imported as real data
    for (let r = 2; r <= 21; r++) {
      const row = ws.addRow([]);
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        if (colIdx <= cols.length) {
          cell.fill = {
            type: "pattern", pattern: "solid",
            fgColor: { argb: r % 2 === 0 ? "FFFAFAFA" : "FFFFFFFF" },
          };
          cell.border = {
            top: { style: "hair", color: { argb: "FFE5E7EB" } },
            bottom: { style: "hair", color: { argb: "FFE5E7EB" } },
            left: { style: "hair", color: { argb: "FFE5E7EB" } },
            right: { style: "hair", color: { argb: "FFE5E7EB" } },
          };
          cell.font = { name: "Calibri", size: 11 };
          cell.alignment = { vertical: "middle" };
        }
      });
    }

    // Freeze header row
    ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];

    // ── Auto-filter on header row ──────────────────────────────
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

    // ── Instructions sheet ─────────────────────────────────────
    const wsHelp = wb.addWorksheet("تعليمات الاستيراد", { views: [{ rightToLeft: true }] });
    wsHelp.columns = [
      { header: "العمود", key: "col", width: 30 },
      { header: "الوصف", key: "desc", width: 50 },
      { header: "مثال", key: "example", width: 35 },
    ];
    const helpHeaderRow = wsHelp.getRow(1);
    helpHeaderRow.height = 24;
    helpHeaderRow.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    const helpRows = [
      { col: "الاسم (مطلوب)", desc: "الاسم الكامل للمشارك — لا يمكن أن يكون فارغاً", example: "أحمد محمد علي" },
      { col: "المُعرِّف (اختياري)", desc: "بريد إلكتروني أو رقم هاتف — يُستخدم لتفادي التكرار ولإرسال الدعوات", example: "ahmed@email.com أو 0501234567" },
      { col: "ملاحظات (اختياري)", desc: "أي ملاحظات إضافية خاصة بهذا المشارك", example: "يفضّل التواصل عبر الهاتف" },
      ...fields.map(f => ({
        col: `${f.label} (اختياري)`,
        desc: `حقل مخصص من نوع ${f.type} — سيُعبَّأ مسبقاً في نموذج المشارك`,
        example: `قيمة ${f.label}`,
      })),
      { col: "─────────────", desc: "─────────────────────────────────", example: "──────────────" },
      { col: "الحد الأقصى", desc: "200 مشارك في عملية استيراد واحدة", example: "" },
      { col: "ملاحظة مهمة", desc: "أي صف بعد الرأس يُعدّ بيانات حقيقية — لا تترك صفوف وصفية أو أمثلة", example: "" },
    ];
    for (const r of helpRows) {
      const row = wsHelp.addRow(r);
      row.height = 20;
      row.eachCell(cell => {
        cell.font = { name: "Calibri", size: 10 };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    }

    const safeName = proj.name.replace(/[^\w\u0600-\u06FF]/g, "_").slice(0, 30);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`participants-template-${safeName}`)}.xlsx`);
    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
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

    // Identify name, identifier, and notes columns (case-insensitive)
    const nameColIdx = headers.findIndex(h => ["name", "الاسم", "اسم", "full name", "الاسم الكامل"].includes(h.toLowerCase()));
    const identifierColIdx = headers.findIndex(h => ["identifier", "المُعرِّف", "المعرف", "email", "البريد", "البريد الإلكتروني", "phone", "الهاتف", "رقم الهاتف", "national_id", "رقم الهوية"].includes(h.toLowerCase()));
    const notesColIdx = headers.findIndex(h => ["notes", "ملاحظات", "note", "ملاحظة"].includes(h.toLowerCase()));

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

      // Extract notes value if a notes column was detected
      const notesVal = notesColIdx >= 0 ? getCellVal(notesColIdx) : "";

      // Build prefill data from remaining columns (skip system columns)
      const prefillData: Record<string, any> = {};
      headers.forEach((h, idx) => {
        if (idx === nameColIdx || idx === identifierColIdx || idx === notesColIdx) return;
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
            .set({ name, identifier: identifier || null, prefillData, notes: notesVal || null })
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
        notes: notesVal || null,
      });
      added++;
    }

    if (added > 0 || updated > 0) {
      await db.insert(projectAuditLog).values({
        projectId: pid,
        recordId: null,
        changedBy: currentActor(req),
        action: "import",
        changesJson: { entity: "participant", added, updated, skipped },
      });
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
        participantLink: `${getTrustedBaseUrl(req)}/p/${pid}/p/${p.token}`,
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
// إذا كان لدى بعض المشاركين المحددين سجل بيانات مُرسَل (recordId)، يُطلب تأكيد
// صريح (force:true) قبل الحذف — لتفادي حذف بيانات تسجيل فعلية بالخطأ.
router.post("/bulk-delete", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const { ids, force } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "لم يتم تحديد مشاركين" });

    const targets = await db.select({ id: projectParticipants.id, recordId: projectParticipants.recordId, name: projectParticipants.name })
      .from(projectParticipants)
      .where(and(eq(projectParticipants.projectId, pid), inArray(projectParticipants.id, ids)));

    const withRecords = targets.filter(t => t.recordId);
    if (withRecords.length > 0 && !force) {
      return res.status(409).json({
        error: `${withRecords.length} من المشاركين المحددين لديهم بيانات تسجيل مُرسَلة بالفعل — تأكيد الحذف سيحذف بيانات التسجيل الخاصة بهم أيضاً من قائمة المشاركين (لا يحذف السجل نفسه من جدول البيانات، لكن الرابط بينهما سيُفقد).`,
        needsConfirmation: true,
        withRecordsCount: withRecords.length,
      });
    }

    await db.delete(projectParticipants)
      .where(and(eq(projectParticipants.projectId, pid), inArray(projectParticipants.id, ids)));

    await db.insert(projectAuditLog).values({
      projectId: pid,
      recordId: null,
      changedBy: currentActor(req),
      action: "delete",
      changesJson: { entity: "participant", deletedIds: targets.map(t => t.id), deletedNames: targets.map(t => t.name), withSubmittedRecords: withRecords.length },
    });

    res.json({ ok: true, deleted: targets.length });
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
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const result = await notifyParticipant(botToken, p.telegramChatId!, String(message));
      if (result.ok) {
        sent++;
        await db.update(projectParticipants).set({
          lastNotifiedAt: new Date(),
          notifyCount: (p.notifyCount ?? 0) + 1,
        }).where(eq(projectParticipants.id, p.id));
      } else { failed++; }
      if (i < targets.length - 1) await sleep(BATCH_SEND_DELAY_MS);
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
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      if (!p.telegramChatId) { noTelegram++; continue; }
      const result = await notifyParticipant(botToken, p.telegramChatId, String(message));
      if (result.ok) {
        sent++;
        await db.update(projectParticipants).set({
          lastNotifiedAt: new Date(),
          notifyCount: (p.notifyCount ?? 0) + 1,
        }).where(eq(projectParticipants.id, p.id));
      } else { failed++; }
      if (i < targets.length - 1) await sleep(BATCH_SEND_DELAY_MS);
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

    await db.insert(projectAuditLog).values({
      projectId,
      recordId: null,
      changedBy: currentActor(req),
      action: "update",
      changesJson: { entity: "participant", participantId, changes: update },
    });

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

    const [existing] = await db.select({ id: projectParticipants.id, name: projectParticipants.name })
      .from(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    if (!existing) return res.status(404).json({ error: "المشارك غير موجود" });

    await db.delete(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));

    await db.insert(projectAuditLog).values({
      projectId,
      recordId: null,
      changedBy: currentActor(req),
      action: "delete",
      changesJson: { entity: "participant", participantId, name: existing.name },
    });

    res.json({ ok: true });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/send-invite-email-batch ─────────
// إرسال رابط الدعوة بالبريد الإلكتروني لمجموعة من المشاركين
router.post("/send-invite-email-batch", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "لم يتم تحديد مشاركين" });

    const [proj] = await db.select({ name: projects.name })
      .from(projects).where(eq(projects.id, projectId));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const baseUrl = getTrustedBaseUrl(req);

    const targets = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.projectId, projectId), inArray(projectParticipants.id, ids)));

    let sent = 0, failed = 0, noEmail = 0;
    const failures: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const email = p.identifierType === "email" && p.identifier ? p.identifier.trim() : null;
      if (!email || !isValidEmail(email)) { noEmail++; continue; }

      const inviteLink = `${baseUrl}/p/${projectId}/p/${p.token}`;
      const result = await sendParticipantInviteEmail({
        to: email,
        participantName: p.name,
        projectName: proj.name,
        inviteLink,
      });

      if (result.ok) {
        sent++;
        // تحديث ذري يمنع فقدان الإحصاء عند الإرسال المتزامن
        await db.execute(sql`
          UPDATE project_participants
          SET last_emailed_at = NOW(), email_count = COALESCE(email_count, 0) + 1
          WHERE id = ${p.id}
        `);
      } else {
        failed++;
        failures.push(`${p.name}: ${result.error}`);
      }
      // SMTP throttle — avoid tripping provider rate limits on large batches
      if (i < targets.length - 1) await sleep(BATCH_SEND_DELAY_MS);
    }

    res.json({ ok: true, sent, failed, noEmail, failures });
  } catch (err: any) { handleError(res, err); }
});

// ─── POST /api/projects/:id/participants/:pid/send-invite-email ──────────
// إرسال رابط الدعوة بالبريد الإلكتروني لمشارك واحد
router.post("/:pid/send-invite-email", requireAuth, requireParticipantEditAccess, async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.id);
    const participantId = String(req.params.pid);

    const [proj] = await db.select({ name: projects.name })
      .from(projects).where(eq(projects.id, projectId));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });

    const [p] = await db.select().from(projectParticipants)
      .where(and(eq(projectParticipants.id, participantId), eq(projectParticipants.projectId, projectId)));
    if (!p) return res.status(404).json({ error: "المشارك غير موجود" });

    if (p.identifierType !== "email" || !p.identifier) {
      return res.status(400).json({ error: "المشارك لا يملك بريداً إلكترونياً مُسجَّلاً — تأكد أن نوع المُعرِّف هو 'email'" });
    }
    if (!isValidEmail(p.identifier)) {
      return res.status(400).json({ error: `البريد الإلكتروني المُسجَّل غير صالح: ${p.identifier}` });
    }

    const baseUrl = getTrustedBaseUrl(req);
    const inviteLink = `${baseUrl}/p/${projectId}/p/${p.token}`;

    const result = await sendParticipantInviteEmail({
      to: p.identifier.trim(),
      participantName: p.name,
      projectName: proj.name,
      inviteLink,
    });

    if (!result.ok) return res.status(500).json({ error: result.error || "فشل إرسال البريد" });

    // تحديث ذري يمنع فقدان الإحصاء عند الإرسال المتزامن
    await db.execute(sql`
      UPDATE project_participants
      SET last_emailed_at = NOW(), email_count = COALESCE(email_count, 0) + 1
      WHERE id = ${p.id}
    `);

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
