import {
  pgTable, text, integer, boolean, timestamp, uuid, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod";

// ============================================================
// USERS
// ============================================================
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer"),
  mustChangePassword: boolean("must_change_password").default(false),
  rememberMeToken: text("remember_me_token"),
  rememberMeExpiresAt: timestamp("remember_me_expires_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// USER INVITATIONS
// ============================================================
export const userInvitations = pgTable("user_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"),
  inviteToken: text("invite_token").unique().notNull(),
  // F2: SET NULL so deleting a user doesn't block the operation (RESTRICT default)
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// GLOBAL SYSTEM SETTINGS (app-wide)
// ============================================================
export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey().default("singleton"),
  appName: text("app_name").default("مسارات"),
  appLogoUrl: text("app_logo_url"),
  defaultLanguage: text("default_language").default("ar"),
  timezone: text("timezone").default("Asia/Damascus"),
  // SMTP (global for invitations)
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: text("smtp_user"),
  smtpPassEnc: text("smtp_pass_enc"),
  smtpFromName: text("smtp_from_name"),
  invitationExpiryHours: integer("invitation_expiry_hours").default(72),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// PROJECTS
// ============================================================
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // F2: SET NULL so deleting a user doesn't orphan or block project deletion
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  // Form settings
  invitationCode: text("invitation_code").notNull().default("PROJECT-2026"),
  editTokenHours: integer("edit_token_hours").default(48),
  formEnabled: boolean("form_enabled").default(true),
  formDisabledMessage: text("form_disabled_message"),
  formTitle: text("form_title").notNull().default("نموذج التسجيل"),
  formSubtitle: text("form_subtitle"),
  steps: jsonb("steps").default(["الخطوة الأولى", "الخطوة الثانية", "الخطوة الثالثة", "المراجعة"]),
  // Google Sheets
  googleSheetId: text("google_sheet_id"),
  importSheetId: text("import_sheet_id"),
  googleSheetName: text("google_sheet_name").default("بيانات"),
  googleServiceAccountEmail: text("google_service_account_email"),
  googleServiceAccountKeyEnc: text("google_service_account_key_enc"),
  googleDriveFolderId: text("google_drive_folder_id"),
  // Google Drive sync (file upload integration)
  driveSyncEnabled: boolean("drive_sync_enabled").default(false),
  driveRootFolderId: text("drive_root_folder_id"),
  // Google Drive OAuth2 (for personal Gmail — alternative to Service Account)
  driveOAuthClientId: text("drive_oauth_client_id"),
  driveOAuthClientSecretEnc: text("drive_oauth_client_secret_enc"),
  driveOAuthRefreshTokenEnc: text("drive_oauth_refresh_token_enc"),
  driveOAuthError: text("drive_oauth_error"),
  // Telegram
  telegramBotTokenEnc: text("telegram_bot_token_enc"),
  telegramChatId: text("telegram_chat_id"),
  // Chats seen by the webhook — persisted so autoscale instances share state
  telegramKnownChats: jsonb("telegram_known_chats").$type<Array<{ id: string; title: string; type: string; seenAt: number }> | null>().default(null),
  // ── Participant Tracking ──────────────────────────────────
  participantsEnabled: boolean("participants_enabled").default(false),
  participantNameField: text("participant_name_field"),
  participantEditHours: integer("participant_edit_hours").default(48),
  participantAllowOpen: boolean("participant_allow_open").default(false),
  // ── Automated Reminders ───────────────────────────────────
  reminderEnabled: boolean("reminder_enabled").default(false),
  reminderIntervalDays: integer("reminder_interval_days").default(2),
  reminderMaxCount: integer("reminder_max_count").default(3),
  confirmationEmailEnabled: boolean("confirmation_email_enabled").default(true),
  // ── Public form (general registration, no participant pre-invite) email flow ──
  publicConfirmationEmailEnabled: boolean("public_confirmation_email_enabled").default(false),
  publicReminderEnabled: boolean("public_reminder_enabled").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// PROJECT FIELDS (dynamic schema per project)
// ============================================================
export const projectFields = pgTable("project_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  isRequired: boolean("is_required").default(false),
  isVisible: boolean("is_visible").default(true),
  options: jsonb("options"),
  stepNumber: integer("step_number").default(1),
  orderIndex: integer("order_index").default(0),
  placeholder: text("placeholder"),
  validationMin: integer("validation_min"),
  validationMax: integer("validation_max"),
  validationRegex: text("validation_regex"),
  validationMessage: text("validation_message"),
  // Conditional visibility: array of { field, value, negate? } evaluated with conditionOperator
  conditions: jsonb("conditions"),
  conditionOperator: text("condition_operator").default("AND"),
  // Who can see this field in admin add/edit record forms ("all" | "admin" | "editor")
  visibleTo: text("visible_to").default("all"),
  // Field becomes read-only after the record is created (still shown, cannot be edited)
  isReadOnly: boolean("is_read_only").default(false),
  // Force full-width (col-span-2) regardless of field type
  isFullWidth: boolean("is_full_width").default(false),
  // File-field restrictions (null = use global defaults)
  allowedFileTypes: jsonb("allowed_file_types").$type<string[] | null>().default(null),
  maxFileSizeMb: integer("max_file_size_mb"),
  // Maximum number of files per field (null/1 = single file, >1 = multi-file stored as array)
  maxFiles: integer("max_files"),
}, (t) => ({
  projectIdIdx:  index("project_fields_project_id_idx").on(t.projectId),
  // Unique (projectId, key) — prevents duplicate field keys that cause frontend mapping collisions
  projectKeyUniq: uniqueIndex("project_fields_project_key_idx").on(t.projectId, t.key),
}));

// ============================================================
// PROJECT FORM DRAFTS (server-persisted autosave for public form)
// ============================================================
export const projectFormDrafts = pgTable("project_form_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  draftId: text("draft_id").notNull(),
  data: jsonb("data").notNull().default({}),
  step: integer("step").default(0),
  // Extracted from the draft's own data (the project's first email-type field, if any) —
  // lets the abandoned-draft reminder cycle find candidates without re-parsing field defs.
  email: text("email"),
  remindersSent: integer("reminders_sent").default(0),
  lastReminderAt: timestamp("last_reminder_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  projectIdIdx:   index("project_form_drafts_project_id_idx").on(t.projectId),
  // F3: Index email — scheduler queries this column on every reminder cycle
  emailIdx:       index("project_form_drafts_email_idx").on(t.email),
  // Ensures each draft_id is unique within a project (matches the UNIQUE constraint in initDB)
  projectDraftUniq: uniqueIndex("project_form_drafts_project_draft_idx").on(t.projectId, t.draftId),
}));

// ============================================================
// PROJECT RECORDS (dynamic data as JSONB)
// ============================================================
export const projectRecords = pgTable("project_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sequentialNumber: integer("sequential_number"),
  data: jsonb("data").notNull().default({}),
  editToken: uuid("edit_token").defaultRandom(),
  tokenExpiresAt: timestamp("token_expires_at"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  sheetsRowIndex: integer("sheets_row_index"),
  // Drive sync fields
  driveFiles: jsonb("drive_files").$type<Record<string, { fileId: string; driveUrl: string; originalName: string; syncedAt: string } | null>>().default({}),
  driveFolderId: text("drive_folder_id"),
  syncStatus: text("sync_status").default("local"),
}, (t) => ({
  projectIdIdx:   index("project_records_project_id_idx").on(t.projectId),
  submittedAtIdx: index("project_records_submitted_at_idx").on(t.submittedAt),
  // Unique (projectId, sequentialNumber) — enforces sequential number uniqueness at DB level
  projectSeqUniq: uniqueIndex("project_records_project_seq_idx").on(t.projectId, t.sequentialNumber),
}));

// ============================================================
// PROJECT AUDIT LOG
// ============================================================
export const projectAuditLog = pgTable("project_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  // set null on record delete so audit history is preserved even when a record is removed
  recordId: uuid("record_id").references(() => projectRecords.id, { onDelete: "set null" }),
  changedBy: text("changed_by"),
  action: text("action").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
  changesJson: jsonb("changes_json"),
}, (t) => ({
  projectIdIdx: index("project_audit_log_project_id_idx").on(t.projectId),
  recordIdIdx: index("project_audit_log_record_id_idx").on(t.recordId),
  changedAtIdx: index("project_audit_log_changed_at_idx").on(t.changedAt),
}));

// ============================================================
// PROJECT COLLABORATORS  (admin grants editor access to non-owned projects)
// ============================================================
export const projectCollaborators = pgTable("project_collaborators", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // F2: SET NULL on grantor deletion — collaborator record stays, grantor reference nulled
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  /** "edit"  — content only (records/fields/uploads); cannot delete project or change settings.
   *  "full"  — equivalent to project owner; all operations including settings & delete. */
  permission: text("permission").notNull().default("edit"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  projectIdIdx: index("project_collaborators_project_id_idx").on(t.projectId),
  userIdIdx: index("project_collaborators_user_id_idx").on(t.userId),
  // Prevents a user from being added as a collaborator on the same project twice
  projectUserUniq: uniqueIndex("project_collaborators_project_user_idx").on(t.projectId, t.userId),
}));

// ============================================================
// PROJECT PARTICIPANTS (invite-based tracking)
// ============================================================
export const projectParticipants = pgTable("project_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  identifier: text("identifier"),
  identifierType: text("identifier_type").default("email"),
  token: uuid("token").notNull().defaultRandom(),
  telegramChatId: text("telegram_chat_id"),
  prefillData: jsonb("prefill_data").$type<Record<string, any>>().default({}),
  recordId: uuid("record_id").references(() => projectRecords.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  firstOpenedAt: timestamp("first_opened_at"),
  lastNotifiedAt: timestamp("last_notified_at"),
  notifyCount: integer("notify_count").default(0),
  lastEmailedAt: timestamp("last_emailed_at"),
  emailCount: integer("email_count").default(0),
  addedAt: timestamp("added_at").defaultNow(),
  notes: text("notes"),
}, (t) => ({
  projectIdIdx: index("project_participants_project_id_idx").on(t.projectId),
  submittedAtIdx: index("project_participants_submitted_at_idx").on(t.submittedAt),
  // Unique invite token — used as the secret URL segment; collision would allow token hijacking
  tokenUniq: uniqueIndex("project_participants_token_idx").on(t.token),
}));

// ============================================================
// TYPES
// ============================================================
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ProjectField = typeof projectFields.$inferSelect;
export type InsertProjectField = typeof projectFields.$inferInsert;
export type ProjectRecord = typeof projectRecords.$inferSelect;
export type InsertProjectRecord = typeof projectRecords.$inferInsert;
export type ProjectAuditLog = typeof projectAuditLog.$inferSelect;
export type ProjectFormDraft = typeof projectFormDrafts.$inferSelect;
export type InsertProjectFormDraft = typeof projectFormDrafts.$inferInsert;
export type ProjectParticipant = typeof projectParticipants.$inferSelect;
export type InsertProjectParticipant = typeof projectParticipants.$inferInsert;

// ============================================================
// ZOD SCHEMAS
// ============================================================
export const insertUserSchema = z.object({
  fullName: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل").max(200, "الاسم طويل جداً"),
  email: z.string().email("بريد إلكتروني غير صالح").max(320, "البريد الإلكتروني طويل جداً"),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

export const createUserSchema = insertUserSchema.extend({
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(200, "كلمة المرور طويلة جداً"),
});

// Cap at 500 IDs — prevents inArray() from generating multi-MB SQL queries
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid("معرف غير صالح"))
    .min(1, "يجب تحديد سجل واحد على الأقل")
    .max(500, "لا يمكن حذف أكثر من 500 سجل في طلب واحد"),
});

export const projectFieldSchema = z.object({
  key:   z.string().min(1).max(100,  "مفتاح الحقل طويل جداً"),
  label: z.string().min(1).max(200,  "اسم الحقل طويل جداً"),
  fieldType: z.enum(["text", "number", "date", "select", "radio", "textarea", "phone", "email", "checkbox", "autoincrement", "file", "heading"]).default("text"),
  isRequired: z.boolean().default(false),
  isVisible:  z.boolean().default(true),
  // Cap options count and each option length
  options: z.array(z.string().max(200, "الخيار طويل جداً")).max(200, "عدد الخيارات كبير جداً").nullish(),
  stepNumber:  z.number().int().min(1).max(20).default(1),
  orderIndex:  z.number().int().min(0).max(1000).default(0),
  placeholder:       z.string().max(300).nullish(),
  validationMin:     z.number().nullish(),
  validationMax:     z.number().nullish(),
  // Regex cap: keep sane, prevents ReDoS-adjacent patterns being stored
  validationRegex:   z.string().max(500, "التعبير النمطي طويل جداً").nullish(),
  validationMessage: z.string().max(300, "رسالة التحقق طويلة جداً").nullish(),
  conditions: z.array(z.object({
    field: z.string().min(1).max(100),
    value: z.string().max(500).nullable().optional(),
    negate: z.boolean().optional(),
  })).max(20, "عدد الشروط كبير جداً").nullable().optional(),
  conditionOperator: z.preprocess(v => (v === null || v === undefined ? "AND" : v), z.enum(["AND", "OR"])).default("AND"),
  visibleTo:   z.enum(["all", "admin", "editor"]).default("all"),
  isReadOnly:  z.boolean().default(false),
  isFullWidth: z.boolean().default(false),
});

export const createProjectSchema = z.object({
  name:           z.string().min(1, "اسم المشروع مطلوب").max(200, "الاسم طويل جداً"),
  description:    z.string().max(2000, "الوصف طويل جداً").optional(),
  formTitle:      z.string().max(200,  "عنوان النموذج طويل جداً").optional(),
  formSubtitle:   z.string().max(500,  "العنوان الفرعي طويل جداً").optional(),
  invitationCode: z.string().max(100,  "رمز الدعوة طويل جداً").optional(),
  steps: z.array(z.string().max(100, "اسم الخطوة طويل جداً")).max(10, "لا يمكن تجاوز 10 خطوات").optional(),
});

export const updateProjectSchema = z.object({
  name:                z.string().min(1).max(200).optional(),
  description:         z.string().max(2000).nullish(),
  formTitle:           z.string().max(200).nullish(),
  formSubtitle:        z.string().max(500).nullish(),
  invitationCode:      z.string().max(100).nullish(),
  editTokenHours:      z.coerce.number().int().min(1).max(8760).optional(),
  formEnabled:         z.boolean().optional(),
  formDisabledMessage: z.string().max(500).nullish(),
  steps: z.array(z.string().max(100)).max(10).optional(),
  googleSheetId:               z.string().max(200).nullish(),
  importSheetId:               z.string().max(200).nullish(),
  googleSheetName:             z.string().max(200).nullish(),
  googleServiceAccountEmail:   z.string().email().max(320).optional().or(z.literal("")).or(z.null()),
  googleServiceAccountKey:     z.string().max(8000).nullish(),   // SA JSON key is ~2–4 KB
  googleDriveFolderId:         z.string().max(200).nullish(),
  driveRootFolderId:           z.string().max(200).nullish(),
  telegramChatId:              z.string().max(100).nullish(),
  telegramBotToken:            z.string().max(200).nullish(),
  driveOAuthClientId:          z.string().max(200).nullish(),
  driveOAuthClientSecret:      z.string().max(200).nullish(),
  // Participant tracking
  participantsEnabled:   z.boolean().optional(),
  participantNameField:  z.string().max(100).nullish(),
  participantEditHours:  z.coerce.number().int().min(1).max(8760).optional(),
  participantAllowOpen:  z.boolean().optional(),
  // Automated reminders
  reminderEnabled:        z.boolean().optional(),
  reminderIntervalDays:   z.coerce.number().int().min(1).max(30).optional(),
  reminderMaxCount:       z.coerce.number().int().min(1).max(20).optional(),
  confirmationEmailEnabled:        z.boolean().optional(),
  // Public form (general registration) email flow
  publicConfirmationEmailEnabled: z.boolean().optional(),
  publicReminderEnabled:          z.boolean().optional(),
  // Drive sync toggle (was missing from plainFields — now validated here too)
  driveSyncEnabled: z.boolean().optional(),
});

export const updateUserRoleSchema = z.object({
  role:     z.enum(["admin", "editor", "viewer"]),
  fullName: z.string().min(2).max(200).optional(),
  email:    z.string().email().max(320).optional(),
});

export const globalSettingsSchema = z.object({
  appName:               z.string().min(1).max(100).optional(),
  appLogoUrl:            z.string().max(500).regex(/^https?:\/\//, "يجب أن يبدأ الرابط بـ http:// أو https://").optional().or(z.literal("")),
  defaultLanguage:       z.enum(["ar", "en"]).optional(),
  timezone:              z.string().max(100).optional(),
  invitationExpiryHours: z.number().int().min(1).max(8760).optional(),
  smtpHost:              z.string().max(253).optional(),   // max DNS hostname length
  smtpPort:              z.number().int().min(1).max(65535).optional(),
  smtpUser:              z.string().max(320).optional(),
  smtpPass:              z.string().max(200).optional(),
  smtpFromName:          z.string().max(100).optional(),
});

export const verifyCodeSchema = z.object({
  code: z.string().min(1, "رمز الدعوة مطلوب").max(200, "الرمز طويل جداً"),
});

// Public form submission: open key/value map.
// Caps: ≤100 fields, each string value ≤ 10 000 chars — guards against
// both mass-field injection and oversized individual values.
export const submitFormSchema = z.object({}).catchall(
  z.union([
    z.string().max(10_000, "قيمة الحقل طويلة جداً"),
    z.array(z.string().max(10_000, "قيمة الملف طويلة جداً")).max(50, "عدد الملفات كبير جداً"),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
  ]).transform(v => (v === undefined ? null : v))
).superRefine((data, ctx) => {
  if (Object.keys(data).length > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "عدد الحقول كبير جداً" });
  }
});

export const insertParticipantSchema = z.object({
  name:           z.string().min(1, "الاسم مطلوب").max(200, "الاسم طويل جداً"),
  identifier:     z.string().max(320).optional(),
  identifierType: z.enum(["email", "phone", "national_id", "custom"]).default("email"),
  prefillData:    z.record(z.any()).optional(),
  notes:          z.string().max(2000).optional(),
});

export const updateParticipantSchema = z.object({
  name:           z.string().min(1).max(200).optional(),
  identifier:     z.string().max(320).nullish(),
  identifierType: z.enum(["email", "phone", "national_id", "custom"]).optional(),
  prefillData:    z.record(z.any()).optional(),
  notes:          z.string().max(2000).nullish(),
  telegramChatId: z.string().max(100).nullish(),
});
