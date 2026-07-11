/**
 * fieldEditorUtils — Shared constants and helpers for the unified FieldEditor component.
 *
 * Any addition of a new field type or validation rule must be made here and will
 * automatically appear in all places that use FieldEditor (ProjectSettings, CreateProject).
 */

/** Full field-type list — used in ProjectSettings (field editor for existing projects). */
export const FIELD_TYPES_AR = [
  { value: "text",          label: "📝 نص" },
  { value: "number",        label: "🔢 رقم" },
  { value: "date",          label: "📅 تاريخ" },
  { value: "select",        label: "📋 قائمة منسدلة" },
  { value: "radio",         label: "🔘 اختيار واحد" },
  { value: "textarea",      label: "📄 نص طويل" },
  { value: "phone",         label: "📞 هاتف" },
  { value: "email",         label: "✉️ بريد إلكتروني" },
  { value: "file",          label: "📎 رفع ملف" },
  { value: "autoincrement", label: "🔁 ترقيم تلقائي" },
  { value: "checkbox",      label: "☑️ خانة اختيار" },
  { value: "heading",       label: "🔤 نص توجيهي / عنوان" },
];

export const FIELD_TYPES_EN = [
  { value: "text",          label: "📝 Text" },
  { value: "number",        label: "🔢 Number" },
  { value: "date",          label: "📅 Date" },
  { value: "select",        label: "📋 Dropdown" },
  { value: "radio",         label: "🔘 Single Choice" },
  { value: "textarea",      label: "📄 Long Text" },
  { value: "phone",         label: "📞 Phone" },
  { value: "email",         label: "✉️ Email" },
  { value: "file",          label: "📎 File Upload" },
  { value: "autoincrement", label: "🔁 Auto Number" },
  { value: "checkbox",      label: "☑️ Checkbox" },
  { value: "heading",       label: "🔤 Heading / Info Text" },
];

/** Subset used in CreateProject wizard (no checkbox/heading since they were not originally supported there). */
export const CREATE_FIELD_TYPES_AR = FIELD_TYPES_AR.filter(
  t => !["checkbox", "heading"].includes(t.value)
);
export const CREATE_FIELD_TYPES_EN = FIELD_TYPES_EN.filter(
  t => !["checkbox", "heading"].includes(t.value)
);

export function getFieldTypes(isAr: boolean) {
  return isAr ? FIELD_TYPES_AR : FIELD_TYPES_EN;
}

export function getCreateFieldTypes(isAr: boolean) {
  return isAr ? CREATE_FIELD_TYPES_AR : CREATE_FIELD_TYPES_EN;
}

/**
 * Unified field data shape accepted by FieldEditor.
 * Covers both ProjectField (from DB) and ParsedColumn (from Excel import wizard).
 */
export interface FieldEditorField {
  // ── Core — present in both contexts ─────────────────
  label: string;
  key: string;
  fieldType: string;
  isRequired: boolean;
  isVisible?: boolean;
  stepNumber?: number;
  orderIndex?: number;
  options?: string[] | null;

  // ── Excel import wizard ──────────────────────────────
  selected?: boolean;
  samples?: string[];
  originalLabel?: string;

  // ── Advanced (ProjectSettings + CreateProject Phase 2) ──
  id?: string;
  projectId?: string;
  placeholder?: string | null;
  validationMin?: number | null;
  validationMax?: number | null;
  validationRegex?: string | null;
  validationMessage?: string | null;
  conditions?: Array<{ field: string; value?: string | null; negate?: boolean }> | null;
  conditionOperator?: "AND" | "OR" | null;
  visibleTo?: string;
  isReadOnly?: boolean;
  isFullWidth?: boolean;
  allowedFileTypes?: string[] | null;
  maxFileSizeMb?: number | null;
}
