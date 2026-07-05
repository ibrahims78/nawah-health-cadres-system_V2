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
import { apiRequest, fetchJson } from "@/lib/queryClient";
import {
  Save, Loader2, Plus, Trash2, ArrowUp, ArrowDown, ArrowRight, ExternalLink,
  ChevronDown, ChevronUp, Eye, EyeOff, GitBranch, Settings2, FileUp,
  Upload, TableProperties, Wrench, RefreshCw, BotMessageSquare, ArrowUpToLine,
  History, User, Clock, FolderSync, HardDrive, AlertTriangle, CheckCircle2, XCircle,
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
  const [tab, setTab] = useState<"form" | "fields" | "sheets" | "telegram" | "audit" | "drive">("form");
  const [testing, setTesting] = useState(false);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [showGuide, setShowGuide] = useState(false);


  // Sheets-specific state
  const [checkResult, setCheckResult] = useState<{
    ok: boolean; message: string;
    matched?: string[]; missing?: string[]; extra?: string[];
  } | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState<"check" | "fix" | "preview" | "import" | "export" | null>(null);

  // Telegram-specific state
  const [chatIdLoading, setChatIdLoading] = useState(false);
  const [chatIdChats, setChatIdChats] = useState<{ id: string; title: string; type: string }[] | null>(null);

  // Drive-specific state
  const [driveModal, setDriveModal] = useState(false);
  const [driveMode, setDriveMode] = useState<"keep_local" | "delete_local">("keep_local");
  const [driveResult, setDriveResult] = useState<{ synced: number; failed: number; failedRecords: any[]; message?: string } | null>(null);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveRootInput, setDriveRootInput] = useState("");

  // Expanded field for validation
  const [expandedFieldIdx, setExpandedFieldIdx] = useState<number | null>(null);

  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetchJson(`/api/projects/${id}`),
  });

  const { data: rawFields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetchJson(`/api/projects/${id}/fields`),
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<any[]>({
    queryKey: ["/api/projects", id, "audit-log"],
    queryFn: () => fetchJson(`/api/projects/${id}/audit-log?limit=100`),
    enabled: tab === "audit",
  });

  const { data: syncStats, refetch: refetchStats } = useQuery<{
    local: number; synced: number; failed: number; syncing: number; total: number; hasFileFields: boolean;
  }>({
    queryKey: ["/api/projects", id, "sync-stats"],
    queryFn: () => fetchJson(`/api/projects/${id}/sync-stats`),
    enabled: tab === "drive",
    refetchInterval: driveSyncing ? 3000 : false,
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
        importSheetId: project.importSheetId,
        googleServiceAccountEmail: project.googleServiceAccountEmail,
        telegramChatId: project.telegramChatId,
      });
      setDriveRootInput(project.driveRootFolderId || project.googleDriveFolderId || "");
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
    mutationFn: () => {
      // Strip incomplete conditions (field === "") before sending to avoid Zod validation errors
      const cleanedFields = fields.map(f => ({
        ...f,
        conditions: Array.isArray((f as any).conditions)
          ? (f as any).conditions.filter((c: any) => c.field && c.field.trim() !== "")
          : (f as any).conditions,
      }));
      return apiRequest("POST", `/api/projects/${id}/fields`, { fields: cleanedFields });
    },
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

  const previewImport = async () => {
    setSheetsLoading("preview"); setImportPreview(null); setImportResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/import-from-sheets`, { syncDeleted, dryRun: true }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    setImportPreview(res);
    setSheetsLoading(null);
  };

  const doImport = async () => {
    setSheetsLoading("import"); setImportResult(null); setImportPreview(null);
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
      conditions: [], conditionOperator: "AND", visibleTo: "all", isReadOnly: false,
      allowedFileTypes: null, maxFileSizeMb: null,
    } as any]);
  };

  const removeField = (idx: number) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
    if (expandedFieldIdx === idx) setExpandedFieldIdx(null);
  };
  const updateField = (idx: number, upd: Partial<ProjectField>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...upd } : f));

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    setFields(prev => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((f, i) => ({ ...f, orderIndex: i }));
    });
  };

  const doSyncDrive = async (retryFailed = false) => {
    setDriveSyncing(true);
    setDriveResult(null);
    setDriveModal(false);
    try {
      const res: any = await apiRequest("POST", `/api/projects/${id}/sync-drive`, {
        mode: driveMode, retryFailed,
      });
      setDriveResult(res);
      if (res.ok) {
        toast({ description: isAr ? `✅ تمت المزامنة: ${res.synced} ملف` : `✅ Synced: ${res.synced} files` });
        refetchStats();
      }
    } catch (err: any) {
      toast({ variant: "destructive", description: `❌ ${err.message}` });
    }
    setDriveSyncing(false);
  };

  const saveDriveRoot = async () => {
    try {
      await apiRequest("PATCH", `/api/projects/${id}`, { googleDriveFolderId: driveRootInput });
      qc.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ description: isAr ? "✅ تم حفظ معرِّف مجلد Drive" : "✅ Drive folder ID saved" });
    } catch (err: any) {
      toast({ variant: "destructive", description: `❌ ${err.message}` });
    }
  };

  const tabs = [
    { key: "form",     label: isAr ? "النموذج" : "Form" },
    { key: "fields",   label: isAr ? "الحقول" : "Fields" },
    { key: "sheets",   label: "Google Sheets" },
    { key: "telegram", label: "Telegram" },
    { key: "drive",    label: isAr ? "مزامنة Drive" : "Drive Sync" },
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
                fields.map((f, idx) => {
                  const condCount = ((f as any).conditions || []).filter((c: any) => c.field).length;
                  const isFieldVisible = f.isVisible !== false;
                  const isExpanded = expandedFieldIdx === idx;

                  // field type label map
                  const typeLabels: Record<string, string> = isAr
                    ? { text: "📝 نص", number: "🔢 رقم", date: "📅 تاريخ", select: "📋 قائمة", radio: "🔘 راديو", textarea: "📄 نص طويل", phone: "📞 هاتف", email: "✉️ بريد", checkbox: "☑️ خانة اختيار", file: "📎 رفع ملف", autoincrement: "🔁 ترقيم تلقائي", heading: "🔤 نص توجيهي / عنوان" }
                    : { text: "📝 Text", number: "🔢 Number", date: "📅 Date", select: "📋 Select", radio: "🔘 Radio", textarea: "📄 Textarea", phone: "📞 Phone", email: "✉️ Email", checkbox: "☑️ Checkbox", file: "📎 File Upload", autoincrement: "🔁 Auto Number", heading: "🔤 Heading / Info Text" };

                  return (
                  <div
                    key={f.id}
                    className={`border rounded-xl overflow-hidden transition-all duration-200 ${
                      isFieldVisible
                        ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
                        : "border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/20 opacity-60"
                    }`}
                    data-testid={`field-${idx}`}
                  >
                    {/* ── TOP: Order buttons + Inputs + Type + Step ── */}
                    <div className="flex items-center gap-2 p-3">
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => moveField(idx, -1)}
                          disabled={idx === 0}
                          className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-primary/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                          title={isAr ? "تحريك لأعلى" : "Move up"}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(idx, 1)}
                          disabled={idx === fields.length - 1}
                          className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-primary/10 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                          title={isAr ? "تحريك لأسفل" : "Move down"}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Label + Key */}
                      <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                        <Input
                          value={f.label}
                          onChange={e => updateField(idx, { label: e.target.value })}
                          placeholder={isAr ? "الاسم المعروض للمستخدم" : "Display label"}
                          className="text-sm h-8"
                          data-testid={`field-label-${idx}`}
                        />
                        <Input
                          value={f.key}
                          onChange={e => updateField(idx, { key: e.target.value })}
                          placeholder={isAr ? "المفتاح الداخلي (key)" : "Internal key"}
                          className="text-sm h-8 font-mono text-slate-500"
                          data-testid={`field-key-${idx}`}
                        />
                      </div>

                      {/* Type selector */}
                      <select
                        value={f.fieldType || "text"}
                        onChange={e => updateField(idx, { fieldType: e.target.value })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 min-w-[130px]"
                        data-testid={`field-type-${idx}`}
                      >
                        {Object.entries(typeLabels).map(([v, label]) => (
                          <option key={v} value={v}>{label}</option>
                        ))}
                      </select>

                      {/* Step */}
                      <select
                        value={f.stepNumber || 1}
                        onChange={e => updateField(idx, { stepNumber: Number(e.target.value) })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 w-24"
                        data-testid={`field-step-${idx}`}
                      >
                        {[1, 2, 3, 4, 5].map(s => (
                          <option key={s} value={s}>{isAr ? `الخطوة ${s}` : `Step ${s}`}</option>
                        ))}
                      </select>
                    </div>

                    {/* ── PLACEHOLDER / SUBTITLE ROW ── */}
                    {f.fieldType !== "autoincrement" && f.fieldType !== "select" && f.fieldType !== "radio" && (
                      <div className="px-3 pb-2">
                        <Input
                          value={(f as any).placeholder ?? ""}
                          onChange={e => updateField(idx, { placeholder: e.target.value || null } as any)}
                          className="text-xs h-7 text-slate-500"
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
                        onClick={() => updateField(idx, { isRequired: !f.isRequired })}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                          f.isRequired
                            ? "bg-rose-50 border-rose-300 text-rose-600 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-400"
                            : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700"
                        }`}
                        data-testid={`field-required-${idx}`}
                        title={isAr ? "إلزامي — المستخدم مُلزم بملء هذا الحقل" : "Required — user must fill this field"}
                      >
                        <span>{f.isRequired ? "✱" : "○"}</span>
                        {isAr ? "إلزامي" : "Required"}
                      </button>

                      {/* Visible toggle */}
                      <button
                        type="button"
                        onClick={() => updateField(idx, { isVisible: !isFieldVisible })}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                          isFieldVisible
                            ? "bg-sky-50 border-sky-300 text-sky-600 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-400"
                            : "bg-slate-100 border-slate-300 text-slate-400 dark:bg-slate-800 dark:border-slate-600 line-through"
                        }`}
                        title={isAr
                          ? (isFieldVisible ? "الحقل ظاهر في نموذج التعبئة — اضغط لإخفائه" : "الحقل مخفي من نموذج التعبئة — اضغط لإظهاره")
                          : (isFieldVisible ? "Visible in form — click to hide" : "Hidden from form — click to show")}
                      >
                        {isFieldVisible
                          ? <Eye className="h-3 w-3" />
                          : <EyeOff className="h-3 w-3" />}
                        {isAr ? (isFieldVisible ? "ظاهر في النموذج" : "مخفي من النموذج") : (isFieldVisible ? "Visible" : "Hidden")}
                      </button>

                      {/* Advanced panel toggle — conditions + validation in one panel */}
                      <button
                        type="button"
                        onClick={() => setExpandedFieldIdx(isExpanded ? null : idx)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${
                          isExpanded
                            ? "bg-primary/10 border-primary/40 text-primary dark:bg-primary/20"
                            : condCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400"
                              : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 hover:border-primary/40 hover:text-primary"
                        }`}
                        data-testid={`field-expand-${idx}`}
                        title={isAr ? "شروط الظهور + التحقق + الخيارات المتقدمة" : "Conditions + Validation + Advanced options"}
                      >
                        <GitBranch className="h-3 w-3" />
                        {isAr ? "شروط وتحقق" : "Conditions & Validation"}
                        {condCount > 0 && (
                          <span className="bg-amber-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{condCount}</span>
                        )}
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {/* Spacer */}
                      <div className="flex-1" />

                      {/* DELETE — always visible and clearly red */}
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border border-red-200 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-600 dark:hover:border-red-600 dark:hover:text-white"
                        data-testid={`button-remove-field-${idx}`}
                        title={isAr ? "حذف هذا الحقل نهائياً" : "Delete this field permanently"}
                      >
                        <Trash2 className="h-3 w-3" />
                        {isAr ? "حذف الحقل" : "Delete"}
                      </button>
                    </div>

                    {/* ── FILE FIELD OPTIONS ── */}
                    {f.fieldType === "file" && (
                      <div className="mx-3 mb-3 p-3 rounded-lg bg-blue-50/60 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 space-y-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                          <FileUp className="h-3.5 w-3.5" />
                          {isAr ? "إعدادات رفع الملف" : "File Upload Settings"}
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground mb-2">
                            {isAr ? "أنواع الملفات المسموحة — اتركه فارغاً للسماح بأي ملف" : "Allowed file types — leave empty to allow all"}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt"].map(ext => {
                              const current: string[] = (f as any).allowedFileTypes || [];
                              const isChecked = current.includes(ext);
                              return (
                                <label key={ext} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] cursor-pointer select-none font-medium transition-all ${
                                  isChecked
                                    ? "bg-blue-500 border-blue-500 text-white"
                                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-blue-300"
                                }`}>
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={isChecked}
                                    onChange={e => {
                                      const prev: string[] = (f as any).allowedFileTypes || [];
                                      const next = e.target.checked ? [...prev, ext] : prev.filter(t => t !== ext);
                                      updateField(idx, { allowedFileTypes: next.length > 0 ? next : null } as any);
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
                            onChange={e => updateField(idx, { maxFileSizeMb: e.target.value ? Number(e.target.value) : null } as any)}
                            placeholder={isAr ? "افتراضي: 10" : "Default: 10"}
                            className="w-32 h-7 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 px-2 text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {/* ── SELECT / RADIO OPTIONS ── */}
                    {(f.fieldType === "select" || f.fieldType === "radio") && (
                      <div className="mx-3 mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-500">{isAr ? "الخيارات — كل خيار في سطر منفصل" : "Options — one per line"}</p>
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

                    {/* ── EXPANDED: CONDITIONS + VALIDATION + ACCESS ── */}
                    {isExpanded && (
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
                                onChange={e => updateField(idx, { conditionOperator: e.target.value } as any)}
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
                            <div key={ci} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium">{isAr ? "إذا كان الحقل" : "If field"}</label>
                                <select
                                  value={cond.field ?? ""}
                                  onChange={e => {
                                    const next = [...((f as any).conditions || [])];
                                    next[ci] = { ...next[ci], field: e.target.value };
                                    updateField(idx, { conditions: next } as any);
                                  }}
                                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-7"
                                  data-testid={`field-condfield-${idx}-${ci}`}
                                >
                                  <option value="">{isAr ? "— اختر حقلاً —" : "— choose a field —"}</option>
                                  {fields
                                    .filter((other, oi) => oi !== idx && other.fieldType !== "autoincrement")
                                    .map(other => (
                                      <option key={other.id} value={other.key}>{other.label || other.key}</option>
                                    ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium">{isAr ? "عكس" : "Negate"}</label>
                                <div className="h-7 flex items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={!!cond.negate}
                                    onChange={e => {
                                      const next = [...((f as any).conditions || [])];
                                      next[ci] = { ...next[ci], negate: e.target.checked };
                                      updateField(idx, { conditions: next } as any);
                                    }}
                                    className="rounded"
                                    data-testid={`field-condnegate-${idx}-${ci}`}
                                    title={isAr ? "عكس الشرط (≠ بدلاً من =)" : "Negate condition (≠ instead of =)"}
                                  />
                                </div>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium">{isAr ? (cond.negate ? "لا يساوي" : "يساوي") : (cond.negate ? "not equal to" : "equals")}</label>
                                <Input
                                  value={cond.value ?? ""}
                                  onChange={e => {
                                    const next = [...((f as any).conditions || [])];
                                    next[ci] = { ...next[ci], value: e.target.value };
                                    updateField(idx, { conditions: next } as any);
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
                                  const next = ((f as any).conditions || []).filter((_: any, i: number) => i !== ci);
                                  updateField(idx, { conditions: next } as any);
                                }}
                                data-testid={`button-remove-cond-${idx}-${ci}`}
                                title={isAr ? "حذف الشرط" : "Remove condition"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}

                          <Button
                            type="button" variant="outline" size="sm" className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700"
                            onClick={() => {
                              const next = [...((f as any).conditions || []), { field: "", value: "", negate: false }];
                              updateField(idx, { conditions: next } as any);
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
                                {(f as any).conditions.filter((c: any) => c.field).map((c: any, i: number) => {
                                  const lbl = fields.find(o => o.key === c.field)?.label || c.field;
                                  const expr = isAr
                                    ? `«${lbl}» ${c.negate ? "≠" : "="} «${c.value || "أي قيمة"}»`
                                    : `"${lbl}" ${c.negate ? "≠" : "="} "${c.value || "any value"}"`;
                                  return i === 0 ? expr : ` ${(f as any).conditionOperator === "OR" ? (isAr ? "أو" : "OR") : (isAr ? "و" : "AND")} ${expr}`;
                                }).join("")}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* ── Validation ── */}
                        <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                          <div className="flex items-center gap-1.5">
                            <Settings2 className="h-3.5 w-3.5 text-slate-400" />
                            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                              {isAr ? "قواعد التحقق (اختياري)" : "Validation Rules (optional)"}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "الحد الأدنى للأحرف" : "Min length"}</label>
                              <Input type="number" min={0} value={(f as any).validationMin ?? ""} onChange={e => updateField(idx, { validationMin: e.target.value ? Number(e.target.value) : null } as any)} className="h-7 text-xs" placeholder="0" data-testid={`field-valmin-${idx}`} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "الحد الأقصى للأحرف" : "Max length"}</label>
                              <Input type="number" min={0} value={(f as any).validationMax ?? ""} onChange={e => updateField(idx, { validationMax: e.target.value ? Number(e.target.value) : null } as any)} className="h-7 text-xs" placeholder="—" data-testid={`field-valmax-${idx}`} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">{isAr ? "نمط Regex (للتحقق)" : "Regex pattern"}</label>
                            <Input value={(f as any).validationRegex ?? ""} onChange={e => updateField(idx, { validationRegex: e.target.value || null } as any)} className="h-7 text-xs font-mono" placeholder="^[0-9]{10}$" dir="ltr" data-testid={`field-valregex-${idx}`} />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">{isAr ? "رسالة خطأ التحقق" : "Validation error message"}</label>
                            <Input value={(f as any).validationMessage ?? ""} onChange={e => updateField(idx, { validationMessage: e.target.value || null } as any)} className="h-7 text-xs" placeholder={isAr ? "الرجاء إدخال قيمة صحيحة" : "Please enter a valid value"} data-testid={`field-valmsg-${idx}`} />
                          </div>
                        </div>

                        {/* ── Access Control ── */}
                        <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{isAr ? "التحكم بالوصول" : "Access Control"}</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "مرئي لصلاحية" : "Visible to role"}</label>
                              <select value={(f as any).visibleTo || "all"} onChange={e => updateField(idx, { visibleTo: e.target.value } as any)} className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-7" data-testid={`field-visibleto-${idx}`}>
                                <option value="all">{isAr ? "الجميع" : "Everyone"}</option>
                                <option value="admin">{isAr ? "المدير فقط" : "Admin only"}</option>
                                <option value="editor">{isAr ? "المحرر فقط" : "Editor only"}</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "قراءة فقط بعد الإنشاء" : "Read-only after creation"}</label>
                              <div className="h-7 flex items-center gap-1.5">
                                <input type="checkbox" checked={!!(f as any).isReadOnly} onChange={e => updateField(idx, { isReadOnly: e.target.checked } as any)} className="rounded" id={`readonly-${idx}`} data-testid={`field-readonly-${idx}`} />
                                <label htmlFor={`readonly-${idx}`} className="text-xs">{isAr ? "لا يمكن تعديله بعد الإنشاء" : "Cannot be edited after creation"}</label>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">{isAr ? "عرض الحقل في النموذج" : "Field width in form"}</label>
                              <div className="h-7 flex items-center gap-1.5">
                                <input type="checkbox" checked={!!(f as any).isFullWidth} onChange={e => updateField(idx, { isFullWidth: e.target.checked } as any)} className="rounded" id={`fullwidth-${idx}`} data-testid={`field-fullwidth-${idx}`} />
                                <label htmlFor={`fullwidth-${idx}`} className="text-xs">{isAr ? "عرض كامل (صف مستقل)" : "Full width (own row)"}</label>
                              </div>
                            </div>
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                  );
                })
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
                  <Label className="text-xs">{isAr ? "رابط أو ID ملف Spreadsheet (للمزامنة والتصدير)" : "Spreadsheet URL or ID (for sync & export)"}</Label>
                  <Input {...register("googleSheetId")} placeholder="https://docs.google.com/spreadsheets/d/..." data-testid="input-googleSheetId" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "رابط أو ID ملف مصدر الاستيراد (اختياري)" : "Import Source Spreadsheet URL or ID (optional)"}</Label>
                  <Input {...register("importSheetId")} placeholder={isAr ? "اتركه فارغاً لاستخدام نفس ملف المزامنة أعلاه" : "Leave empty to use the same sheet as above"} data-testid="input-importSheetId" />
                  <p className="text-[10px] text-muted-foreground">
                    {isAr
                      ? "استخدم هذا إذا أردت الاستيراد من ملف مختلف عن ملف المزامنة/التصدير."
                      : "Use this if you want to import from a different sheet than the one used for sync/export."}
                  </p>
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
                <Button type="button" variant="outline" size="sm" onClick={previewImport} disabled={sheetsLoading === "preview"} data-testid="button-preview-import">
                  {sheetsLoading === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Upload className="h-3.5 w-3.5 ml-1" />}
                  {isAr ? "معاينة الاستيراد" : "Preview Import"}
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
              {importPreview && (
                <div className={`p-3 rounded-lg text-sm space-y-2 ${importPreview.ok ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300" : "bg-red-50 dark:bg-red-900/20 text-red-700"}`}>
                  <p className="font-semibold">{importPreview.message}</p>
                  {importPreview.ok && (importPreview.added > 0 || importPreview.updated > 0 || (importPreview.deleted || 0) > 0) && (
                    <>
                      {importPreview.preview && importPreview.preview.length > 0 && (
                        <div className="max-h-40 overflow-y-auto rounded-md bg-white/60 dark:bg-black/20 divide-y divide-amber-100 dark:divide-amber-900/30">
                          {importPreview.preview.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1 text-xs">
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${p.action === "add" ? "bg-green-100 text-green-700" : p.action === "update" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"}`}>
                                {p.action === "add" ? (isAr ? "إضافة" : "Add") : p.action === "update" ? (isAr ? "تحديث" : "Update") : (isAr ? "حذف" : "Delete")}
                              </span>
                              <span className="font-mono">#{p.seqNum}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button type="button" size="sm" onClick={doImport} disabled={sheetsLoading === "import"} data-testid="button-confirm-import">
                          {sheetsLoading === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Upload className="h-3.5 w-3.5 ml-1" />}
                          {isAr ? "تأكيد الاستيراد" : "Confirm Import"}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setImportPreview(null)} data-testid="button-cancel-import">
                          {isAr ? "إلغاء" : "Cancel"}
                        </Button>
                      </div>
                    </>
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

        {/* ══ DRIVE SYNC TAB ══ */}
        {tab === "drive" && (
          <div className="space-y-4">

            {/* Drive root folder config */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <HardDrive className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">{isAr ? "إعداد مجلد Drive الجذر" : "Drive Root Folder Setup"}</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "أدخل معرِّف مجلد Google Drive المشترك مع حساب الخدمة. ستُنشأ مجلدات المشروع والسجلات داخله تلقائياً عند المزامنة."
                  : "Enter the Google Drive folder ID shared with the service account. Project and record folders will be created inside it automatically during sync."}
              </p>
              <div className="flex gap-2">
                <input
                  value={driveRootInput}
                  onChange={e => setDriveRootInput(e.target.value)}
                  placeholder={isAr ? "مثال: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" : "e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"}
                  className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  data-testid="input-drive-root-folder"
                />
                <Button type="button" size="sm" onClick={saveDriveRoot} disabled={!driveRootInput}>
                  <Save className="h-3.5 w-3.5 ml-1" />{isAr ? "حفظ" : "Save"}
                </Button>
              </div>
              {driveRootInput && (
                <a href={`https://drive.google.com/drive/folders/${driveRootInput}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline" data-testid="link-drive-folder">
                  <ExternalLink className="h-3 w-3" />{isAr ? "فتح المجلد في Drive" : "Open folder in Drive"}
                </a>
              )}
            </Card>

            {/* Sync stats */}
            {syncStats && (
              <>
                {/* Warning banner */}
                {syncStats.hasFileFields && syncStats.local > 0 && (
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        {isAr ? `${syncStats.local} ملف محفوظ مؤقتاً على الخادم` : `${syncStats.local} file(s) stored locally on the server`}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        {isAr ? "قد تُفقَد هذه الملفات عند تحديث المنصة. يُنصح بالمزامنة مع Google Drive." : "These files may be lost on platform updates. Sync to Google Drive is recommended."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                {syncStats.hasFileFields ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Card className="p-4 text-center space-y-1">
                      <p className="text-2xl font-bold text-amber-500">{syncStats.local}</p>
                      <p className="text-xs text-muted-foreground">{isAr ? "محلي — لم يُزامَن" : "Local — not synced"}</p>
                    </Card>
                    <Card className="p-4 text-center space-y-1">
                      <p className="text-2xl font-bold text-green-500">{syncStats.synced}</p>
                      <p className="text-xs text-muted-foreground">{isAr ? "مُزامَن مع Drive" : "Synced to Drive"}</p>
                    </Card>
                    <Card className="p-4 text-center space-y-1">
                      <p className="text-2xl font-bold text-red-500">{syncStats.failed}</p>
                      <p className="text-xs text-muted-foreground">{isAr ? "فشلت المزامنة" : "Sync failed"}</p>
                    </Card>
                  </div>
                ) : (
                  <Card className="p-8 text-center">
                    <p className="text-sm text-muted-foreground">{isAr ? "لا يوجد حقول ملفات في هذا المشروع." : "No file fields configured in this project."}</p>
                  </Card>
                )}

                {/* Action buttons */}
                {syncStats.hasFileFields && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => { setDriveModal(true); setDriveResult(null); }}
                      disabled={driveSyncing || syncStats.local === 0}
                      className="gap-2"
                      data-testid="button-sync-drive"
                    >
                      {driveSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
                      {isAr ? `مزامنة الملفات المحلية (${syncStats.local})` : `Sync Local Files (${syncStats.local})`}
                    </Button>
                    {syncStats.failed > 0 && (
                      <Button variant="outline" onClick={() => doSyncDrive(true)} disabled={driveSyncing} className="gap-2" data-testid="button-retry-sync">
                        <RefreshCw className="h-3.5 w-3.5" />
                        {isAr ? `إعادة محاولة الفاشلة (${syncStats.failed})` : `Retry Failed (${syncStats.failed})`}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Sync result */}
            {driveResult && (
              <Card className="p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  {driveResult.failed === 0
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  {isAr ? "نتيجة المزامنة" : "Sync Result"}
                </div>
                {driveResult.message && <p className="text-sm text-muted-foreground">{driveResult.message}</p>}
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600 font-medium">✅ {isAr ? `نجح: ${driveResult.synced}` : `Synced: ${driveResult.synced}`}</span>
                  {driveResult.failed > 0 && (
                    <span className="text-red-500 font-medium">❌ {isAr ? `فشل: ${driveResult.failed}` : `Failed: ${driveResult.failed}`}</span>
                  )}
                </div>
                {driveResult.failedRecords && driveResult.failedRecords.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {driveResult.failedRecords.map((r: any) => (
                      <div key={r.id} className="flex items-start gap-2 text-xs text-red-500 dark:text-red-400">
                        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{r.id.slice(0, 8)}… — {r.error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Sync confirmation modal */}
            {driveModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <Card className="w-full max-w-md p-6 space-y-4" dir={isAr ? "rtl" : "ltr"}>
                  <div className="flex items-center gap-2">
                    <FolderSync className="h-5 w-5 text-primary" />
                    <h2 className="font-bold text-base">{isAr ? "تأكيد المزامنة مع Drive" : "Confirm Drive Sync"}</h2>
                  </div>

                  {syncStats && (
                    <p className="text-sm text-muted-foreground">
                      {isAr
                        ? `سيتم رفع ${syncStats.local} ملفاً إلى Google Drive.`
                        : `${syncStats.local} file(s) will be uploaded to Google Drive.`}
                    </p>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{isAr ? "بعد المزامنة:" : "After sync:"}</p>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="driveMode" value="keep_local" checked={driveMode === "keep_local"}
                        onChange={() => setDriveMode("keep_local")} className="mt-0.5 accent-primary" data-testid="radio-keep-local" />
                      <div>
                        <p className="text-sm font-medium">{isAr ? "إبقاء النسخة المحلية + Drive" : "Keep local copy + Drive"}</p>
                        <p className="text-xs text-muted-foreground">{isAr ? "الملفات تبقى على الخادم وفي Drive" : "Files remain on server and in Drive"}</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="driveMode" value="delete_local" checked={driveMode === "delete_local"}
                        onChange={() => setDriveMode("delete_local")} className="mt-0.5 accent-primary" data-testid="radio-delete-local" />
                      <div>
                        <p className="text-sm font-medium">{isAr ? "حذف النسخة المحلية بعد المزامنة" : "Delete local copy after sync"}</p>
                        <p className="text-xs text-red-500">{isAr ? "⚠️ Drive سيكون المصدر الوحيد — لا يمكن التراجع" : "⚠️ Drive will be the only source — irreversible"}</p>
                      </div>
                    </label>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" onClick={() => setDriveModal(false)} data-testid="button-cancel-sync">
                      {isAr ? "إلغاء" : "Cancel"}
                    </Button>
                    <Button onClick={() => doSyncDrive(false)} className="gap-2" data-testid="button-confirm-sync">
                      <FolderSync className="h-4 w-4" />
                      {isAr ? "بدء المزامنة" : "Start Sync"}
                    </Button>
                  </div>
                </Card>
              </div>
            )}

          </div>
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
