---
name: Deep audit round 5 fixes
description: All bugs confirmed and fixed in the fifth comprehensive audit pass (6 issues across 5 areas)
---

## F1 — XSS via javascript: URL in <a href> (ProjectRecordDetails.tsx)
**Rule:** All user-supplied or API-derived values placed in `href` attributes must pass through `safeHref()` first. safeHref() allows only http/https and server-relative paths (/); everything else collapses to "#".
**Why:** A field value of type "url" or "file" could contain `javascript:alert(1)` — React renders it verbatim in the DOM, giving XSS on click. Three locations were affected: line 176 (file field), line 250 (local upload link), line 258 (Drive link).
**How to apply:** Any new `<a href={...}>` that uses data from the API must wrap the value in `safeHref()`.

## F2 — FK onDelete missing for invitedBy / createdBy / grantedBy (shared/schema.ts)
**Rule:** invitedBy, createdBy, grantedBy all must use `{ onDelete: "set null" }`.
**Why:** The default PostgreSQL behavior when onDelete is omitted is RESTRICT — deleting a user who created projects, sent invitations, or granted collaborator access would fail at the DB level with a FK violation. SET NULL is the correct semantic: the record survives, the user reference becomes null.

## F3 — Missing index on project_form_drafts.email (schema.ts + initDB)
**Rule:** Add `emailIdx: index("project_form_drafts_email_idx").on(t.email)` to the table's index callback AND `CREATE INDEX IF NOT EXISTS project_form_drafts_email_idx ON project_form_drafts(email)` in initDB.
**Why:** The scheduler scans this column on every 30-minute cycle to find abandonment-reminder candidates. Without an index, each project triggers a full table scan of all drafts.

## F4 — Remember-me: token generated and stored but never consumed (dead code)
**Rule:** Remove the rawToken/tokenHash/expiresAt block from the rememberMe branch in POST /login. Keep only `req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000`.
**Why:** The SHA-256-hashed token was written to users.rememberMeToken but no middleware or route ever reads it. Session-based persistence (longer maxAge) already provides the 30-day feature. The dead token write wastes a DB round-trip and stores a value that can never be revoked via a separate code path.

## F5 — Symlink escape in file serving (server/index.ts)
**Rule:** Replace `await stat(filePath)` with `await lstat(filePath)` (which does NOT follow symlinks). After lstat, check `fileStats.isSymbolicLink()` — if true, return 400. Also check `fileStats.isFile()` to reject directories.
**Why:** `path.normalize()` + `startsWith(uploadsRoot)` blocks `..` path traversal but NOT symlink traversal — an attacker who can place a symlink inside the uploads directory (e.g., via a compromised process) could redirect file serving to any path on the filesystem. lstat sees through the symlink at the OS level.

## Summary of areas audited and confirmed clean
- Client XSS: only the 3 href locations were real; no dangerouslySetInnerHTML, no hardcoded secrets, no token in localStorage
- Access control: all routes have correct middleware chains; no IDOR or privilege escalation found beyond previously fixed D1
- Error leakage: handleError gates err.message behind SHOW_ERROR_DETAIL env var (dev only); no catch block sends raw stack traces
- Crypto: AES-256-GCM correct (IV, auth tag, key); bcrypt cost 12; timing-safe comparisons in place; remember-me token was dead code (now removed)
- File serving: Content-Type from extension allowlist (not browser sniff); IDOR check via JSON string match in record.data; path traversal guarded; symlink escape now blocked
- DB schema: FK onDelete fixed; email index added; timestamp without timezone is an existing design decision (risky migration to change)
- Import/export: operation is atomic (db.transaction); wrong password on import produces safe error; no encrypted values exported in plaintext
- Session/headers: global rate limiter registered before all route mounts; CORS no wildcard; HSTS production-only; body size 512kb
