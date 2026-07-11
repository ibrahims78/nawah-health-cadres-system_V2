import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";
import { db, pool } from "../db.js";
import { users, userInvitations, systemSettings } from "../../shared/schema.js";
import { eq, count, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";
import rateLimit from "express-rate-limit";

const router = Router();

// ── Rate Limiters ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "تم حجب الحساب مؤقتاً بسبب محاولات متعددة. حاول بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

// H-02: Rate limit on setup and invite registration
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 5,
  message: { error: "محاولات كثيرة — حاول بعد ساعة" },
  standardHeaders: true,
  legacyHeaders: false,
});

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "محاولات كثيرة — حاول بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

// I-01: Rate limit the setup-required probe — prevents reconnaissance scanning
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "محاولات كثيرة — حاول بعد 15 دقيقة" },
  standardHeaders: true,
  legacyHeaders: false,
});

const setupRequiredLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "طلبات كثيرة — أعد المحاولة لاحقاً" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Check if setup is required ────────────────────────────────
router.get("/setup-required", setupRequiredLimiter, async (_req, res) => {
  try {
    const [result] = await db.select({ count: count() }).from(users);
    res.json({ required: (result?.count || 0) === 0 });
  } catch (err: any) {
    // Do NOT return { required: true } here — a DB failure must not be
    // misinterpreted as "no admin exists yet", which would expose the setup
    // wizard on a healthy system that simply has a transient DB error.
    console.error("[ERROR] GET /api/auth/setup-required:", err);
    res.status(503).json({ error: "قاعدة البيانات غير متاحة مؤقتاً — حاول مجدداً" });
  }
});

// ── Initial setup ─────────────────────────────────────────────
// H-02: setupLimiter applied
router.post("/setup", setupLimiter, async (req: Request, res: Response) => {
  try {
    const { fullName, password } = req.body;
    const email = typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : "";
    if (!fullName || !email || !password || password.length < 8) {
      return res.status(400).json({ error: "بيانات غير مكتملة أو كلمة المرور أقصر من 8 أحرف" });
    }
    // Hash outside the transaction to avoid holding the lock during slow bcrypt
    const hash = await bcrypt.hash(password, 12);

    // Race-condition fix: advisory lock + re-check inside a transaction guarantees
    // only one admin account is ever created, even under concurrent requests.
    let user: any;
    try {
      user = await db.transaction(async (tx) => {
        // pg_advisory_xact_lock is released automatically when the transaction ends
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('masarat_initial_setup'))`);
        const [result] = await tx.select({ count: count() }).from(users);
        if ((result?.count ?? 0) > 0) {
          const err: any = new Error("already_setup");
          err.alreadySetup = true;
          throw err;
        }
        const [u] = await tx
          .insert(users)
          .values({ fullName, email, passwordHash: hash, role: "admin" })
          .returning();
        await tx.insert(systemSettings).values({ id: "singleton" }).onConflictDoNothing();
        return u;
      });
    } catch (txErr: any) {
      if (txErr.alreadySetup) {
        return res.status(400).json({ error: "تم إعداد النظام مسبقاً" });
      }
      throw txErr;
    }

    // H-01: Regenerate session ID after authentication to prevent session fixation
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "خطأ في الجلسة" });
      (req.session as any).userId = user.id;
      (req.session as any).role = user.role;
      (req.session as any).fullName = user.fullName;
      req.session.save(() => res.json({ ok: true }));
    });
  } catch (err: any) {
    console.error("[ERROR] POST /api/auth/setup:", err);
    res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

// ── Login ─────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req: Request, res: Response) => {
  try {
    const { password, rememberMe } = req.body;
    const email = typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : "";
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "بريد إلكتروني أو كلمة مرور خاطئة" });
    }

    // H-01: Regenerate session ID after successful authentication
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "خطأ في الجلسة" });

      (req.session as any).userId = user.id;
      (req.session as any).role = user.role;
      (req.session as any).fullName = user.fullName;

      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        const rawToken = uuidv4();
        // H-04: Store SHA-256 hash of the token, not the raw value
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        db.update(users)
          .set({ rememberMeToken: tokenHash, rememberMeExpiresAt: expiresAt, lastLoginAt: new Date() })
          .where(eq(users.id, user.id))
          .catch((e) => console.error("[ERROR] rememberMe update:", e));
      } else {
        db.update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id))
          .catch((e) => console.error("[ERROR] lastLoginAt update:", e));
      }

      req.session.save(() =>
        res.json({ ok: true, role: user.role, fullName: user.fullName })
      );
    });
  } catch (err: any) {
    console.error("[ERROR] POST /api/auth/login:", err);
    res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

// ── Logout ────────────────────────────────────────────────────
router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    // E4: Explicitly clear the session cookie from the browser.
    // req.session.destroy() removes the server-side record but does NOT instruct
    // the browser to delete its cookie — the orphaned cookie persists until maxAge
    // expires (24 h). clearCookie sends Set-Cookie with maxAge=0, expiring it now.
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ── Current user ──────────────────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const userId = (req.session as any).userId;
  const [user] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, userId));
  res.json(user || null);
});

// ── Register via invitation ───────────────────────────────────
// H-02: inviteLimiter applied
router.post("/register-invite", inviteLimiter, async (req: Request, res: Response) => {
  try {
    const { token, fullName, password } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "رمز الدعوة مطلوب" });
    }
    if (!fullName || !password || password.length < 8) {
      return res.status(400).json({ error: "الاسم مطلوب وكلمة المرور يجب أن تكون 8 أحرف على الأقل" });
    }

    // Hash BEFORE the transaction — bcrypt is slow (~100 ms) and we must not hold
    // the advisory lock or a DB transaction open while it runs.
    const hash = await bcrypt.hash(password, 12);

    // D2: Atomic token consumption via transaction + advisory lock.
    // Both concurrent requests grab the same lock; the second re-reads usedAt = now()
    // and is rejected, preventing two accounts being created with one token.
    let createdUser: any;
    try {
      createdUser = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${token}))`);
        const [inv] = await tx.select().from(userInvitations).where(eq(userInvitations.inviteToken, token));
        if (!inv || inv.usedAt || inv.expiresAt < new Date()) {
          const e: any = new Error("INVITE_INVALID"); e.inviteInvalid = true; throw e;
        }
        const [u] = await tx
          .insert(users)
          .values({ fullName, email: inv.email, passwordHash: hash, role: inv.role })
          .returning();
        await tx.update(userInvitations).set({ usedAt: new Date() }).where(eq(userInvitations.id, inv.id));
        return u;
      });
    } catch (txErr: any) {
      if (txErr.inviteInvalid) {
        return res.status(400).json({ error: "رمز الدعوة غير صالح أو منتهي الصلاحية" });
      }
      if (txErr.code === "23505") {
        return res.status(409).json({ error: "يوجد حساب بهذا البريد الإلكتروني بالفعل" });
      }
      throw txErr;
    }

    // H-01: Regenerate session ID after authentication
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "خطأ في الجلسة" });
      (req.session as any).userId = createdUser.id;
      (req.session as any).role = createdUser.role;
      (req.session as any).fullName = createdUser.fullName;
      req.session.save(() => res.json({ ok: true }));
    });
  } catch (err: any) {
    console.error("[ERROR] POST /api/auth/register-invite:", err);
    res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

// ── Change password ───────────────────────────────────────────
// D8: Rate limited — prevents brute-forcing the old password to learn it
router.post("/change-password", requireAuth, changePasswordLimiter, async (req: Request, res: Response) => {
  try {
    const userId = (req.session as any).userId;
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" });
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

    // If mustChangePassword is set, we skip checking current password (forced change)
    if (!user.mustChangePassword) {
      if (!currentPassword) return res.status(400).json({ error: "كلمة المرور الحالية مطلوبة" });
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ passwordHash: newHash, mustChangePassword: false })
      .where(eq(users.id, userId));

    // D5: Invalidate all OTHER active sessions for this user — a session hijacker who
    // obtained an old session cookie can no longer use it after a password change.
    // The current session (req.sessionID) is deliberately kept so the UI stays logged in.
    await pool.query(
      `DELETE FROM session WHERE sess->>'userId' = $1 AND sid != $2`,
      [userId, req.sessionID]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[ERROR] POST /api/auth/change-password:", err);
    res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

export default router;
