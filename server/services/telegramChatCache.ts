/**
 * In-memory cache for Telegram chats seen by the webhook handler.
 *
 * Scoped by projectId so that chats from one project's bot are never
 * returned to a different project's admin (cross-project isolation).
 *
 * Entries expire after ENTRY_TTL_MS to prevent stale data from blocking
 * the getUpdates fallback or misleading admins.
 */

const ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_PROJECT = 30;

interface CachedChat {
  id: string;
  title: string;
  type: string;
  seenAt: number;
}

// projectId → list of chats
const cache = new Map<string, CachedChat[]>();

/** Called from the Telegram webhook handler after resolving projectId. */
export function storeChatForProject(
  projectId: string,
  chatId: string,
  chat: {
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    type?: string;
  }
): void {
  const sanitize = (s: string) =>
    s.replace(/[<>&"']/g, "").replace(/[\r\n\t]/g, " ").trim().slice(0, 120);

  const parts = [chat.first_name, chat.last_name].filter(Boolean);
  const rawTitle =
    chat.title ||
    (parts.length ? parts.join(" ") : undefined) ||
    chat.username ||
    chatId;
  const title = sanitize(String(rawTitle));

  const entry: CachedChat = {
    id: chatId,
    title,
    type: chat.type || "private",
    seenAt: Date.now(),
  };

  let list = cache.get(projectId) ?? [];
  // Update existing entry or prepend
  const idx = list.findIndex((c) => c.id === chatId);
  if (idx !== -1) {
    list[idx] = entry;
  } else {
    list = [entry, ...list];
  }
  // Keep newest MAX_PER_PROJECT entries
  if (list.length > MAX_PER_PROJECT) list = list.slice(0, MAX_PER_PROJECT);
  cache.set(projectId, list);
}

/** Returns recent non-expired chats for a project, sorted newest-first. */
export function getProjectChats(
  projectId: string
): { id: string; title: string; type: string }[] {
  const now = Date.now();
  const list = cache.get(projectId) ?? [];
  return list
    .filter((c) => now - c.seenAt < ENTRY_TTL_MS)
    .map(({ id, title, type }) => ({ id, title, type }));
}

export function hasProjectChats(projectId: string): boolean {
  return getProjectChats(projectId).length > 0;
}
