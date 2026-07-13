---
name: Deep audit round 7 fixes
description: Third comprehensive re-audit (8 parallel subagents) — all platform features — actionable fixes applied
---

## Rules and decisions

- **reminderIntervalDays must be floored at 1** — `Math.max(1, intervalDays ?? 2)` in BOTH reminder cycles. A DB value of 0 makes cutoff = now(), making every candidate immediately overdue every 30 min = instant spam.
- **isValidEmail before sending to draft.email** — scheduler publicDraftReminder only did a null check; added `/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test()` guard before atomic claim.
- **CRLF stripping must cover ALL email functions** — previously only applied to sendParticipantReminderEmail. Now also applied to: sendInviteEmail (admin invite), sendParticipantInviteEmail, sendParticipantConfirmEmail. Pattern: strip `[\r\n]+` from `to` and `subject` before sendMail.
- **updateRecordRow must use sparse batchUpdate** — the previous full-row write (`values.update` with a full array padded with "") silently overwrites manually-added sheet columns. Fixed by building individual `ValueRange` objects per project-field column and using `values.batchUpdate`. This preserves any columns the user added manually to the sheet.
- **Prototype pollution guard on req.body spread** — any spread of req.body into a Record must filter out `__proto__`, `constructor`, `prototype` keys first. Use `Object.fromEntries(Object.entries(req.body).filter(([k]) => !DANGEROUS_KEYS.has(k)))`.
- **appLogoUrl requires http/https protocol** — Zod regex `^https?:\/\/` (or empty string). Prevents `javascript:` or `file://` URLs in the logo field.
- **Session pruning** — `connect-pg-simple` does not auto-prune by default. Pass `pruneSessionInterval: 3600` (seconds) to the PgSession constructor.
- **Draft cleanup cycle** — added `runCleanupCycle()` to scheduler: deletes `project_form_drafts` where `updated_at < 30 days ago`. Runs every 6 hours.

**Why:** Found in third full-platform audit (8 subagents × all features). The updateRecordRow issue was the most impactful: it caused silent data loss for any sheet columns added manually by users.
**How to apply:** Any new scheduler cycle involving intervals must floor at 1. Any new email function must strip CRLF. Any sheet write that targets a specific row must use sparse batchUpdate, not full-row overwrite.
