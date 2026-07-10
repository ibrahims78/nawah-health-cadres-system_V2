/**
 * In-memory cache for Telegram chats seen by the webhook handler.
 *
 * Because Telegram delivers messages to the webhook in real-time, they are
 * consumed immediately and never appear in getUpdates. This cache captures
 * every chat that contacts the bot so the admin can discover their Chat ID
 * without needing to delete + re-register the webhook.
 */

interface CachedChat {
  id: string;
  title: string;
  type: string;
  seenAt: number; // Date.now()
}

const MAX_ENTRIES = 100;
const cache = new Map<string, CachedChat>();

/** Called from the Telegram webhook handler for every incoming message. */
export function storeChatFromWebhook(chatId: string, chat: {
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  type?: string;
}): void {
  const parts = [chat.first_name, chat.last_name].filter(Boolean);
  const title =
    chat.title ||
    (parts.length ? parts.join(" ") : undefined) ||
    chat.username ||
    chatId;

  cache.set(chatId, {
    id: chatId,
    title,
    type: chat.type || "private",
    seenAt: Date.now(),
  });

  // Evict oldest entry when over limit
  if (cache.size > MAX_ENTRIES) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [key, val] of cache) {
      if (val.seenAt < oldestTime) { oldestTime = val.seenAt; oldestKey = key; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

/** Returns recent chats sorted newest-first (up to 30). */
export function getRecentWebhookChats(): { id: string; title: string; type: string }[] {
  return [...cache.values()]
    .sort((a, b) => b.seenAt - a.seenAt)
    .slice(0, 30)
    .map(({ id, title, type }) => ({ id, title, type }));
}

export function hasRecentWebhookChats(): boolean {
  return cache.size > 0;
}
