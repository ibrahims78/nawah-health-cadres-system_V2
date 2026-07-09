---
name: Email participant invite feature
description: How participant invite email sending works — endpoints, template, security decisions
---

## Design

Single-send: `POST /api/projects/:id/participants/:pid/send-invite-email`
Batch-send:  `POST /api/projects/:id/participants/send-invite-email-batch`

Both require `requireAuth` + `requireParticipantEditAccess`.

## Security decisions

**Why:** code review flagged `req.protocol + req.get("host")` as open to host-header injection.
**Fix:** `getTrustedBaseUrl(req)` in `participants.ts` uses `REPLIT_DOMAINS` → `REPLIT_DEV_DOMAIN` → local fallback.

**Why:** concurrent sends could lose emailCount increments with read-then-write.
**Fix:** atomic SQL: `SET email_count = COALESCE(email_count,0)+1, last_emailed_at=NOW()` via `db.execute(sql`...`)`.

Email addresses are validated with `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` before sending.

## Schema additions
`project_participants.last_emailed_at` (TIMESTAMP) and `email_count` (INTEGER DEFAULT 0).
Migration added to `server/index.ts` as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

## UI

- Per-row `<Mail>` button — shown for all participants, enabled only when `identifierType === "email"` and `identifier` non-empty; disabled/greyed otherwise.
- Button turns green + shows send count when `emailCount > 0` (resend state).
- Bulk bar: "إرسال بريد" / "Email" button appears when selection > 0 → confirms → shows result dialog (sent/noEmail/failed counts + error details).
