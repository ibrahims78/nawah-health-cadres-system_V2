/**
 * FieldEditor — Unified single-field editor for the Masarat platform.
 *
 * This component replaces two previously separate inline implementations:
 *   1. The field-editing block in ProjectSettings.tsx (tab "fields")
 *   2. The field-editing block in CreateProject.tsx (wizard step 1, Phase 2)
 *
 * Any new field type, validation rule, or access-control option should be added
 * here only — it will automatically appear in all pages that use this component.
 *
 * Props overview:
 *   field              — Controlled field data (FieldEditorField)
 *   index              — Numeric index used for data-testid attributes
 *   allFields          — All sibling fields (for condition field dropdowns)
 *   isAr               — Language flag (true = Arabic UI)
 *   onUpdate           — Called with a partial update when any field property changes
 *   onRemove           — Called when the user clicks "Delete"
 *   onMoveUp/Down      — Optional; shows move-up/down arrows when provided
 *   isFirst/isLast     — Disables the corresponding arrow when at the boundary
 *   showIncludeCheckbox — Shows a checkbox to include/exclude the field (Excel import mode)
 *   expanded           — Whether the advanced panel (conditions/validation/access) is open
 *   onToggleExpand     — Toggles the expanded state
 *   fieldTypeSet       — "full" (default, all types) or "create" (subset for CreateProject)
 *   outerTestId        — data-testid for the outermost div (default: `field-${index}`)
 *
 * Example — ProjectSettings:
 *   <FieldEditor
 *     field={f} index={idx} allFields={fields} isAr={isAr}
 *     onUpdate={upd => updateField(idx, upd)}
 *     onRemove={() => removeField(idx)}
 *     onMoveUp={() => moveField(idx, -1)} isFirst={idx === 0}
 *     onMoveDown={() => moveField(idx, 1)} isLast={idx === fields.length - 1}
 *     expanded={expandedFieldIdx === idx}
 *     onToggleExpand={() => setExpandedFieldIdx(expandedFieldIdx === idx ? null : idx)}
 *   />
 *
 * Example — CreateProject (Phase 2):
 *   <FieldEditor
 *     field={col} index={idx} allFields={columns} isAr={ar}
 *     onUpdate={upd => updateColumn(idx, upd)}
 *     onRemove={() => removeColumn(idx)}
 *     showIncludeCheckbox
 *     expanded={expandedFieldIdx === idx}
 *     onToggleExpand={() => setExpandedFieldIdx(expandedFieldIdx === idx ? null : idx)}
 *     fieldTypeSet="create"
 *     outerTestId={`field-row-${idx}`}
 *   />
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp, ArrowDown, Trash2, Eye, EyeOff, Plus,
  GitBranch, Settings2, FileUp, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFieldTypes, getCreateFieldTypes, type FieldEditorField } from "@/lib/fieldEditorUtils";

export type { FieldEditorField };

export interface FieldEditorProps {
  field: FieldEditorField;
  index: number;
  allFields: FieldEditorField[];
  isAr: boolean;
  onUpdate: (upd: Partial<FieldEditorField>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  showIncludeCheckbox?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  fieldTypeSet?: "full" | "create";
  outerTestId?: string;
}

export function FieldEditor({
  field: f,
  index: idx,
  allFields,
  isAr,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  showIncludeCheckbox = false,
  expanded,
  onToggleExpand,
  fieldTypeSet = "full",
  outerTestId,
}: FieldEditorProps) {
  const fieldTypes = fieldTypeSet === "create" ? getCreateFieldTypes(isAr) : getFieldTypes(isAr);
  const condCount = ((f as any).conditions || []).filter((c: any) => c.field).length;
  const isFieldVisible = f.isVisible !== false;
  // In Excel-import mode, the "disabled" state means the field is not selected
  const isDisabled = showIncludeCheckbox && !f.selected;

  return (
    <div
      className={cn(
        "border rounded-xl overflow-hidden transition-all duration-200",
        showIncludeCheckbox
          ? f.selected
            ? f.isVisible !== false
              ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
              : "border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/20 opacity-60"
            : "border-dashed border-slate-200 dark:border-slate-700 opacity-40 bg-slate-50 dark:bg-slate-800/30"
          : isFieldVisible
            ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
            : "border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/20 opacity-60"
      )}
      data-testid={outerTestId ?? `field-${idx}`}
    >
      {/* ── TOP ROW: order buttons + label + key + type + step ── */}
      <div className="flex items-center gap-2 p-3">

        {/* Move up/down arrows (ProjectSettings) */}
        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={isFirst}
              className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-primary/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
              title={isAr ? "تحريك لأعلى" : "Move up"}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={isLast}
              className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-primary/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
              title={isAr ? "تحريك لأسفل" : "Move down"}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Include checkbox (Excel import mode) */}
        {showIncludeCheckbox && (
          <input
            type="checkbox"
            checked={f.selected ?? true}
            onChange={e => onUpdate({ selected: e.target.checked })}
            className="rounded accent-primary flex-shrink-0 w-4 h-4"
            data-testid={`field-select-${idx}`}
            title={isAr ? "تضمين هذا الحقل في المشروع" : "Include this field in the project"}
          />
        )}

        {/* Label + Key */}
        <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
          <Input
            value={f.label}
            onChange={e => onUpdate({ label: e.target.value })}
            placeholder={isAr ? "الاسم المعروض للمستخدم" : "Display label"}
            className="text-sm h-8"
            disabled={isDisabled}
            data-testid={`field-label-${idx}`}
          />
          <Input
            value={f.key}
            onChange={e => onUpdate({ key: e.target.value })}
            placeholder={isAr ? "المفتاح الداخلي (key)" : "Internal key"}
            className="text-sm h-8 font-mono text-slate-500"
            disabled={isDisabled}
            data-testid={`field-key-${idx}`}
          />
        </div>

        {/* Type selector */}
        <select
          value={f.fieldType || "text"}
          onChange={e => onUpdate({ fieldType: e.target.value })}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 min-w-[130px] disabled:opacity-50"
          disabled={isDisabled}
          data-testid={`field-type-${idx}`}
        >
          {fieldTypes.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Step selector */}
        <select
          value={f.stepNumber || 1}
          onChange={e => onUpdate({ stepNumber: Number(e.target.value) })}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 w-24 disabled:opacity-50"
          disabled={isDisabled}
          data-testid={`field-step-${idx}`}
        >
          {[1, 2, 3, 4, 5].map(s => (
            <option key={s} value={s}>{isAr ? `الخطوة ${s}` : `Step ${s}`}</option>
          ))}
        </select>
      </div>

      {/* ── PLACEHOLDER ROW (most field types) ── */}
      {f.fieldType !== "autoincrement" && f.fieldType !== "select" && f.fieldType !== "radio" && (
        <div className="px-3 pb-2">
          <Input
            value={(f as any).placeholder ?? ""}
            onChange={e => onUpdate({ placeholder: e.target.value || null } as any)}
            className="text-xs h-7 text-slate-500"
            disabled={isDisabled}
            data-testid={`field-placeholder-${idx}`}
            placeholder={
              f.fieldType === "checkbox"
                ? (isAr ? "النص بجانب مربع الاختيار (مثال: أوافق على الشروط)" : "Text next to the checkbox")
                : f.fieldType === "heading"
                ? (isAr ? "نص توضيحي أسفل العنوان (اختياري)" : "Subtitle below heading (optional)")
                : f.fieldType === "file"
                ? (isAr ? "تعليمات الرفع (مثال: ارفع صورة شخصية واضحة)" : "Upload hint (e.g. Upload a clear photo)")
                : (isAr ? "نص تلميح داخل الحقل (Placeholder)" : "Hint text inside the field (Placeholder)")
            }
          />
        </div>
      )}

      {/* ── CONTROLS BAR ── */}
      <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">

        {/* Required toggle */}
        <button
          type="button"
          onClick={() => onUpdate({ isRequired: !f.isRequired })}
          disabled={isDisabled}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all disabled:opacity-40",
            f.isRequired
              ? "bg-rose-50 border-rose-300 text-rose-600 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-400"
              : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700"
          )}
          data-testid={`field-required-${idx}`}
          title={isAr ? "إلزامي — المستخدم مُلزم بملء هذا الحقل" : "Required — user must fill this field"}
        >
          <span>{f.isRequired ? "✱" : "○"}</span>
          {isAr ? (f.isRequired ? "إلزامي" : "اختياري") : (f.isRequired ? "Required" : "Optional")}
        </button>

        {/* Visible toggle */}
        <button
          type="button"
          onClick={() => onUpdate({ isVisible: !isFieldVisible })}
          disabled={isDisabled}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all disabled:opacity-40",
            isFieldVisible
              ? "bg-sky-50 border-sky-300 text-sky-600 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-400"
              : "bg-slate-100 border-slate-300 text-slate-400 dark:bg-slate-800 dark:border-slate-600 line-through"
          )}
          title={isAr
            ? (isFieldVisible ? "الحقل ظاهر في نموذج التعبئة — اضغط لإخفائه" : "الحقل مخفي من نموذج التعبئة — اضغط لإظهاره")
            : (isFieldVisible ? "Visible in form — click to hide" : "Hidden from form — click to show")}
        >
          {isFieldVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {isAr
            ? (isFieldVisible ? "ظاهر في النموذج" : "مخفي من النموذج")
            : (isFieldVisible ? "Visible" : "Hidden")}
        </button>

        {/* Advanced panel toggle (conditions + validation + access) */}
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={isDisabled}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all disabled:opacity-40",
            expanded
              ? "bg-primary/10 border-primary/40 text-primary dark:bg-primary/20"
              : condCount > 0
                ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400"
                : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 hover:border-primary/40 hover:text-primary"
          )}
          data-testid={`field-expand-${idx}`}
          title={isAr ? "شروط الظهور + التحقق + الخيارات المتقدمة" : "Conditions + Validation + Advanced options"}
        >
          <GitBranch className="h-3 w-3" />
          {isAr ? "شروط وتحقق" : "Conditions & Validation"}
          {condCount > 0 && (
            <span className="bg-amber-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {condCount}
            </span>
          )}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        <div className="flex-1" />

        {/* Delete button */}
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border border-red-200 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-600 dark:hover:border-red-600 dark:hover:text-white"
          data-testid={`button-remove-field-${idx}`}
          title={isAr ? "حذف هذا الحقل نهائياً" : "Delete this field permanently"}
        >
          <Trash2 className="h-3 w-3" />
          {isAr ? "حذف الحقل" : "Delete"}
        </button>
      </div>

      {/* ── FILE UPLOAD OPTIONS ── */}
      {!isDisabled && f.fieldType === "file" && (
        <div className="mx-3 mb-3 p-3 rounded-lg bg-blue-50/60 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
            <FileUp className="h-3.5 w-3.5" />
            {isAr ? "إعدادات رفع الملف" : "File Upload Settings"}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-2">
              {isAr
                ? "أنواع الملفات المسموحة — اتركه فارغاً للسماح بأي ملف"
                : "Allowed file types — leave empty to allow all"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt"].map(ext => {
                const current: string[] = (f as any).allowedFileTypes || [];
                const isChecked = current.includes(ext);
                return (
                  <label
                    key={ext}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] cursor-pointer select-none font-medium transition-all",
                      isChecked
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-blue-300"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={isChecked}
                      onChange={e => {
                        const prev: string[] = (f as any).allowedFileTypes || [];
                        const next = e.target.checked
                          ? [...prev, ext]
                          : prev.filter(t => t !== ext);
                        onUpdate({ allowedFileTypes: next.length > 0 ? next : null } as any);
                      }}
                    />
                    .{ext}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] text-muted-foreground whitespace-nowrap">
              {isAr ? "الحجم الأقصى (MB)" : "Max size (MB)"}
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={(f as any).maxFileSizeMb || ""}
              onChange={e =>
                onUpdate({ maxFileSizeMb: e.target.value ? Number(e.target.value) : null } as any)
              }
              placeholder={isAr ? "افتراضي: 10" : "Default: 10"}
              className="w-32 h-7 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-2 text-xs"
            />
          </div>
        </div>
      )}

      {/* ── SELECT / RADIO OPTIONS ── */}
      {!isDisabled && (f.fieldType === "select" || f.fieldType === "radio") && (
        <div className="mx-3 mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
          <p className="text-[11px] font-semibold text-slate-500">
            {isAr ? "الخيارات — كل خيار في سطر منفصل" : "Options — one per line"}
            <span className="text-red-400 mr-1">*</span>
          </p>
          <Textarea
            key={`${f.id ?? idx}-opts`}
            defaultValue={(f.options as string[] | null || []).join("\n")}
            onBlur={e =>
              onUpdate({
                options: e.target.value
                  .split("\n")
                  .map((s: string) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={isAr ? "خيار 1\nخيار 2\nخيار 3" : "Option 1\nOption 2\nOption 3"}
            className="text-xs"
            rows={3}
            data-testid={`field-options-${idx}`}
          />
          {(f.options as string[] | null || []).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {(f.options as string[]).map((opt, oi) => (
                <span
                  key={oi}
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                >
                  {opt}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SAMPLE DATA (Excel import mode) ── */}
      {showIncludeCheckbox && f.selected && f.samples && f.samples.length > 0 && (
        <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{isAr ? "أمثلة:" : "Samples:"}</span>
          {f.samples.slice(0, 5).map((s, i) => (
            <span
              key={i}
              className="text-[10px] bg-slate-100 dark:bg-slate-700 text-muted-foreground px-2 py-0.5 rounded"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* ── EXPANDED PANEL: CONDITIONS + VALIDATION + ACCESS CONTROL ── */}
      {expanded && !isDisabled && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3 space-y-5 bg-slate-50/50 dark:bg-slate-800/20">

          {/* ── Conditional Visibility ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {isAr ? "ظهور مشروط" : "Conditional Visibility"}
                </p>
              </div>
              {((f as any).conditions?.length || 0) > 1 && (
                <select
                  value={(f as any).conditionOperator || "AND"}
                  onChange={e => onUpdate({ conditionOperator: e.target.value as "AND" | "OR" })}
                  className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] h-6"
                  data-testid={`field-condop-${idx}`}
                >
                  <option value="AND">{isAr ? "كل الشروط (AND)" : "All conditions (AND)"}</option>
                  <option value="OR">{isAr ? "أي شرط (OR)" : "Any condition (OR)"}</option>
                </select>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-md px-2 py-1.5">
              {isAr
                ? "💡 يمكنك إخفاء هذا الحقل وإظهاره فقط عندما يختار المستخدم قيمة معينة في حقل آخر. مثال: أظهر حقل «اسم الشركة» فقط عندما يكون «نوع التسجيل» = «مؤسسة»."
                : "💡 Show this field only when a condition is met in another field. E.g. show 'Company Name' only when 'Type' = 'Business'."}
            </p>

            {((f as any).conditions || []).map((cond: any, ci: number) => (
              <div
                key={ci}
                className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2"
              >
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">
                    {isAr ? "إذا كان الحقل" : "If field"}
                  </label>
                  <select
                    value={cond.field ?? ""}
                    onChange={e => {
                      const next = [...((f as any).conditions || [])];
                      next[ci] = { ...next[ci], field: e.target.value };
                      onUpdate({ conditions: next } as any);
                    }}
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-7"
                    data-testid={`field-condfield-${idx}-${ci}`}
                  >
                    <option value="">
                      {isAr ? "— اختر حقلاً —" : "— choose a field —"}
                    </option>
                    {allFields
                      .filter((other, oi) => oi !== idx && other.fieldType !== "autoincrement")
                      .map((other, oi) => (
                        <option key={other.id ?? oi} value={other.key}>
                          {other.label || other.key}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">
                    {isAr ? "عكس" : "Negate"}
                  </label>
                  <div className="h-7 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={!!cond.negate}
                      onChange={e => {
                        const next = [...((f as any).conditions || [])];
                        next[ci] = { ...next[ci], negate: e.target.checked };
                        onUpdate({ conditions: next } as any);
                      }}
                      className="rounded"
                      data-testid={`field-condnegate-${idx}-${ci}`}
                      title={isAr ? "عكس الشرط (≠ بدلاً من =)" : "Negate condition (≠ instead of =)"}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">
                    {isAr ? (cond.negate ? "لا يساوي" : "يساوي") : (cond.negate ? "not equal to" : "equals")}
                  </label>
                  <Input
                    value={cond.value ?? ""}
                    onChange={e => {
                      const next = [...((f as any).conditions || [])];
                      next[ci] = { ...next[ci], value: e.target.value };
                      onUpdate({ conditions: next } as any);
                    }}
                    className="h-7 text-xs"
                    placeholder={isAr ? "القيمة..." : "Value..."}
                    data-testid={`field-condvalue-${idx}-${ci}`}
                  />
                </div>

                <button
                  type="button"
                  className="h-7 w-7 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors self-end"
                  onClick={() => {
                    const next = ((f as any).conditions || []).filter(
                      (_: any, i: number) => i !== ci
                    );
                    onUpdate({ conditions: next } as any);
                  }}
                  data-testid={`button-remove-cond-${idx}`}
                  title={isAr ? "حذف الشرط" : "Remove condition"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700"
              onClick={() => {
                const next = [
                  ...((f as any).conditions || []),
                  { field: "", value: "", negate: false },
                ];
                onUpdate({ conditions: next } as any);
              }}
              data-testid={`button-add-cond-${idx}`}
            >
              <Plus className="h-3.5 w-3.5 ml-1" />
              {isAr ? "إضافة شرط ظهور" : "Add condition"}
            </Button>

            {condCount > 0 && (
              <div className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2.5 py-2 border border-amber-200 dark:border-amber-800">
                <GitBranch className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  {isAr ? "الحقل يظهر فقط عندما: " : "Field shows only when: "}
                  {((f as any).conditions || [])
                    .filter((c: any) => c.field)
                    .map((c: any, i: number) => {
                      const lbl =
                        allFields.find(o => o.key === c.field)?.label || c.field;
                      const expr = isAr
                        ? `«${lbl}» ${c.negate ? "≠" : "="} «${c.value || "أي قيمة"}»`
                        : `"${lbl}" ${c.negate ? "≠" : "="} "${c.value || "any value"}"`;
                      return i === 0
                        ? expr
                        : ` ${
                            (f as any).conditionOperator === "OR"
                              ? isAr
                                ? "أو"
                                : "OR"
                              : isAr
                              ? "و"
                              : "AND"
                          } ${expr}`;
                    })
                    .join("")}
                </span>
              </div>
            )}
          </div>

          {/* ── Validation Rules ── */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {isAr ? "قواعد التحقق (اختياري)" : "Validation Rules (optional)"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {isAr ? "الحد الأدنى للأحرف" : "Min length"}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={(f as any).validationMin ?? ""}
                  onChange={e =>
                    onUpdate({ validationMin: e.target.value ? Number(e.target.value) : null } as any)
                  }
                  className="h-7 text-xs"
                  placeholder="0"
                  data-testid={`field-valmin-${idx}`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {isAr ? "الحد الأقصى للأحرف" : "Max length"}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={(f as any).validationMax ?? ""}
                  onChange={e =>
                    onUpdate({ validationMax: e.target.value ? Number(e.target.value) : null } as any)
                  }
                  className="h-7 text-xs"
                  placeholder="—"
                  data-testid={`field-valmax-${idx}`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                {isAr ? "نمط Regex (للتحقق)" : "Regex pattern"}
              </label>
              <Input
                value={(f as any).validationRegex ?? ""}
                onChange={e =>
                  onUpdate({ validationRegex: e.target.value || null } as any)
                }
                className="h-7 text-xs font-mono"
                placeholder="^[0-9]{10}$"
                dir="ltr"
                data-testid={`field-valregex-${idx}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                {isAr ? "رسالة خطأ التحقق" : "Validation error message"}
              </label>
              <Input
                value={(f as any).validationMessage ?? ""}
                onChange={e =>
                  onUpdate({ validationMessage: e.target.value || null } as any)
                }
                className="h-7 text-xs"
                placeholder={isAr ? "الرجاء إدخال قيمة صحيحة" : "Please enter a valid value"}
                data-testid={`field-valmsg-${idx}`}
              />
            </div>
          </div>

          {/* ── Access Control ── */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {isAr ? "التحكم بالوصول" : "Access Control"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {isAr ? "مرئي لصلاحية" : "Visible to role"}
                </label>
                <select
                  value={(f as any).visibleTo || "all"}
                  onChange={e => onUpdate({ visibleTo: e.target.value } as any)}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-7"
                  data-testid={`field-visibleto-${idx}`}
                >
                  <option value="all">{isAr ? "الجميع" : "Everyone"}</option>
                  <option value="admin">{isAr ? "المدير فقط" : "Admin only"}</option>
                  <option value="editor">{isAr ? "المحرر فقط" : "Editor only"}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {isAr ? "قراءة فقط بعد الإنشاء" : "Read-only after creation"}
                </label>
                <div className="h-7 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!(f as any).isReadOnly}
                    onChange={e => onUpdate({ isReadOnly: e.target.checked } as any)}
                    className="rounded"
                    id={`readonly-fe-${idx}`}
                    data-testid={`field-readonly-${idx}`}
                  />
                  <label htmlFor={`readonly-fe-${idx}`} className="text-xs">
                    {isAr ? "لا يمكن تعديله بعد الإنشاء" : "Cannot be edited after creation"}
                  </label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {isAr ? "عرض الحقل في النموذج" : "Field width in form"}
                </label>
                <div className="h-7 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!(f as any).isFullWidth}
                    onChange={e => onUpdate({ isFullWidth: e.target.checked } as any)}
                    className="rounded"
                    id={`fullwidth-fe-${idx}`}
                    data-testid={`field-fullwidth-${idx}`}
                  />
                  <label htmlFor={`fullwidth-fe-${idx}`} className="text-xs">
                    {isAr ? "عرض كامل (صف مستقل)" : "Full width (own row)"}
                  </label>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
