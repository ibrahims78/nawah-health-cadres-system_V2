import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import projectsRoutes from "./routes/projects.js";
import pformRoutes from "./routes/pform.js";
import { uploadsDir } from "./middleware/upload.js";

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

app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));
app.use(cors({
  origin: (origin, cb) => {
    // Same-origin (no header) or known origin → allow
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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

app.use("/uploads", express.static(uploadsDir));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectsRoutes);
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
        condition_field TEXT,
        condition_value TEXT
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
    console.log("✅ Database tables initialized");
  } catch (err) {
    console.error("❌ DB init error:", err);
  }
}

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  });
});
