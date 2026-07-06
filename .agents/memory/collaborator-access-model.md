---
name: Collaborator access model
description: How admin-granted editor collaboration works across routes and file serving.
---

## Rule
Three distinct server-side guards exist in `server/routes/projects.ts`:

1. **`requireProjectOwnership`** (strict) — admin or project `createdBy` only.
   Applied to: `PATCH /:id` (project settings/credentials), `DELETE /:id` (delete project).

2. **`requireProjectEditAccess`** (broad) — admin, project owner, OR `project_collaborators` entry.
   Applied to: all content operations (records CRUD, fields, uploads, sheets/telegram/drive ops).

3. **`requireProjectReadAccess`** — admin, viewer, project owner, OR collaborator.
   Applied to: read-only routes (GET project, fields, records, stats, export, audit log).

**Why:** Collaborators must be able to work on records/fields but must NOT be able to delete the project or change its integration credentials. Splitting into two edit guards enforces this without per-route duplication.

## File serving
`server/index.ts` `/uploads/*` editor branch checks both:
- Records in projects where `created_by = sessionUserId` (owner)
- Records in projects where a `project_collaborators` row exists for the session user (collaborator)

## Schema
`project_collaborators (id, project_id, user_id, granted_by, created_at)` with UNIQUE(project_id, user_id).
Added to `shared/schema.ts` as `projectCollaborators` and to `initDB()` migrations.

## Frontend
- `ProjectSettings.tsx`: "المتعاونون / Collaborators" tab, admin-only (hidden for editors/viewers).
  Tab key union typed as `TabKey` to avoid string-widening TS error from conditional spread.
- `Projects.tsx`: "مشارك / Shared" amber badge shown when editor views a non-owned project.

**How to apply:** Any new project-level route must choose the correct guard explicitly.
New project-governing routes → `requireProjectOwnership`.
New content/operational routes → `requireProjectEditAccess`.
