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
import { useEffect, useState } from "react";
import type { Project, ProjectField } from "@shared/schema";

export function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"form" | "fields" | "sheets" | "telegram">("form");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  // Sheets-specific state
  const [checkResult, setCheckResult] = useState<{
    ok: boolean; message: string;
    matched?: string[]; missing?: string[]; extra?: string[];
  } | null>(null);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState<"check" | "fix" | "import" | null>(null);

  // Telegram-specific state
  const [chatIdLoading, setChatIdLoading] = useState(false);
  const [chatIdChats, setChatIdChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [chatIdMsg, setChatIdMsg] = useState<string | null>(null);

  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

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
      setTestResult("✅ تم الحفظ بنجاح");
      setTimeout(() => setTestResult(null), 3000);
    },
    onError: (err: any) => setTestResult(`❌ ${err.message}`),
  });

  const saveFieldsMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/fields`, { fields }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/projects", id, "fields"] }),
  });

  const testSheets = async () => {
    setTesting(true); setTestResult(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/test-sheets`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    setTestResult(res.message); setTesting(false);
  };

  const createSheet = async () => {
    if (project?.googleSheetId) {
      const ok = window.confirm(
        "سيتم إنشاء ملف Google Sheet جديد تماماً في المجلد المحدد.\n" +
        "الملف القديم لن يُحذف لكن لن يُستخدم للتسجيل بعد الآن.\n\n" +
        "هل تريد المتابعة؟"
      );
      if (!ok) return;
    }
    setTesting(true); setTestResult(null); setCreatedSheetUrl(null);
    const res: any = await apiRequest("POST", `/api/projects/${id}/create-sheet`, {}).catch(e => ({ message: `❌ ${e.message}` }));
    setTestResult(res.message);
    if (res.sheetId) {
      qc.invalidateQueries({ queryKey: ["/api/projects", id] });
      if (res.sheetUrl) setCreatedSheetUrl(res.sheetUrl);
    }
    setTesting(false);
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
      setChatIdMsg(res.message || "❌ تعذّر جلب Chat ID");
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
      key: `field_${prev.length + 1}`, label: `حقل ${prev.length + 1}`,
      fieldType: "text", isRequired: false, isVisible: true,
      options: null, stepNumber: 1, orderIndex: prev.length, placeholder: null,
    } as any]);
  };

  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx));
  const updateField = (idx: number, upd: Partial<ProjectField>) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...upd } : f));

  const tabs = [
    { key: "form",     label: "النموذج" },
    { key: "fields",   label: "الحقول" },
    { key: "sheets",   label: "Google Sheets" },
    { key: "telegram", label: "Telegram" },
  ] as const;

  const ResultBox = ({ msg }: { msg: string }) => (
    <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${msg.startsWith("✅") ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : msg.startsWith("⚠️") ? "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"}`}>
      {msg.startsWith("✅") ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : msg.startsWith("⚠️") ? <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
      <span>{msg}</span>
    </div>
  );

  return (
    <Layout projectId={id}>
      <div className="max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav(`/admin/projects/${id}/dashboard`)}>
            <ArrowRight className="h-4 w-4 ml-1" />الرئيسية
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold">إعدادات المشروع</h1>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.open(`/p/${id}/register`, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5 ml-1" />معاينة النموذج
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
                  <Label className="text-xs">اسم المشروع *</Label>
                  <Input {...register("name")} data-testid="input-name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">رمز الدعوة</Label>
                  <Input {...register("invitationCode")} data-testid="input-invitationCode" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">وصف المشروع</Label>
                <Textarea {...register("description")} rows={2} data-testid="input-description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">عنوان النموذج</Label>
                  <Input {...register("formTitle")} data-testid="input-formTitle" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">العنوان الفرعي</Label>
                  <Input {...register("formSubtitle")} data-testid="input-formSubtitle" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">أسماء الخطوات (كل خطوة في سطر منفصل)</Label>
                <Textarea {...register("steps")} rows={3} placeholder={"الخطوة الأولى\nالخطوة الثانية\nالخطوة الثالثة"} data-testid="input-steps" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">مدة صلاحية رابط التعديل (ساعة)</Label>
                <Input {...register("editTokenHours")} type="number" className="w-32" data-testid="input-editTokenHours" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-sm font-semibold">تفعيل النموذج</p>
                  <p className="text-xs text-muted-foreground">السماح للمستخدمين بالتسجيل</p>
                </div>
                <Switch checked={!!formEnabled} onCheckedChange={v => setValue("formEnabled", v)} data-testid="switch-formEnabled" />
              </div>
              {!formEnabled && (
                <div className="space-y-1.5">
                  <Label className="text-xs">رسالة التوقف</Label>
                  <Input {...register("formDisabledMessage")} placeholder="النموذج متوقف مؤقتاً" data-testid="input-formDisabledMessage" />
                </div>
              )}
              {testResult && <ResultBox msg={testResult} />}
              <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-form">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                حفظ الإعدادات
              </Button>
            </Card>
          </form>
        )}

        {/* ══ FIELDS TAB ══ */}
        {tab === "fields" && (
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              {fields.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">لا يوجد حقول. أضف حقلاً للبدء.</p>
              ) : (
                fields.map((f, idx) => (
                  <div key={f.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30" data-testid={`field-${idx}`}>
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0" />
                      <div className="grid grid-cols-2 gap-2 flex-1">
                        <Input value={f.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder="الاسم المعروض" className="text-sm h-8" data-testid={`field-label-${idx}`} />
                        <Input value={f.key} onChange={e => updateField(idx, { key: e.target.value })} placeholder="المفتاح (key)" className="text-sm h-8 font-mono" data-testid={`field-key-${idx}`} />
                      </div>
                      <select value={f.fieldType || "text"} onChange={e => updateField(idx, { fieldType: e.target.value })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8" data-testid={`field-type-${idx}`}>
                        <option value="text">نص</option>
                        <option value="number">رقم</option>
                        <option value="date">تاريخ</option>
                        <option value="select">قائمة</option>
                        <option value="radio">راديو</option>
                        <option value="textarea">نص طويل</option>
                        <option value="phone">هاتف</option>
                        <option value="email">بريد</option>
                      </select>
                      <select value={f.stepNumber || 1} onChange={e => updateField(idx, { stepNumber: Number(e.target.value) })}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs h-8 w-20" data-testid={`field-step-${idx}`}>
                        {[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>خطوة {s}</option>)}
                      </select>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" checked={!!f.isRequired} onChange={e => updateField(idx, { isRequired: e.target.checked })} id={`req-${idx}`} className="rounded" data-testid={`field-required-${idx}`} />
                        <label htmlFor={`req-${idx}`} className="text-xs">إلزامي</label>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" checked={f.isVisible !== false} onChange={e => updateField(idx, { isVisible: e.target.checked })} id={`vis-${idx}`} className="rounded" />
                        <label htmlFor={`vis-${idx}`} className="text-xs">مرئي</label>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => removeField(idx)} data-testid={`button-remove-field-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {(f.fieldType === "select" || f.fieldType === "radio") && (
                      <div className="pr-6 space-y-1">
                        <p className="text-[11px] text-muted-foreground">الخيارات — كل خيار في سطر منفصل</p>
                        <Textarea
                          key={`${f.id}-opts`}
                          defaultValue={(f.options as string[] | null || []).join("\n")}
                          onBlur={e => updateField(idx, { options: e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean) })}
                          placeholder={"خيار 1\nخيار 2\nخيار 3"}
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
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
                  <Plus className="h-4 w-4 ml-1" />إضافة حقل
                </Button>
                <Button size="sm" onClick={() => saveFieldsMut.mutate()} disabled={saveFieldsMut.isPending} data-testid="button-save-fields">
                  {saveFieldsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                  حفظ الحقول
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
                  📖 دليل الإعداد الكامل خطوة بخطوة
                </span>
                {showGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showGuide && (
                <div className="px-4 pb-4 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">

                  {/* Section A: Google Cloud */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">أ — إعداد Google Cloud Console</p>
                    {[
                      { n: 1, title: "إنشاء مشروع Google Cloud", desc: 'انتقل إلى console.cloud.google.com → أنشئ مشروعاً جديداً أو اختر مشروعاً موجوداً.' },
                      { n: 2, title: "تفعيل Google Sheets API", desc: 'APIs & Services → Enable APIs → ابحث عن "Google Sheets API" وفعّله.' },
                      { n: 3, title: "تفعيل Google Drive API", desc: 'APIs & Services → Enable APIs → ابحث عن "Google Drive API" وفعّله. (مطلوب للإنشاء التلقائي في مجلد)' },
                      { n: 4, title: "إنشاء Service Account", desc: 'APIs & Services → Credentials → Create Credentials → Service Account → أدخل اسماً وأنشئه.' },
                      { n: 5, title: "تحميل مفتاح JSON", desc: 'افتح الـ Service Account → Keys → Add Key → Create new key → اختر JSON → تحميل. احفظ الملف في مكان آمن.' },
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

                  <div className="border-t border-dashed border-slate-200 dark:border-slate-700" />

                  {/* Section B: Drive folder */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">ب — إعداد Google Drive (للإنشاء التلقائي في مجلد)</p>
                    {[
                      { n: 6, title: "أنشئ مجلداً في Google Drive", desc: 'افتح drive.google.com → مجلد جديد. اختر مكانه وسمّه.' },
                      { n: 7, title: "شارك المجلد مع Service Account", desc: 'انقر بزر الماوس الأيمن على المجلد → مشاركة → أضف بريد الـ Service Account كـ "محرر". هذا يسمح له بوضع الملفات فيه.' },
                      { n: 8, title: "انسخ Folder ID", desc: 'افتح المجلد في Drive → الرابط في المتصفح يحتوي على ID: drive.google.com/drive/folders/FOLDER_ID_HERE — انسخه والصقه في حقل "Folder ID" أدناه.' },
                    ].map(step => (
                      <div key={step.n} className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">{step.n}</span>
                        <div>
                          <p className="text-sm font-semibold">{step.title}</p>
                          <p className="text-xs text-muted-foreground">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-dashed border-slate-200 dark:border-slate-700" />

                  {/* Section C: App settings */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">ج — الإعداد في التطبيق</p>
                    {[
                      { n: 9, title: "أدخل بيانات Service Account", desc: 'أدخل بريد الـ Service Account وانسخ محتوى ملف JSON كاملاً في حقل المفتاح.' },
                      { n: 10, title: "أدخل Folder ID (اختياري)", desc: 'إذا أردت إنشاء الـ Sheet داخل مجلد محدد في Drive، أدخل Folder ID هنا. إذا تركته فارغاً سيُنشأ في Drive الخاص بالـ Service Account.' },
                      { n: 11, title: "احفظ ثم أنشئ الـ Sheet", desc: 'اضغط "حفظ" أولاً، ثم اضغط "إنشاء Sheet تلقائياً". سيُنشئ الملف ويضع الترويسات ويوفر لك رابطاً مباشراً.' },
                    ].map(step => (
                      <div key={step.n} className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center">{step.n}</span>
                        <div>
                          <p className="text-sm font-semibold">{step.title}</p>
                          <p className="text-xs text-muted-foreground">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                    ⚠️ <strong>ملاحظة:</strong> إذا لم تحدد Folder ID، سيُنشأ الملف في My Drive الخاص بحساب الـ Service Account. يمكنك إضافة Folder ID لاحقاً ثم الضغط على "إنشاء Sheet تلقائياً" مجدداً لنقله.
                  </div>
                </div>
              )}
            </Card>

            {/* Connection status */}
            <Card className="p-4 flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${project?.hasGoogleKey ? "bg-green-500" : "bg-slate-300"}`} />
              <div className="flex-1">
                <p className="text-sm font-medium">{project?.hasGoogleKey ? "مفتاح Google محفوظ ✓" : "لم يتم رفع مفتاح Google"}</p>
                <p className="text-xs text-muted-foreground">{project?.googleSheetId ? `Sheet: ${project.googleSheetId.slice(0, 24)}...` : "لم يتم إدخال Sheet ID"}</p>
              </div>
              {project?.hasGoogleKey && project?.googleSheetId && (
                <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">جاهز</Badge>
              )}
            </Card>

            {/* Connection form */}
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
              <Card className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sheet ID</Label>
                  <Input {...register("googleSheetId")} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" dir="ltr" data-testid="input-googleSheetId" />
                  <p className="text-[11px] text-muted-foreground">من رابط الـ Sheet: https://docs.google.com/spreadsheets/d/<strong>SHEET_ID</strong>/edit</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">اسم الورقة</Label>
                  <Input {...register("googleSheetName")} placeholder="بيانات" data-testid="input-googleSheetName" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Service Account Email</Label>
                  <Input {...register("googleServiceAccountEmail")} placeholder="project@appspot.iam.gserviceaccount.com" dir="ltr" data-testid="input-googleServiceAccountEmail" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    Service Account JSON Key
                    {project?.hasGoogleKey && <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30">محفوظ</Badge>}
                  </Label>
                  <Textarea {...register("googleServiceAccountKey")} placeholder='{"type":"service_account","project_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n..."}' rows={4} dir="ltr" className="font-mono text-xs" data-testid="input-googleServiceAccountKey" />
                  {project?.hasGoogleKey && <p className="text-[11px] text-muted-foreground">اتركه فارغاً للإبقاء على المفتاح الحالي</p>}
                </div>

                {/* Drive Folder ID */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    Google Drive Folder ID
                    <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600">اختياري</Badge>
                  </Label>
                  <Input
                    {...register("googleDriveFolderId")}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms أو الرابط كاملاً"
                    dir="ltr"
                    data-testid="input-googleDriveFolderId"
                    onPaste={e => {
                      const pasted = e.clipboardData.getData("text");
                      const m = pasted.match(/folders\/([a-zA-Z0-9_-]+)/);
                      if (m) {
                        e.preventDefault();
                        setValue("googleDriveFolderId", m[1]);
                      }
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    يمكنك لصق رابط المجلد كاملاً أو الـ ID فقط — سيُستخرج تلقائياً.
                    يجب مشاركة المجلد مع بريد الـ Service Account كـ "محرر"
                  </p>
                </div>

                {testResult && <ResultBox msg={testResult} />}

                {/* Sheet link after creation */}
                {createdSheetUrl && (
                  <a
                    href={createdSheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
                    data-testid="link-open-sheet"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    فتح Google Sheet المنشأ
                  </a>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={saveMut.isPending} data-testid="button-save-sheets">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                    حفظ الإعدادات
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={testSheets} disabled={testing} data-testid="button-test-sheets">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                    اختبار الاتصال
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={createSheet}
                    disabled={testing || !project?.hasGoogleKey}
                    className="bg-green-600 hover:bg-green-700 text-white gap-1"
                    data-testid="button-create-sheet"
                  >
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Plus className="h-4 w-4 ml-1" />}
                    إنشاء Sheet تلقائياً
                  </Button>
                </div>
                {!project?.hasGoogleKey && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠️ احفظ مفتاح الـ Service Account أولاً لتفعيل زر الإنشاء التلقائي</p>
                )}
              </Card>
            </form>

            {/* Column check tool */}
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TableProperties className="h-4 w-4 text-blue-500" />
                فحص تطابق الأعمدة
              </h3>
              <p className="text-xs text-muted-foreground">يقارن ترويسات الـ Sheet الحالية مع حقول المشروع ويُظهر الأعمدة الناقصة والإضافية.</p>
              <Button size="sm" variant="outline" onClick={checkColumns} disabled={sheetsLoading === "check"} data-testid="button-check-columns">
                {sheetsLoading === "check" ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <TableProperties className="h-4 w-4 ml-1" />}
                فحص تطابق الأعمدة
              </Button>
              {checkResult && (
                <div className="space-y-2">
                  <ResultBox msg={checkResult.message} />
                  {checkResult.missing && checkResult.missing.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">أعمدة ناقصة في الـ Sheet:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {checkResult.missing.map(h => <Badge key={h} variant="outline" className="text-[10px] border-red-300 text-red-600">{h}</Badge>)}
                      </div>
                    </div>
                  )}
                  {checkResult.extra && checkResult.extra.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">أعمدة إضافية في الـ Sheet:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {checkResult.extra.map(h => <Badge key={h} variant="outline" className="text-[10px] border-yellow-300 text-yellow-600">{h}</Badge>)}
                      </div>
                    </div>
                  )}
                  {checkResult.matched && checkResult.matched.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-green-600 dark:text-green-400">أعمدة متطابقة ({checkResult.matched.length}):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {checkResult.matched.map(h => <Badge key={h} variant="outline" className="text-[10px] border-green-300 text-green-600">{h}</Badge>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Fix headers tool */}
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wrench className="h-4 w-4 text-orange-500" />
                تصحيح ترويسات الـ Sheet تلقائياً
              </h3>
              <p className="text-xs text-muted-foreground">يُحدّث الصف الأول في الـ Sheet بحيث يطابق تسميات حقول المشروع الحالية.</p>
              <Button size="sm" variant="outline" onClick={fixHeaders} disabled={sheetsLoading === "fix"} data-testid="button-fix-headers">
                {sheetsLoading === "fix" ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Wrench className="h-4 w-4 ml-1" />}
                تصحيح الترويسات تلقائياً
              </Button>
              {fixResult && <ResultBox msg={fixResult} />}
            </Card>

            {/* Import from sheets */}
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4 text-green-600" />
                استيراد البيانات من الـ Sheet
              </h3>
              <p className="text-xs text-muted-foreground">
                يقرأ بيانات الـ Sheet ويستوردها إلى قاعدة البيانات. يطابق السجلات بناءً على الرقم التسلسلي.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={syncDeleted} onChange={e => setSyncDeleted(e.target.checked)} className="accent-primary" data-testid="check-sync-deleted" />
                مزامنة المحذوفات (حذف السجلات غير الموجودة في الـ Sheet)
              </label>
              <Button size="sm" variant="outline" onClick={doImport} disabled={sheetsLoading === "import"} data-testid="button-import-from-sheets">
                {sheetsLoading === "import" ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Upload className="h-4 w-4 ml-1" />}
                استيراد من Sheets
              </Button>
              {importResult && (
                <div className="space-y-2">
                  <ResultBox msg={importResult.message} />
                  {importResult.ok && (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "مُضاف", val: importResult.added, color: "text-green-600" },
                        { label: "مُحدَّث", val: importResult.updated, color: "text-blue-600" },
                        { label: "مُتجاوَز", val: importResult.skipped, color: "text-slate-500" },
                      ].map(item => (
                        <div key={item.label} className="text-center p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <p className={`text-xl font-bold ${item.color}`}>{item.val ?? 0}</p>
                          <p className="text-[11px] text-muted-foreground">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══ TELEGRAM TAB ══ */}
        {tab === "telegram" && (
          <div className="space-y-4">

            {/* Status indicators */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3 flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full shrink-0 ${project?.hasTelegramToken ? "bg-green-500" : "bg-slate-300"}`} />
                <div>
                  <p className="text-xs font-semibold">{project?.hasTelegramToken ? "Bot Token محفوظ ✓" : "Bot Token غير محفوظ"}</p>
                  <p className="text-[11px] text-muted-foreground">رمز البوت</p>
                </div>
              </Card>
              <Card className="p-3 flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full shrink-0 ${project?.telegramChatId ? "bg-green-500" : "bg-slate-300"}`} />
                <div>
                  <p className="text-xs font-semibold">{project?.telegramChatId ? `Chat ID: ${project.telegramChatId}` : "Chat ID غير محفوظ"}</p>
                  <p className="text-[11px] text-muted-foreground">مُعرّف المحادثة</p>
                </div>
              </Card>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(d => saveMut.mutate(d))}>
              <Card className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    Bot Token
                    {project?.hasTelegramToken && <Badge variant="secondary" className="text-[10px]">محفوظ</Badge>}
                  </Label>
                  <Input {...register("telegramBotToken")} placeholder="اتركه فارغاً للإبقاء على القديم" dir="ltr" data-testid="input-telegramBotToken" />
                  <p className="text-[11px] text-muted-foreground">احصل عليه من <strong>@BotFather</strong> على Telegram</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Chat ID</Label>
                  <Input {...register("telegramChatId")} placeholder="-1001234567890" dir="ltr" data-testid="input-telegramChatId" />
                  <p className="text-[11px] text-muted-foreground">مُعرّف المجموعة أو القناة أو المحادثة الخاصة</p>
                </div>

                {testResult && <ResultBox msg={testResult} />}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={saveMut.isPending} data-testid="button-save-telegram">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                    حفظ
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={testing} onClick={handleSubmit(d => testTelegram(d))} data-testid="button-test-telegram">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : null}
                    إرسال رسالة اختبار
                  </Button>
                </div>
              </Card>
            </form>

            {/* Fetch Chat ID */}
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <BotMessageSquare className="h-4 w-4 text-blue-500" />
                جلب Chat ID تلقائياً
              </h3>
              <p className="text-xs text-muted-foreground">
                أرسل <strong>/start</strong> للبوت أو أضفه للمجموعة وأرسل أي رسالة، ثم اضغط الزر للجلب التلقائي.
              </p>
              <Button size="sm" variant="outline" onClick={handleSubmit(fetchChatId)} disabled={chatIdLoading} data-testid="button-fetch-chat-id">
                {chatIdLoading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <BotMessageSquare className="h-4 w-4 ml-1" />}
                جلب Chat ID تلقائياً
              </Button>
              {chatIdMsg && <ResultBox msg={chatIdMsg} />}
              {chatIdChats && chatIdChats.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">اختر المحادثة المطلوبة:</p>
                  {chatIdChats.map(chat => (
                    <div key={chat.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div>
                        <p className="text-sm font-medium">{chat.title}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{chat.id} — {chat.type}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => {
                          setValue("telegramChatId", chat.id);
                          setChatIdChats(null);
                        }}
                        data-testid={`button-use-chat-${chat.id}`}>
                        استخدام هذا
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Notification example */}
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">مثال على رسالة الإشعار</h3>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 font-mono text-xs space-y-1 border border-slate-200 dark:border-slate-700 leading-relaxed" dir="ltr">
                <p className="font-bold">🏥 تسجيل جديد — {project?.name || "نظام الكوادر"}</p>
                <p>👤 الاسم: أحمد محمد</p>
                <p>🆔 الرقم التسلسلي: 42</p>
                <p>📍 المحافظة: دمشق</p>
                <p>💼 المسمى الوظيفي: طبيب</p>
                <p>🕒 الوقت: {new Date().toLocaleString("ar-SY")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground">يُرسل هذا الإشعار لكل تسجيل جديد عبر نموذج المشروع.</p>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
