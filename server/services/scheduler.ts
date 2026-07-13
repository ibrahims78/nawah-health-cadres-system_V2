/**
 * Background scheduler — runs every 30 minutes.
 *
 * For each project with reminderEnabled=true, finds unsubmitted participants
 * due for a reminder and sends via ONE channel per cycle:
 *   • Telegram (preferred — if participant has linked their bot)
 *   • Email    (fallback — if identifierType=email and no Telegram)
 *
 * Concurrency protection:
 *   • Per-process run lock (isRunning) prevents overlapping cycles.
 *   • Atomic DB claim: each participant is updated with a conditional WHERE
 *     so that two racing instances can't both pick the same row.
 */
import { db, pool } from "../db.js";
import { projects, projectParticipants, projectFormDrafts } from "../../shared/schema.js";
import { eq, and, isNull, or, lt, sql } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import { sendParticipantReminderEmail } from "./email.js";
import { getTrustedBaseUrl } from "../utils/baseUrl.js";

/** Per-process overlap guard — prevents a slow cycle from spawning a second. */
let isRunning = false;
/** Separate lock for the public-draft cycle so a slow participant cycle never blocks it (and vice versa). */
let isRunningPublicDrafts = false;

async function runReminderCycle() {
  if (isRunning) return;
  isRunning = true;
  try {
    const baseUrl = getTrustedBaseUrl();
    if (!baseUrl) return;

    const activeProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        telegramBotTokenEnc: projects.telegramBotTokenEnc,
        reminderIntervalDays: projects.reminderIntervalDays,
        reminderMaxCount: projects.reminderMaxCount,
      })
      .from(projects)
      .where(eq(projects.reminderEnabled, true));

    for (const proj of activeProjects) {
      // Enforce minimum of 1 day to prevent 0-interval spam
      const intervalDays = Math.max(1, proj.reminderIntervalDays ?? 2);
      const maxCount = proj.reminderMaxCount ?? 3;
      const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

      // Decrypt bot token once per project
      let botToken: string | null = null;
      if (proj.telegramBotTokenEnc) {
        botToken = decrypt(proj.telegramBotTokenEnc);
      }

      // ── Telegram-eligible: linked + under max + overdue ──────────────
      if (botToken) {
        // D6: Limit candidate batch size — prevents OOM on projects with tens of thousands
        // of overdue participants. Remaining participants are picked up in the next cycle.
        const telegramCandidates = await db
          .select({ id: projectParticipants.id, name: projectParticipants.name, telegramChatId: projectParticipants.telegramChatId, token: projectParticipants.token })
          .from(projectParticipants)
          .where(
            and(
              eq(projectParticipants.projectId, proj.id),
              isNull(projectParticipants.submittedAt),
              sql`${projectParticipants.telegramChatId} IS NOT NULL`,
              sql`COALESCE(${projectParticipants.notifyCount}, 0) < ${maxCount}`,
              or(
                isNull(projectParticipants.lastNotifiedAt),
                lt(projectParticipants.lastNotifiedAt, cutoff),
              ),
            )
          )
          .limit(500);

        for (const p of telegramCandidates) {
          // ── Atomic claim: update only if state hasn't changed since query ──
          const now = new Date();
          const claimed = await pool.query(
            `UPDATE project_participants
             SET last_notified_at = $1,
                 notify_count = COALESCE(notify_count, 0) + 1
             WHERE id = $2
               AND submitted_at IS NULL
               AND COALESCE(notify_count, 0) < $3
               AND (last_notified_at IS NULL OR last_notified_at < $4)`,
            [now, p.id, maxCount, cutoff]
          );
          if (!claimed.rowCount || claimed.rowCount < 1) continue; // already claimed or state changed

          try {
            const inviteLink = `${baseUrl}/p/${proj.id}/p/${p.token}`;
            const escape = (s: string) =>
              String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const msg = [
              `🔔 <b>تذكير بإتمام التسجيل</b>`,
              ``,
              `مرحباً <b>${escape(p.name)}</b>،`,
              `لاحظنا أنك لم تُكمل تسجيلك في: <b>${escape(proj.name)}</b>`,
              ``,
              `🔗 <a href="${inviteLink}">اضغط هنا لاستكمال التسجيل</a>`,
            ].join("\n");

            const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: p.telegramChatId, text: msg, parse_mode: "HTML", disable_web_page_preview: false }),
            });

            if (!((await resp.json() as any).ok)) {
              // إصلاح: عند فشل الإرسال (توكن غير صالح، حظر البوت، إلخ) لا نُصفّر
              // last_notified_at — فعل ذلك كان يجعل العملية تُعاد كل 30 دقيقة إلى
              // الأبد دون أن يصل العداد أبداً للحد الأقصى (reminderMaxCount مُتجاوَز
              // فعلياً). الآن نُبقي الاستهلاك من العداد ونحترم الفاصل الزمني الكامل
              // قبل إعادة المحاولة، حتى تتوقف المحاولات فعلياً بعد الوصول للحد.
              console.error(`[scheduler] Telegram send rejected for participant ${p.id} — will retry after next interval, not immediately`);
            }
          } catch (err) {
            console.error(`[scheduler] Telegram reminder failed for participant ${p.id}:`, err);
            // نفس المنطق: لا نُصفّر last_notified_at كي لا تتكرر المحاولة كل 30 دقيقة
          }
        }
      }

      // ── Email-eligible: identifierType=email + no Telegram linked + under max + overdue ──
      // Participants with Telegram linked are handled above — email is the fallback channel only.
      const emailCandidates = await db
        .select({ id: projectParticipants.id, name: projectParticipants.name, identifier: projectParticipants.identifier, token: projectParticipants.token })
        .from(projectParticipants)
        .where(
          and(
            eq(projectParticipants.projectId, proj.id),
            isNull(projectParticipants.submittedAt),
            eq(projectParticipants.identifierType, "email"),
            sql`${projectParticipants.identifier} IS NOT NULL`,
            sql`${projectParticipants.telegramChatId} IS NULL`,
            sql`COALESCE(${projectParticipants.emailCount}, 0) < ${maxCount}`,
            or(
              isNull(projectParticipants.lastEmailedAt),
              lt(projectParticipants.lastEmailedAt, cutoff),
            ),
          )
        )
        .limit(500); // D6: cap batch per cycle

      for (const p of emailCandidates) {
        if (!p.identifier) continue;

        // ── Atomic claim ──────────────────────────────────────────────
        const now = new Date();
        const claimed = await pool.query(
          `UPDATE project_participants
           SET last_emailed_at = $1,
               email_count = COALESCE(email_count, 0) + 1
           WHERE id = $2
             AND submitted_at IS NULL
             AND COALESCE(email_count, 0) < $3
             AND (last_emailed_at IS NULL OR last_emailed_at < $4)`,
          [now, p.id, maxCount, cutoff]
        );
        if (!claimed.rowCount || claimed.rowCount < 1) continue;

        try {
          const inviteLink = `${baseUrl}/p/${proj.id}/p/${p.token}`;
          const result = await sendParticipantReminderEmail({
            to: p.identifier,
            participantName: p.name,
            projectName: proj.name,
            inviteLink,
          });

          if (!result.ok) {
            // إصلاح: نفس منطق تيليغرام — لا نُصفّر last_emailed_at عند الفشل
            // حتى لا يتكرر الفشل كل 30 دقيقة إلى الأبد بدل احترام reminderMaxCount
            console.error(`[scheduler] Email send failed for participant ${p.id} — will retry after next interval, not immediately: ${result.error || ""}`);
          }
        } catch (err) {
          console.error(`[scheduler] Email reminder failed for participant ${p.id}:`, err);
        }
        // Throttle between sends to avoid SMTP rate limiting
        await sleep(EMAIL_THROTTLE_MS);
      }
    }
  } catch (err) {
    console.error("[scheduler] Reminder cycle error:", err);
  } finally {
    isRunning = false;
  }
}

/**
 * Reminder cycle for abandoned PUBLIC-form drafts (general registration, not
 * participant invites). Mirrors the participant reminder cycle's atomic-claim
 * and non-reset-on-failure patterns, but the "candidate" is a projectFormDrafts
 * row with a captured email, and the resumable link carries the draftId so the
 * recipient can continue on any device (see ProjectRegister's ?resume= handling).
 */
async function runPublicDraftReminderCycle() {
  if (isRunningPublicDrafts) return;
  isRunningPublicDrafts = true;
  try {
    const baseUrl = getTrustedBaseUrl();
    if (!baseUrl) return;

    const activeProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        reminderIntervalDays: projects.reminderIntervalDays,
        reminderMaxCount: projects.reminderMaxCount,
      })
      .from(projects)
      .where(eq(projects.publicReminderEnabled, true));

    for (const proj of activeProjects) {
      const intervalDays = Math.max(1, proj.reminderIntervalDays ?? 2);
      const maxCount = proj.reminderMaxCount ?? 3;
      const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

      const candidates = await db
        .select({ id: projectFormDrafts.id, draftId: projectFormDrafts.draftId, email: projectFormDrafts.email })
        .from(projectFormDrafts)
        .where(
          and(
            eq(projectFormDrafts.projectId, proj.id),
            sql`${projectFormDrafts.email} IS NOT NULL`,
            sql`COALESCE(${projectFormDrafts.remindersSent}, 0) < ${maxCount}`,
            or(
              isNull(projectFormDrafts.lastReminderAt),
              lt(projectFormDrafts.lastReminderAt, cutoff),
            ),
            // A draft only counts as "abandoned" once it's had at least one interval
            // to sit untouched — avoids reminding someone still actively filling it in.
            lt(projectFormDrafts.updatedAt, cutoff),
          )
        )
        .limit(500); // D6: cap batch per cycle

      for (const c of candidates) {
        if (!c.email) continue;
        // Guard: only send to structurally valid email addresses
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) continue;

        // ── Atomic claim ──────────────────────────────────────────────
        const now = new Date();
        const claimed = await pool.query(
          `UPDATE project_form_drafts
           SET last_reminder_at = $1,
               reminders_sent = COALESCE(reminders_sent, 0) + 1
           WHERE id = $2
             AND COALESCE(reminders_sent, 0) < $3
             AND (last_reminder_at IS NULL OR last_reminder_at < $4)`,
          [now, c.id, maxCount, cutoff]
        );
        if (!claimed.rowCount || claimed.rowCount < 1) continue;

        try {
          const resumeLink = `${baseUrl}/p/${proj.id}/register?resume=${encodeURIComponent(c.draftId)}`;
          const result = await sendParticipantReminderEmail({
            to: c.email,
            participantName: c.email.split("@")[0],
            projectName: proj.name,
            inviteLink: resumeLink,
          });

          if (!result.ok) {
            // Same non-reset-on-failure logic as the participant cycle — keep the
            // counter consumed and respect the full interval before retrying.
            console.error(`[scheduler] Public-draft reminder email failed for draft ${c.id} — will retry after next interval, not immediately: ${result.error || ""}`);
          }
        } catch (err) {
          console.error(`[scheduler] Public-draft reminder failed for draft ${c.id}:`, err);
        }
        // Throttle between sends to avoid SMTP rate limiting
        await sleep(EMAIL_THROTTLE_MS);
      }
    }
  } catch (err) {
    console.error("[scheduler] Public-draft reminder cycle error:", err);
  } finally {
    isRunningPublicDrafts = false;
  }
}

/**
 * Periodic cleanup of stale form drafts (older than 30 days) and
 * expired sessions that connect-pg-simple may miss between hourly prunes.
 * Non-blocking — failures are logged but never throw.
 */
async function runCleanupCycle() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `DELETE FROM project_form_drafts WHERE updated_at < $1`,
      [thirtyDaysAgo]
    );
  } catch (err) {
    console.error("[scheduler] Cleanup cycle error:", err);
  }
}

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** Small delay between email sends to avoid hitting SMTP rate limits. */
const EMAIL_THROTTLE_MS = 150;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Hold interval IDs so we can clear them on graceful shutdown.
let reminderIntervalId: ReturnType<typeof setInterval> | null = null;
let draftReminderIntervalId: ReturnType<typeof setInterval> | null = null;
// Guard against calling startScheduler() more than once (e.g. hot-reload),
// which would stack up duplicate SIGTERM handlers and double-schedule cycles.
let schedulerStarted = false;

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  console.log("⏰ Reminder scheduler started — runs every 30 minutes");
  // Initial run after 1 minute (give DB time to fully initialize)
  setTimeout(() => {
    runReminderCycle();
    runPublicDraftReminderCycle();
    runCleanupCycle(); // initial cleanup
    reminderIntervalId = setInterval(runReminderCycle, INTERVAL_MS);
    draftReminderIntervalId = setInterval(runPublicDraftReminderCycle, INTERVAL_MS);
    // Cleanup every 6 hours
    setInterval(runCleanupCycle, 6 * 60 * 60 * 1000);
  }, 60 * 1000);

  // Graceful shutdown — clear intervals so the process can exit cleanly.
  const stop = () => {
    if (reminderIntervalId) clearInterval(reminderIntervalId);
    if (draftReminderIntervalId) clearInterval(draftReminderIntervalId);
    schedulerStarted = false;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
