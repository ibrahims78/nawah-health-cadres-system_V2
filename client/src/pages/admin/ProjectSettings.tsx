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
import { apiRequest } from "@/lib/queryClient";
import {
  Save, Loader2, Plus, Trash2, GripVertical, ArrowRight, ExternalLink,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  Upload, TableProperties, Wrench, RefreshCw, BotMessageSquare,
} from "lucide-react";
import type { Project, ProjectField } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";

export function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [tab, setTab] = useState<"form" | "fields" | "sheets" | "telegram">("form");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  const [showManualSheetId, setShowManualSheetId] = useState(false);

  // Sheets-specific state
  const [checkResult, setCheckResult] = useState<{
    ok: boolean; message: string;
    matched?: string[]; missing?: string[]; extra?: string[];
  } | null>(null);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState<"check" | "fix" | "import" | "cleanup" | null>(null);

  // Telegram-specific state
  const [chatIdLoading, setChatIdLoading] = useState(false);
  const [chatIdChats, setChatIdChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [chatIdMsg, setChatIdMsg] = useState<string | null>(null);

  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: (query: any) => query.state.data?.sheetCreationPending ? 20_000 : false,
  });

  const prevSheetPending = useRef(false);
  useEffect(() => {
    if (prevSheetPending.current && project?.googleSheetId && !project?.sheetCreationPending) {
      setTestResult(isAr ? "✅ تم إنشاء الـ Sheet تلقائياً بنجاح!" : "✅ Google Sheet automatically created successfully!");
      setCreatedSheetUrl(`https://docs.google.com/spreadsheets/d/${project.googleSheetId}/edit`);
    }
    prevSheetPending.current = !!project?.sheetCreationPending;
  }, [project?.sheetCreationPending, project?.googleSheetId, isAr]);

  const { data: rawFields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
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
        googleDriveFolderId: project.googleDriveFolderId,
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
      setTestResult(isAr ? "✅ تم الحفظ بنجاح" : "✅ Saved successfully");
      setTimeout(() => setTestResult(null), 3000);
    },
    onError: (err: any) => setTestResult(`❌ ${err.message}`),
  });

  const saveFieldsMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/fields`, { fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "fields"] });
      setTestResult(isAr ? "✅ تم حفظ الحقول بنجاح" : "✅ Fields saved successfully");
      setTimeout(() => setTestResult(null), 3000);
    },
    onError: (err: any) => setTestResult(`❌ ${err.message}`),
  });

  const testSheets = async () => {
    setTesting(true); setTestResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/test-sheets`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    setTestResult(res.message); setTesting(false);
  };

  const createSheet = async () => {
    if (project?.googleSheetId) {
      const ok = window.confirm(
        isAr ? "سيتم إنشاء ملف Google Sheet جديد في المجلد المحدد.\n" +
        "الملف القديم لن يُحذف لكن لن يُستخدم بعد الآن.\n\n" +
        "هل تريد المتابعة؟" :
        "A new Google Sheet will be created in the specified folder.\n" +
        "The old file will not be deleted but will no longer be used.\n\n" +
        "Do you want to continue?"
      );
      if (!ok) return;
    }
    setTesting(true); setTestResult(null); setCreatedSheetUrl(null);

    let res: any = await apiRequest("POST", `/api/projects/${id}/create-sheet`, {}).catch(e => ({ message: `❌ ${e.message}` }));

    if (!res.ok && res.message && /حصة|quota/i.test(res.message)) {
      setTestResult(isAr ? "⏳ حصة Drive ممتلئة — جارٍ تنظيف الملفات القديمة تلقائياً..." : "⏳ Drive quota full — cleaning up old files automatically...");
      await apiRequest("POST", `/api/projects/${id}/cleanup-drive`, {}).catch(() => null);
      setTestResult(isAr ? "⏳ اكتمل التنظيف — جارٍ إعادة إنشاء الـ Sheet..." : "⏳ Cleanup complete — recreating the Sheet...");
      res = await apiRequest("POST", `/api/projects/${id}/create-sheet`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    }

    setTestResult(res.message);
    if (res.sheetId) {
      qc.invalidateQueries({ queryKey: ["/api/projects", id] });
      if (res.sheetUrl) setCreatedSheetUrl(res.sheetUrl);
    }
    if (res.needsManualId) setShowManualSheetId(true);
    setTesting(false);
  };

  const cleanupDrive = async () => {
    if (!window.confirm(
      isAr ? "سيقوم هذا بفحص جميع الملفات في Drive الـ Service Account (جميع الأنواع) وحذف ما لم يرتبط بأي مشروع.\n\n" +
      "✅ محمي: الملفات المرتبطة بمشاريع نشطة لن تُحذف أبداً.\n" +
      "❌ سيُحذف: كل ملف آخر (تجريبي، مؤقت، أو غير مستخدم).\n\n" +
      "هل تريد المتابعة؟" :
      "This will scan all files in the Service Account's Drive and delete those not linked to any project.\n\n" +
      "✅ Protected: Files linked to active projects will never be deleted.\n" +
      "❌ Will be deleted: Every other file (test, temporary, or unused).\n\n" +
      "Do you want to continue?"
    )) return;
    setSheetsLoading("cleanup"); setTestResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/cleanup-drive`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    setTestResult(res.message);
    setSheetsLoading(null);
  };

  const checkColumns = async () => {
    setSheetsLoading("check"); setCheckResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/check-sheet-columns`, {}).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    setCheckResult(res); setSheetsLoading(null);
  };

  const fixHeaders = async () => {
    setSheetsLoading("fix"); setFixResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/fix-sheet-headers`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    setFixResult(res.message); setSheetsLoading(null);
  };

  const doImport = async () => {
    setSheetsLoading("import"); setImportResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/import-from-sheets`, { syncDeleted }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    setImportResult(res);
    if (res.ok) qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
    setSheetsLoading(null);
  };

  const fetchChatId = async (values: any) => {
    setChatIdLoading(true); setChatIdChats(null); setChatIdMsg(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/telegram-updates`, { token: values.telegramBotToken }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    if (res.ok && res.chats) {
      setChatIdChats(res.chats);
    } else {
      setChatIdMsg(res.message || (isAr ? "❌ تعذّر جلب Chat ID" : "❌ Could not fetch Chat ID"));
    }
    setChatIdLoading(false);
  };

  const testTelegram = async (values: any) => {
    setTesting(true); setTestResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/test-telegram`, { token: values.telegramBotToken, chatId: values.telegramChatId }).catch(e => ({ message: `❌ ${e.message}` }));
    setTestResult(res.message); setTesting(false);
  };

  const addField = () => {
    setFields(prev => [...prev, {
      id: `new_${Date.now()}`, projectId: id!,
      key: `field_${prev.length + 1}`, label: isAr ? `حقل ${prev.length + 1}` : `Field ${prev.length + 1}`,
      fieldType: "text", isRequired: false, isVisible: true,
      options: null, stepNumber: 1, orderIndex: prev.length, placeholder: null,
    } as any]);
  };

  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx));
  const updateField = (idx: number, upd: Partial<ProjectField>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...upd } : f));

  const tabs = [
    { key: "form",     label: isAr ? "النموذج" : "Form" },
    { key: "fields",   label: isAr ? "الحقول" : "Fields" },
    { key: "sheets",   label: isAr ? "Google Sheets" : "Google Sheets" },
    { key: "telegram", label: isAr ? "Telegram" : "Telegram" },
  ] as const;

  const ResultBox = ({ msg }: { msg: string }) => (
    <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${msg.startsWith("✅") ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : msg.startsWith("⚠️") ? "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"}`}>
      {msg.startsWith("✅") ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : msg.startsWith("⚠️") ? <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
      <span className="whitespace-pre-wrap break-words">{msg}</span>
    </div>
  );

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
            <button key={t.key} onClick={() => { setTab(t.key); setTestResult(null); setCheckResult(null); setFixResult(null); setImportResult(null); setChatIdChats(null); setChatIdMsg(null); }}
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
              {testResult && <ResultBox msg={testResult} />}
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
                  <div key={f.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30" data-testid={`field-${idx}`}>
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0" />
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => removeField(idx)} data-testid={`button-remove-field-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
                  </div>
                ))
              )}
              {testResult && <ResultBox msg={testResult} />}
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

                  {/* Section A: Google Cloud */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">{isAr ? "أ — إعداد Google Cloud Console" : "A — Google Cloud Console Setup"}</p>
                    {[
                      { n: 1, title: isAr ? "إنشاء مشروع Google Cloud" : "Create Google Cloud Project", desc: isAr ? 'انتقل إلى console.cloud.google.com → أنشئ مشروعاً جديداً أو اختر مشروعاً موجوداً.' : 'Go to console.cloud.google.com → Create a new project or select an existing one.' },
                      { n: 2, title: isAr ? "تفعيل Google Sheets API" : "Enable Google Sheets API", desc: isAr ? 'APIs & Services → Enable APIs → ابحث عن "Google Sheets API" وفعّله.' : 'APIs & Services → Enable APIs → Search for "Google Sheets API" and enable it.' },
                      { n: 3, title: isAr ? "تفعيل Google Drive API" : "Enable Google Drive API", desc: isAr ? 'APIs & Services → Enable APIs → ابحث عن "Google Drive API" وفعّله. (مطلوب للإنشاء التلقائي في مجلد)' : 'APIs & Services → Enable APIs → Search for "Google Drive API" and enable it (required for automatic folder creation).' },
                      { n: 4, title: isAr ? "إنشاء Service Account" : "Create Service Account", desc: isAr ? 'APIs & Services → Credentials → Create Credentials → Service Account → أدخل اسماً وأنشئه.' : 'APIs & Services → Credentials → Create Credentials → Service Account → Enter a name and create.' },
                      { n: 5, title: isAr ? "تحميل مفتاح JSON" : "Download JSON Key", desc: isAr ? 'افتح الـ Service Account → Keys → Add Key → Create new key → اختر JSON → تحميل. احفظ الملف في مكان آمن.' : 'Open the Service Account → Keys → Add Key → Create new key → Select JSON → Download. Keep this file safe.' },
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

                  <div className="h-px bg-slate-100 dark:bg-slate-700" />

                  {/* Section B: Integration */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">{isAr ? "ب — ربط الـ Service Account بالمشروع" : "B — Link Service Account to Project"}</p>
                    {[
                      { n: 1, title: isAr ? "إدخال البريد الإلكتروني" : "Enter Email", desc: isAr ? 'انسخ البريد الخاص بالـ Service Account وألصقه في حقل "بريد الـ Service Account" بالأسفل.' : 'Copy the Service Account email and paste it in the "Service Account Email" field below.' },
                      { n: 2, title: isAr ? "إدخال المجلد (اختياري)" : "Enter Folder (Optional)", desc: isAr ? 'إذا أردت إنشاء الملفات في مجلد محدد، أدخل ID المجلد وأعطِ صلاحية Editor للبريد الإلكتروني لهذا المجلد في Drive.' : 'If you want files created in a specific folder, enter the Folder ID and give Editor permission to the email for this folder in Drive.' },
                      { n: 3, title: isAr ? "إنشاء الـ Sheet" : "Create Sheet", desc: isAr ? 'اضغط على "إنشاء ملف Sheet جديد" بالأسفل. سيقوم النظام بإنشاء ملف متوافق تلقائياً.' : 'Click "Create New Sheet" below. The system will create a compatible file automatically.' },
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

                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg flex items-start gap-2 border border-blue-100 dark:border-blue-800/50">
                    <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-700 dark:text-blue-300">
                      {isAr ? "تأكد من تفعيل صلاحيات Google Sheets و Google Drive للـ Service Account لضمان عمل المزامنة والإنشاء التلقائي." : "Ensure Google Sheets and Google Drive permissions are enabled for the Service Account to ensure sync and automatic creation work."}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <TableProperties className="h-5 w-5 text-green-600" />
                  <h3 className="text-sm font-bold">{isAr ? "إعدادات الربط مع Google Sheets" : "Google Sheets Integration Settings"}</h3>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">{isAr ? "بريد الـ Service Account (Client Email)" : "Service Account Email"}</Label>
                  <Input {...register("googleServiceAccountEmail")} placeholder="service-account@project.iam.gserviceaccount.com" className="font-mono text-xs" data-testid="input-googleEmail" />
                  <p className="text-[10px] text-muted-foreground">{isAr ? "يجب أن يكون هذا البريد مضافاً كـ Editor في مجلد الـ Drive." : "This email must be added as Editor in the Drive folder."}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{isAr ? "معرف مجلد Drive (اختياري)" : "Drive Folder ID (Optional)"}</Label>
                    <Input {...register("googleDriveFolderId")} placeholder="folder_id_from_url" className="font-mono text-xs" data-testid="input-folderId" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{isAr ? "اسم ملف الـ Sheet (عند الإنشاء)" : "Sheet Filename (on creation)"}</Label>
                    <Input {...register("googleSheetName")} placeholder={isAr ? "بيانات المشروع" : "Project Data"} data-testid="input-sheetName" />
                  </div>
                </div>

                {/* Service Account JSON Key */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-2">
                    {isAr ? "مفتاح الـ Service Account (JSON)" : "Service Account Key (JSON)"}
                    {project?.hasGoogleKey && (
                      <Badge variant="secondary" className="font-normal text-[10px] text-green-700 bg-green-50 border-green-200">
                        {isAr ? "✅ محفوظ" : "✅ Saved"}
                      </Badge>
                    )}
                  </Label>
                  <Textarea
                    {...register("googleServiceAccountKey")}
                    rows={4}
                    dir="ltr"
                    className="font-mono text-[11px] resize-y"
                    placeholder={project?.hasGoogleKey
                      ? (isAr ? "محفوظ — اتركه فارغاً للإبقاء على المفتاح الحالي" : "Saved — leave empty to keep current key")
                      : (isAr ? 'الصق محتوى ملف JSON هنا...\n{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}' : 'Paste the JSON file content here...\n{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}')}
                    data-testid="input-googleKey"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {isAr
                      ? "محتوى ملف JSON الذي نزّلته من Google Cloud Console عند إنشاء الـ Service Account."
                      : "The content of the JSON file you downloaded from Google Cloud Console when creating the Service Account."}
                  </p>
                </div>

                {/* Current Sheet ID */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <Label className="text-xs flex items-center gap-2">
                    {isAr ? "معرف ملف الـ Sheet الحالي" : "Current Sheet ID"}
                    {project?.googleSheetId && <Badge variant="secondary" className="font-normal text-[10px]">{isAr ? "موجود" : "Present"}</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      {...register("googleSheetId")}
                      placeholder="spreadsheet_id_from_url"
                      className="font-mono text-xs flex-1"
                      readOnly={!showManualSheetId && !!project?.googleSheetId}
                      data-testid="input-sheetId"
                    />
                    {!showManualSheetId && project?.googleSheetId && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowManualSheetId(true)} title={isAr ? "تعديل يدوياً" : "Edit manually"}>
                        <Wrench className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {project?.googleSheetId && (
                    <a href={`https://docs.google.com/spreadsheets/d/${project.googleSheetId}/edit`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center text-[11px] text-blue-600 hover:underline gap-1">
                      <ExternalLink className="h-3 w-3" /> {isAr ? "فتح ملف الـ Sheet الحالي" : "Open current Sheet file"}
                    </a>
                  )}
                  {!project?.googleSheetId && (
                    <p className="text-[10px] text-muted-foreground">
                      {isAr
                        ? "أدخل ID يدوياً أو استخدم زر «إنشاء ملف Sheet» لإنشائه تلقائياً."
                        : "Enter an ID manually or use the «Create Sheet File» button to create one automatically."}
                    </p>
                  )}
                </div>

                {project?.sheetCreationPending && (
                  <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-800/50 flex items-center gap-3 animate-pulse">
                    <Loader2 className="h-5 w-5 text-yellow-600 animate-spin shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-yellow-800 dark:text-yellow-300">{isAr ? "جاري إنشاء الـ Sheet..." : "Creating Sheet..."}</p>
                      <p className="text-[10px] text-yellow-700 dark:text-yellow-400">{isAr ? "يرجى الانتظار، سيتم تحديث الصفحة تلقائياً عند الانتهاء." : "Please wait, page will auto-refresh when done."}</p>
                    </div>
                  </div>
                )}

                {testResult && <ResultBox msg={testResult} />}
                {createdSheetUrl && (
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 text-blue-800 dark:text-blue-300 flex items-center justify-between">
                    <span className="text-xs font-bold">{isAr ? "✅ تم إنشاء الملف بنجاح!" : "✅ File created successfully!"}</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(createdSheetUrl, "_blank")}>
                      <ExternalLink className="h-3 w-3 ml-1" />{isAr ? "فتح الملف" : "Open File"}
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-sheets">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                    {isAr ? "حفظ الإعدادات" : "Save Settings"}
                  </Button>
                  <Button type="button" variant="outline" onClick={createSheet} disabled={testing || project?.sheetCreationPending} data-testid="button-create-sheet">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Plus className="h-4 w-4 ml-1" />}
                    {project?.googleSheetId ? (isAr ? "إنشاء ملف جديد" : "Create New File") : (isAr ? "إنشاء ملف Sheet" : "Create Sheet File")}
                  </Button>
                  <Button type="button" variant="outline" onClick={testSheets} disabled={testing || !project?.googleSheetId} data-testid="button-test-sheets">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                    {isAr ? "اختبار الاتصال" : "Test Connection"}
                  </Button>
                </div>
              </Card>
            </form>

            {/* Sync / Repair Panel */}
            <Card className="p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-blue-500" />
                <h3 className="text-sm font-bold">{isAr ? "أدوات الصيانة والمزامنة" : "Maintenance & Sync Tools"}</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2">
                  <p className="text-xs font-bold">{isAr ? "التحقق من الأعمدة" : "Check Columns"}</p>
                  <p className="text-[10px] text-muted-foreground">{isAr ? "فحص ما إذا كانت ترويسات الـ Sheet تطابق حقول المشروع." : "Verify if Sheet headers match project fields."}</p>
                  <Button size="sm" variant="secondary" className="w-full h-8 text-[11px]" onClick={checkColumns} disabled={!!sheetsLoading}>
                    {sheetsLoading === "check" ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : <CheckCircle2 className="h-3 w-3 ml-1" />}
                    {isAr ? "فحص الأعمدة" : "Check Columns"}
                  </Button>
                </div>

                <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2">
                  <p className="text-xs font-bold">{isAr ? "إصلاح الترويسات" : "Fix Headers"}</p>
                  <p className="text-[10px] text-muted-foreground">{isAr ? "إضافة الأعمدة الناقصة أو إعادة ترتيبها في ملف الـ Sheet." : "Add missing columns or reorder them in the Sheet."}</p>
                  <Button size="sm" variant="secondary" className="w-full h-8 text-[11px]" onClick={fixHeaders} disabled={!!sheetsLoading}>
                    {sheetsLoading === "fix" ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : <RefreshCw className="h-3 w-3 ml-1" />}
                    {isAr ? "إصلاح الترويسات" : "Fix Headers"}
                  </Button>
                </div>

                <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2">
                  <p className="text-xs font-bold">{isAr ? "استيراد البيانات" : "Import Data"}</p>
                  <div className="flex items-center gap-2 pb-1">
                    <input type="checkbox" checked={syncDeleted} onChange={e => setSyncDeleted(e.target.checked)} id="sd-set" className="rounded" />
                    <label htmlFor="sd-set" className="text-[10px]">{isAr ? "مزامنة الحذف" : "Sync Deletion"}</label>
                  </div>
                  <Button size="sm" variant="secondary" className="w-full h-8 text-[11px]" onClick={doImport} disabled={!!sheetsLoading}>
                    {sheetsLoading === "import" ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : <Upload className="h-3 w-3 ml-1" />}
                    {isAr ? "مزامنة الآن" : "Sync Now"}
                  </Button>
                </div>

                <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2">
                  <p className="text-xs font-bold text-red-500">{isAr ? "تنظيف Drive (خطير)" : "Drive Cleanup (Dangerous)"}</p>
                  <p className="text-[10px] text-muted-foreground">{isAr ? "حذف كافة الملفات غير المرتبطة بأي مشروع في الـ Service Account." : "Delete all files not linked to any project in the Service Account."}</p>
                  <Button size="sm" variant="ghost" className="w-full h-8 text-[11px] text-red-400 hover:text-red-500" onClick={cleanupDrive} disabled={!!sheetsLoading}>
                    {sheetsLoading === "cleanup" ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : <Trash2 className="h-3 w-3 ml-1" />}
                    {isAr ? "تنظيف الـ Drive" : "Cleanup Drive"}
                  </Button>
                </div>
              </div>

              {/* Check Results */}
              {checkResult && (
                <div className={`p-4 rounded-lg border text-sm space-y-2 ${checkResult.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  <p className="font-bold">{checkResult.ok ? (isAr ? "✅ الأعمدة متطابقة تماماً" : "✅ Columns match perfectly") : (isAr ? "⚠️ توجد اختلافات في الأعمدة" : "⚠️ Column discrepancies found")}</p>
                  {!checkResult.ok && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {checkResult.missing && checkResult.missing.length > 0 && (
                        <div>
                          <p className="font-bold text-red-600 mb-1">{isAr ? "أعمدة ناقصة في الـ Sheet:" : "Missing in Sheet:"}</p>
                          <ul className="list-disc pr-4 space-y-0.5 opacity-80">
                            {checkResult.missing.map(c => <li key={c}>{c}</li>)}
                          </ul>
                        </div>
                      )}
                      {checkResult.extra && checkResult.extra.length > 0 && (
                        <div>
                          <p className="font-bold text-slate-600 mb-1">{isAr ? "أعمدة إضافية (سيتم تجاهلها):" : "Extra columns (ignored):"}</p>
                          <ul className="list-disc pr-4 space-y-0.5 opacity-80">
                            {checkResult.extra.map(c => <li key={c}>{c}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {checkResult.matched && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-slate-200">{isAr ? `إجمالي الأعمدة المتطابقة: ${checkResult.matched.length}` : `Total matching columns: ${checkResult.matched.length}`}</p>
                  )}
                </div>
              )}

              {fixResult && <ResultBox msg={fixResult} />}
              {importResult && <ResultBox msg={importResult.message || (importResult.ok ? (isAr ? "✅ تمت المزامنة بنجاح" : "✅ Sync completed successfully") : (isAr ? "❌ فشلت المزامنة" : "❌ Sync failed"))} />}
            </Card>
          </div>
        )}

        {/* ══ TELEGRAM TAB ══ */}
        {tab === "telegram" && (
          <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <BotMessageSquare className="h-5 w-5 text-blue-400" />
                <h3 className="text-sm font-bold">{isAr ? "إشعارات Telegram" : "Telegram Notifications"}</h3>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "توكن البوت (Bot Token)" : "Bot Token"}</Label>
                <div className="flex gap-2">
                  <Input {...register("telegramBotToken")} placeholder="1234567890:ABCdefGHI..." className="font-mono text-xs" data-testid="input-telegramToken" />
                  <Button type="button" variant="outline" size="sm" onClick={() => fetchChatId(watch())} disabled={chatIdLoading || !watch("telegramBotToken")} title={isAr ? "جلب المحادثات" : "Fetch Chats"}>
                    {chatIdLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {chatIdMsg && <ResultBox msg={chatIdMsg} />}

              {chatIdChats && chatIdChats.length > 0 && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">{isAr ? "المحادثات الأخيرة (اختر واحدة):" : "Recent Chats (Select one):"}</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {chatIdChats.map(c => (
                      <button key={c.id} type="button" onClick={() => setValue("telegramChatId", c.id)}
                        className="w-full flex items-center justify-between p-2 rounded hover:bg-white dark:hover:bg-slate-700 text-xs transition-colors border border-transparent hover:border-slate-200">
                        <span className="font-semibold">{c.title}</span>
                        <span className="text-[10px] opacity-60 font-mono">{c.id} ({c.type})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "معرف المحادثة (Chat ID)" : "Chat ID"}</Label>
                <Input {...register("telegramChatId")} placeholder="-100..." className="font-mono text-xs" data-testid="input-telegramChatId" />
                <p className="text-[10px] text-muted-foreground">{isAr ? "يمكنك الحصول عليه بإرسال رسالة للبوت ثم الضغط على زر التحديث أعلاه." : "You can get this by sending a message to the bot and clicking the refresh button above."}</p>
              </div>

              {testResult && <ResultBox msg={testResult} />}

              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-telegram">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                  {isAr ? "حفظ الإعدادات" : "Save Settings"}
                </Button>
                <Button type="button" variant="outline" onClick={() => testTelegram(watch())} disabled={testing || !watch("telegramBotToken") || !watch("telegramChatId")} data-testid="button-test-telegram">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                  {isAr ? "إرسال رسالة تجريبية" : "Send Test Message"}
                </Button>
              </div>
            </Card>
          </form>
        )}
      </div>
    </Layout>
  );
}
