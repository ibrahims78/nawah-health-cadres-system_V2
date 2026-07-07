import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileUp, Loader2, CheckCircle2, AlertTriangle,
  FolderKanban, Eye, EyeOff, ArrowRight, ShieldCheck,
  Sheet, BotMessageSquare, HardDrive, List,
} from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { useToast } from "@/hooks/use-toast";

interface PreviewResult {
  projectName: string;
  mode: "template" | "backup";
  fieldCount: number;
  steps: string[];
  hasCredentials: boolean;
  integrations: { googleSheets: boolean; telegram: boolean; drive: boolean };
  warnings: string[];
}

export function ProjectImport() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [, nav] = useLocation();
  const { toast } = useToast();

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const isBackup = fileData?._meta?.mode === "backup";
  const needsPassword = isBackup && !preview;

  const readFile = (f: File) => {
    setFile(f);
    setPreview(null);
    setPassword("");
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (parsed?._meta?.platform !== "masarat") {
          toast({ title: ar ? "ملف غير صالح" : "Invalid file", description: ar ? "هذا الملف ليس من منصة مسارات" : "This file is not from Masarat", variant: "destructive" });
          setFile(null);
          setFileData(null);
          return;
        }
        setFileData(parsed);
      } catch {
        toast({ title: ar ? "خطأ في قراءة الملف" : "File parse error", variant: "destructive" });
        setFile(null);
        setFileData(null);
      }
    };
    reader.readAsText(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  };

  const doPreview = async () => {
    if (!file) return;
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/projects/import/preview", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (ar ? "فشل التحقق" : "Validation failed"));
      setPreview(data.preview);
    } catch (err: any) {
      toast({ title: ar ? "خطأ" : "Error", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const doImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (password) fd.append("password", password);
      const res = await fetch("/api/projects/import", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (ar ? "فشل الاستيراد" : "Import failed"));
      setDone(data.project);
      toast({ title: ar ? "✅ تم الاستيراد بنجاح" : "✅ Import successful" });
    } catch (err: any) {
      toast({ title: ar ? "خطأ في الاستيراد" : "Import error", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  // ─── Success state ───────────────────────────────────────────
  if (done) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto mt-16 text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              {ar ? "تم الاستيراد بنجاح!" : "Import successful!"}
            </h2>
            <p className="text-muted-foreground">
              {ar ? `تم إنشاء المشروع "${done.name}" بنجاح.` : `Project "${done.name}" was created successfully.`}
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => nav(`/admin/projects/${done.id}/dashboard`)}>
              {ar ? "فتح المشروع" : "Open Project"}
              <ArrowRight className="h-4 w-4 mr-2" />
            </Button>
            <Button variant="outline" onClick={() => nav("/admin/projects")}>
              {ar ? "كل المشاريع" : "All Projects"}
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {ar ? "📥 استيراد مشروع" : "📥 Import Project"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {ar
              ? "ارفع ملف .masarat لإنشاء مشروع جديد مستقل بكامل إعداداته وحقوله"
              : "Upload a .masarat file to create a new independent project with all its settings and fields"}
          </p>
        </div>

        {/* ① File drop zone */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="h-4 w-4 text-primary" />
              {ar ? "ملف القالب" : "Template File"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragging
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-green-400 bg-green-50 dark:bg-green-900/20"
                    : "border-slate-300 dark:border-slate-600 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".masarat,.json"
                hidden
                onChange={e => { if (e.target.files?.[0]) readFile(e.target.files[0]); }}
              />
              {file ? (
                <div className="space-y-2">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                  <p className="font-semibold text-green-700 dark:text-green-400">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB ·{" "}
                    {fileData?._meta?.mode === "backup"
                      ? (ar ? "🔒 نسخة كاملة مشفّرة" : "🔒 Encrypted backup")
                      : (ar ? "📋 قالب قابل للمشاركة" : "📋 Shareable template")}
                  </p>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={e => { e.stopPropagation(); setFile(null); setFileData(null); setPreview(null); }}
                  >
                    {ar ? "استبدال الملف" : "Replace file"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="h-8 w-8 text-slate-400 mx-auto" />
                  <div>
                    <p className="font-medium text-slate-600 dark:text-slate-300">
                      {ar ? "اسحب وأفلت ملف .masarat هنا" : "Drag & drop a .masarat file here"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {ar ? "أو انقر للاختيار" : "or click to browse"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ② Password (backup mode only) */}
        {fileData && isBackup && (
          <Card className="border-amber-200 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-600" />
                {ar ? "كلمة مرور فك التشفير" : "Decryption Password"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                {ar
                  ? "هذا الملف نسخة احتياطية مشفّرة — أدخل كلمة المرور التي استُخدمت عند التصدير لاسترداد بيانات الاعتماد."
                  : "This file is an encrypted backup — enter the password used during export to restore credentials."}
              </p>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setPreview(null); }}
                  placeholder={ar ? "كلمة مرور التصدير..." : "Export password..."}
                  dir="ltr"
                  className="pl-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ③ Preview button + results */}
        {fileData && (
          <>
            {!preview ? (
              <Button
                onClick={doPreview}
                disabled={previewing || (isBackup && !password)}
                variant="outline"
                className="w-full"
              >
                {previewing
                  ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />{ar ? "جاري التحقق..." : "Validating..."}</>
                  : <><Eye className="h-4 w-4 ml-2" />{ar ? "معاينة المشروع" : "Preview Project"}</>}
              </Button>
            ) : (
              <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 text-primary" />
                    {ar ? "معاينة المشروع" : "Project Preview"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Name + mode */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-lg text-slate-800 dark:text-slate-100">{preview.projectName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ar ? `${preview.fieldCount} حقل · ${preview.steps.length} خطوات` : `${preview.fieldCount} fields · ${preview.steps.length} steps`}
                      </p>
                    </div>
                    <Badge variant={preview.mode === "backup" ? "default" : "secondary"}>
                      {preview.mode === "backup" ? (ar ? "🔒 نسخة كاملة" : "🔒 Full backup") : (ar ? "📋 قالب" : "📋 Template")}
                    </Badge>
                  </div>

                  {/* Steps */}
                  {preview.steps.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <List className="h-3.5 w-3.5" />
                        {ar ? "الخطوات" : "Steps"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.steps.map((s, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            {i + 1}. {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Integrations */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {ar ? "التكاملات" : "Integrations"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${preview.integrations.googleSheets ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-400" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"}`}>
                        <Sheet className="h-3.5 w-3.5" />
                        Google Sheets
                      </span>
                      <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${preview.integrations.telegram ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-400" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"}`}>
                        <BotMessageSquare className="h-3.5 w-3.5" />
                        Telegram
                      </span>
                      <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${preview.integrations.drive ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"}`}>
                        <HardDrive className="h-3.5 w-3.5" />
                        Google Drive
                      </span>
                    </div>
                  </div>

                  {/* Warnings */}
                  {preview.warnings.length > 0 && (
                    <div className="space-y-1">
                      {preview.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ④ Import button */}
        {preview && (
          <Button
            className="w-full"
            size="lg"
            onClick={doImport}
            disabled={importing}
          >
            {importing
              ? <><Loader2 className="h-5 w-5 animate-spin ml-2" />{ar ? "جاري الإنشاء..." : "Creating..."}</>
              : <><FolderKanban className="h-5 w-5 ml-2" />{ar ? "إنشاء المشروع من القالب" : "Create Project from Template"}</>}
          </Button>
        )}

        {/* Info note */}
        <p className="text-xs text-center text-muted-foreground pb-4">
          {ar
            ? "⚡ الاستيراد ينشئ مشروعاً جديداً دائماً — لن يؤثر على أي مشروع موجود"
            : "⚡ Import always creates a new project — it will never affect existing projects"}
        </p>
      </div>
    </Layout>
  );
}
