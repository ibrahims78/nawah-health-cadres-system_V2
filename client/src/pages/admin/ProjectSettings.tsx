import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import {
  Save, Loader2, Plus, Trash2, GripVertical, ArrowRight, ExternalLink,
  ChevronDown, ChevronUp,
  Upload, TableProperties, Wrench, RefreshCw, BotMessageSquare, ArrowUpToLine,
  History, User, Clock,
} from "lucide-react";
import type { Project, ProjectField } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";
import { useToast } from "@/hooks/use-toast";

export function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const { toast } = useToast();
  const [tab, setTab] = useState<"form" | "fields" | "sheets" | "telegram" | "audit">("form");
  const [testing, setTesting] = useState(false);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Sheets-specific state
  const [checkResult, setCheckResult] = useState<{
    ok: boolean; message: string;
    matched?: string[]; missing?: string[]; extra?: string[];
  } | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState<"check" | "fix" | "import" | "export" | null>(null);

  // Telegram-specific state
  const [chatIdLoading, setChatIdLoading] = useState(false);
  const [chatIdChats, setChatIdChats] = useState<{ id: string; title: string; type: string }[] | null>(null);

  // Expanded field for validation
  const [expandedFieldIdx, setExpandedFieldIdx] = useState<number | null>(null);

  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: rawFields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<any[]>({
    queryKey: ["/api/projects", id, "audit-log"],
    queryFn: () => fetch(`/api/projects/${id}/audit-log?limit=100`, { credentials: "include" }).then(r => r.json()),
    enabled: tab === "audit",
  });

  useEffect(() => { setFields(rawFields); }, [rawFields]);

  const { register, handleSubmit, reset, watch, setValue } = useForm<any>();
  useEffect(() => {
    if (project) {
      reset({
        name: project.name, description: project.description,
        formTitle: project.formTitle, formSubtitle: project.formSubtitle,
        invitationCode: project.invitationCode, editTokenHours: project.editTokenHours,
        formEnabled: project.formEnabled, formDisabledMessage: project.formDisabledMessage,
        steps: Array.isArray(project.steps) ? project.steps.join("\n") : "",
        googleSheetId: project.googleSheetId, googleSheetName: project.googleSheetName,
        googleServiceAccountEmail: project.googleServiceAccountEmail,
        telegramChatId: project.telegramChatId,
      });
    }
  }, [project, reset]);

  const formEnabled = watch("formEnabled");

  const saveMut = useMutation({
    mutationFn: (data: any) => {
      const stepsRaw = data.steps || "";
      const stepsArr = stepsRaw.split("\n").map((s: string) => s.trim()).filter(Boolean);
      return apiRequest("PATCH", `/api/projects/${id}`, { ...data, steps: stepsArr });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ description: isAr ? "✅ تم الحفظ بنجاح" : "✅ Saved successfully" });
    },
    onError: (err: any) => toast({ variant: "destructive", description: `❌ ${err.message}` }),
  });

  const saveFieldsMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/fields`, { fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "fields"] });
      toast({ description: isAr ? "✅ تم حفظ الحقول بنجاح" : "✅ Fields saved successfully" });
    },
    onError: (err: any) => toast({ variant: "destructive", description: `❌ ${err.message}` }),
  });

  const testSheets = async () => {
    setTesting(true);
    const res: any = await apiRequest("POST", `/api/projects/${id}/test-sheets`, {}).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    toast({ variant: res.ok === false ? "destructive" : undefined, description: res.message });
    setTesting(false);
  };

  const checkColumns = async () => {
    setSheetsLoading("check"); setCheckResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/check-sheet-columns`, {}).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    setCheckResult(res); setSheetsLoading(null);
  };

  const fixHeaders = async () => {
    setSheetsLoading("fix");
    const res: any = await apiRequest("POST", `/api/projects/${id}/fix-sheet-headers`, {}).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    toast({ variant: res.ok === false ? "destructive" : undefined, description: res.message });
    setSheetsLoading(null);
  };

  const doImport = async () => {
    setSheetsLoading("import"); setImportResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/import-from-sheets`, { syncDeleted }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    setImportResult(res);
    if (res.ok) qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
    setSheetsLoading(null);
  };

  const doExport = async () => {
    setSheetsLoading("export");
    const res: any = await apiRequest("POST", `/api/projects/${id}/export-to-sheets`, {}).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    toast({ variant: res.ok === false ? "destructive" : undefined, description: res.message });
    setSheetsLoading(null);
  };

  const fetchChatId = async (values: any) => {
    setChatIdLoading(true); setChatIdChats(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/telegram-updates`, { token: values.telegramBotToken }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    if (res.ok && res.chats) {
      setChatIdChats(res.chats);
    } else {
      toast({ variant: "destructive", description: res.message || (isAr ? "❌ تعذّر جلب Chat ID" : "❌ Could not fetch Chat ID") });
    }
    setChatIdLoading(false);
  };

  const testTelegram = async (values: any) => {
    setTesting(true);
    const res: any = await apiRequest("POST", `/api/projects/${id}/test-telegram`, { token: values.telegramBotToken, chatId: values.telegramChatId }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    toast({ variant: res.ok === false ? "destructive" : undefined, description: res.message });
    setTesting(false);
  };

  const addField = () => {
    setFields(prev => [...prev, {
      id: `new_${Date.now()}`, projectId: id!,
      key: `field_${prev.length + 1}`, label: isAr ? `حقل ${prev.length + 1}` : `Field ${prev.length + 1}`,
      fieldType: "text", isRequired: false, isVisible: true,
      options: null, stepNumber: 1, orderIndex: prev.length, placeholder: null,
      validationMin: null, validationMax: null, validationRegex: null, validationMessage: null,
      conditionField: null, conditionValue: null,
    } as any]);
  };

  const removeField = (idx: number) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
    if (expandedFieldIdx === idx) setExpandedFieldIdx(null);
  };
  const updateField = (idx: number, upd: Partial<ProjectField>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...upd } : f));

  // Drag-and-drop handlers
  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) { dragItem.current = null; dragOverItem.current = null; return; }
    setFields(prev => {
      const next = [...prev];
      const dragged = next.splice(dragItem.current!, 1)[0];
      next.splice(dragOverItem.current!, 0, dragged);
      return next.map((f, i) => ({ ...f, orderIndex: i }));
    });
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const tabs = [
    { key: "form",     label: isAr ? "النموذج" : "Form" },
    { key: "fields",   label: isAr ? "الحقول" : "Fields" },
    { key: "sheets",   label: "Google Sheets" },
    { key: "telegram", label: "Telegram" },
    { key: "audit",    label: isAr ? "سجل النشاط" : "Activity Log" },
  ] as const;

  const ACTION_LABEL: Record<string, { ar: string; en: string; color: string }> = {
    create: { ar: "إنشاء", en: "Create", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    update: { ar: "تعديل", en: "Update", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    delete: { ar: "حذف", en: "Delete", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };

  return (
    <Layout projectId={id}>
      <div className="max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav(`/admin/projects/${id}/dashboard`)}>
            <ArrowRight className="h-4 w-4 ml-1" />{isAr ? "الرئيسية" : "Main"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold">{isAr ? "إعدادات المشروع" : "Project Settings"}</h1>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.open(`/p/${id}/register`, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5 ml-1" />{isAr ? "معاينة النموذج" : "Preview Form"}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setCheckResult(null); setImportResult(null); setChatIdChats(null); }}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? "bg-white dark:bg-slate-700 shadow-sm text-primary" : "text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300"}`}
              data-testid={`tab-${t.key}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══ FORM TAB ══ */}
        {tab === "form" && (
          <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
            <Card className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "اسم المشروع *" : "Project Name *"}</Label>
                  <Input {...register("name")} data-testid="input-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "رمز الدعوة" : "Invitation Code"}</Label>
                  <Input {...register("invitationCode")} data-testid="input-invitationCode" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "وصف المشروع" : "Project Description"}</Label>
                <Textarea {...register("description")} rows={2} data-testid="input-description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "عنوان النموذج" : "Form Title"}</Label>
                  <Input {...register("formTitle")} data-testid="input-formTitle" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "العنوان الفرعي" : "Form Subtitle"}</Label>
                  <Input {...register("formSubtitle")} data-testid="input-formSubtitle" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "أسماء الخطوات (كل خطوة في سطر منفصل)" : "Step Names (each step on a separate line)"}</Label>
                <Textarea {...register("steps")} rows={3} placeholder={isAr ? "الخطوة الأولى\nالخطوة الثانية\nالخطوة الثالثة" : "Step 1\nStep 2\nStep 3"} data-testid="input-steps" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "مدة صلاحية رابط التعديل (ساعة)" : "Edit Token Validity (hours)"}</Label>
                <Input {...register("editTokenHours")} type="number" className="w-32" data-testid="input-editTokenHours" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-sm font-semibold">{isAr ? "تفعيل النموذج" : "Enable Form"}</p>
                  <p className="text-xs text-muted-foreground">{isAr ? "السماح للمستخدمين بالتسجيل" : "Allow users to register"}</p>
                </div>
                <Switch checked={!!formEnabled} onCheckedChange={v => setValue("formEnabled", v)} data-testid="switch-formEnabled" />
              </div>
              {!formEnabled && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "رسالة التوقف" : "Disabled Message"}</Label>
                  <Input {...register("formDisabledMessage")} placeholder={isAr ? "النموذج متوقف مؤقتاً" : "Form is temporarily disabled"} data-testid="input-formDisabledMessage" />
                </div>
              )}
              <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-form">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                {isAr ? "حفظ الإعدادات" : "Save Settings"}
              </Button>
            </Card>
          </form>
        )}

        {/* ══ FIELDS TAB ══ */}
        {tab === "fields" && (
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              {fields.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">{isAr ? "لا يوجد حقول. أضف حقلاً للبدء." : "No fields found. Add a field to get started."}</p>
              ) : (
                fields.map((f, idx) => (
                  <div
                    key={f.id}
                    className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30 cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => e.preventDefault()}
                    data-testid={`field-${idx}`}
                  >
                    <div className="flex items-center gap-2">
                      <span title={isAr ? "اسحب لإعادة الترتيب" : "Drag to reorder"}>
                        <GripVertical className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      </span>
                      <div className="grid grid-cols-2 gap-2 flex-1">
                        <Input value={f.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder={isAr ? "الاسم المعروض" : "Display Label"} className="text-sm h-8" data-testid={`field-label-${idx}`} />
                        <Input value={f.key} onChange={e => updateField(idx, { key: e.target.value })} placeholder={isAr ? "المفتاح (key)" : "Key (internal)"} className="text-sm h-8 font-mono" data-testid={`field-key-${idx}`} />
                      </div>
                      <select value={f.fieldType || "text"} onChange={e => updateField(idx, { fieldType: e.target.value })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8" data-testid={`field-type-${idx}`}>
                        <option value="text">{isAr ? "نص" : "Text"}</option>
                        <option value="number">{isAr ? "رقم" : "Number"}</option>
                        <option value="date">{isAr ? "تاريخ" : "Date"}</option>
                        <option value="select">{isAr ? "قائمة" : "Select"}</option>
                        <option value="radio">{isAr ? "راديو" : "Radio"}</option>
                        <option value="textarea">{isAr ? "نص طويل" : "Textarea"}</option>
                        <option value="phone">{isAr ? "هاتف" : "Phone"}</option>
                        <option value="email">{isAr ? "بريد" : "Email"}</option>
                        <option value="file">{isAr ? "ملف" : "File"}</option>
                        <option value="autoincrement">{isAr ? "ترقيم تلقائي" : "Auto Number"}</option>
                      </select>
                      <select value={f.stepNumber || 1} onChange={e => updateField(idx, { stepNumber: Number(e.target.value) })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 w-20" data-testid={`field-step-${idx}`}>
                        {[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>{isAr ? `خطوة ${s}` : `Step ${s}`}</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" checked={!!f.isRequired} onChange={e => updateField(idx, { isRequired: e.target.checked })} id={`req-${idx}`} className="rounded" data-testid={`field-required-${idx}`} />
                        <label htmlFor={`req-${idx}`} className="text-xs">{isAr ? "إلزامي" : "Required"}</label>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" checked={f.isVisible !== false} onChange={e => updateField(idx, { isVisible: e.target.checked })} id={`vis-${idx}`} className="rounded" />
                        <label htmlFor={`vis-${idx}`} className="text-xs">{isAr ? "مرئي" : "Visible"}</label>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedFieldIdx(expandedFieldIdx === idx ? null : idx)}
                        className="h-7 w-7 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                        title={isAr ? "خيارات التحقق" : "Validation options"}
                        data-testid={`field-expand-${idx}`}
                      >
                        {expandedFieldIdx === idx ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => removeField(idx)} data-testid={`button-remove-field-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Options editor */}
                    {(f.fieldType === "select" || f.fieldType === "radio") && (
                      <div className="pr-6 space-y-1">
                        <p className="text-[11px] text-muted-foreground">{isAr ? "الخيارات — كل خيار في سطر منفصل" : "Options — each option on a separate line"}</p>
                        <Textarea
                          key={`${f.id}-opts`}
                          defaultValue={(f.options as string[] | null || []).join("\n")}
                          onBlur={e => updateField(idx, { options: e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean) })}
                          placeholder={isAr ? "خيار 1\nخيار 2\nخيار 3" : "Option 1\nOption 2\nOption 3"}
                          className="text-xs"
                          rows={3}
                          data-testid={`field-options-${idx}`}
                        />
                        {(f.options as string[] | null || []).length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {(f.options as string[]).map((opt, oi) => (
                              <span key={oi} className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">{opt}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Validation + Condition section */}
                    {expandedFieldIdx === idx && (
                      <div className="pr-6 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">

                        {/* ── Validation ── */}
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            {isAr ? "قواعد التحقق (اختياري)" : "Validation Rules (optional)"}
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "الحد الأدنى للأحرف" : "Min length"}</label>
                              <Input
                                type="number"
                                min={0}
                                value={(f as any).validationMin ?? ""}
                                onChange={e => updateField(idx, { validationMin: e.target.value ? Number(e.target.value) : null } as any)}
                                className="h-7 text-xs"
                                placeholder="0"
                                data-testid={`field-valmin-${idx}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "الحد الأقصى للأحرف" : "Max length"}</label>
                              <Input
                                type="number"
                                min={0}
                                value={(f as any).validationMax ?? ""}
                                onChange={e => updateField(idx, { validationMax: e.target.value ? Number(e.target.value) : null } as any)}
                                className="h-7 text-xs"
                                placeholder="—"
                                data-testid={`field-valmax-${idx}`}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">{isAr ? "نمط Regex (للتحقق)" : "Regex pattern"}</label>
                            <Input
                              value={(f as any).validationRegex ?? ""}
                              onChange={e => updateField(idx, { validationRegex: e.target.value || null } as any)}
                              className="h-7 text-xs font-mono"
                              placeholder="^[0-9]{10}$"
                              dir="ltr"
                              data-testid={`field-valregex-${idx}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">{isAr ? "رسالة خطأ التحقق" : "Validation error message"}</label>
                            <Input
                              value={(f as any).validationMessage ?? ""}
                              onChange={e => updateField(idx, { validationMessage: e.target.value || null } as any)}
                              className="h-7 text-xs"
                              placeholder={isAr ? "الرجاء إدخال رقم صحيح" : "Please enter a valid value"}
                              data-testid={`field-valmsg-${idx}`}
                            />
                          </div>
                        </div>

                        {/* ── Conditional Visibility ── */}
                        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            {isAr ? "ظهور مشروط (اختياري)" : "Conditional Visibility (optional)"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {isAr
                              ? "أظهر هذا الحقل فقط عندما يكون حقل آخر يساوي قيمة محددة."
                              : "Show this field only when another field equals a specific value."}
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">
                                {isAr ? "عندما يكون الحقل" : "When field"}
                              </label>
                              <select
                                value={(f as any).conditionField ?? ""}
                                onChange={e => updateField(idx, { conditionField: e.target.value || null, conditionValue: e.target.value ? (f as any).conditionValue : null } as any)}
                                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-7"
                                data-testid={`field-condfield-${idx}`}
                              >
                                <option value="">{isAr ? "— لا شرط —" : "— No condition —"}</option>
                                {fields
                                  .filter((other, oi) => oi !== idx && other.fieldType !== "autoincrement")
                                  .map(other => (
                                    <option key={other.id} value={other.key}>{other.label}</option>
                                  ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">
                                {isAr ? "يساوي القيمة" : "Equals value"}
                              </label>
                              <Input
                                value={(f as any).conditionValue ?? ""}
                                onChange={e => updateField(idx, { conditionValue: e.target.value || null } as any)}
                                className="h-7 text-xs"
                                placeholder={isAr ? "القيمة المطلوبة..." : "Required value..."}
                                disabled={!(f as any).conditionField}
                                data-testid={`field-condvalue-${idx}`}
                              />
                            </div>
                          </div>
                          {(f as any).conditionField && (
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5">
                              <span>⚡</span>
                              <span>
                                {isAr
                                  ? `هذا الحقل يظهر فقط عندما "${fields.find(o => o.key === (f as any).conditionField)?.label || (f as any).conditionField}" = "${(f as any).conditionValue || '(أي قيمة)'}"`
                                  : `This field shows only when "${fields.find(o => o.key === (f as any).conditionField)?.label || (f as any).conditionField}" = "${(f as any).conditionValue || '(any value)'}"` }
                              </span>
                            </div>
                          )}
                        </div>

                      </div>
                    )}
                  </div>
                ))
              )}
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
                  <Plus className="h-4 w-4 ml-1" />{isAr ? "إضافة حقل" : "Add Field"}
                </Button>
                <Button size="sm" onClick={() => saveFieldsMut.mutate()} disabled={saveFieldsMut.isPending} data-testid="button-save-fields">
                  {saveFieldsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                  {isAr ? "حفظ الحقول" : "Save Fields"}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* ══ SHEETS TAB ══ */}
        {tab === "sheets" && (
          <div className="space-y-4">

            {/* Step-by-step guide */}
            <Card className="overflow-hidden">
              <button
                onClick={() => setShowGuide(v => !v)}
                className="w-full flex items-center justify-between p-4 text-right hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                data-testid="button-toggle-guide"
              >
                <span className="text-sm font-semibold flex items-center gap-2">
                  {isAr ? "📖 دليل الإعداد الكامل خطوة بخطوة" : "📖 Full Step-by-Step Setup Guide"}
                </span>
                {showGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showGuide && (
                <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">
                      {isAr ? "أ — إعداد Google Cloud Console (مرة واحدة)" : "A — Google Cloud Console Setup (once)"}
                    </p>
                    {[
                      {
                        n: 1,
                        title: isAr ? "إنشاء مشروع Google Cloud" : "Create a Google Cloud project",
                        desc: isAr ? "انتقل إلى console.cloud.google.com → أنشئ مشروعاً جديداً أو اختر مشروعاً موجوداً." : "Go to console.cloud.google.com → create a new project or choose an existing one.",
                      },
                      {
                        n: 2,
                        title: isAr ? "تفعيل Google Sheets API فقط" : "Enable Google Sheets API only",
                        desc: isAr ? 'APIs & Services → Enable APIs → ابحث عن "Google Sheets API" وفعّله.' : 'APIs & Services → Enable APIs → search "Google Sheets API" and enable it.',
                      },
                      {
                        n: 3,
                        title: isAr ? "إنشاء Service Account وتحميل مفتاح JSON" : "Create a Service Account and download JSON key",
                        desc: isAr ? "APIs & Services → Credentials → Create Credentials → Service Account → افتحه → Keys → Add Key → JSON → تحميل." : "APIs & Services → Credentials → Create Credentials → Service Account → open it → Keys → Add Key → JSON → Download.",
                      },
                    ].map(step => (
                      <div key={step.n} className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">{step.n}</span>
                        <div>
                          <p className="text-sm font-semibold">{step.title}</p>
                          <p className="text-xs text-muted-foreground">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Sheets settings form */}
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
              <Card className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "رابط أو ID ملف Spreadsheet" : "Spreadsheet URL or ID"}</Label>
                  <Input {...register("googleSheetId")} placeholder="https://docs.google.com/spreadsheets/d/..." data-testid="input-googleSheetId" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{isAr ? "اسم ورقة العمل" : "Sheet Name"}</Label>
                    <Input {...register("googleSheetName")} placeholder={isAr ? "بيانات" : "Data"} data-testid="input-googleSheetName" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{isAr ? "بريد Service Account" : "Service Account Email"}</Label>
                    <Input {...register("googleServiceAccountEmail")} placeholder="...@...iam.gserviceaccount.com" data-testid="input-googleServiceAccountEmail" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "مفتاح JSON لـ Service Account" : "Service Account JSON Key"}</Label>
                  <Textarea {...register("googleServiceAccountKey")} placeholder={isAr ? "الصق محتوى ملف JSON هنا" : "Paste JSON file content here"} rows={4} className="font-mono text-xs" data-testid="input-googleServiceAccountKey" />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-sheets">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                    {isAr ? "حفظ" : "Save"}
                  </Button>
                  <Button type="button" variant="outline" onClick={testSheets} disabled={testing} data-testid="button-test-sheets">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                    {isAr ? "اختبار الاتصال" : "Test Connection"}
                  </Button>
                </div>
              </Card>
            </form>

            {/* Sheet tools */}
            <Card className="p-5 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wrench className="h-4 w-4 text-orange-500" />{isAr ? "أدوات الـ Sheet" : "Sheet Tools"}
              </h3>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" size="sm" onClick={checkColumns} disabled={sheetsLoading === "check"} data-testid="button-check-columns">
                  {sheetsLoading === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <TableProperties className="h-3.5 w-3.5 ml-1" />}
                  {isAr ? "فحص الأعمدة" : "Check Columns"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={fixHeaders} disabled={sheetsLoading === "fix"} data-testid="button-fix-headers">
                  {sheetsLoading === "fix" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Wrench className="h-3.5 w-3.5 ml-1" />}
                  {isAr ? "إصلاح الترويسات" : "Fix Headers"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={doImport} disabled={sheetsLoading === "import"} data-testid="button-import-sheets">
                  {sheetsLoading === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Upload className="h-3.5 w-3.5 ml-1" />}
                  {isAr ? "استيراد من Sheet" : "Import from Sheet"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={doExport} disabled={sheetsLoading === "export"} data-testid="button-export-sheets">
                  {sheetsLoading === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <ArrowUpToLine className="h-3.5 w-3.5 ml-1" />}
                  {isAr ? "تصدير إلى Sheet" : "Export to Sheet"}
                </Button>
              </div>
              {checkResult && (
                <div className={`p-3 rounded-lg text-sm ${checkResult.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700" : "bg-red-50 dark:bg-red-900/20 text-red-700"}`}>
                  <p className="font-semibold mb-1">{checkResult.message}</p>
                  {checkResult.missing && checkResult.missing.length > 0 && (
                    <p className="text-xs">{isAr ? "ناقصة: " : "Missing: "}{checkResult.missing.join(", ")}</p>
                  )}
                  {checkResult.extra && checkResult.extra.length > 0 && (
                    <p className="text-xs">{isAr ? "زائدة: " : "Extra: "}{checkResult.extra.join(", ")}</p>
                  )}
                </div>
              )}
              {importResult && (
                <div className={`p-3 rounded-lg text-sm ${importResult.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700" : "bg-red-50 dark:bg-red-900/20 text-red-700"}`}>
                  {importResult.message}
                </div>
              )}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <input type="checkbox" id="syncDel" checked={syncDeleted} onChange={e => setSyncDeleted(e.target.checked)} className="rounded" />
                <label htmlFor="syncDel" className="text-xs text-muted-foreground">{isAr ? "مزامنة الحذف عند الاستيراد" : "Sync deletion on import"}</label>
              </div>
            </Card>
          </div>
        )}

        {/* ══ TELEGRAM TAB ══ */}
        {tab === "telegram" && (
          <form onSubmit={handleSubmit(d => testTelegram(d))}>
            <Card className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "Bot Token" : "Bot Token"}</Label>
                <Input {...register("telegramBotToken")} placeholder="123456789:AAG..." type="password" data-testid="input-telegramBotToken" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "Chat ID" : "Chat ID"}</Label>
                <Input {...register("telegramChatId")} placeholder="-100..." data-testid="input-telegramChatId" />
              </div>
              {chatIdChats && chatIdChats.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{isAr ? "المجموعات المتاحة:" : "Available chats:"}</p>
                  {chatIdChats.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => setValue("telegramChatId", c.id)}
                      className="w-full text-right text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-primary/10 flex justify-between items-center">
                      <span className="font-mono text-muted-foreground">{c.id}</span>
                      <span>{c.title} ({c.type})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={handleSubmit(fetchChatId)} disabled={chatIdLoading} data-testid="button-fetch-chatid">
                  {chatIdLoading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <BotMessageSquare className="h-4 w-4 ml-1" />}
                  {isAr ? "جلب Chat ID" : "Fetch Chat ID"}
                </Button>
                <Button type="submit" variant="outline" disabled={testing} data-testid="button-test-telegram">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                  {isAr ? "إرسال رسالة اختبار" : "Send Test Message"}
                </Button>
                <Button type="button" onClick={handleSubmit(d => saveMut.mutate(d))} disabled={saveMut.isPending} data-testid="button-save-telegram">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                  {isAr ? "حفظ" : "Save"}
                </Button>
              </div>
            </Card>
          </form>
        )}

        {/* ══ AUDIT LOG TAB ══ */}
        {tab === "audit" && (
          <div className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <History className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">{isAr ? "سجل النشاط (آخر 100 عملية)" : "Activity Log (last 100)"}</h3>
              </div>

              {auditLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-100 dark:border-slate-700">
                      <Skeleton className="h-6 w-14 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !auditLog || auditLog.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  {isAr ? "لا توجد سجلات نشاط بعد." : "No activity logs yet."}
                </p>
              ) : (
                <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-700">
                  {auditLog.map((log: any) => {
                    const actionInfo = ACTION_LABEL[log.action] || { ar: log.action, en: log.action, color: "bg-slate-100 text-slate-600" };
                    const date = log.changedAt ? new Date(log.changedAt) : null;
                    return (
                      <div key={log.id} className="flex items-start gap-3 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${actionInfo.color}`}>
                          {isAr ? actionInfo.ar : actionInfo.en}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium text-slate-700 dark:text-slate-300">{log.userName || log.changedBy || (isAr ? "مجهول" : "Unknown")}</span>
                            <span className="text-muted-foreground">{isAr ? "على السجل" : "on record"}</span>
                            <span className="font-mono text-[10px] text-muted-foreground truncate">{log.recordId?.slice(0, 8)}…</span>
                          </div>
                          {date && (
                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              <span>{date.toLocaleDateString(isAr ? "ar" : "en")} — {date.toLocaleTimeString(isAr ? "ar" : "en", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
