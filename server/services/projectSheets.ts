import { google } from "googleapis";
import { db } from "../db.js";
import { projects, projectFields } from "../../shared/schema.js";
import { decrypt } from "./crypto.js";
import { eq } from "drizzle-orm";

// ── Auth client ───────────────────────────────────────────────

async function getSheetsClient(projectId: string) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("المشروع غير موجود");
  if (!proj.googleServiceAccountKeyEnc || !proj.googleServiceAccountEmail) {
    throw new Error("لم يتم إعداد Google Sheets لهذا المشروع");
  }

  // Normalise the stored Sheet ID — user may have pasted a full URL
  if (proj.googleSheetId) {
    proj.googleSheetId = extractSpreadsheetId(proj.googleSheetId);
  }

  const keyJson = decrypt(proj.googleServiceAccountKeyEnc);
  let credentials: any;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    throw new Error("ملف JSON تالف — تأكد من نسخه كاملاً");
  }

  if (credentials.type !== "service_account") {
    throw new Error("يجب أن يكون النوع service_account");
  }
  if (!credentials.private_key || !credentials.client_email) {
    throw new Error("ملف JSON ناقص — لا يحتوي على private_key أو client_email");
  }

  // Fix corrupted newlines from textarea copy-paste
  if (credentials.private_key && !credentials.private_key.includes("\n")) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  console.log(
    "[ProjectSheets] getSheetsClient — email:", credentials.client_email,
    "| project:", credentials.project_id,
    "| key_id:", credentials.private_key_id?.slice(0, 8) + "...",
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, proj, auth };
}

// ── Helpers ───────────────────────────────────────────────────

async function getProjectFields(projectId: string) {
  return db.select().from(projectFields)
    .where(eq(projectFields.projectId, projectId))
    .orderBy(projectFields.stepNumber, projectFields.orderIndex);
}

/**
 * Extract a bare spreadsheet ID from either a bare ID or a full Google Sheets URL.
 * e.g. "https://docs.google.com/spreadsheets/d/ABC123/edit" → "ABC123"
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = (input || "").trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return trimmed;
}

/**
 * Sanitize a string for use as a Google Sheets tab name.
 * Rules: max 100 chars, no \ / ? * [ ] :, not empty, not "History".
 */
function sanitizeSheetTabName(name: string): string {
  let clean = (name || "بيانات")
    .replace(/[\\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (!clean || clean.toLowerCase() === "history") clean = "بيانات";
  return clean;
}

/** Wrap sheet name in single quotes so spaces/special chars work in range notation */
function sheetRange(name: string, range: string): string {
  const escaped = name.replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

/**
 * Resolve the ACTUAL tab title from the live spreadsheet.
 * Order: exact match → case-insensitive match → first tab.
 * If createIfMissing=true and nothing matches, creates the tab and returns desiredName.
 *
 * Always use the returned value (not desiredName) in range notation — it is the
 * exact title the API knows about, so ranges won't be rejected as "Unable to parse".
 */
async function resolveSheetTab(
  sheets: any,
  spreadsheetId: string,
  desiredName: string,
  createIfMissing = false,
): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allTabs: string[] = (meta.data.sheets || [])
    .map((s: any) => s.properties?.title as string)
    .filter(Boolean);

  // 1. Exact match (fastest path)
  if (allTabs.includes(desiredName)) return desiredName;

  // 2. Case-insensitive match (handles "بيانات" vs "بيانات")
  const ci = allTabs.find(t => t.toLowerCase() === desiredName.toLowerCase());
  if (ci) return ci;

  // 3. Create the tab when caller asks for it (write operations)
  if (createIfMissing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: desiredName } } }] },
    });
    return desiredName;
  }

  // 4. Fall back to first tab (read operations — don't create silently)
  return allTabs[0] ?? desiredName;
}

/** Ensure header row exists and matches field labels; rewrites if different. */
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

// ── Sync operations ───────────────────────────────────────────

export async function appendRecordToSheet(
  projectId: string,
  recordData: Record<string, any>,
  seqNum: number
): Promise<number | null> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return null;

    const fields = await getProjectFields(projectId);
    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const sheetName = await resolveSheetTab(sheets, proj.googleSheetId, desiredName, true);
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

export async function updateRecordRow(
  projectId: string,
  rowIndex: number,
  recordData: Record<string, any>,
  seqNum: number
): Promise<void> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return;

    const fields = await getProjectFields(projectId);
    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const sheetName = await resolveSheetTab(sheets, proj.googleSheetId, desiredName);
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

    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: proj.googleSheetId });
    const allSheets = spreadsheet.data.sheets || [];
    const sheetName = allSheets.find((s: any) => s.properties?.title === desiredName)?.properties?.title
      ?? allSheets.find((s: any) => s.properties?.title?.toLowerCase() === desiredName.toLowerCase())?.properties?.title
      ?? allSheets[0]?.properties?.title;
    const sheetMeta = allSheets.find((s: any) => s.properties?.title === sheetName);
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

// ── Connection test ───────────────────────────────────────────

/**
 * Verifies the Google Sheets integration with four checks:
 * ① JSON validity (type, private_key, client_email) — done in getSheetsClient
 * ② Newline fix for textarea copy-paste — done in getSheetsClient
 * ③ spreadsheets.get — confirms read access
 * ④ values.update on a temp cell + immediate clear — confirms write access
 */
export async function testProjectSheetsConnection(
  projectId: string
): Promise<{ ok: boolean; message: string }> {
  let saEmail = "";
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    saEmail = proj.googleServiceAccountEmail || "";

    if (!proj.googleSheetId) {
      return { ok: false, message: "❌ لم يتم إدخال Sheet ID أو رابط الـ Sheet" };
    }

    const spreadsheetId = extractSpreadsheetId(proj.googleSheetId);

    // Auto-heal: persist the clean ID so future calls use it
    if (spreadsheetId !== proj.googleSheetId) {
      await db.update(projects).set({ googleSheetId: spreadsheetId }).where(eq(projects.id, projectId));
    }

    // ③ Read check — also fetches real tab names so the write test uses the correct tab
    let spreadsheetMeta: any;
    try {
      spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    } catch (readErr: any) {
      const rCode: number = readErr?.code ?? readErr?.status ?? readErr?.response?.status ?? 0;
      const rMsg: string = readErr?.message || "";
      console.error("[ProjectSheets] test — read check failed:", rCode, rMsg);
      if (rCode === 403 || /forbidden|permission/i.test(rMsg)) {
        return { ok: false, message: `❌ صلاحية مرفوضة (403) — تأكد من مشاركة الملف مع: ${saEmail || "بريد الـ Service Account"}` };
      }
      if (rCode === 404 || /not found/i.test(rMsg)) {
        return { ok: false, message: "❌ الملف غير موجود (404) — أعد إنشاء الملف وشاركه مع الـ Service Account" };
      }
      if (rCode === 400 || /invalid argument|INVALID_ARGUMENT/i.test(rMsg)) {
        return { ok: false, message: "❌ معرف الـ Sheet غير صالح (400) — تأكد من نسخ الرابط أو الـ ID بشكل صحيح" };
      }
      return { ok: false, message: `❌ فشل فحص القراءة: ${rMsg}` };
    }

    // Determine the real tab name to use for the write test
    const configuredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const allSheetsMeta: any[] = spreadsheetMeta.data.sheets || [];
    const realTabs: string[] = allSheetsMeta.map(
      (s: any) => s.properties?.title as string
    ).filter(Boolean);
    // Use first available tab if the configured one doesn't exist yet (created on first real write)
    const testTab = realTabs.includes(configuredName) ? configuredName : (realTabs[0] || configuredName);

    // ④ Write check — use the LAST existing row of the sheet so we never expand its grid.
    //    gridProperties.rowCount is the current allocated row count; writing to exactly that
    //    row is within bounds and will not resize the sheet permanently.
    const sheetTabMeta = allSheetsMeta.find(
      (s: any) => s.properties?.title === testTab
    ) ?? allSheetsMeta[0];
    const existingRowCount: number = sheetTabMeta?.properties?.gridProperties?.rowCount ?? 1000;
    const tempRange = sheetRange(testTab, `A${existingRowCount}`);
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: tempRange,
        valueInputOption: "RAW",
        requestBody: { values: [["__test__"]] },
      });
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: tempRange }).catch(() => {});
    } catch (writeErr: any) {
      const wCode: number = writeErr?.code ?? writeErr?.status ?? writeErr?.response?.status ?? 0;
      const wMsg: string = writeErr?.message || "";
      console.error("[ProjectSheets] test — write check failed:", wCode, wMsg);
      if (wCode === 403 || /forbidden|permission/i.test(wMsg)) {
        return { ok: false, message: `❌ صلاحية الكتابة مرفوضة (403) — تأكد من إعطاء الـ Service Account دور «محرر» وليس «قارئ»\nالبريد: ${saEmail}` };
      }
      if (wCode === 400 || /invalid argument|INVALID_ARGUMENT/i.test(wMsg)) {
        return { ok: false, message: `❌ فشل اختبار الكتابة (400) — تأكد من اسم التبويب واتصالك بالإنترنت\nالتبويب المستخدم: "${testTab}"` };
      }
      return { ok: false, message: `❌ فشل فحص الكتابة: ${wMsg}` };
    }

    return { ok: true, message: `✅ الاتصال ناجح — قراءة وكتابة مؤكّدتان\nالتبويب: "${testTab}" | ${realTabs.length} تبويب في الملف` };

  } catch (err: any) {
    const msg: string = err?.message || String(err);
    console.error("[ProjectSheets] test — unexpected error:", msg);
    // JSON / key errors from getSheetsClient carry descriptive Arabic messages already
    return { ok: false, message: `❌ ${msg}` };
  }
}

// ── Maintenance tools ─────────────────────────────────────────

export async function fixProjectSheetHeaders(
  projectId: string
): Promise<{ ok: boolean; message: string; count?: number }> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) return { ok: false, message: "لم يتم إدخال Sheet ID" };

    const fields = await getProjectFields(projectId);
    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const sheetName = await resolveSheetTab(sheets, proj.googleSheetId, desiredName, true);
    const headers = ["م", ...fields.map(f => f.label)];

    await sheets.spreadsheets.values.update({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    return { ok: true, message: `✅ تم تصحيح الترويسات — ${headers.length} عمود (التبويب: "${sheetName}")`, count: headers.length };
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
    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const sheetName = await resolveSheetTab(sheets, proj.googleSheetId, desiredName);
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
  syncDeleted = false
): Promise<{ ok: boolean; message: string; added: number; updated: number; skipped: number }> {
  try {
    const { sheets, proj } = await getSheetsClient(projectId);
    if (!proj.googleSheetId) {
      return { ok: false, message: "لم يتم إدخال Sheet ID", added: 0, updated: 0, skipped: 0 };
    }

    const fields = await getProjectFields(projectId);
    const desiredName = sanitizeSheetTabName(proj.googleSheetName || proj.name || "بيانات");
    const sheetName = await resolveSheetTab(sheets, proj.googleSheetId, desiredName);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: proj.googleSheetId,
      range: sheetRange(sheetName, "A:ZZ"),
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
      return { ok: true, message: "لا توجد بيانات في الـ Sheet", added: 0, updated: 0, skipped: 0 };
    }

    const headerRow = (rows[0] || []).map(String);
    const labelToKey: Record<string, string> = {};
    for (const f of fields) labelToKey[f.label] = f.key;

    const colMap: Record<number, string> = {};
    for (let i = 1; i < headerRow.length; i++) {
      const key = labelToKey[headerRow[i]];
      if (key) colMap[i] = key;
    }

    const { projectRecords: prTable } = await import("../../shared/schema.js");
    const { eq: eqFn, and: andFn, notInArray } = await import("drizzle-orm");

    let added = 0, updated = 0, skipped = 0, deleted = 0;

    // Collect all valid seqNums seen in the Sheet (used by syncDeleted below)
    const sheetSeqNums: number[] = [];

    for (const row of rows.slice(1)) {
      if (!row || row.length === 0) { skipped++; continue; }
      const seqNum = row[0] ? parseInt(String(row[0])) : null;
      const data: Record<string, string> = {};
      for (const [colIdx, key] of Object.entries(colMap)) {
        data[key] = String(row[parseInt(colIdx)] ?? "");
      }
      if (Object.keys(data).length === 0) { skipped++; continue; }

      if (seqNum && !isNaN(seqNum)) {
        sheetSeqNums.push(seqNum);

        const existing = await db.select({ id: prTable.id })
          .from(prTable)
          .where(andFn(eqFn(prTable.projectId, projectId), eqFn(prTable.sequentialNumber, seqNum)));

        if (existing.length > 0) {
          await db.update(prTable)
            .set({ data, updatedAt: new Date() })
            .where(eqFn(prTable.id, existing[0].id));
          updated++;
        } else {
          await db.insert(prTable).values({
            projectId, sequentialNumber: seqNum, data, submittedAt: new Date(),
          });
          added++;
        }
      } else {
        skipped++;
      }
    }

    // syncDeleted: remove DB records whose seqNum is not present in the Sheet at all.
    // Safety guard: only delete when we found ≥1 valid rows in the Sheet. If the Sheet
    // is empty or all rows lack seq numbers, we treat it as "sheet not ready" and skip
    // deletion to avoid accidentally wiping the entire DB.
    if (syncDeleted && sheetSeqNums.length > 0) {
      const toDelete = await db.select({ id: prTable.id })
        .from(prTable)
        .where(andFn(
          eqFn(prTable.projectId, projectId),
          notInArray(prTable.sequentialNumber, sheetSeqNums)
        ));
      for (const rec of toDelete) {
        await db.delete(prTable).where(eqFn(prTable.id, rec.id));
        deleted++;
      }
    }

    const parts = [`${added} مُضاف`, `${updated} مُحدَّث`, `${skipped} مُتجاوَز`];
    if (syncDeleted) parts.push(`${deleted} مُحذوف`);
    return {
      ok: true,
      message: `✅ اكتمل: ${parts.join("، ")}`,
      added, updated, skipped,
    };
  } catch (err: any) {
    return { ok: false, message: `❌ ${err.message}`, added: 0, updated: 0, skipped: 0 };
  }
}
