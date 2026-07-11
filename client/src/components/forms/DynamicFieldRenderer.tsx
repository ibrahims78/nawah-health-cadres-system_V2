/**
 * DynamicFieldRenderer — Shared field rendering component for all public-facing forms.
 *
 * What is shared (handled here):
 *   - Rendering every field type (text, number, date, select, radio, textarea,
 *     checkbox, file, email, phone, heading, autoincrement).
 *   - Displaying field-level validation errors.
 *   - isReadOnly display mode (used by ProjectEditForm).
 *   - col-span logic for full-width / textarea / file / checkbox fields.
 *
 * What stays in the calling page (intentional differences):
 *   - Conditional visibility check — caller must skip hidden fields before rendering.
 *   - Upload URL construction — each form has its own auth context.
 *   - `validationRules` — supplied by `useProjectFormEngine.fieldValidationRules(f)`
 *     or a simpler inline object, so the caller controls the level of validation.
 *
 * Usage:
 *   import { DynamicFieldRenderer } from "@/components/forms/DynamicFieldRenderer";
 *
 *   const { fieldValidationRules } = useProjectFormEngine({ ... });
 *
 *   {visibleFields.map(f => (
 *     <DynamicFieldRenderer
 *       key={f.id}
 *       field={f}
 *       register={register}
 *       errors={errors}
 *       formValues={watchedValues}
 *       setValue={setValue}
 *       isAr={isAr}
 *       validationRules={fieldValidationRules(f)}
 *       uploadConfig={{ url: `/api/pform/${projectId}/upload`, folder: uploadFolder }}
 *     />
 *   ))}
 */

import type { UseFormRegister, FieldErrors } from "react-hook-form";
import type { ProjectField } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileField } from "@/components/FileField";
import { cn } from "@/lib/utils";

export interface UploadConfig {
  /** Base upload URL (e.g. `/api/pform/${projectId}/upload`). */
  url: string;
  /**
   * Upload folder / session identifier.
   * - ProjectRegister: a stable UUID generated once per submission session.
   * - ProjectEditForm: the edit token.
   * - ProjectParticipantForm: a stable UUID generated once per submission session.
   */
  folder: string;
  /**
   * Optional query-string suffix appended to the upload URL for auth.
   * Example: `?token=abc&project=123` (used by ProjectEditForm).
   */
  authSuffix?: string;
}

export interface DynamicFieldRendererProps {
  field: ProjectField;
  register: UseFormRegister<Record<string, any>>;
  errors: FieldErrors<Record<string, any>>;
  /** Current form values — required for controlled file fields and read-only display. */
  formValues: Record<string, any>;
  setValue: (key: string, value: any, opts?: any) => void;
  isAr: boolean;
  /** Pre-computed validation rules from `useProjectFormEngine.fieldValidationRules(f)`. */
  validationRules: Record<string, any>;
  /** Upload configuration. Pass null to suppress file upload UI (e.g. review-only views). */
  uploadConfig?: UploadConfig | null;
  /**
   * Enable read-only field display for fields with `isReadOnly = true`.
   * Used by ProjectEditForm. Defaults to false.
   */
  showReadOnly?: boolean;
  /**
   * Override label CSS classes. Defaults to the standard form label style.
   * Pass a custom value to match per-form typography.
   */
  labelClassName?: string;
}

export function DynamicFieldRenderer({
  field: f,
  register,
  errors,
  formValues,
  setValue,
  isAr,
  validationRules,
  uploadConfig,
  showReadOnly = false,
  labelClassName = "text-sm font-medium text-slate-700 dark:text-slate-200",
}: DynamicFieldRendererProps) {
  // autoincrement fields are filled server-side — never shown to the public
  if (f.fieldType === "autoincrement") return null;

  // Heading fields render as static instructional text — no input, no label wrapper
  if (f.fieldType === "heading") {
    return (
      <div className="col-span-2 pt-2">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 border-r-4 border-primary pr-3 py-1">
          {f.label}
        </p>
        {f.placeholder && (
          <p className="text-xs text-muted-foreground mt-1 pr-4">{f.placeholder}</p>
        )}
      </div>
    );
  }

  const isFullW =
    (f as any).isFullWidth ||
    f.fieldType === "textarea" ||
    f.fieldType === "file" ||
    f.fieldType === "checkbox";

  const fieldError = (errors as any)?.[f.key]?.message as string | undefined;

  // ── Read-only mode (ProjectEditForm) ───────────────────────────────────────
  if (showReadOnly && (f as any).isReadOnly) {
    return (
      <div className={cn("space-y-1.5", isFullW ? "col-span-2" : "")}>
        <Label className={labelClassName}>
          {f.label}
          {f.isRequired && <span className="text-red-500 mr-1">*</span>}
        </Label>
        <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 select-none">
          <input type="hidden" {...register(f.key)} />
          <span className="font-medium">{formValues[f.key] || "—"}</span>
          <span className="text-xs text-muted-foreground">
            ({isAr ? "للقراءة فقط" : "read only"})
          </span>
        </div>
      </div>
    );
  }

  // ── Normal editable field ──────────────────────────────────────────────────
  return (
    <div className={cn("space-y-1.5", isFullW ? "col-span-2" : "")}>
      <Label className={labelClassName}>
        {f.label}
        {f.isRequired && <span className="text-red-500 mr-1">*</span>}
      </Label>

      {f.fieldType === "checkbox" ? (
        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            {...register(f.key, validationRules)}
            className="accent-primary w-4 h-4 rounded"
            data-testid={`checkbox-${f.key}`}
          />
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {f.placeholder || ""}
          </span>
        </label>
      ) : f.fieldType === "textarea" ? (
        <Textarea
          {...register(f.key, validationRules)}
          placeholder={f.placeholder || ""}
          rows={3}
          data-testid={`input-${f.key}`}
        />
      ) : (f.fieldType === "select" || f.fieldType === "radio") && f.options ? (
        f.fieldType === "select" ? (
          <select
            {...register(f.key, validationRules)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
            data-testid={`select-${f.key}`}
          >
            <option value="">{isAr ? "— اختر —" : "— Select —"}</option>
            {(f.options as string[]).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-3 pt-1">
            {(f.options as string[]).map(opt => (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:border-primary/50 transition"
              >
                <input
                  type="radio"
                  {...register(f.key, validationRules)}
                  value={opt}
                  className="accent-primary w-3.5 h-3.5"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )
      ) : f.fieldType === "file" ? (
        <>
          <input type="hidden" {...register(f.key, validationRules)} />
          {uploadConfig ? (
            <FileField
              value={formValues[f.key]}
              onChange={url => setValue(f.key, url, { shouldValidate: true })}
              uploadUrl={uploadConfig.url + (uploadConfig.authSuffix || "")}
              fieldKey={f.key}
              uploadFolder={uploadConfig.folder}
              allowedTypes={(f as any).allowedFileTypes}
              maxSizeMb={(f as any).maxFileSizeMb}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">—</p>
          )}
        </>
      ) : (
        <Input
          {...register(f.key, validationRules)}
          type={
            f.fieldType === "number" ? "number" :
            f.fieldType === "date"   ? "date"   :
            f.fieldType === "email"  ? "email"  :
            f.fieldType === "phone"  ? "tel"    : "text"
          }
          placeholder={f.placeholder || ""}
          data-testid={`input-${f.key}`}
        />
      )}

      {fieldError && (
        <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
          <span>⚠</span> {fieldError}
        </p>
      )}
    </div>
  );
}
