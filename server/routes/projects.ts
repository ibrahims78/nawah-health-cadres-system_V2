import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { projects, projectFields, projectRecords, projectAuditLog, users, userInvitations, systemSettings } from "../../shared/schema.js";
import { eq, desc, count, gte, and, ilike, or, gt, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEditorOrAdmin } from "../middleware/auth.js";
import { encrypt, decrypt } from "../services/crypto.js";
import { appendRecordToSheet, updateRecordRow, deleteRecordRow, testProjectSheetsConnection, createProjectSheet, fixProjectSheetHeaders, checkProjectSheetColumns, importFromProjectSheet, isSheetCreationPending, startBackgroundSheetCreation, cancelSheetCreationJob } from "../services/projectSheets.js";
import { testTelegramBot, getTelegramUpdates } from "../services/telegram.js";
import { sendInvitationEmail, testEmailConnection } from "../services/email.js";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── PROJECTS CRUD ───────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  try {
    const list = await db.select().from(projects).orderBy(desc(projects.createdAt));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATIC ROUTES (must come before /:id to avoid shadowing) ───

router.get("/global-settings", requireAdmin, async (_req, res) => {
  try {
    const [s] = await db.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
    if (!s) return res.json({});
    const { smtpPassEnc, ...safe } = s;
    res.json({ ...safe, hasSmtpPass: !!smtpPassEnc });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users-list", requireAdmin, async (_req, res) => {
  const list = await db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users);
  res.json(list);
});

// ─── DYNAMIC ROUTES ───────────────────────────────────────────

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const [proj] = await db.select().from(projects).where(eq(projects.id, String(req.params.id)));
    if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
    const { googleServiceAccountKeyEnc, telegramBotTokenEnc, ...safe } = proj;
    res.json({
      ...safe,
      hasGoogleKey: !!googleServiceAccountKeyEnc,
      hasTelegramToken: !!telegramBotTokenEnc,
      sheetCreationPending: isSheetCreationPending(String(req.params.id)),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, formTitle, formSubtitle, invitationCode, steps, fields } = req.body;
    if (!name) return res.status(400).json({ error: "اسم المشروع مطلوب" });

    const [proj] = await db.insert(projects).values({
      name,
      description,
      formTitle: formTitle || name,
      formSubtitle,
      invitationCode: invitationCode || `${name.replace(/\s+/g, "-").toUpperCase()}-2026`,
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
      }));
      await db.insert(projectFields).values(fieldRows);
    }

    res.json({ ok: true, project: proj });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/global-settings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const update: any = { updatedAt: new Date() };
    const plain = ["appName", "appLogoUrl", "defaultLanguage", "timezone", "invitationExpiryHours",
      "smtpHost", "smtpPort", "smtpUser", "smtpFromName"];
    for (const f of plain) { if (f in body) update[f] = body[f]; }
    if (body.smtpPass) update.smtpPassEnc = encrypt(body.smtpPass);
    await db.update(systemSettings).set(update).where(eq(systemSettings.id, "singleton"));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const update: any = { updatedAt: new Date() };

    const plainFields = ["name", "description", "formTitle", "formSubtitle", "invitationCode",
      "editTokenHours", "formEnabled", "formDisabledMessage", "steps",
      "googleSheetId", "googleSheetName", "googleServiceAccountEmail",
      "googleDriveFolderId", "telegramChatId"];

    for (const field of plainFields) {
      if (field in body) update[field] = body[field];
    }

    if (body.googleServiceAccountKey) update.googleServiceAccountKeyEnc = encrypt(body.googleServiceAccountKey);
    if (body.telegramBotToken) update.telegramBotTokenEnc = encrypt(body.telegramBotToken);

    await db.update(projects).set(update).where(eq(projects.id, String(req.params.id)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.delete(projects).where(eq(projects.id, String(req.params.id)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EXCEL PARSE ─────────────────────────────────────────────

router.post("/parse-excel", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ─── PROJECT FIELDS ──────────────────────────────────────────

router.get("/:id/fields", requireAuth, async (req: Request, res: Response) => {
  try {
    const fields = await db.select().from(projectFields)
      .where(eq(projectFields.projectId, String(req.params.id)))
      .orderBy(projectFields.stepNumber, projectFields.orderIndex);
    res.json(fields);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/fields", requireAdmin, async (req: Request, res: Response) => {
  try {
    const fields: any[] = req.body.fields;
    await db.delete(projectFields).where(eq(projectFields.projectId, String(req.params.id)));
    if (fields && fields.length > 0) {
      await db.insert(projectFields).values(fields.map((f: any, idx: number) => ({
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
      })));
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PROJECT RECORDS ─────────────────────────────────────────

router.get("/:id/records", requireAuth, async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/records", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const [proj] = await db.select({ editTokenHours: projects.editTokenHours }).from(projects).where(eq(projects.id, String(req.params.id)));
    const tokenHours = proj?.editTokenHours ?? 48;
    const tokenExpiresAt = new Date(Date.now() + tokenHours * 60 * 60 * 1000);

    // Get next sequential number
    const [maxSeq] = await db.select({ max: sql<number>`COALESCE(MAX(sequential_number), 0)` })
      .from(projectRecords).where(eq(projectRecords.projectId, String(req.params.id)));
    const seqNum = (maxSeq?.max || 0) + 1;

    const [record] = await db.insert(projectRecords).values({
      projectId: String(req.params.id),
      data: req.body,
      sequentialNumber: seqNum,
      tokenExpiresAt,
      submittedAt: new Date(),
    }).returning();

    await db.insert(projectAuditLog).values({
      projectId: String(req.params.id),
      recordId: record.id,
      changedBy: (req.session as any).userId || "admin",
      action: "create",
      changesJson: req.body,
    });

    appendRecordToSheet(String(req.params.id), record.data as any, seqNum).then(async (rowIndex) => {
      if (rowIndex) {
        await db.update(projectRecords).set({ sheetsRowIndex: rowIndex }).where(eq(projectRecords.id, record.id));
      }
    }).catch(console.error);

    res.json({ ok: true, record });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/records/:recordId", requireAuth, async (req: Request, res: Response) => {
  try {
    const [record] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.id, String(req.params.recordId)), eq(projectRecords.projectId, String(req.params.id))));
    if (!record) return res.status(404).json({ error: "السجل غير موجود" });

    const logs = await db.select().from(projectAuditLog)
      .where(eq(projectAuditLog.recordId, record.id))
      .orderBy(desc(projectAuditLog.changedAt)).limit(20);

    res.json({ record, auditLog: logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/records/:recordId", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(projectRecords)
      .where(and(eq(projectRecords.id, String(req.params.recordId)), eq(projectRecords.projectId, String(req.params.id))));
    if (!existing) return res.status(404).json({ error: "السجل غير موجود" });

    const [updated] = await db.update(projectRecords)
      .set({ data: req.body, updatedAt: new Date() })
      .where(eq(projectRecords.id, String(req.params.recordId)))
      .returning();

    await db.insert(projectAuditLog).values({
      projectId: String(req.params.id),
      recordId: String(req.params.recordId),
      changedBy: (req.session as any).userId,
      action: "update",
      changesJson: req.body,
    });

    if (updated.sheetsRowIndex) {
      updateRecordRow(String(req.params.id), updated.sheetsRowIndex, updated.data as any, updated.sequentialNumber || 0).catch(console.error);
    } else {
      appendRecordToSheet(String(req.params.id), updated.data as any, updated.sequentialNumber || 0).then(async (rowIndex) => {
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

router.delete("/:id/records/:recordId", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const [rec] = await db.select({ sheetsRowIndex: projectRecords.sheetsRowIndex })
      .from(projectRecords).where(eq(projectRecords.id, String(req.params.recordId)));
    await db.delete(projectRecords).where(eq(projectRecords.id, String(req.params.recordId)));

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
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/records/bulk-delete", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    for (const rid of ids) {
      await db.delete(projectRecords).where(eq(projectRecords.id, rid));
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS ───────────────────────────────────────────────────

router.get("/:id/stats", requireAuth, async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ─── EXPORT ──────────────────────────────────────────────────

router.get("/:id/export", requireAuth, async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS DISTRIBUTIONS ─────────────────────────────────────

router.get("/:id/stats/distributions", requireAuth, async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ─── SHEET TOOLS ─────────────────────────────────────────────

router.post("/:id/fix-sheet-headers", requireAdmin, async (req: Request, res: Response) => {
  const result = await fixProjectSheetHeaders(String(req.params.id));
  res.json(result);
});

router.post("/:id/check-sheet-columns", requireAdmin, async (req: Request, res: Response) => {
  const result = await checkProjectSheetColumns(String(req.params.id));
  res.json(result);
});

router.post("/:id/import-from-sheets", requireAdmin, async (req: Request, res: Response) => {
  const { syncDeleted } = req.body;
  const result = await importFromProjectSheet(String(req.params.id), !!syncDeleted);
  res.json(result);
});

// ─── SETTINGS ACTIONS ────────────────────────────────────────

router.post("/:id/test-sheets", requireAdmin, async (req: Request, res: Response) => {
  const result = await testProjectSheetsConnection(String(req.params.id));
  res.json(result);
});

router.post("/:id/create-sheet", requireAdmin, async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  cancelSheetCreationJob(projectId); // cancel any running background job first
  const result = await createProjectSheet(projectId);
  // If quota error — start background retry loop and return pending immediately
  if (!result.ok && result.message && /quota/i.test(result.message)) {
    startBackgroundSheetCreation(projectId);
    return res.json({
      ok: true,
      pending: true,
      message: "⏳ حصة Drive الـ SA تحتاج وقتاً للتحديث — بدأ النظام إنشاء الـ Sheet تلقائياً في الخلفية.\nسيُحدَّث الـ ID تلقائياً خلال دقيقة إلى عشر دقائق.",
    });
  }
  res.json(result);
});

router.post("/:id/cleanup-drive", requireAdmin, async (req: Request, res: Response) => {
  const { cleanupServiceAccountDrive } = await import("../services/projectSheets.js");
  const result = await cleanupServiceAccountDrive(String(req.params.id));
  res.json(result);
});

router.post("/:id/test-telegram", requireAdmin, async (req: Request, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/telegram-updates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    let botToken = token;
    if (!botToken) {
      const [proj] = await db.select({ telegramBotTokenEnc: projects.telegramBotTokenEnc }).from(projects).where(eq(projects.id, String(req.params.id)));
      if (proj?.telegramBotTokenEnc) botToken = decrypt(proj.telegramBotTokenEnc);
    }
    if (!botToken) return res.status(400).json({ ok: false, message: "أدخل Bot Token أولاً" });
    const result = await getTelegramUpdates(botToken);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post("/test-email", requireAdmin, async (req: Request, res: Response) => {
  const { host, port, user, pass } = req.body;
  const result = await testEmailConnection(
    host || user || pass ? { host, port: Number(port) || 587, user, pass } : undefined
  );
  res.json(result);
});

router.post("/send-invitation", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, role } = req.body;
    const [s] = await db.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
    const expiryHours = s?.invitationExpiryHours ?? 72;
    const appName = s?.appName || "منصة نواة";
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
    res.status(500).json({ error: err.message });
  }
});

router.post("/create-user", requireAdmin, async (req: Request, res: Response) => {
  try {
    const bcrypt = await import("bcryptjs");
    const { fullName, email, password, role } = req.body;
    const hash = await bcrypt.default.hash(password, 12);
    const [user] = await db.insert(users).values({ fullName, email, passwordHash: hash, role: role || "viewer", mustChangePassword: true }).returning({ id: users.id });
    res.json({ ok: true, userId: user.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

router.patch("/users/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { fullName, email, role } = req.body;
    await db.update(users).set({ fullName, email, role }).where(eq(users.id, String(req.params.userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/users/:userId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const adminUsers = await db.select({ count: count() }).from(users).where(eq(users.role, "admin"));
    if (Number(adminUsers[0]?.count || 0) <= 1) {
      const [target] = await db.select().from(users).where(eq(users.id, String(req.params.userId)));
      if (target?.role === "admin") return res.status(400).json({ error: "لا يمكن حذف آخر مدير" });
    }
    await db.delete(users).where(eq(users.id, String(req.params.userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
