import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, createReadStream } from "fs";
import { stat } from "fs/promises";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import projectsRoutes from "./routes/projects.js";
import pformRoutes from "./routes/pform.js";
import driveOAuthRoutes from "./routes/driveOAuth.js";
import participantsRoutes from "./routes/participants.js";
import { uploadsDir } from "./middleware/upload.js";
import { requireAuth, requirePasswordNotExpired } from "./middleware/auth.js";
import { db } from "./db.js";
import { projectRecords, projects, projectCollaborators } from "../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";

dotenv.config();

// ── Startup checks ────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.error("❌ SESSION_SECRET is not set. Refusing to start. Set it in Replit Secrets.");
  process.exit(1);
}

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || "3001");

app.set("trust proxy", 1);

const PgSession = connectPgSimple(session);

// ── CORS: restrict to known Replit domains + localhost in dev ─
const allowedOrigins = (() => {
  const set = new Set<string>();
  if (process.env.REPLIT_DEV_DOMAIN) set.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").forEach(d => set.add(`https://${d.trim()}`));
  }
  if (process.env.NODE_ENV !== "production") {
    set.add("http://localhost:5000");
    set.add("http://localhost:3001");
    set.add("http://127.0.0.1:5000");
  }
  return [...set];
})();

// M-02: Enable CSP + security headers.
// frameguard and frameAncestors kept permissive in dev so Replit preview iframe works.
// In production they become strict (deny framing from unknown origins).
const isProduction = process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  } : false,
  frameguard: isProduction ? { action: "deny" } : false,
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  noSniff: true,
  xssFilter: true,
}));
app.use(cors({
  origin: (origin, cb) => {
    // Same-origin (no header) or known origin → allow
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
// M-06: Referrer-Policy prevents token leakage via Referer headers when
// users navigate from edit/invite links to external sites.
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
// M-05: Reduce JSON body limit to 512 KB — 10 MB was excessive for API payloads
// and enabled trivial in-memory DoS. File uploads go through multer separately.
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));

// ── Session ───────────────────────────────────────────────────
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // sameSite: lax blocks cross-site subresource requests (fetch/XHR) from sending cookies
    // which is sufficient CSRF protection for JSON API endpoints.
    // sameSite: none is NOT used — the frontend and backend share the same Replit domain.
    secure: process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax",
  },
}));

// Protected uploads: requires an active session OR a valid (non-expired) edit token
// passed as ?token=<uuid>&project=<projectId>
// Supports both flat (/uploads/uuid.ext) and organised (/uploads/project-slug/folder/uuid.ext) paths.
app.get("/uploads/*", async (req, res) => {
  const sessionUserId = (req.session as any)?.userId;
  const sessionRole = (req.session as any)?.role;

  // Extract and sanitize path after /uploads/
  const rawPath = (req.params as any)[0] as string || "";
  const normalized = path.normalize(rawPath);          // resolves any .. sequences
  const filePath   = path.join(uploadsDir, normalized);

  // Path-traversal guard: resolved path must stay inside uploadsDir
  const uploadsRoot = uploadsDir + path.sep;
  if (!filePath.startsWith(uploadsRoot)) {
    return res.status(400).json({ error: "مسار غير صالح" });
  }

  // For the IDOR check we use the leaf filename (UUID is globally unique)
  const filename = path.basename(normalized);

  if (!sessionUserId) {
    // Try edit-token auth: ?token=<uuid>&project=<projectId>
    const { token, project } = req.query as Record<string, string>;
    if (!token || !project) {
      return res.status(401).json({ error: "غير مصادق" });
    }
    try {
      const [record] = await db
        .select({ id: projectRecords.id, tokenExpiresAt: projectRecords.tokenExpiresAt, data: projectRecords.data })
        .from(projectRecords)
        .where(and(eq(projectRecords.projectId, project), eq(projectRecords.editToken, token as any)));
      if (!record) return res.status(401).json({ error: "رمز غير صالح" });
      if (record.tokenExpiresAt && record.tokenExpiresAt < new Date()) {
        return res.status(410).json({ error: "انتهت صلاحية الرابط" });
      }
      // IDOR guard: verify the requested file is actually referenced in this record's data
      const recordDataStr = JSON.stringify(record.data ?? {});
      if (!recordDataStr.includes(filename)) {
        return res.status(403).json({ error: "لا تملك صلاحية الوصول لهذا الملف" });
      }
    } catch {
      return res.status(500).json({ error: "خطأ في التحقق" });
    }
  } else if (sessionRole !== "admin" && sessionRole !== "viewer") {
    // Editors: allow access to files in records of projects they own OR are collaborators on.
    try {
      const [owned] = await db
        .select({ id: projectRecords.id })
        .from(projectRecords)
        .innerJoin(projects, eq(projects.id, projectRecords.projectId))
        .where(and(
          eq(projects.createdBy, sessionUserId),
          sql`${projectRecords.data}::text ILIKE ${"%" + filename + "%"}`,
        ))
        .limit(1);
      if (owned) {
        // file belongs to a project they own — allow
      } else {
        // Check if editor is a collaborator on the project containing this file
        const [collabOwned] = await db
          .select({ id: projectRecords.id })
          .from(projectRecords)
          .innerJoin(projects, eq(projects.id, projectRecords.projectId))
          .innerJoin(projectCollaborators, and(
            eq(projectCollaborators.projectId, projects.id),
            eq(projectCollaborators.userId, sessionUserId),
          ))
          .where(sql`${projectRecords.data}::text ILIKE ${"%" + filename + "%"}`)
          .limit(1);
        if (!collabOwned) {
          return res.status(403).json({ error: "لا تملك صلاحية الوصول لهذا الملف" });
        }
      }
    } catch {
      return res.status(500).json({ error: "خطأ في التحقق" });
    }
  }

  try {
    await stat(filePath);
  } catch {
    return res.status(404).json({ error: "الملف غير موجود" });
  }
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  createReadStream(filePath).pipe(res);
});

app.use("/api/auth", authRoutes);
app.use("/api", driveOAuthRoutes);
// H-03: Block all project API access if mustChangePassword is set
app.use("/api/projects", requireAuth, requirePasswordNotExpired, projectsRoutes);
app.use("/api/projects/:id/participants", requireAuth, requirePasswordNotExpired, participantsRoutes);
app.use("/api/pform", pformRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve frontend in production
const clientDist = path.join(currentDir, "client");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

async function initDB() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        must_change_password BOOLEAN DEFAULT FALSE,
        remember_me_token TEXT,
        remember_me_expires_at TIMESTAMP,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        invite_token TEXT UNIQUE NOT NULL,
        invited_by UUID REFERENCES users(id),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS system_settings (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        app_name TEXT DEFAULT 'مسارات',
        app_logo_url TEXT,
        default_language TEXT DEFAULT 'ar',
        timezone TEXT DEFAULT 'Asia/Damascus',
        smtp_host TEXT,
        smtp_port INTEGER DEFAULT 587,
        smtp_user TEXT,
        smtp_pass_enc TEXT,
        smtp_from_name TEXT,
        invitation_expiry_hours INTEGER DEFAULT 72,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO system_settings (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        invitation_code TEXT NOT NULL DEFAULT 'PROJECT-2026',
        edit_token_hours INTEGER DEFAULT 48,
        form_enabled BOOLEAN DEFAULT TRUE,
        form_disabled_message TEXT,
        form_title TEXT DEFAULT 'نموذج التسجيل',
        form_subtitle TEXT,
        steps JSONB DEFAULT '["البيانات الأساسية","البيانات التفصيلية","المراجعة"]',
        google_sheet_id TEXT,
        import_sheet_id TEXT,
        google_sheet_name TEXT DEFAULT 'بيانات',
        google_service_account_email TEXT,
        google_service_account_key_enc TEXT,
        google_drive_folder_id TEXT,
        telegram_bot_token_enc TEXT,
        telegram_chat_id TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'text',
        is_required BOOLEAN DEFAULT FALSE,
        is_visible BOOLEAN DEFAULT TRUE,
        options JSONB,
        step_number INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0,
        placeholder TEXT,
        validation_min INTEGER,
        validation_max INTEGER,
        validation_regex TEXT,
        validation_message TEXT,
        conditions JSONB,
        condition_operator TEXT DEFAULT 'AND',
        visible_to TEXT DEFAULT 'all',
        is_read_only BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS project_form_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        draft_id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        step INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, draft_id)
      );

      CREATE TABLE IF NOT EXISTS project_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sequential_number INTEGER,
        data JSONB NOT NULL DEFAULT '{}',
        edit_token UUID DEFAULT gen_random_uuid(),
        token_expires_at TIMESTAMP,
        submitted_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP,
        sheets_row_index INTEGER
      );

      CREATE TABLE IF NOT EXISTS project_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        record_id UUID REFERENCES project_records(id) ON DELETE CASCADE,
        changed_by TEXT,
        action TEXT NOT NULL,
        changed_at TIMESTAMP DEFAULT NOW(),
        changes_json JSONB
      );
    `);

    // Project collaborators table (admin grants editors access to non-owned projects)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_collaborators (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, user_id)
      );
    `);

    // Add permission column to project_collaborators if not already present
    await pool.query(`
      ALTER TABLE project_collaborators ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'edit';
    `);

    // Backward-compatible migrations for installs created before newer columns/tables existed
    await pool.query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS import_sheet_id TEXT;
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS conditions JSONB;
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS condition_operator TEXT DEFAULT 'AND';
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS visible_to TEXT DEFAULT 'all';
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS is_read_only BOOLEAN DEFAULT FALSE;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_sync_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_root_folder_id TEXT;
      ALTER TABLE project_records ADD COLUMN IF NOT EXISTS drive_files JSONB DEFAULT '{}';
      ALTER TABLE project_records ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
      ALTER TABLE project_records ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'local';
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS allowed_file_types JSONB;
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS max_file_size_mb INTEGER;
      ALTER TABLE project_fields ADD COLUMN IF NOT EXISTS is_full_width BOOLEAN DEFAULT FALSE;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_oauth_client_id TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_oauth_client_secret_enc TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_oauth_refresh_token_enc TEXT;
      -- Participant tracking columns
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS participants_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS participant_name_field TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS participant_edit_hours INTEGER DEFAULT 48;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS participant_allow_open BOOLEAN NOT NULL DEFAULT false;
    `);

    // Project participants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        identifier TEXT,
        identifier_type TEXT DEFAULT 'email',
        token UUID NOT NULL DEFAULT gen_random_uuid(),
        telegram_chat_id TEXT,
        prefill_data JSONB DEFAULT '{}',
        record_id UUID REFERENCES project_records(id) ON DELETE SET NULL,
        submitted_at TIMESTAMP,
        first_opened_at TIMESTAMP,
        last_notified_at TIMESTAMP,
        notify_count INTEGER DEFAULT 0,
        added_at TIMESTAMP DEFAULT NOW(),
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS project_participants_token_idx ON project_participants(token);
    `);
    // Migrate legacy single-condition columns (if present) into the new conditions[] array, then drop them
    const legacyColCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'project_fields' AND column_name = 'condition_field'
    `);
    if (legacyColCheck.rows.length > 0) {
      await pool.query(`
        UPDATE project_fields
        SET conditions = jsonb_build_array(jsonb_build_object('field', condition_field, 'value', COALESCE(condition_value, '')))
        WHERE condition_field IS NOT NULL AND conditions IS NULL;
        ALTER TABLE project_fields DROP COLUMN IF EXISTS condition_field;
        ALTER TABLE project_fields DROP COLUMN IF EXISTS condition_value;
      `);
    }
    console.log("✅ Database tables initialized");
  } catch (err) {
    console.error("❌ DB init error:", err);
    process.exit(1);
  }
}

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  });
});
