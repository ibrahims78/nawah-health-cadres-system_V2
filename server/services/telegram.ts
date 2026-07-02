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
        text: "✅ *اختبار ناجح* — نظام بيانات الكوادر الصحية متصل بـ Telegram",
        parse_mode: "Markdown",
      }),
    });
    const data = (await response.json()) as any;
    if (data.ok) return { ok: true, message: "✅ تم الاتصال وإرسال الرسالة بنجاح" };

    // Translate common Telegram errors to Arabic
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

/** جلب آخر المحادثات التي أرسل إليها البوت — يساعد في معرفة Chat ID */
export async function getTelegramUpdates(
  token: string
): Promise<{ ok: boolean; chats?: Array<{ id: string; title: string; type: string }>; message?: string }> {
  const base = `https://api.telegram.org/bot${token}`;
  try {
    // If a webhook is active, getUpdates will fail — delete it first silently
    await fetch(`${base}/deleteWebhook`, { method: "POST" }).catch(() => {});

    const response = await fetch(`${base}/getUpdates?limit=50&offset=-50`);
    const data = (await response.json()) as any;

    if (!data.ok) {
      const desc: string = data.description || "";
      const hint = desc.includes("Unauthorized") ? "Bot Token غير صحيح" : desc;
      return { ok: false, message: `❌ ${hint}` };
    }

    // Extract unique chats from updates
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
    return { ok: false, message: `❌ ${err.message}` };
  }
}
