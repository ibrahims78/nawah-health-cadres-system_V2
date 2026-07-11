/**
 * Server-side counterpart to the public form's client-side validation
 * (client/src/pages/ProjectParticipantForm.tsx, ProjectRegister.tsx, ProjectEditForm.tsx).
 *
 * The client only prevents a well-behaved browser from submitting invalid or
 * unexpected data — it does not stop a direct API call. This module re-applies
 * the same rules server-side so /submit and /edit endpoints are safe even when
 * called directly:
 *   1. Strict allowlist — only keys that match a defined project field are kept;
 *      anything else is silently dropped.
 *   2. Hidden-by-condition fields are cleared (their value is dropped) — a field
 *      whose visibility condition is not currently satisfied must not persist a
 *      stale value from before the condition changed.
 *   3. required / email / number min-max / custom regex are enforced, matching
 *      the rules built by fieldValidationRules() in ProjectParticipantForm.tsx.
 */
import { db } from "../db.js";
import { projectFields, type ProjectField } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import { isFieldVisible } from "../../shared/fieldVisibility.js";

export interface FieldValidationResult {
  ok: boolean;
  error?: string;
  /** Sanitised data — only allowlisted keys, hidden-field values cleared. */
  data: Record<string, any>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and sanitises a raw submission body against the project's field
 * definitions. `existingData` (optional) is used on edit — it lets locked
 * (autoincrement/read-only) fields keep their original value, matching the
 * behaviour already applied separately in pform.ts after this call.
 */
export async function validateAndSanitizeSubmission(
  projectId: string,
  rawData: Record<string, any>,
  opts: { isAr?: boolean } = {}
): Promise<FieldValidationResult> {
  const isAr = opts.isAr ?? true;
  const fields: ProjectField[] = await db.select().from(projectFields).where(eq(projectFields.projectId, projectId));

  // 1) Strict allowlist — only keys that correspond to a real data-bearing field.
  //    "heading" fields carry no value; autoincrement is always server-assigned.
  const dataFields = fields.filter(f => f.fieldType !== "heading");
  const allowedKeys = new Set(dataFields.map(f => f.key));
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(rawData || {})) {
    if (allowedKeys.has(key)) sanitized[key] = rawData[key];
  }

  // 2) Clear values of fields currently hidden by an unmet condition — evaluated
  //    against the sanitized data itself (same semantics as the client's watch()).
  for (const f of dataFields) {
    if (!isFieldVisible(f as any, sanitized)) {
      delete sanitized[f.key];
    }
  }

  // 3) Validate visible, non-autoincrement fields.
  for (const f of dataFields) {
    if (f.fieldType === "autoincrement") continue; // server-assigned, never user input
    if (!isFieldVisible(f as any, sanitized)) continue; // hidden — nothing to validate

    const value = sanitized[f.key];
    const isEmpty = value === undefined || value === null || String(value).trim() === "";

    if (f.isRequired && isEmpty) {
      return { ok: false, data: sanitized, error: isAr ? `${f.label} مطلوب` : `${f.label} is required` };
    }
    if (isEmpty) continue; // optional and empty — nothing further to check

    if (f.fieldType === "email" && !EMAIL_RE.test(String(value))) {
      return { ok: false, data: sanitized, error: isAr ? `${f.label}: بريد إلكتروني غير صحيح` : `${f.label}: invalid email` };
    }

    if (f.fieldType === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return { ok: false, data: sanitized, error: isAr ? `${f.label}: يجب أن تكون قيمة رقمية` : `${f.label}: must be a number` };
      }
      if (f.validationMin !== null && f.validationMin !== undefined && num < f.validationMin) {
        return { ok: false, data: sanitized, error: f.validationMessage || (isAr ? `${f.label}: القيمة الدنيا ${f.validationMin}` : `${f.label}: min ${f.validationMin}`) };
      }
      if (f.validationMax !== null && f.validationMax !== undefined && num > f.validationMax) {
        return { ok: false, data: sanitized, error: f.validationMessage || (isAr ? `${f.label}: القيمة القصوى ${f.validationMax}` : `${f.label}: max ${f.validationMax}`) };
      }
    }

    if (f.validationRegex) {
      try {
        const re = new RegExp(f.validationRegex);
        if (!re.test(String(value))) {
          return { ok: false, data: sanitized, error: f.validationMessage || (isAr ? `${f.label}: قيمة غير صحيحة` : `${f.label}: invalid value`) };
        }
      } catch {
        // Invalid regex saved by an admin — ignore safely, same as the client does.
      }
    }
  }

  return { ok: true, data: sanitized };
}
