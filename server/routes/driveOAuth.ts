/**
 * Google Drive OAuth2 flow routes.
 *
 * GET    /api/projects/:id/drive-oauth/url        — generate authorization URL (requires auth)
 * GET    /api/drive-oauth/callback                 — Google redirect target; validates session nonce
 * DELETE /api/projects/:id/drive-oauth/disconnect  — remove stored refresh token (requires auth)
 */
import express, { Request, Response } from "express";
import { google } from "googleapis";
import crypto from "crypto";
import { db } from "../db.js";
import { projects } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../services/crypto.js";
import { requireEditorOrAdmin } from "../middleware/auth.js";

const router = express.Router();

/** Ensure the calling user owns the project or is an admin. */
async function requireDriveProjectAccess(req: Request, res: Response, next: Function) {
  const pid = String(req.params.id);
  const sess = req.session as any;
  const role = sess?.role;
  if (role === "admin") return next();
  const [proj] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, pid));
  if (!proj) return res.status(404).json({ error: "المشروع غير موجود" });
  if (proj.createdBy !== sess?.userId) return res.status(403).json({ error: "لا تملك صلاحية تعديل هذا المشروع" });
  return next();
}

/** Redirect URI — must be registered verbatim in Google Cloud Console. */
export function getRedirectUri(): string {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/drive-oauth/callback`;
  }
  const base = (process.env.APP_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/drive-oauth/callback`;
}

// ── Generate authorization URL ────────────────────────────────────────────────
router.get("/projects/:id/drive-oauth/url", requireEditorOrAdmin, requireDriveProjectAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const sess = req.session as any;

    const [proj] = await db
      .select({ driveOAuthClientId: projects.driveOAuthClientId, driveOAuthClientSecretEnc: projects.driveOAuthClientSecretEnc })
      .from(projects)
      .where(eq(projects.id, pid));

    if (!proj?.driveOAuthClientId || !proj?.driveOAuthClientSecretEnc) {
      return res.status(400).json({ error: "أدخل Client ID و Client Secret واحفظهما أولاً" });
    }

    // CSRF: generate a one-time nonce tied to this session + project
    const nonce = crypto.randomBytes(16).toString("hex");
    sess.driveOAuthNonce = nonce;
    sess.driveOAuthProjectId = pid;

    const clientSecret = decrypt(proj.driveOAuthClientSecretEnc!);
    const oauth2Client = new google.auth.OAuth2(proj.driveOAuthClientId, clientSecret, getRedirectUri());

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",   // always returns a refresh_token
      scope: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
      state: `${nonce}:${pid}`,
    });

    res.json({ authUrl, redirectUri: getRedirectUri() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── OAuth2 callback (Google redirects here) ───────────────────────────────────
router.get("/drive-oauth/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  const sess = req.session as any;

  // Parse state: "nonce:projectId"
  const stateParts = String(state || "").split(":");
  const nonce = stateParts[0];
  const projectId = stateParts.slice(1).join(":"); // handle UUIDs with dashes safely

  const frontendBase = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : (process.env.APP_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

  const settingsUrl = (extra = "") =>
    `${frontendBase}/admin/projects/${projectId}/settings?tab=drive${extra}`;

  if (error) {
    return res.redirect(settingsUrl(`&oauth=error&msg=${encodeURIComponent(String(error))}`));
  }

  // CSRF: validate nonce and that this session initiated the flow
  if (
    !nonce ||
    !projectId ||
    !code ||
    nonce !== sess.driveOAuthNonce ||
    projectId !== sess.driveOAuthProjectId
  ) {
    return res.redirect(settingsUrl("&oauth=error&msg=invalid_state"));
  }

  // Clear nonce so it cannot be replayed
  delete sess.driveOAuthNonce;
  delete sess.driveOAuthProjectId;

  try {
    const [proj] = await db
      .select({ driveOAuthClientId: projects.driveOAuthClientId, driveOAuthClientSecretEnc: projects.driveOAuthClientSecretEnc })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!proj?.driveOAuthClientId || !proj?.driveOAuthClientSecretEnc) {
      return res.redirect(settingsUrl("&oauth=error&msg=missing_credentials"));
    }

    const clientSecret = decrypt(proj.driveOAuthClientSecretEnc!);
    const oauth2Client = new google.auth.OAuth2(proj.driveOAuthClientId, clientSecret, getRedirectUri());
    const { tokens } = await oauth2Client.getToken(String(code));

    if (!tokens.refresh_token) {
      // Happens when the app was previously authorized without prompt:consent.
      // User must revoke access at https://myaccount.google.com/permissions then retry.
      return res.redirect(settingsUrl("&oauth=error&msg=no_refresh_token"));
    }

    await db.update(projects)
      .set({ driveOAuthRefreshTokenEnc: encrypt(tokens.refresh_token) })
      .where(eq(projects.id, projectId));

    return res.redirect(settingsUrl("&oauth=success"));
  } catch (err: any) {
    return res.redirect(settingsUrl(`&oauth=error&msg=${encodeURIComponent(err.message)}`));
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────
router.delete("/projects/:id/drive-oauth/disconnect", requireEditorOrAdmin, requireDriveProjectAccess, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    await db.update(projects).set({ driveOAuthRefreshTokenEnc: null }).where(eq(projects.id, pid));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
