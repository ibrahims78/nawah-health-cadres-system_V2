import { google } from "googleapis";
import { db } from "../db.js";
import { projects, projectFields } from "../../shared/schema.js";
import { decrypt } from "./crypto.js";
import { eq } from "drizzle-orm";

async function getSheetsClient(projectId: string, extraScopes: string[] = []) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("المشروع غير موجود");
  if (!proj.googleServiceAccountKeyEnc || !proj.googleServiceAccountEmail) {
    throw new Error("لم يتم إعداد Google Sheets لهذا المشروع");
  }

  const keyJson = decrypt(proj.googleServiceAccountKeyEnc);
  const credentials = JSON.parse(keyJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      ...extraScopes,
    ],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, proj, auth };
}

async function getProjectFields(projectId: string) {
  return db.select().from(projectFields)
    .where(eq(projectFields.projectId, projectId))
    .orderBy(projectFields.stepNumber, projectFields.orderIndex);
}

/** Wrap sheet name in single quotes so spaces/special chars work in range notation */
function sheetRange(name: string, range: string): string {
  const escaped = name.replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

/** Ensure the named sheet tab exists in the spreadsheet; creates it if missing. */
async function ensureSheetTab(sheets: any, spreadsheetId: string, sheetName: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(
    (s: any) => s.properties?.title === sheetName
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  }
}

// Ensure header row exists with all field labels
async function ensureHeaders(sheets: any, spreadsheetId: string, sheetName: string, fields: any[]) {
  const headers = ["م", ...fields.map(f => f.label)];
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange(sheetName, "1:1"),
  });
  const existing = res.data.values?.[0] || [];
  if (existing.join(",") !== headers.join(",")) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

export async function appendRecordToSheet(projectId: string, recordData: Record<string, any>, seqNum: number): Promise<number | null> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return null;

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || "بيانات";

    await ensureSheetTab(sheets, proj.googleSheetId, sheetName);
    await ensureHeaders(sheets, proj.googleSheetId, sheetName, fields);

    const row = [String(seqNum), ...fields.map(f => String(recordData[f.key] ?? ""))];

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "A:A"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    const updatedRange: string = res.data.updates?.updatedRange || "";
    const match = updatedRange.match(/!A(\d+)/);
    return match ? parseInt(match[1]) : null;
  } catch (err) {
    console.error("[ProjectSheets] appendRecordToSheet error:", err);
    return null;
  }
}

export async function updateRecordRow(projectId: string, rowIndex: number, recordData: Record<string, any>, seqNum: number): Promise<void> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return;

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || "بيانات";

    const row = [String(seqNum), ...fields.map(f => String(recordData[f.key] ?? ""))];

    await sheets.spreadsheets.values.update({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, `A${rowIndex}`),
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.error("[ProjectSheets] updateRecordRow error:", err);
  }
}

export async function deleteRecordRow(projectId: string, rowIndex: number): Promise<boolean> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return false;

    // Get spreadsheet ID of the sheet to get sheetId
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: proj.googleSheetId });
    const sheetName = proj.googleSheetName || "بيانات";
    const sheetMeta = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === sheetName
    );
    if (!sheetMeta?.properties?.sheetId) return false;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: proj.googleSheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetMeta.properties.sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        }],
      },
    });
    return true;
  } catch (err) {
    console.error("[ProjectSheets] deleteRecordRow error:", err);
    return false;
  }
}

export async function testProjectSheetsConnection(projectId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return { ok: false, message: "لم يتم إدخال Sheet ID" };

    await sheets.spreadsheets.get({ spreadsheetId: proj.googleSheetId });
    return { ok: true, message: "✅ تم الاتصال بـ Google Sheets بنجاح" };
  } catch (err: any) {
    return { ok: false, message: `❌ ${err.message}` };
  }
}

/** Extract a human-readable reason from a Google API error */
function googleErrorReason(e: any): string {
  // Structured Google API errors have e.errors[0].reason
  const reason: string = e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || "";
  const msg: string = e?.message || "";
  const code: number = e?.code ?? e?.status ?? e?.response?.status ?? 0;
  console.error("[ProjectSheets] Google API error — code:", code, "reason:", reason, "message:", msg);
  return reason;
}

/** Classify a Google API error and return an Arabic hint */
function classifyDriveError(e: any, context: { folderId?: string; saEmail?: string } = {}): string {
  const reason = googleErrorReason(e);
  const msg: string = (e?.message || "").toLowerCase();
  const code: number = e?.code ?? e?.status ?? e?.response?.status ?? 0;

  const isQuota = reason === "storageQuota" || /storagequota/i.test(reason) || /storage quota/i.test(msg) || /quota exceeded/i.test(msg);
  const isPermission = reason === "forbidden" || reason === "insufficientPermissions" || /caller does not have permission/i.test(msg) || /insufficient permission/i.test(msg);
  const isNotFound = reason === "notFound" || code === 404;

  if (isQuota) {
    return `حصة تخزين الـ Service Account ممتلئة. اضغط "تنظيف Drive" لحذف الملفات الفارغة، أو نظّف Drive الـ SA يدوياً.`;
  }
  if (isPermission) {
    return context.folderId
      ? `خطأ في الصلاحيات (403): تأكد من مشاركة المجلد مع (${context.saEmail}) بصلاحية "محرر"، وأن Google Drive API مُفعَّل في Google Cloud Console`
      : `خطأ في الصلاحيات (403): تأكد من تفعيل Google Drive API وأن الـ Service Account لديه الصلاحيات الصحيحة`;
  }
  if (isNotFound) {
    return `خطأ 404: المجلد ID (${context.folderId}) غير موجود أو غير مُشارَك مع (${context.saEmail})`;
  }
  const raw = e?.message || "خطأ غير معروف";
  return `${raw} (code: ${code}, reason: ${reason || "?"})`;
}

export async function createProjectSheet(projectId: string): Promise<{
  ok: boolean; sheetId?: string; sheetUrl?: string; message: string;
}> {
  try {
    const { sheets, proj, auth } = await getSheetsClient(projectId, [
      "https://www.googleapis.com/auth/drive",
    ]);

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || proj.name || "بيانات";
    const drive = google.drive({ version: "v3", auth });

    // Accept either a full Drive URL or a bare folder ID
    const rawFolder = (proj.googleDriveFolderId || "").trim();
    const folderIdMatch = rawFolder.match(/folders\/([a-zA-Z0-9_-]+)/);
    const folderId = folderIdMatch ? folderIdMatch[1] : rawFolder;
    console.log("[ProjectSheets] rawFolder:", rawFolder, "| folderId:", folderId);

    let spreadsheetId: string;
    let inFolder = false;
    let folderNote = "";

    /** Helper: move a file into folderId, returns true on success */
    const moveFileToFolder = async (fileId: string): Promise<boolean> => {
      try {
        let removeParents: string | undefined;
        try {
          const meta = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true } as any);
          const parr: string[] = (meta.data as any).parents || [];
          if (parr.length > 0) removeParents = parr.join(",");
        } catch { /* skip removeParents */ }
        await drive.files.update({
          fileId,
          addParents: folderId,
          ...(removeParents ? { removeParents } : {}),
          supportsAllDrives: true,
          fields: "id,parents",
        } as any);
        console.log("[ProjectSheets] Moved", fileId, "→ folder", folderId);
        return true;
      } catch (moveErr: any) {
        console.error("[ProjectSheets] Move failed:", classifyDriveError(moveErr, { folderId, saEmail: proj.googleServiceAccountEmail ?? "" }));
        return false;
      }
    };

    if (folderId) {
      // ── Attempt 1: Drive API — create directly inside the folder ──
      let driveCreateOk = false;
      try {
        const driveFile = await drive.files.create({
          requestBody: {
            name: proj.name,
            mimeType: "application/vnd.google-apps.spreadsheet",
            parents: [folderId],
          },
          fields: "id",
          supportsAllDrives: true,
        } as any);
        spreadsheetId = driveFile.data.id!;
        inFolder = true;
        driveCreateOk = true;
        console.log("[ProjectSheets] Drive create OK — id:", spreadsheetId);
      } catch (driveErr: any) {
        const driveErrReason = googleErrorReason(driveErr);
        const hint = classifyDriveError(driveErr, { folderId, saEmail: proj.googleServiceAccountEmail ?? "" });
        console.warn("[ProjectSheets] Drive create failed:", hint);

        const isQuotaErr = driveErrReason === "storageQuotaExceeded" || driveErrReason === "storageQuota" || /storagequota/i.test(driveErrReason);

        // ── Attempt 2A: If quota and existing sheet — try moving it (no new storage needed) ──
        if (isQuotaErr && proj.googleSheetId) {
          console.log("[ProjectSheets] Quota error + stored sheet ID — checking if file still exists...");
          let fileExists = false;
          try {
            await drive.files.get({ fileId: proj.googleSheetId, fields: "id", supportsAllDrives: true } as any);
            fileExists = true;
          } catch { /* file was deleted or inaccessible */ }

          if (fileExists) {
            const moved = await moveFileToFolder(proj.googleSheetId);
            if (moved) {
              spreadsheetId = proj.googleSheetId;
              inFolder = true;
              console.log("[ProjectSheets] Existing sheet moved to folder successfully");
            } else {
              const sheetUrl = `https://docs.google.com/spreadsheets/d/${proj.googleSheetId}/edit`;
              return {
                ok: false,
                sheetId: proj.googleSheetId,
                sheetUrl,
                message: `⚠️ حصة Drive الـ Service Account ممتلئة وتعذّر نقل الملف الموجود للمجلد.\n\nتأكد من مشاركة المجلد مع (${proj.googleServiceAccountEmail}) كـ "محرر"`,
              };
            }
          } else {
            // File was deleted — clear stored ID, empty trash to free quota, then create fresh
            console.log("[ProjectSheets] Stored sheet ID deleted — clearing ID and emptying trash...");
            await db.update(projects).set({ googleSheetId: null }).where(eq(projects.id, projectId));
            try { await drive.files.emptyTrash(); console.log("[ProjectSheets] Trash emptied OK"); } catch (te: any) { console.warn("[ProjectSheets] emptyTrash:", te.message); }
            // Now attempt fresh creation
            try {
              const newSheet = await sheets.spreadsheets.create({
                requestBody: {
                  properties: { title: proj.name },
                  sheets: [{ properties: { title: sheetName } }],
                },
              });
              spreadsheetId = newSheet.data.spreadsheetId!;
              console.log("[ProjectSheets] Fresh create OK — id:", spreadsheetId);
              inFolder = await moveFileToFolder(spreadsheetId);
              if (!inFolder) {
                folderNote = `\n(ملاحظة: الملف أُنشئ لكن تعذّر نقله للمجلد. تأكد من مشاركة المجلد مع ${proj.googleServiceAccountEmail} كـ "محرر")`;
              }
            } catch (sheetsErr: any) {
              return { ok: false, message: `❌ حصة Drive لا تزال ممتلئة بعد تفريغ سلة المهملات.\n\nالسبب: ${sheetsErr.message}` };
            }
          }
        } else if (isQuotaErr && !proj.googleSheetId) {
          // ── Attempt 2B: Quota + no stored sheet — empty trash first, then Sheets API ──
          console.log("[ProjectSheets] Quota error, no stored sheet — emptying trash and retrying...");
          try { await drive.files.emptyTrash(); console.log("[ProjectSheets] Trash emptied OK"); } catch (te: any) { console.warn("[ProjectSheets] emptyTrash:", te.message); }
          try {
            const newSheet = await sheets.spreadsheets.create({
              requestBody: {
                properties: { title: proj.name },
                sheets: [{ properties: { title: sheetName } }],
              },
            });
            spreadsheetId = newSheet.data.spreadsheetId!;
            console.log("[ProjectSheets] Sheets API create OK — id:", spreadsheetId);
            inFolder = await moveFileToFolder(spreadsheetId);
            if (!inFolder) {
              folderNote = `\n(ملاحظة: الملف في Drive الـ SA — تعذّر نقله للمجلد. تأكد من مشاركة المجلد مع ${proj.googleServiceAccountEmail} كـ "محرر")`;
            }
          } catch (sheetsErr: any) {
            return { ok: false, message: `❌ ${hint}\n\nبعد تفريغ سلة المهملات لا يزال الإنشاء يفشل.\nالسبب: ${sheetsErr.message}` };
          }
        } else if (!isQuotaErr) {
          // Non-quota error (permission/not found) — return immediately with hint
          return { ok: false, message: `❌ ${hint}` };
        }
      }

      // Rename the default sheet tab (only needed when Drive API created the file)
      if (!inFolder || driveCreateOk) {
        try {
          const defaultTab = await sheets.spreadsheets.get({ spreadsheetId });
          const defaultSheetId = defaultTab.data.sheets?.[0]?.properties?.sheetId ?? 0;
          const currentTitle = defaultTab.data.sheets?.[0]?.properties?.title ?? "";
          if (currentTitle !== sheetName) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [{
                  updateSheetProperties: {
                    properties: { sheetId: defaultSheetId, title: sheetName },
                    fields: "title",
                  },
                }],
              },
            });
          }
        } catch (renameErr: any) {
          console.warn("[ProjectSheets] Tab rename failed (non-fatal):", renameErr.message);
        }
      }
    } else {
      // No folder specified — create normally via Sheets API
      const newSheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: proj.name },
          sheets: [{ properties: { title: sheetName } }],
        },
      });
      spreadsheetId = newSheet.data.spreadsheetId!;
    }

    // Persist new spreadsheet ID
    await db.update(projects)
      .set({ googleSheetId: spreadsheetId })
      .where(eq(projects.id, projectId));

    // Write column headers
    await ensureHeaders(sheets, spreadsheetId, sheetName, fields);

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const parts: string[] = [];
    parts.push("تم إنشاء ملف Google Sheet جديد");
    if (inFolder) parts.push("في المجلد المحدد");
    else if (folderId) parts.push("(في Drive الـ SA — تعذّر وضعه في المجلد)");
    parts.push(`بـ ${fields.length} عمود`);

    return {
      ok: true,
      sheetId: spreadsheetId,
      sheetUrl,
      message: `✅ ${parts.join(" ")}${folderNote}`,
    };
  } catch (err: any) {
    console.error("[ProjectSheets] createProjectSheet unexpected error:", err.message);
    return { ok: false, message: `❌ ${err.message}` };
  }
}

export async function fixProjectSheetHeaders(projectId: string): Promise<{ ok: boolean; message: string; count?: number }> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return { ok: false, message: "لم يتم إدخال Sheet ID" };

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || "بيانات";
    const headers = ["م", ...fields.map(f => f.label)];

    await sheets.spreadsheets.values.update({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    return { ok: true, message: `✅ تم تصحيح الترويسات — ${headers.length} عمود`, count: headers.length };
  } catch (err: any) {
    return { ok: false, message: `❌ ${err.message}` };
  }
}

export async function checkProjectSheetColumns(projectId: string): Promise<{
  ok: boolean; message: string;
  matched?: string[]; missing?: string[]; extra?: string[];
}> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return { ok: false, message: "لم يتم إدخال Sheet ID" };

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || "بيانات";
    const expected = ["م", ...fields.map(f => f.label)];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "1:1"),
    });

    const actual: string[] = (res.data.values?.[0] || []).map(String);
    const matched = expected.filter(h => actual.includes(h));
    const missing = expected.filter(h => !actual.includes(h));
    const extra = actual.filter(h => !expected.includes(h));

    const ok = missing.length === 0;
    const message = ok
      ? `✅ جميع الأعمدة متطابقة (${matched.length} عمود)`
      : `⚠️ ${missing.length} أعمدة ناقصة — ${extra.length} أعمدة إضافية`;

    return { ok, message, matched, missing, extra };
  } catch (err: any) {
    return { ok: false, message: `❌ ${err.message}` };
  }
}

export async function importFromProjectSheet(
  projectId: string,
  syncDeleted: boolean = false
): Promise<{ ok: boolean; message: string; added: number; updated: number; skipped: number }> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return { ok: false, message: "لم يتم إدخال Sheet ID", added: 0, updated: 0, skipped: 0 };

    const fields = await getProjectFields(projectId);
    const sheetName = proj.googleSheetName || "بيانات";

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "A:ZZ"),
    });

    const rows = res.data.values || [];
    if (rows.length < 2) return { ok: true, message: "لا توجد بيانات في الـ Sheet", added: 0, updated: 0, skipped: 0 };

    const headerRow = (rows[0] || []).map(String);
    const labelToKey: Record<string, string> = {};
    for (const f of fields) labelToKey[f.label] = f.key;

    const colMap: Record<number, string> = {};
    for (let i = 1; i < headerRow.length; i++) {
      const key = labelToKey[headerRow[i]];
      if (key) colMap[i] = key;
    }

    const { projectRecords: prTable } = await import("../../shared/schema.js");
    const { eq: eqFn, and: andFn } = await import("drizzle-orm");

    let added = 0, updated = 0, skipped = 0;

    for (const row of rows.slice(1)) {
      if (!row || row.length === 0) { skipped++; continue; }
      const seqNum = row[0] ? parseInt(String(row[0])) : null;
      const data: Record<string, string> = {};
      for (const [colIdx, key] of Object.entries(colMap)) {
        data[key] = String(row[parseInt(colIdx)] ?? "");
      }
      if (Object.keys(data).length === 0) { skipped++; continue; }

      if (seqNum && !isNaN(seqNum)) {
        const existing = await db.select({ id: prTable.id })
          .from(prTable)
          .where(andFn(eqFn(prTable.projectId, projectId), eqFn(prTable.sequentialNumber, seqNum)));

        if (existing.length > 0) {
          await db.update(prTable).set({ data, updatedAt: new Date() }).where(eqFn(prTable.id, existing[0].id));
          updated++;
        } else {
          await db.insert(prTable).values({ projectId, sequentialNumber: seqNum, data, submittedAt: new Date() });
          added++;
        }
      } else {
        skipped++;
      }
    }

    return {
      ok: true,
      message: `✅ اكتمل: ${added} مُضاف، ${updated} مُحدَّث، ${skipped} مُتجاوَز`,
      added, updated, skipped,
    };
  } catch (err: any) {
    return { ok: false, message: `❌ ${err.message}`, added: 0, updated: 0, skipped: 0 };
  }
}

/**
 * Deletes ALL files owned by the Service Account that are NOT linked to any
 * active project sheet. Searches across all drives (including Shared Drives)
 * with full pagination support. Protects only files whose IDs are saved in
 * the projects table.
 */
export async function cleanupServiceAccountDrive(projectId: string): Promise<{
  ok: boolean; message: string; deleted: number; skipped: number; found: number;
}> {
  try {
    const { auth } = await getSheetsClient(projectId, [
      "https://www.googleapis.com/auth/drive",
    ]);
    const drive = google.drive({ version: "v3", auth });

    // Collect ALL known sheet IDs from every project — never delete these
    const allProjects = await db.select({ sheetId: projects.googleSheetId }).from(projects);
    const knownSheetIds = new Set(allProjects.map(p => p.sheetId).filter(Boolean));

    // Paginate through files OWNED BY the SA only (not shared folders/files)
    const allFiles: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;

    do {
      const listRes: any = await drive.files.list({
        // Only files owned by the SA — excludes shared folders/files the SA can see
        q: "'me' in owners and trashed=false",
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: 200,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        ...(pageToken ? { pageToken } : {}),
      } as any);

      const batch = listRes.data.files || [];
      allFiles.push(...batch);
      pageToken = listRes.data.nextPageToken;
      console.log(`[ProjectSheets] cleanup page — found ${batch.length} files, total: ${allFiles.length}`);
    } while (pageToken);

    let deleted = 0;
    let skipped = 0;

    for (const file of allFiles) {
      if (!file.id) continue;
      if (knownSheetIds.has(file.id)) {
        console.log("[ProjectSheets] cleanup protected:", file.id, file.name);
        skipped++;
        continue;
      }
      try {
        await drive.files.delete({ fileId: file.id, supportsAllDrives: true } as any);
        deleted++;
        console.log("[ProjectSheets] cleanup deleted:", file.id, file.name);
      } catch (err: any) {
        console.warn("[ProjectSheets] cleanup could not delete:", file.id, file.name, "—", err.message);
        skipped++;
      }
    }

    // Always empty trash to free up any deleted files still consuming quota
    let trashNote = "";
    try {
      await drive.files.emptyTrash();
      trashNote = " + سلة المهملات فُرِّغت";
      console.log("[ProjectSheets] Trash emptied successfully");
    } catch (te: any) {
      console.warn("[ProjectSheets] emptyTrash failed:", te.message);
    }

    const found = allFiles.length;
    return {
      ok: true,
      found,
      deleted,
      skipped,
      message: `✅ تم التنظيف: فحص ${found} ملف، حُذف ${deleted}، تجاوز ${skipped} محمي${trashNote}`,
    };
  } catch (err: any) {
    console.error("[ProjectSheets] cleanupServiceAccountDrive error:", err.message);
    return { ok: false, found: 0, deleted: 0, skipped: 0, message: `❌ ${err.message}` };
  }
}
