export async function testTelegramBot(
  token: string,
  chatId: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ *اختبار ناجح* — منصة مسارات متصلة بـ Telegram",
        parse_mode: "Markdown",
      }),
    });
    const data = (await response.json()) as any;
    if (data.ok) return { ok: true, message: "✅ تم الاتصال وإرسال الرسالة بنجاح" };

    const desc: string = data.description || "";
    let hint = desc;
    if (desc.includes("chat not found"))
      hint = "Chat ID غير صحيح — اضغط 'جلب Chat ID' للحصول عليه تلقائياً";
    else if (desc.includes("Unauthorized") || desc.includes("bot token"))
      hint = "Bot Token غير صحيح — تحقق من الرمز في BotFather";
    else if (desc.includes("bot was kicked"))
      hint = "تم طرد البوت من المجموعة — أضفه مجدداً";
    else if (desc.includes("bot is not a member"))
      hint = "البوت ليس عضواً في المجموعة — أضفه أولاً";
    else if (desc.includes("have no rights"))
      hint = "البوت لا يملك صلاحية الإرسال — اجعله مشرفاً في القناة";

    return { ok: false, message: `❌ ${hint}` };
  } catch (err: any) {
    return { ok: false, message: `❌ خطأ في الاتصال: ${err.message}` };
  }
}

/** جلب آخر المحادثات التي أرسل إليها البوت — يساعد في معرفة Chat ID
 *  يقبل webhookUrl + webhookSecret اختياريًا لإعادة تسجيل الـ Webhook بعد جلب المحادثات
 *  (getUpdates تتطلب حذف الـ Webhook مسبقًا، لذا نعيد تسجيله فورًا بعد الانتهاء)
 */
export async function getTelegramUpdates(
  token: string,
  webhookUrl?: string,
  webhookSecret?: string
): Promise<{ ok: boolean; chats?: Array<{ id: string; title: string; type: string }>; message?: string }> {
  const base = `https://api.telegram.org/bot${token}`;
  try {
    // يجب حذف الـ Webhook قبل استخدام getUpdates (Telegram لا يسمح بالاثنين معًا)
    await fetch(`${base}/deleteWebhook`, { method: "POST" }).catch(() => {});

    const response = await fetch(`${base}/getUpdates?limit=50&offset=-50`);
    const data = (await response.json()) as any;

    // أعِد تسجيل الـ Webhook فورًا بعد الانتهاء حتى لا تُكسَر ميزة المشاركين
    if (webhookUrl) {
      const reregResult = await setWebhook(token, webhookUrl, webhookSecret || "").catch((e) => ({ ok: false, message: String(e) }));
      if (!reregResult.ok) {
        console.error("[getTelegramUpdates] فشل إعادة تسجيل الـ Webhook:", reregResult.message);
      }
    }

    if (!data.ok) {
      const desc: string = data.description || "";
      const hint = desc.includes("Unauthorized") ? "Bot Token غير صحيح" : desc;
      return { ok: false, message: `❌ ${hint}` };
    }

    const seen = new Set<string>();
    const chats: Array<{ id: string; title: string; type: string }> = [];

    for (const update of data.result) {
      const msg = update.message || update.channel_post || update.edited_message;
      if (!msg?.chat) continue;
      const { id, title, username, first_name, type } = msg.chat;
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      chats.push({ id: key, title: title || username || first_name || key, type });
    }

    if (chats.length === 0) {
      return {
        ok: false,
        message: "لم تصل رسائل للبوت بعد — أرسل /start للبوت أو أضفه للمجموعة وأرسل أي رسالة، ثم أعد المحاولة",
      };
    }

    return { ok: true, chats };
  } catch (err: any) {
    // حاول إعادة الـ Webhook حتى عند الخطأ
    if (webhookUrl) {
      await setWebhook(token, webhookUrl, webhookSecret || "").catch(() => {});
    }
    return { ok: false, message: `❌ ${err.message}` };
  }
}

/** إرسال إشعار نصي لمشارك عبر chat_id */
export async function notifyParticipant(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = (await res.json()) as any;
    if (data.ok) return { ok: true };
    return { ok: false, message: data.description || "فشل الإرسال" };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

/** جلب username البوت عبر getMe */
export async function getBotUsername(botToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = (await res.json()) as any;
    if (data.ok && data.result?.username) return data.result.username as string;
    return null;
  } catch {
    return null;
  }
}

/** تسجيل Webhook للبوت — يُستدعى عند تفعيل ميزة المشاركين */
export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secret: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message"],
      }),
    });
    const data = (await res.json()) as any;
    if (data.ok) return { ok: true };
    return { ok: false, message: data.description || "فشل تسجيل الـ Webhook" };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

/** حذف Webhook للبوت */
export async function deleteWebhook(botToken: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: "POST" }).catch(() => {});
}
