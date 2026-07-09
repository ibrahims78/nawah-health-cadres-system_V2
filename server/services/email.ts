import nodemailer from "nodemailer";
import { db } from "../db.js";
import { systemSettings } from "../../shared/schema.js";
import { decrypt } from "./crypto.js";
import { eq } from "drizzle-orm";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName?: string;
}

function buildTransporter(cfg: SmtpConfig) {
  const port = Number(cfg.port) || 587;
  const secure = port === 465;
  return nodemailer.createTransport({
    host: cfg.host,
    port,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15000,  // 15 seconds to connect
    greetingTimeout: 15000,    // 15 seconds for SMTP greeting
    socketTimeout: 20000,      // 20 seconds for data transfer
  });
}

async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; fromName: string; fromUser: string }> {
  const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.id, "singleton"));
  if (!settings?.smtpHost || !settings?.smtpUser || !settings?.smtpPassEnc) {
    throw new Error("لم يتم إعداد SMTP — أدخل بيانات الخادم واحفظها أولاً");
  }
  const pass = decrypt(settings.smtpPassEnc);
  if (!pass) {
    throw new Error("فشل فك تشفير كلمة مرور SMTP — تأكد من ضبط ENCRYPTION_KEY وأعد حفظ كلمة المرور");
  }
  const transporter = buildTransporter({
    host: settings.smtpHost,
    port: Number(settings.smtpPort) || 587,
    user: settings.smtpUser,
    pass,
  });
  return {
    transporter,
    fromName: settings.smtpFromName || "منصة مسارات",
    fromUser: settings.smtpUser,
  };
}

function roleLabel(role: string): string {
  if (role === "admin")  return "مدير";
  if (role === "editor") return "محرر";
  return "مشاهد";
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInvitationEmail(
  to: string,
  token: string,
  role: string,
  appUrl: string,
  expiryHours: number = 72,
  appName: string = "منصة مسارات"
): Promise<boolean> {
  try {
    const { transporter, fromName, fromUser } = await getTransporter();
    const inviteUrl = `${appUrl}/admin/register/${token}`;
    const expiryText = expiryHours >= 24
      ? `${expiryHours / 24} ${expiryHours === 24 ? "يوم" : "أيام"}`
      : `${expiryHours} ساعة`;

    await transporter.sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to,
      subject: `دعوة للانضمام إلى ${appName}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1d4ed8; margin-top: 0;">📋 ${escapeHtml(appName)}</h2>
          <p style="color: #374151;">تم دعوتك للانضمام إلى النظام بصلاحية: <strong>${escapeHtml(roleLabel(role))}</strong></p>
          <p style="color: #374151;">انقر على الرابط أدناه لإنشاء حسابك:</p>
          <a href="${encodeURI(inviteUrl)}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;font-size:16px;">
            إنشاء الحساب
          </a>
          <p style="color:#64748b;font-size:13px; margin-top: 16px;">⏱️ هذا الرابط صالح لـ ${escapeHtml(expiryText)} فقط</p>
          <hr style="border:none;border-top:1px solid #e2e8f0; margin: 16px 0;" />
          <p style="color:#94a3b8;font-size:12px;">إذا لم تطلب هذه الدعوة، يمكنك تجاهل هذا البريد بأمان.</p>
          <p style="color:#94a3b8;font-size:12px;">الرابط المباشر: ${escapeHtml(inviteUrl)}</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("Email send error:", err);
    return false;
  }
}

/**
 * Sends a personalised invitation email to a project participant.
 * The email contains their name, the project name, and a prominent CTA button
 * linking directly to their unique registration form URL.
 */
export async function sendParticipantInviteEmail(opts: {
  to: string;
  participantName: string;
  projectName: string;
  inviteLink: string;
  appName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { to, participantName, projectName, inviteLink, appName = "منصة مسارات" } = opts;
  try {
    const { transporter, fromName, fromUser } = await getTransporter();

    const safeName    = escapeHtml(participantName);
    const safeProject = escapeHtml(projectName);
    const safeApp     = escapeHtml(appName);
    const safeLink    = encodeURI(inviteLink);

    await transporter.sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to,
      subject: `دعوة للتسجيل في ${safeProject}`,
      html: `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>دعوة للتسجيل</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);padding:32px 40px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:12px;padding:10px 20px;margin-bottom:16px;">
                <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">${safeApp}</span>
              </div>
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:600;">دعوة للتسجيل 📋</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 12px;color:#374151;font-size:16px;line-height:1.7;">
                مرحباً <strong>${safeName}</strong>،
              </p>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">
                تمت دعوتك للتسجيل في:
                <br />
                <strong style="color:#1d4ed8;font-size:17px;">${safeProject}</strong>
              </p>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 28px;" />

              <!-- CTA -->
              <p style="margin:0 0 20px;color:#374151;font-size:14px;">
                اضغط على الزر أدناه لاستكمال تسجيلك — رابطك الشخصي خاص بك فقط:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <a href="${safeLink}"
                       style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.3px;">
                      ابدأ التسجيل الآن ←
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 8px;color:#64748b;font-size:12px;">إذا لم يعمل الزر، انسخ الرابط التالي في متصفحك:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="${safeLink}" style="color:#1d4ed8;font-size:12px;">${safeLink}</a>
                </p>
              </div>

              <!-- Note -->
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
                  ⚠️ <strong>ملاحظة:</strong> هذا الرابط خاص بك ولا تشاركه مع أحد.
                  إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:11px;">
                أُرسلت هذه الرسالة من ${safeApp} — منصة إدارة نماذج التسجيل والبيانات
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    });
    return { ok: true };
  } catch (err: any) {
    console.error("[sendParticipantInviteEmail] Error:", err);
    return { ok: false, error: err.message };
  }
}

export async function testEmailConnection(
  liveConfig?: Partial<SmtpConfig>
): Promise<{ ok: boolean; message: string }> {
  try {
    let transporter: nodemailer.Transporter;

    if (liveConfig?.host && liveConfig?.user && liveConfig?.pass) {
      transporter = buildTransporter({
        host: liveConfig.host,
        port: Number(liveConfig.port) || 587,
        user: liveConfig.user,
        pass: liveConfig.pass,
      });
    } else {
      const result = await getTransporter();
      transporter = result.transporter;
    }

    await transporter.verify();
    return { ok: true, message: "✅ اتصال SMTP ناجح — الخادم يعمل بشكل صحيح" };
  } catch (err: any) {
    const msg: string = err.message || "";
    let hint = "";
    if (msg.includes("ECONNREFUSED"))   hint = " (تأكد من صحة الـ Host والـ Port)";
    if (msg.includes("auth"))           hint = " (خطأ في اسم المستخدم أو كلمة المرور)";
    if (msg.includes("certificate"))    hint = " (خطأ في شهادة TLS)";
    if (msg.includes("fك تشفير"))      hint = " — أعد حفظ كلمة المرور بعد ضبط ENCRYPTION_KEY";
    return { ok: false, message: `❌ فشل الاتصال: ${msg}${hint}` };
  }
}
