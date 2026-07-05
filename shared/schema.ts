import {
  pgTable, text, integer, boolean, timestamp, uuid, jsonb,
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
  invitedBy: uuid("invited_by").references(() => users.id),
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
  createdBy: uuid("created_by").references(() => users.id),
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
  // Telegram
  telegramBotTokenEnc: text("telegram_bot_token_enc"),
  telegramChatId: text("telegram_chat_id"),
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
});

// ============================================================
// PROJECT FORM DRAFTS (server-persisted autosave for public form)
// ============================================================
export const projectFormDrafts = pgTable("project_form_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  draftId: text("draft_id").notNull(),
  data: jsonb("data").notNull().default({}),
  step: integer("step").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
});

// ============================================================
// PROJECT AUDIT LOG
// ============================================================
export const projectAuditLog = pgTable("project_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").references(() => projectRecords.id, { onDelete: "cascade" }),
  changedBy: text("changed_by"),
  action: text("action").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
  changesJson: jsonb("changes_json"),
});

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

// ============================================================
// ZOD SCHEMAS
// ============================================================
export const insertUserSchema = z.object({
  fullName: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

export const createUserSchema = insertUserSchema.extend({
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid("معرف غير صالح")).min(1, "يجب تحديد سجل واحد على الأقل"),
});

export const projectFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(["text", "number", "date", "select", "radio", "textarea", "phone", "email", "checkbox", "autoincrement", "file", "heading"]).default("text"),
  isRequired: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  options: z.array(z.string()).nullish(),
  stepNumber: z.number().int().min(1).default(1),
  orderIndex: z.number().int().default(0),
  placeholder: z.string().nullish(),
  validationMin: z.number().nullish(),
  validationMax: z.number().nullish(),
  validationRegex: z.string().nullish(),
  validationMessage: z.string().nullish(),
  conditions: z.array(z.object({
    field: z.string().min(1),
    value: z.string().nullable().optional(),
    negate: z.boolean().optional(),
  })).nullable().optional(),
  conditionOperator: z.enum(["AND", "OR"]).default("AND"),
  visibleTo: z.enum(["all", "admin", "editor"]).default("all"),
  isReadOnly: z.boolean().default(false),
  isFullWidth: z.boolean().default(false),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, "اسم المشروع مطلوب"),
  description: z.string().optional(),
  formTitle: z.string().optional(),
  formSubtitle: z.string().optional(),
  invitationCode: z.string().optional(),
  steps: z.array(z.string()).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  formTitle: z.string().nullish(),
  formSubtitle: z.string().nullish(),
  invitationCode: z.string().nullish(),
  editTokenHours: z.coerce.number().int().min(1).max(8760).optional(),
  formEnabled: z.boolean().optional(),
  formDisabledMessage: z.string().nullish(),
  steps: z.array(z.string()).optional(),
  googleSheetId: z.string().nullish(),
  importSheetId: z.string().nullish(),
  googleSheetName: z.string().nullish(),
  googleServiceAccountEmail: z.string().email().optional().or(z.literal("")).or(z.null()),
  googleServiceAccountKey: z.string().nullish(),
  googleDriveFolderId: z.string().nullish(),
  telegramChatId: z.string().nullish(),
  telegramBotToken: z.string().nullish(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
});

export const globalSettingsSchema = z.object({
  appName: z.string().min(1).optional(),
  appLogoUrl: z.string().optional(),
  defaultLanguage: z.enum(["ar", "en"]).optional(),
  timezone: z.string().optional(),
  invitationExpiryHours: z.number().int().min(1).max(8760).optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFromName: z.string().optional(),
});

export const verifyCodeSchema = z.object({
  code: z.string().min(1, "رمز الدعوة مطلوب").max(200, "الرمز طويل جداً"),
});

export const submitFormSchema = z.object({}).catchall(
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
    .transform(v => (v === undefined ? null : v))
);
