---
name: Participants feature hardening (follow-up pass)
description: Second hardening pass on the participants feature — throttling, audit trail, bulk-delete safety, base-URL consolidation, hidden-field clearing
---

- Server-side field validation must mirror client rules exactly (required/email/min/max/regex) and allowlist by real field keys — never trust raw `req.body` keys on submit/edit routes, even when the client already validates.
- **Why:** a direct API call (curl/Postman) bypasses client validation entirely; the only enforcement point that matters is the server.
- **How to apply:** any new participant/public-form submission route must call the shared `validateAndSanitizeSubmission()`-style helper before persisting, not just on the two original routes.

- Bulk-delete of participants that already have a submitted record (non-null `recordId`) needs a two-step confirm: server returns 409 + a count on first attempt, client shows the count and requires an explicit `force:true` retry.
- **Why:** deleting a participant row silently orphans/loses the link to real submitted registration data; users need to see the blast radius before confirming.
- **How to apply:** any future bulk-action endpoint touching participants with `recordId` should follow the same 409-then-force pattern rather than a plain destructive delete.

- All base-URL construction (email links, Telegram webhook links, export links, scheduler links) must go through one shared `getTrustedBaseUrl(req?)` helper (priority: REPLIT_DOMAINS → REPLIT_DEV_DOMAIN → APP_URL → req-derived with warning → empty+error).
- **Why:** duplicated inline implementations drifted (some missing APP_URL fallback, some defaulting to http:// insecurely) and produced broken/empty edit links in emails.
- **How to apply:** never inline base-URL logic again; import the shared helper.

- Batch send loops (Telegram notify, invite emails) must await a small delay (e.g. `sleep(60ms)`) between sends in the loop, skipping the delay after the last item, to avoid tripping provider rate limits on large batches.

- Conditionally-hidden form fields (via `isFieldVisible`/`evaluateCondition` in `shared/fieldVisibility.ts`) must have their react-hook-form value cleared (`setValue(key, "")`) the moment they become hidden, in every public form that uses this visibility system (participant form, open registration form, open edit form) — not just enforced server-side.
- **Why:** stale values from a field the user no longer sees can otherwise be resubmitted/persisted, confusing both admins and the visibility-driven logic itself.
