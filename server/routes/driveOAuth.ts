/**
 * Google Drive OAuth2 flow routes.
 *
 * GET  /api/projects/:id/drive-oauth/url        — generate authorization URL
 * GET  /api/drive-oauth/callback                 — Google redirect target (exchange code → tokens)
 * DELETE /api/projects/:id/drive-oauth/disconnect — remove stored refresh token
 */
import express, { Request, Response } from "express";
import { google } from "googleapis";
import { db } from "../db.js";
import { projects } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../services/crypto.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/** Redirect URI registered in Google Cloud Console. Must match exactly. */
export function getRedirectUri(): string {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/drive-oauth/callback`;
  }
  const base = (process.env.APP_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/drive-oauth/callback`;
}

// ── Generate authorization URL ────────────────────────────────────────────────
router.get("/projects/:id/drive-oauth/url", requireAuth, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    const [proj] = await db
      .select({ driveOAuthClientId: projects.driveOAuthClientId, driveOAuthClientSecretEnc: projects.driveOAuthClientSecretEnc })
      .from(projects)
      .where(eq(projects.id, pid));

    if (!proj?.driveOAuthClientId || !proj?.driveOAuthClientSecretEnc) {
      return res.status(400).json({ error: "أدخل Client ID و Client Secret واحفظهما أولاً" });
    }

    const clientSecret = decrypt(proj.driveOAuthClientSecretEnc!);
    const oauth2Client = new google.auth.OAuth2(proj.driveOAuthClientId, clientSecret, getRedirectUri());

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",          // always return refresh_token
      scope: ["https://www.googleapis.com/auth/drive"],
      state: pid,
    });

    res.json({ authUrl, redirectUri: getRedirectUri() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── OAuth2 callback (Google redirects here) ───────────────────────────────────
router.get("/drive-oauth/callback", async (req: Request, res: Response) => {
  const { code, state: projectId, error } = req.query;

  // Construct frontend base URL for redirects
  const frontendBase = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : (process.env.APP_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

  const settingsUrl = (extra = "") =>
    `${frontendBase}/admin/projects/${projectId}/settings?tab=drive${extra}`;

  if (error) {
    return res.redirect(settingsUrl(`&oauth=error&msg=${encodeURIComponent(String(error))}`));
  }
  if (!code || !projectId) {
    return res.redirect(settingsUrl("&oauth=error&msg=missing_params"));
  }

  try {
    const [proj] = await db
      .select({ driveOAuthClientId: projects.driveOAuthClientId, driveOAuthClientSecretEnc: projects.driveOAuthClientSecretEnc })
      .from(projects)
      .where(eq(projects.id, String(projectId)));

    if (!proj?.driveOAuthClientId || !proj?.driveOAuthClientSecretEnc) {
      return res.redirect(settingsUrl("&oauth=error&msg=missing_credentials"));
    }

    const clientSecret = decrypt(proj.driveOAuthClientSecretEnc!);
    const oauth2Client = new google.auth.OAuth2(proj.driveOAuthClientId, clientSecret, getRedirectUri());
    const { tokens } = await oauth2Client.getToken(String(code));

    if (!tokens.refresh_token) {
      // This happens when the user already authorized before without prompt:consent.
      return res.redirect(settingsUrl("&oauth=error&msg=no_refresh_token"));
    }

    await db.update(projects)
      .set({ driveOAuthRefreshTokenEnc: encrypt(tokens.refresh_token) })
      .where(eq(projects.id, String(projectId)));

    return res.redirect(settingsUrl("&oauth=success"));
  } catch (err: any) {
    return res.redirect(settingsUrl(`&oauth=error&msg=${encodeURIComponent(err.message)}`));
  }
});

// ── Disconnect (remove stored tokens) ────────────────────────────────────────
router.delete("/projects/:id/drive-oauth/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    const pid = String(req.params.id);
    await db.update(projects).set({ driveOAuthRefreshTokenEnc: null }).where(eq(projects.id, pid));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
