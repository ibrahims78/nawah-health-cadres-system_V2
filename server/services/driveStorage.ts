import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { db } from "../db.js";
import { projects } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import { uploadsDir } from "../middleware/upload.js";

// ── Drive client initialisation ────────────────────────────────────────────

/**
 * Returns a Drive client + project record.
 * Priority:
 *   1. OAuth2 with user's personal Google account (refresh token stored per-project)
 *   2. Service Account (legacy / Workspace setups)
 */
async function getDriveClient(projectId: string) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("المشروع غير موجود");

  // ── Option 1: OAuth2 (works with personal Gmail) ──────────────────────────
  if (proj.driveOAuthRefreshTokenEnc && proj.driveOAuthClientId && proj.driveOAuthClientSecretEnc) {
    const clientSecret = decrypt(proj.driveOAuthClientSecretEnc);
    const refreshToken = decrypt(proj.driveOAuthRefreshTokenEnc);
    const oauth2Client = new google.auth.OAuth2(proj.driveOAuthClientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    return { drive, proj };
  }

  // ── Option 2: Service Account ──────────────────────────────────────────────
  if (!proj.googleServiceAccountKeyEnc || !proj.googleServiceAccountEmail) {
    throw new Error("لم يتم إعداد Google Drive. فعّل OAuth2 أو أضف Service Account.");
  }

  const keyJson = decrypt(proj.googleServiceAccountKeyEnc);
  let credentials: any;
  try { credentials = JSON.parse(keyJson); } catch {
    throw new Error("ملف JSON تالف — تأكد من نسخه كاملاً");
  }
  if (credentials.type !== "service_account") throw new Error("يجب أن يكون النوع service_account");
  if (!credentials.private_key || !credentials.client_email) throw new Error("ملف JSON ناقص");
  if (!credentials.private_key.includes("\n")) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  const drive = google.drive({ version: "v3", auth });
  return { drive, proj };
}

// ── Folder helpers ─────────────────────────────────────────────────────────

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const safeName = name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200);

  const search = await drive.files.list({
    q: `name = '${safeName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (search.data.files && search.data.files.length > 0) {
    return search.data.files[0].id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return folder.data.id!;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure the project folder exists inside the root Drive folder.
 * Returns the folder ID (and stores it in projects.googleDriveFolderId).
 */
export async function ensureProjectFolder(
  projectId: string,
  projectName: string,
  rootFolderId: string
): Promise<string> {
  const { drive } = await getDriveClient(projectId);
  const folderId = await findOrCreateFolder(drive, `مشروع: ${projectName}`, rootFolderId);
  await db.update(projects).set({ googleDriveFolderId: folderId } as any).where(eq(projects.id, projectId));
  return folderId;
}

/**
 * Ensure the record sub-folder exists inside the project folder.
 * Label format: "{label} [{recordId.slice(0,8)}]"
 */
export async function ensureRecordFolder(
  projectId: string,
  projectFolderId: string,
  label: string,
  recordId: string
): Promise<string> {
  const { drive } = await getDriveClient(projectId);
  const folderName = `${label} [${recordId.slice(0, 8)}]`;
  return findOrCreateFolder(drive, folderName, projectFolderId);
}

/**
 * Upload a local file from /uploads/ to a Drive folder.
 * Sets "Anyone with the link can view" permission.
 * Returns { fileId, driveUrl }.
 */
export async function uploadLocalFileToDrive(
  projectId: string,
  params: {
    localFilename: string;
    displayName: string;
    mimeType?: string;
    folderId: string;
  }
): Promise<{ fileId: string; driveUrl: string }> {
  const { drive } = await getDriveClient(projectId);
  const localPath = path.join(uploadsDir, params.localFilename);

  if (!fs.existsSync(localPath)) {
    throw new Error(`الملف غير موجود محلياً: ${params.localFilename}`);
  }

  const fileStream = fs.createReadStream(localPath);
  const created = await drive.files.create({
    requestBody: {
      name: params.displayName,
      parents: [params.folderId],
    },
    media: {
      mimeType: params.mimeType || "application/octet-stream",
      body: fileStream,
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = created.data.id!;

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  return {
    fileId,
    driveUrl: `https://drive.google.com/file/d/${fileId}/view`,
  };
}

/**
 * Delete a file from Google Drive. Silently ignores "not found" errors.
 */
export async function deleteFileFromDrive(projectId: string, fileId: string): Promise<void> {
  try {
    const { drive } = await getDriveClient(projectId);
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (err: any) {
    if (err?.code === 404 || err?.status === 404) return;
    throw err;
  }
}

/**
 * Delete a folder from Google Drive. Silently ignores "not found" errors.
 */
export async function deleteFolderFromDrive(projectId: string, folderId: string): Promise<void> {
  try {
    const { drive } = await getDriveClient(projectId);
    await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
  } catch (err: any) {
    if (err?.code === 404 || err?.status === 404) return;
    throw err;
  }
}

/**
 * Detect MIME type from file extension (best-effort fallback).
 */
export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
  };
  return map[ext] || "application/octet-stream";
}
