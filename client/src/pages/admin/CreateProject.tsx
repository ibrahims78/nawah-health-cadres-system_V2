import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import {
  Upload, ArrowRight, ArrowLeft, Check, Loader2, Plus, Trash2,
  FileSpreadsheet, FolderPlus, GripVertical, Eye, EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";

interface ParsedColumn {
  originalLabel: string; label: string; key: string;
  fieldType: string; isRequired: boolean; isVisible: boolean;
  stepNumber: number; orderIndex: number; samples: string[];
  selected: boolean;
}

const FIELD_TYPES_AR = [
  { value: "text", label: "نص" }, { value: "number", label: "رقم" },
  { value: "date", label: "تاريخ" }, { value: "select", label: "قائمة منسدلة" },
  { value: "radio", label: "اختيار واحد" }, { value: "textarea", label: "نص طويل" },
  { value: "phone", label: "هاتف" }, { value: "email", label: "بريد إلكتروني" },
  { value: "autoincrement", label: "ترقيم تلقائي" },
];
const FIELD_TYPES_EN = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" },
  { value: "date", label: "Date" }, { value: "select", label: "Dropdown" },
  { value: "radio", label: "Single Choice" }, { value: "textarea", label: "Long Text" },
  { value: "phone", label: "Phone" }, { value: "email", label: "Email" },
  { value: "autoincrement", label: "Auto Number" },
];

const WIZARD_STEPS_AR = ["رفع الملف", "تحرير الحقول", "إعدادات المشروع", "إنشاء"];
const WIZARD_STEPS_EN = ["Upload File", "Edit Fields", "Project Settings", "Create"];

export function CreateProject() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { lang } = useLang();
  const ar = lang === "ar";

  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [columns, setColumns] = useState<ParsedColumn[]>([]);
  const [manualMode, setManualMode] = useState(false);

  // Project settings
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formSubtitle, setFormSubtitle] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [stepsText, setStepsText] = useState("البيانات الأساسية\nالبيانات التفصيلية\nالمراجعة");

  const handleFileUpload = async (file: File) => {
    setUploading(true); setUploadError("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/projects/parse-excel", {
        method: "POST", body: fd, credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (ar ? "فشل في تحليل الملف" : "Failed to parse file"));
      setColumns(data.columns.map((c: any) => ({ ...c, selected: true })));
      setStep(1);
    } catch (err: any) {
      setUploadError(err.message);
    }
    setUploading(false);
  };

  const addManualField = () => {
    setColumns(prev => [...prev, {
      originalLabel: "", label: ar ? `حقل ${prev.length + 1}` : `Field ${prev.length + 1}`, key: `field_${prev.length + 1}`,
      fieldType: "text", isRequired: false, isVisible: true,
      stepNumber: 1, orderIndex: prev.length, samples: [], selected: true,
    }]);
  };

  const updateColumn = (idx: number, upd: Partial<ParsedColumn>) => {
    setColumns(prev => prev.map((c, i) => i === idx ? { ...c, ...upd } : c));
  };

  const removeColumn = (idx: number) => setColumns(prev => prev.filter((_, i) => i !== idx));

  const createMut = useMutation({
    mutationFn: () => {
      const selectedFields = columns.filter(c => c.selected).map((c, idx) => ({
        key: c.key, label: c.label, fieldType: c.fieldType,
        isRequired: c.isRequired, isVisible: c.isVisible,
        stepNumber: c.stepNumber, orderIndex: idx,
      }));
      const steps = stepsText.split("\n").map(s => s.trim()).filter(Boolean);
      return apiRequest("POST", "/api/projects", {
        name: projectName, description, formTitle: formTitle || projectName,
        formSubtitle, invitationCode: invitationCode || `${projectName.replace(/\s+/g, "-").toUpperCase()}-2026`,
        steps, fields: selectedFields,
      });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      nav(`/admin/projects/${data.project.id}/dashboard`);
    },
  });

  const selectedCount = columns.filter(c => c.selected).length;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav("/admin/projects")} data-testid="button-back">
            <ArrowRight className="h-4 w-4 ml-1" />
            {ar ? "المشاريع" : "Projects"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold">{ar ? "إنشاء مشروع جديد" : "Create New Project"}</h1>
        </div>

        {/* Step indicator */}
        {(() => { const WIZARD_STEPS = ar ? WIZARD_STEPS_AR : WIZARD_STEPS_EN; return (
        <div className="flex items-center gap-0">
          {WIZARD_STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                  i < step ? "bg-green-500 text-white" : i === step ? "bg-primary text-white shadow-md" : "bg-slate-100 dark:bg-slate-800 text-muted-foreground"
                )}>
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn("text-xs font-semibold hidden sm:block", i === step ? "text-primary" : "text-muted-foreground")}>
                  {s}
                </span>
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={cn("flex-1 h-0.5 mx-3", i < step ? "bg-green-400" : "bg-slate-200 dark:bg-slate-700")} />
              )}
            </div>
          ))}
        </div>
        ); })()}

        {/* STEP 0: Upload Excel */}
        {step === 0 && (
          <div className="space-y-4">
            <Card
              className={cn(
                "border-2 border-dashed p-12 text-center cursor-pointer transition-all hover:border-primary hover:bg-primary/5",
                uploading && "opacity-50 pointer-events-none"
              )}
              onClick={() => fileRef.current?.click()}
              data-testid="card-upload-area"
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
              {uploading ? (
                <div className="space-y-3">
                  <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />
                  <p className="text-sm text-muted-foreground">{ar ? "جاري تحليل الملف..." : "Analyzing file..."}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <FileSpreadsheet className="h-14 w-14 text-slate-300 dark:text-slate-600 mx-auto" />
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">{ar ? "ارفع ملف Excel" : "Upload Excel File"}</h3>
                  <p className="text-sm text-muted-foreground">{ar ? "اسحب ملف .xlsx أو انقر للاختيار" : "Drag a .xlsx file here or click to select"}</p>
                  <p className="text-xs text-muted-foreground">{ar ? "سيتم استخراج الأعمدة تلقائياً كحقول للمشروع" : "Columns will be automatically extracted as project fields"}</p>
                </div>
              )}
            </Card>

            {uploadError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm" data-testid="text-upload-error">
                {uploadError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-muted-foreground">{ar ? "أو" : "or"}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            </div>

            <Button variant="outline" className="w-full" onClick={() => { setManualMode(true); setStep(1); }} data-testid="button-manual-mode">
              <FolderPlus className="h-4 w-4 ml-2" />
              {ar ? "إنشاء مشروع بحقول يدوية" : "Create Project with Manual Fields"}
            </Button>
          </div>
        )}

        {/* STEP 1: Edit Fields */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-800 dark:text-slate-100">{ar ? "تحرير الحقول" : "Edit Fields"}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {manualMode
                    ? (ar ? "أضف الحقول التي ستظهر في النموذج" : "Add the fields that will appear in the form")
                    : (ar ? `تم العثور على ${columns.length} حقل — اختر وعدّل ما تريد` : `Found ${columns.length} fields — select and edit as needed`)}
                </p>
              </div>
              {!manualMode && (
                <Badge variant="secondary">{selectedCount} {ar ? "حقل محدد" : "fields selected"}</Badge>
              )}
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {columns.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">{ar ? "لا يوجد حقول. أضف حقلاً للبدء." : "No fields. Add a field to get started."}</p>
              )}
              {columns.map((col, idx) => (
                <div key={idx} className={cn(
                  "border rounded-xl p-3 transition-all",
                  col.selected ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" : "border-dashed border-slate-200 dark:border-slate-700 opacity-50 bg-slate-50 dark:bg-slate-800/50"
                )} data-testid={`field-row-${idx}`}>
                  <div className="flex items-start gap-2">
                    {/* Select toggle */}
                    {!manualMode && (
                      <input type="checkbox" checked={col.selected} onChange={e => updateColumn(idx, { selected: e.target.checked })}
                        className="mt-1 rounded accent-primary flex-shrink-0" data-testid={`field-select-${idx}`} />
                    )}

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                      {/* Label */}
                      <div className="sm:col-span-2 space-y-1">
                        <p className="text-[10px] text-muted-foreground">{ar ? "الاسم المعروض" : "Display Name"}</p>
                        <Input value={col.label} onChange={e => updateColumn(idx, { label: e.target.value })}
                          className="h-8 text-sm" disabled={!col.selected} data-testid={`field-label-${idx}`} />
                      </div>
                      {/* Key */}
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">{ar ? "المفتاح" : "Key"}</p>
                        <Input value={col.key} onChange={e => updateColumn(idx, { key: e.target.value })}
                          className="h-8 text-xs font-mono" disabled={!col.selected} data-testid={`field-key-${idx}`} />
                      </div>
                      {/* Type */}
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">{ar ? "النوع" : "Type"}</p>
                        <select value={col.fieldType} onChange={e => updateColumn(idx, { fieldType: e.target.value })}
                          className="w-full h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs disabled:opacity-50"
                          disabled={!col.selected} data-testid={`field-type-${idx}`}>
                          {(ar ? FIELD_TYPES_AR : FIELD_TYPES_EN).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {/* Step number */}
                      <select value={col.stepNumber} onChange={e => updateColumn(idx, { stepNumber: Number(e.target.value) })}
                        className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs w-20"
                        disabled={!col.selected} data-testid={`field-step-${idx}`}>
                        {[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>{ar ? `خطوة ${s}` : `Step ${s}`}</option>)}
                      </select>

                      <div className="flex gap-1">
                        {/* Required */}
                        <button onClick={() => updateColumn(idx, { isRequired: !col.isRequired })} disabled={!col.selected}
                          className={cn("h-7 px-2 rounded text-[10px] font-semibold transition-colors", col.isRequired ? "bg-red-100 text-red-600 dark:bg-red-900/30" : "bg-slate-100 dark:bg-slate-700 text-muted-foreground")}
                          data-testid={`field-required-${idx}`}>
                          {col.isRequired ? (ar ? "إلزامي" : "Required") : (ar ? "اختياري" : "Optional")}
                        </button>
                        {/* Remove */}
                        {manualMode && (
                          <button onClick={() => removeColumn(idx)} className="h-7 w-7 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                            data-testid={`field-remove-${idx}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sample data */}
                  {col.samples && col.samples.length > 0 && col.selected && (
                    <div className="mt-2 flex gap-1.5 flex-wrap pr-6">
                      {col.samples.map((s, i) => (
                        <span key={i} className="text-[10px] bg-slate-100 dark:bg-slate-700 text-muted-foreground px-2 py-0.5 rounded">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addManualField} data-testid="button-add-field">
              <Plus className="h-4 w-4 ml-1" />
              {ar ? "إضافة حقل" : "Add Field"}
            </Button>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(0)} data-testid="button-prev">
                <ArrowRight className="h-4 w-4 ml-1" />
                {ar ? "السابق" : "Previous"}
              </Button>
              <Button className="flex-1" onClick={() => setStep(2)} disabled={selectedCount === 0 && !manualMode}
                data-testid="button-next-to-settings">
                {ar ? "التالي — إعدادات المشروع" : "Next — Project Settings"}
                <ArrowLeft className="h-4 w-4 mr-1" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Project Settings */}
        {step === 2 && (
          <Card className="p-6 space-y-5">
            <h2 className="font-semibold text-slate-800 dark:text-slate-100">{ar ? "إعدادات المشروع" : "Project Settings"}</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "اسم المشروع *" : "Project Name *"}</Label>
                <Input value={projectName} onChange={e => setProjectName(e.target.value)}
                  placeholder={ar ? "مثال: تسجيل الموظفين — محافظة دمشق" : "e.g. Staff Registration — Damascus"} data-testid="input-project-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "رمز الدعوة" : "Invitation Code"}</Label>
                <Input value={invitationCode} onChange={e => setInvitationCode(e.target.value)}
                  placeholder="MASAR-2026" data-testid="input-invitation-code" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{ar ? "وصف المشروع (اختياري)" : "Project Description (optional)"}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} data-testid="input-description" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "عنوان النموذج العام" : "Public Form Title"}</Label>
                <Input value={formTitle} onChange={e => setFormTitle(e.target.value)}
                  placeholder={ar ? "نموذج التسجيل" : "Registration Form"} data-testid="input-form-title" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "العنوان الفرعي (اختياري)" : "Subtitle (optional)"}</Label>
                <Input value={formSubtitle} onChange={e => setFormSubtitle(e.target.value)}
                  placeholder={ar ? "برجاء تعبئة البيانات بدقة" : "Please fill in your details carefully"} data-testid="input-form-subtitle" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{ar ? "أسماء الخطوات (كل خطوة في سطر — آخر خطوة للمراجعة)" : "Step names (one per line — last step is for review)"}</Label>
              <Textarea value={stepsText} onChange={e => setStepsText(e.target.value)} rows={4} data-testid="input-steps" />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} data-testid="button-prev-to-fields">
                <ArrowRight className="h-4 w-4 ml-1" />
                {ar ? "السابق" : "Previous"}
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)} disabled={!projectName.trim()}
                data-testid="button-next-to-confirm">
                {ar ? "التالي — مراجعة وإنشاء" : "Next — Review & Create"}
                <ArrowLeft className="h-4 w-4 mr-1" />
              </Button>
            </div>
          </Card>
        )}

        {/* STEP 3: Confirm & Create */}
        {step === 3 && (
          <div className="space-y-4">
            <Card className="p-6 space-y-4">
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">{ar ? "مراجعة وإنشاء" : "Review & Create"}</h2>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{ar ? "اسم المشروع" : "Project Name"}</p>
                  <p className="font-semibold">{projectName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{ar ? "رمز الدعوة" : "Invitation Code"}</p>
                  <p className="font-mono font-semibold">{invitationCode || `${projectName.replace(/\s+/g, "-").toUpperCase()}-2026`}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{ar ? "عنوان النموذج" : "Form Title"}</p>
                  <p className="font-semibold">{formTitle || projectName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{ar ? "عدد الحقول" : "Field Count"}</p>
                  <p className="font-semibold">{selectedCount} {ar ? "حقل" : "fields"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">{ar ? "الخطوات" : "Steps"}</p>
                <div className="flex flex-wrap gap-2">
                  {stepsText.split("\n").filter(s => s.trim()).map((s, i) => (
                    <Badge key={i} variant="secondary">{i + 1}. {s}</Badge>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">{ar ? `الحقول المحددة (${selectedCount})` : `Selected Fields (${selectedCount})`}</p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {columns.filter(c => c.selected).map((c, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {c.label}
                      {c.isRequired && <span className="text-red-400 mr-1">*</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            </Card>

            {createMut.isError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 text-sm" data-testid="text-create-error">
                {ar ? "حدث خطأ أثناء الإنشاء. حاول مرة أخرى." : "An error occurred while creating the project. Please try again."}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} data-testid="button-prev-to-settings">
                <ArrowRight className="h-4 w-4 ml-1" />
                {ar ? "السابق" : "Previous"}
              </Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => createMut.mutate()} disabled={createMut.isPending}
                data-testid="button-create-project">
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Check className="h-4 w-4 ml-2" />}
                {ar ? "إنشاء المشروع" : "Create Project"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
