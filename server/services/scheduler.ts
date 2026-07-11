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
import { projects, projectParticipants } from "../../shared/schema.js";
import { eq, and, isNull, or, lt, sql } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import { sendParticipantReminderEmail } from "./email.js";

function getBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",");
  if (domains?.length) return `https://${domains[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return process.env.APP_URL || "";
}

/** Per-process overlap guard — prevents a slow cycle from spawning a second. */
let isRunning = false;

async function runReminderCycle() {
  if (isRunning) return;
  isRunning = true;
  try {
    const baseUrl = getBaseUrl();
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
      const intervalDays = proj.reminderIntervalDays ?? 2;
      const maxCount = proj.reminderMaxCount ?? 3;
      const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

      // Decrypt bot token once per project
      let botToken: string | null = null;
      if (proj.telegramBotTokenEnc) {
        botToken = decrypt(proj.telegramBotTokenEnc);
      }

      // ── Telegram-eligible: linked + under max + overdue ──────────────
      if (botToken) {
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
          );

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
        );

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
      }
    }
  } catch (err) {
    console.error("[scheduler] Reminder cycle error:", err);
  } finally {
    isRunning = false;
  }
}

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startScheduler() {
  console.log("⏰ Reminder scheduler started — runs every 30 minutes");
  // Initial run after 1 minute (give DB time to fully initialize)
  setTimeout(() => {
    runReminderCycle();
    setInterval(runReminderCycle, INTERVAL_MS);
  }, 60 * 1000);
}
