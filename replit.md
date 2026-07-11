# مسارات — Masarat Sheet2Site

A full-stack bilingual (Arabic/English) multi-project platform that converts any spreadsheet (Excel) into a multi-step public data-registration website, with an admin dashboard, secure file uploads, and live Google Sheets / Google Drive sync.

Each "project" is an independent form: admins/editors can create unlimited projects, define custom dynamic fields (imported from an Excel file or built from scratch), and share a public registration link. End users submit data (with optional file attachments) through the public multi-step form; admins/editors manage records, files, and integrations in a private dashboard.

## Tech Stack

- **Frontend:** React 18 + Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Node.js + Express, TypeScript (tsx)
- **Database:** PostgreSQL (Replit managed) with Drizzle ORM
- **State/Routing:** TanStack Query v5, Wouter
- **Integrations:** Google Sheets API, Telegram Bot API, Nodemailer (SMTP)
- **Security:** AES-256-GCM field-level encryption, Helmet, rate limiting, express-session

## Running the App

```
npm run dev
```

- Frontend (Vite): http://localhost:5000
- Backend (Express): http://localhost:3001
- Vite proxies `/api/*` → backend automatically

## Required Secrets

| Secret | Description |
|---|---|
| `SESSION_SECRET` | Express session signing key |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM field encryption |

## Optional Integration Secrets

| Secret | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Sheets / Drive integration |
| `TELEGRAM_BOT_TOKEN` | Telegram notifications |
| SMTP credentials | Email (configurable per-project in admin settings) |

## First Run

On a fresh database, the app shows a setup wizard to create the first admin account. After that, admins can create projects (optionally importing an Excel file to auto-generate fields), define custom form fields, and manage submitted records.

## Roles

- **Admin:** full access to all projects, users, and global settings.
- **Editor:** full access only to projects they created (enforced server-side via `requireProjectOwnership` / `requireProjectReadAccess`).
- **Viewer:** read/export access to all projects, no write access.

## Project Structure

```
client/     React frontend (public multi-step form + admin dashboard)
server/     Express backend (routes/, middleware/, services/)
shared/     Drizzle schema + Zod validators shared by both
docs/       Feature plans and audit reports
```

## Database

Schema is managed via `initDB()` in `server/index.ts` (CREATE TABLE IF NOT EXISTS + ALTER TABLE migrations). Push schema changes with `npm run db:push`.

## Replit Setup (completed)

The following was done to get the project running on Replit (re-verified after a fresh GitHub import on 2026-07-11):

1. **Dependencies** — `npm install` installs all packages including `concurrently` (devDep used by `npm run dev`).
2. **Database** — Replit's built-in PostgreSQL is used. Schema is applied via `npm run db:push` (Drizzle Kit reads `drizzle.config.ts` and `DATABASE_URL` from the runtime environment).
3. **Secrets configured:**
   - `SESSION_SECRET` — Express session signing key
   - `ENCRYPTION_KEY` — 32-byte hex key for AES-256-GCM field encryption (regenerated and saved as a secret during this setup, since the imported repo had no key stored)
4. **Workflow** — `Start application` runs `npm run dev` (concurrently starts Vite on port 5000 and Express on port 3001). Vite proxies `/api/*` to the backend automatically.
5. **First run** — Verified: the app shows the setup wizard at `/` on a fresh database (no admin account yet) to create the first admin account.

## Architecture — Unified Components (added 2026-07-11)

Three major shared components were extracted as part of the unification plan (docs/unification-plan.md). Any new field type, validation rule, or form rendering logic should be added to these shared files — they automatically propagate to all pages.

### 1. `client/src/components/fields/FieldEditor.tsx`
Unified single-field editor used in **ProjectSettings** (tab "fields") and **CreateProject** (wizard step 1). Covers: field type, label, key, step, placeholder, required/visible toggles, conditions, validation (min/max/regex/message), access control (visibleTo, isReadOnly), full-width, file settings, select/radio options.

- **Rule:** Any new field type or advanced property must be added here only — it will appear in all admin pages automatically.
- Companion utility: `client/src/lib/fieldEditorUtils.ts` (FieldEditorField type, FIELD_TYPES arrays, getFieldTypes/getCreateFieldTypes).

### 2. `client/src/hooks/useProjectFormEngine.ts`
Shared form logic hook used by **ProjectRegister**, **ProjectEditForm**, and **ProjectParticipantForm**. Provides:
- `isFieldVisible(f)` — conditional field visibility
- `fieldValidationRules(f)` — full validation (required + email pattern + admin-configured regex/min/max)
- Internal "clear hidden fields" useEffect — automatically zeros out values when a conditional field is hidden

### 3. `client/src/components/forms/DynamicFieldRenderer.tsx`
Renders a single form field (all types) inside public-facing forms. Used by all three form pages. Each page keeps its own unique context (upload URL, auth token, draft logic, etc.) outside this component.

## User Preferences

- Keep bilingual support (Arabic/English) intact across all changes
- Do not restructure the monorepo layout
