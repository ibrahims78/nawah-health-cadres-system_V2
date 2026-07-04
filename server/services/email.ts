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
