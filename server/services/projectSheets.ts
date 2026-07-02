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

    let spreadsheetId: string;
    let inFolder = false;

    if (proj.googleDriveFolderId) {
      // Create file DIRECTLY inside the target folder — no move needed, no permission issues
      const driveFile = await drive.files.create({
        requestBody: {
          name: proj.name,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [proj.googleDriveFolderId],
        },
        fields: "id",
      });
      spreadsheetId = driveFile.data.id!;
      inFolder = true;

      // Rename the default sheet tab to the desired name
      const defaultTab = await sheets.spreadsheets.get({ spreadsheetId });
      const defaultSheetId = defaultTab.data.sheets?.[0]?.properties?.sheetId ?? 0;
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
    parts.push(`بـ ${fields.length} عمود`);

    return {
      ok: true,
      sheetId: spreadsheetId,
      sheetUrl,
      message: `✅ ${parts.join(" ")}`,
    };
  } catch (err: any) {
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
