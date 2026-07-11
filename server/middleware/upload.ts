import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";
import { fileTypeFromFile } from "file-type";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export const uploadsDir = path.join(currentDir, "..", "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt",
]);

// M-04: Map allowed MIME types — extension + content must both match
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const fileUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error("نوع الملف غير مدعوم"));
      return;
    }
    cb(null, true);
  },
});

// Extensions that have no magic-byte signature (file-type returns undefined for them)
// and are safe to allow without a detected MIME type.
const NO_MAGIC_EXTENSIONS = new Set([".txt"]);

// Binary extensions that MUST have a detectable magic-byte signature.
// If file-type returns undefined for these, the file is malformed/spoofed → reject.
const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
]);

/**
 * M-04: Post-upload MIME validation middleware (fail-closed).
 * Call AFTER fileUpload.single()/array() — reads the saved file from disk,
 * checks its actual magic-bytes MIME type, and deletes it if it doesn't match
 * an allowed type. This prevents extension spoofing (e.g. .jpg containing HTML/JS).
 *
 * Fail-closed logic:
 *  - Binary extensions (.jpg, .pdf, etc.) must have a detectable MIME → reject if undefined.
 *  - Text-only extensions (.txt) naturally have no magic bytes → allow undefined.
 *  - Any detected MIME must be in the allowlist.
 */
export async function validateMimeType(req: Request, res: Response, next: NextFunction) {
  if (!req.file) return next();

  const filePath = path.join(uploadsDir, req.file.filename);
  const ext = path.extname(req.file.filename).toLowerCase();

  try {
    const detected = await fileTypeFromFile(filePath);

    const safeUnlink = (p: string) => fs.unlink(p, (e) => { if (e) console.warn(`[upload] failed to delete temp file ${p}:`, e.message); });

    if (detected) {
      // MIME detected — must be in the allowlist
      if (!ALLOWED_MIME_TYPES.has(detected.mime)) {
        safeUnlink(filePath);
        return res.status(400).json({ error: "محتوى الملف لا يتطابق مع امتداده" });
      }
    } else {
      // No magic bytes detected
      if (BINARY_EXTENSIONS.has(ext)) {
        // Binary files must have detectable magic bytes — reject to be safe
        safeUnlink(filePath);
        return res.status(400).json({ error: "محتوى الملف لا يتطابق مع امتداده" });
      }
      if (!NO_MAGIC_EXTENSIONS.has(ext)) {
        // Unknown extension with no magic bytes — reject
        safeUnlink(filePath);
        return res.status(400).json({ error: "نوع الملف غير مدعوم" });
      }
      // .txt with no magic bytes is expected — allow
    }
    next();
  } catch (err) {
    fs.unlink(filePath, (e) => { if (e) console.warn(`[upload] failed to delete temp file after error ${filePath}:`, e.message); });
    return res.status(400).json({ error: "تعذّر التحقق من نوع الملف" });
  }
}

export function publicFileUrl(filename: string): string {
  return `/uploads/${filename}`;
}

/**
 * Slugify a project name into a safe directory name.
 * Arabic text → dashes; only alphanumeric + dashes remain.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "project";
}

/**
 * Move the freshly-uploaded file from the flat uploads root into the
 * organised tree:  uploads/{project-slug}/{upload-folder}/{uuid.ext}
 *
 * Call AFTER all validation passes (validateMimeType + validateFieldRestrictions),
 * because those middlewares read the file from the flat uploadsDir.
 *
 * @param tempFilename  The uuid.ext filename multer created in uploadsDir.
 * @param projectName   Raw project name (Arabic/English) — will be slugified.
 * @param uploadFolder  Client-supplied session UUID — sanitised server-side.
 * @returns             Relative path from uploads root, e.g. "my-project/abc123/uuid.ext"
 */
export function organizeUploadedFile(
  tempFilename: string,
  projectName: string,
  uploadFolder: string,
): string {
  const slug = slugify(projectName);
  // Allow only alphanumeric + dash/underscore (UUIDs use these)
  const safeFolder = uploadFolder.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "misc";
  const destDir = path.join(uploadsDir, slug, safeFolder);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, tempFilename);
  fs.renameSync(path.join(uploadsDir, tempFilename), destPath);
  return `${slug}/${safeFolder}/${tempFilename}`;
}

/**
 * Validate per-field file restrictions (allowed types + max size).
 * Call AFTER validateMimeType. Deletes the file and responds with 400 if invalid.
 */
export async function validateFieldRestrictions(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedFileTypes: string[] | null | undefined,
  maxFileSizeMb: number | null | undefined,
): Promise<void> {
  if (!req.file) { next(); return; }

  const filePath = path.join(uploadsDir, req.file.filename);

  // Size check
  if (maxFileSizeMb && maxFileSizeMb > 0) {
    const sizeMb = req.file.size / (1024 * 1024);
    if (sizeMb > maxFileSizeMb) {
      fs.unlink(filePath, () => {});
      res.status(400).json({ error: `حجم الملف يتجاوز الحد المسموح (${maxFileSizeMb} MB) / File exceeds the ${maxFileSizeMb} MB limit` });
      return;
    }
  }

  // Allowed extensions check
  if (allowedFileTypes && allowedFileTypes.length > 0) {
    const ext = path.extname(req.file.originalname).toLowerCase().replace(/^\./, "");
    const allowed = allowedFileTypes.map((t: string) => t.toLowerCase().replace(/^\./, ""));
    if (!allowed.includes(ext)) {
      fs.unlink(filePath, () => {});
      res.status(400).json({ error: `نوع الملف غير مسموح. الأنواع المقبولة: ${allowedFileTypes.join(", ")} / Allowed types: ${allowedFileTypes.join(", ")}` });
      return;
    }
  }

  next();
}
