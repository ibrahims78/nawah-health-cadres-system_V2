/**
 * useProjectFormEngine — Shared form logic hook for all public-facing project forms.
 *
 * What is shared (lives here):
 *   - `isFieldVisible(f)`          — conditional visibility check
 *   - `fieldValidationRules(f)`    — react-hook-form validation rules (required, email, regex, min/max)
 *   - "clear hidden field values"  — useEffect that zeros out values when a field becomes hidden
 *
 * What stays in each page (intentional differences):
 *   - ProjectRegister  : draft save/restore, invitation code flow, submit/editToken
 *   - ProjectEditForm  : pre-fill from existing record, isReadOnly display
 *   - ProjectParticipantForm : participant token, Telegram banner, canEdit/canSubmit guards
 *
 * Usage:
 *   const { isFieldVisible, fieldValidationRules } = useProjectFormEngine({
 *     fields, formValues: watchedValues, setValue, isAr,
 *   });
 *
 * The "clear hidden fields" effect runs automatically inside this hook — remove the
 * equivalent inline useEffect from any page that adopts this hook.
 */

import { useEffect } from "react";
import type { ProjectField } from "@shared/schema";
import { isFieldVisible as checkFieldVisible } from "@/lib/fieldVisibility";

export interface UseProjectFormEngineOptions {
  fields: ProjectField[];
  formValues: Record<string, any>;
  setValue: (key: string, value: any) => void;
  isAr: boolean;
}

export interface UseProjectFormEngineReturn {
  isFieldVisible: (f: ProjectField) => boolean;
  fieldValidationRules: (f: ProjectField) => Record<string, any>;
}

export function useProjectFormEngine({
  fields,
  formValues,
  setValue,
  isAr,
}: UseProjectFormEngineOptions): UseProjectFormEngineReturn {
  // ── Clear hidden field values ───────────────────────────────────────────────
  // When a conditional rule hides a field, its stored value is cleared so no
  // stale data is sent on submit.  This mirrors the identical effect that was
  // previously duplicated in all three form pages.
  useEffect(() => {
    for (const f of fields) {
      if (f.fieldType === "heading" || f.fieldType === "autoincrement") continue;
      if (
        !checkFieldVisible(f as any, formValues) &&
        formValues[f.key] !== undefined &&
        formValues[f.key] !== ""
      ) {
        setValue(f.key, "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(formValues), fields]);

  // ── isFieldVisible wrapper ──────────────────────────────────────────────────
  const isFieldVisible = (f: ProjectField) => checkFieldVisible(f as any, formValues);

  // ── fieldValidationRules ───────────────────────────────────────────────────
  // Builds react-hook-form rules from admin-configured field settings.
  // Previously only ProjectParticipantForm used full validation (regex/min/max);
  // now all three forms use the same rule set so admin-configured constraints are
  // consistently enforced across every entry path.
  const fieldValidationRules = (f: ProjectField): Record<string, any> => {
    const rules: Record<string, any> = {};

    if (f.isRequired) {
      rules.required = isAr
        ? `${f.label} مطلوب`
        : `${f.label} is required`;
    }

    if (f.fieldType === "email") {
      rules.pattern = {
        value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        message: isAr ? "بريد إلكتروني غير صحيح" : "Invalid email",
      };
    }

    // Admin-configured Regex overrides the email pattern (email pattern is a
    // fallback; an explicit regex is always more authoritative).
    if (f.validationRegex) {
      try {
        rules.pattern = {
          value: new RegExp(f.validationRegex),
          message:
            f.validationMessage ||
            (isAr ? "قيمة غير صحيحة" : "Invalid value"),
        };
      } catch {
        // Silently ignore an invalid regex saved by admin — do not crash the form.
      }
    }

    if (f.fieldType === "number") {
      if (f.validationMin !== null && f.validationMin !== undefined) {
        rules.min = {
          value: f.validationMin,
          message:
            f.validationMessage ||
            (isAr ? `القيمة الدنيا ${f.validationMin}` : `Min ${f.validationMin}`),
        };
      }
      if (f.validationMax !== null && f.validationMax !== undefined) {
        rules.max = {
          value: f.validationMax,
          message:
            f.validationMessage ||
            (isAr ? `القيمة القصوى ${f.validationMax}` : `Max ${f.validationMax}`),
        };
      }
    }

    return rules;
  };

  return { isFieldVisible, fieldValidationRules };
}
