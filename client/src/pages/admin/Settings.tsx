import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, TestTube, Send, Trash2, Copy, Check, Download } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/utils";

interface Settings {
  appName: string; defaultLanguage: string; timezone: string;
  editTokenHours: number; invitationExpiryHours: number; formEnabled: boolean; formDisabledMessage: string;
  invitationCode: string; codeUpdatedAt?: string;
  googleSheetId: string; googleSheetName: string;
  googleServiceAccountEmail: string;
  telegramChatId: string;
  smtpHost: string; smtpPort: number; smtpUser: string; smtpFromName: string;
  hasGoogleKey: boolean; hasTelegramToken: boolean; hasSmtpPass: boolean;
}

interface SUser { id: string; fullName: string; email: string; role: string; lastLoginAt?: string; }

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TestBtn({ label, onTest }: { label: string; onTest: () => Promise<{ ok: boolean; message: string }> }) {
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const test = async () => {
    setLoading(true);
    try { setRes(await onTest()); } catch (e: any) { setRes({ ok: false, message: e.message }); }
    finally { setLoading(false); }
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={test} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <TestTube className="h-4 w-4 ml-1" />}
        {label}
      </Button>
      {res && <span className={`text-xs ${res.ok ? "text-green-600" : "text-red-600"}`}>{res.message}</span>}
    </div>
  );
}

export function Settings() {
  const { lang } = useLang();
  const { user } = useAuth();
  const ar = lang === "ar";
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState("viewer");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [editUser, setEditUser] = useState<SUser | null>(null);
  const [smtpPassLive, setSmtpPassLive] = useState("");
  const [tgTokenLive, setTgTokenLive] = useState("");
  const [tgFetching, setTgFetching] = useState(false);
  const [tgChats, setTgChats] = useState<Array<{ id: string; title: string; type: string }> | null>(null);
  const [tgFetchError, setTgFetchError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncDeletes, setSyncDeletes] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; skipped: number; deleted: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    sheetHeaders: string[];
    matched: string[];
    missingFromSheet: string[];
    extraInSheet: string[];
    message?: string;
  } | null>(null);
  const [fixingHeaders, setFixingHeaders] = useState(false);
  const [fixResult, setFixResult] = useState<{
    ok: boolean;
    updated: boolean;
    oldHeaders: string[];
    newHeaders: string[];
    message?: string;
  } | null>(null);

  const { data: rawSettings, isLoading } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: () => apiRequest("GET", "/api/settings"),
  });

  const { data: users, refetch: refetchUsers } = useQuery<SUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiRequest("GET", "/api/admin/users"),
  });

  useEffect(() => { if (rawSettings) setSettings(rawSettings); }, [rawSettings]);

  const set = (k: string, v: any) => setSettings(p => ({ ...p, [k]: v }));

  const save = async (extra?: object) => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/settings", { ...settings, ...extra });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const sendInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const res = await apiRequest<{ ok: boolean; inviteUrl: string; emailSent: boolean }>("POST", "/api/settings/send-invitation", { email: inviteEmail, role: inviteRole });
      setInviteResult(res.emailSent ? (ar ? "✅ تم إرسال البريد" : "✅ Email sent") : (ar ? `🔗 رابط الدعوة: ${res.inviteUrl}` : `🔗 Invite link: ${res.inviteUrl}`));
      setInviteEmail("");
      refetchUsers();
    } catch (err: any) { setInviteResult(`❌ ${err.message}`); }
    finally { setInviting(false); }
  };

  const deleteUser = async (id: string) => {
    if (!confirm(ar ? "حذف هذا المستخدم؟" : "Delete this user?")) return;
    try { await apiRequest("DELETE", `/api/admin/users/${id}`); refetchUsers(); }
    catch (err: any) { alert(err.message); }
  };

  const createUserDirectly = async () => {
    if (!createName || !createEmail || !createPassword) return;
    setCreating(true);
    setCreateResult(null);
    try {
      await apiRequest("POST", "/api/settings/create-user", {
        fullName: createName, email: createEmail, password: createPassword, role: createRole,
      });
      setCreateResult({ ok: true, msg: ar ? `✅ تم إنشاء الحساب بنجاح لـ ${createName}` : `✅ Account created successfully for ${createName}` });
      setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreateRole("viewer");
      refetchUsers();
    } catch (err: any) {
      setCreateResult({ ok: false, msg: `❌ ${err.message}` });
    } finally {
      setCreating(false);
    }
  };

  const fixSheetHeaders = async () => {
    if (!confirm(ar ? "سيتم الكتابة فوق صف الترويسات (الصف الأول) في الـ Sheet بالأسماء الرسمية. البيانات لن تُمسّ. هل تريد المتابعة؟" : "Column headers (first row) in the sheet will be overwritten with official names. Data will not be touched. Continue?")) return;
    setFixingHeaders(true);
    setFixResult(null);
    try {
      const res = await apiRequest<typeof fixResult>("POST", "/api/settings/fix-sheet-headers");
      setFixResult(res);
      setVerifyResult(null);
    } catch (err: any) {
      setFixResult({ ok: false, updated: false, oldHeaders: [], newHeaders: [], message: err.message });
    } finally {
      setFixingHeaders(false);
    }
  };

  const verifyColumns = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await apiRequest<typeof verifyResult>("POST", "/api/settings/verify-columns");
      setVerifyResult(res);
    } catch (err: any) {
      setVerifyResult({ ok: false, sheetHeaders: [], matched: [], missingFromSheet: [], extraInSheet: [], message: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const importFromSheets = async () => {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await apiRequest<{ inserted: number; updated: number; skipped: number; deleted: number; total: number }>(
        "POST", "/api/admin/import-from-sheets", { syncDeletes }
      );
      setImportResult(res);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees"] });
    } catch (err: any) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const copyFormLink = () => {
    const link = `${window.location.origin}/register`;
    navigator.clipboard.writeText(link);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (isLoading) return <Layout><div className="flex items-center justify-center h-64"><Loader2 className="h-10 w-10 animate-spin text-[#1d4ed8]" /></div></Layout>;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">⚙️ {ar ? "الإعدادات" : "Settings"}</h1>

        <Tabs defaultValue="users">
          <TabsList className="flex-wrap h-auto gap-1 mb-4">
            <TabsTrigger value="users">{ar ? "المستخدمون" : "Users"}</TabsTrigger>
            <TabsTrigger value="form">{ar ? "إعدادات النموذج" : "Form"}</TabsTrigger>
            <TabsTrigger value="google">{ar ? "Google" : "Google"}</TabsTrigger>
            <TabsTrigger value="telegram">{ar ? "Telegram" : "Telegram"}</TabsTrigger>
            <TabsTrigger value="email">{ar ? "البريد" : "Email"}</TabsTrigger>
            <TabsTrigger value="general">{ar ? "عام" : "General"}</TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <div className="section-card space-y-6">
              <h3 className="font-semibold">{ar ? "إدارة المستخدمين" : "User Management"}</h3>

              {/* Users Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground">{ar ? "الاسم" : "Name"}</th>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground hidden md:table-cell">{ar ? "البريد" : "Email"}</th>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground">{ar ? "الدور" : "Role"}</th>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground hidden lg:table-cell">{ar ? "آخر دخول" : "Last Login"}</th>
                      <th className="px-4 py-2 text-center text-xs text-muted-foreground">{ar ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users?.map(u => (
                      <tr key={u.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-4 py-2 font-medium">{u.fullName}</td>
                        <td className="px-4 py-2 text-muted-foreground hidden md:table-cell text-xs">{u.email}</td>
                        <td className="px-4 py-2"><Badge variant={u.role === "admin" ? "default" : u.role === "editor" ? "outline" : "secondary"}>{u.role === "admin" ? (ar ? "مدير" : "Admin") : u.role === "editor" ? (ar ? "محرر" : "Editor") : (ar ? "مشاهد" : "Viewer")}</Badge></td>
                        <td className="px-4 py-2 text-muted-foreground text-xs hidden lg:table-cell">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-center gap-1">
                            {u.id !== user?.id && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => deleteUser(u.id)} title={ar ? "حذف" : "Delete"}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Create user directly */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl space-y-3">
                <h4 className="font-medium text-sm text-green-800 dark:text-green-300">➕ {ar ? "إضافة مستخدم مباشر" : "Add User Directly"}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    placeholder={ar ? "الاسم الكامل" : "Full Name"}
                    data-testid="input-create-name"
                  />
                  <Input
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                    placeholder={ar ? "البريد الإلكتروني" : "Email"}
                    type="email"
                    data-testid="input-create-email"
                  />
                  <div className="relative">
                    <Input
                      value={createPassword}
                      onChange={e => setCreatePassword(e.target.value)}
                      placeholder={ar ? "كلمة المرور" : "Password"}
                      type={showCreatePass ? "text" : "password"}
                      data-testid="input-create-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePass(v => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      {showCreatePass ? "🙈" : "👁"}
                    </button>
                  </div>
                  <select
                    value={createRole}
                    onChange={e => setCreateRole(e.target.value)}
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm"
                    data-testid="select-create-role"
                  >
                    <option value="viewer">{ar ? "مشاهد" : "Viewer"}</option>
                    <option value="editor">{ar ? "محرر" : "Editor"}</option>
                    <option value="admin">{ar ? "مدير" : "Admin"}</option>
                  </select>
                </div>
                <Button
                  onClick={createUserDirectly}
                  disabled={creating || !createName || !createEmail || !createPassword}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-create-user"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <span className="ml-2">✚</span>}
                  {ar ? "إنشاء الحساب" : "Create Account"}
                </Button>
                {createResult && (
                  <p className={`text-sm p-2 rounded border ${createResult.ok ? "bg-white dark:bg-slate-800 text-green-700 dark:text-green-400 border-green-200" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200"}`}>
                    {createResult.msg}
                  </p>
                )}
              </div>

              {/* Invite via email */}
              <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl space-y-3">
                <h4 className="font-medium text-sm">✉️ {ar ? "دعوة عبر البريد الإلكتروني" : "Invite via Email"}</h4>
                <div className="flex flex-wrap gap-2">
                  <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder={ar ? "البريد الإلكتروني" : "Email"} className="flex-1 min-w-48" type="email" />
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="h-10 px-3 rounded-md border border-input bg-background text-sm">
                    <option value="viewer">{ar ? "مشاهد" : "Viewer"}</option>
                    <option value="editor">{ar ? "محرر" : "Editor"}</option>
                    <option value="admin">{ar ? "مدير" : "Admin"}</option>
                  </select>
                  <Button onClick={sendInvite} disabled={inviting || !inviteEmail}>
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Send className="h-4 w-4 ml-2" />}
                    {ar ? "إرسال دعوة" : "Send Invite"}
                  </Button>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    {ar ? "⏱️ مدة صلاحية الرابط (ساعات):" : "⏱️ Link expiry (hours):"}
                  </label>
                  <Input
                    type="number"
                    className="w-24 h-8 text-sm"
                    value={settings.invitationExpiryHours || 72}
                    onChange={e => set("invitationExpiryHours", Math.max(1, parseInt(e.target.value) || 72))}
                    min={1}
                    max={720}
                    data-testid="input-invitation-expiry-hours"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    className="h-8 text-xs"
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await apiRequest("PATCH", "/api/settings", {
                          invitationExpiryHours: settings.invitationExpiryHours || 72,
                        });
                        queryClient.invalidateQueries({ queryKey: ["settings"] });
                      } catch (err: any) { alert(err.message); }
                      finally { setSaving(false); }
                    }}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : null}
                    {ar ? "حفظ" : "Save"}
                  </Button>
                </div>
                {inviteResult && <p className="text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 p-2 rounded border break-all">{inviteResult}</p>}
              </div>
            </div>
          </TabsContent>

          {/* Form Tab */}
          <TabsContent value="form">
            <div className="section-card space-y-4">
              <h3 className="font-semibold">{ar ? "إعدادات نموذج التعبئة" : "Registration Form Settings"}</h3>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{ar ? "تفعيل النموذج" : "Enable Form"}</p>
                  <p className="text-xs text-muted-foreground">{settings.formEnabled ? (ar ? "النموذج مفعّل" : "Form is active") : (ar ? "النموذج متوقف" : "Form is disabled")}</p>
                </div>
                <Switch checked={!!settings.formEnabled} onCheckedChange={v => set("formEnabled", v)} />
              </div>

              {!settings.formEnabled && (
                <FieldRow label={ar ? "رسالة الإيقاف" : "Disabled Message"}>
                  <Input value={settings.formDisabledMessage || ""} onChange={e => set("formDisabledMessage", e.target.value)} placeholder={ar ? "النموذج متوقف مؤقتاً..." : "Form is temporarily disabled..."} />
                </FieldRow>
              )}

              <FieldRow label={ar ? "رمز الدعوة" : "Invitation Code"}>
                <div className="flex gap-2">
                  <Input value={settings.invitationCode || ""} onChange={e => set("invitationCode", e.target.value)} className="font-mono tracking-widest" />
                </div>
                {settings.codeUpdatedAt && <p className="text-xs text-muted-foreground mt-1">{ar ? "آخر تغيير:" : "Last changed:"} {formatDate(settings.codeUpdatedAt)}</p>}
              </FieldRow>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyFormLink}>
                  {copiedCode ? <Check className="h-4 w-4 ml-1 text-green-500" /> : <Copy className="h-4 w-4 ml-1" />}
                  {ar ? "نسخ رابط النموذج" : "Copy Form Link"}
                </Button>
                <span className="text-xs text-muted-foreground font-mono">{window.location.origin}/register</span>
              </div>

              <FieldRow label={ar ? "مدة صلاحية رابط التعديل (ساعات)" : "Edit Token Duration (hours)"}>
                <Input type="number" value={settings.editTokenHours || 48} onChange={e => set("editTokenHours", parseInt(e.target.value))} min={1} max={720} />
              </FieldRow>

              <Button onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                {ar ? "حفظ" : "Save"}
              </Button>
            </div>
          </TabsContent>

          {/* Google Tab */}
          <TabsContent value="google">
            <div className="section-card space-y-5">
              <h3 className="font-semibold">{ar ? "إعدادات Google Sheets" : "Google Sheets Settings"}</h3>

              {/* Step-by-step guide */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl space-y-4">
                <p className="font-semibold text-sm text-green-900 dark:text-green-200">{ar ? "🗂️ دليل الربط مع Google Sheets — خطوة بخطوة" : "🗂️ Step-by-Step Guide to Linking Google Sheets"}</p>

                {/* Step 1 */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-6 h-6 bg-green-200 dark:bg-green-800 rounded-full flex items-center justify-center font-bold text-green-900 dark:text-green-100 text-xs">{ar ? "١" : "1"}</span>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">{ar ? "أنشئ مشروعاً في Google Cloud Console" : "Create a Project in Google Cloud Console"}</p>
                  </div>
                  <div className="mr-8 text-xs text-green-800 dark:text-green-300 space-y-1">
                    <p>{ar ? "افتح: " : "Open: "}<span className="font-mono bg-green-100 dark:bg-green-900 px-1 rounded">console.cloud.google.com</span></p>
                    <p>{ar ? "← اضغط \"New Project\" ← سمّه مثلاً masar-platform ← اضغط Create" : "← Click \"New Project\" ← Name it e.g. masar-platform ← Click Create"}</p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-6 h-6 bg-green-200 dark:bg-green-800 rounded-full flex items-center justify-center font-bold text-green-900 dark:text-green-100 text-xs">{ar ? "٢" : "2"}</span>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">{ar ? "فعّل Google Sheets API" : "Enable Google Sheets API"}</p>
                  </div>
                  <div className="mr-8 text-xs text-green-800 dark:text-green-300 space-y-1">
                    <p>{ar ? "من القائمة ← APIs & Services ← Library" : "From the menu ← APIs & Services ← Library"}</p>
                    <p>← ابحث عن <strong>"Google Sheets API"</strong> ← افتحها ← اضغط <strong>Enable</strong></p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-6 h-6 bg-green-200 dark:bg-green-800 rounded-full flex items-center justify-center font-bold text-green-900 dark:text-green-100 text-xs">٣</span>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">أنشئ Service Account</p>
                  </div>
                  <div className="mr-8 text-xs text-green-800 dark:text-green-300 space-y-1">
                    <p>← <strong>APIs &amp; Services</strong> ← <strong>Credentials</strong> ← <strong>Create Credentials</strong> ← <strong>Service Account</strong></p>
                    <p>← أعطه اسماً ← اضغط <strong>Create and Continue</strong> ← ثم Done</p>
                    <p>← اضغط على الـ Service Account المُنشأ ← تبويب <strong>Keys</strong></p>
                    <p>← <strong>Add Key</strong> ← <strong>Create new key</strong> ← اختر <strong>JSON</strong> ← اضغط Create</p>
                    <p className="text-green-700 dark:text-green-400 font-medium">⬇️ سيُنزَّل ملف JSON — هذا هو المفتاح الذي ستلصقه في الحقل أدناه</p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-6 h-6 bg-green-200 dark:bg-green-800 rounded-full flex items-center justify-center font-bold text-green-900 dark:text-green-100 text-xs">٤</span>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">أنشئ جدول Google Sheets وشارك مع Service Account</p>
                  </div>
                  <div className="mr-8 text-xs text-green-800 dark:text-green-300 space-y-1">
                    <p>افتح <span className="font-mono bg-green-100 dark:bg-green-900 px-1 rounded">sheets.google.com</span> ← أنشئ جدولاً جديداً</p>
                    <p>← اضغط <strong>Share</strong> (مشاركة) ← الصق بريد الـ Service Account</p>
                    <p className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-1 rounded text-[11px]">مثال: masar-platform@my-project.iam.gserviceaccount.com</p>
                    <p>← اختر صلاحية <strong>Editor (محرِّر)</strong> ← اضغط Send</p>
                  </div>
                </div>

                {/* Step 5 */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-6 h-6 bg-green-200 dark:bg-green-800 rounded-full flex items-center justify-center font-bold text-green-900 dark:text-green-100 text-xs">٥</span>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">انسخ Sheet ID من الرابط</p>
                  </div>
                  <div className="mr-8 text-xs text-green-800 dark:text-green-300 space-y-1">
                    <p>رابط الجدول يبدو هكذا:</p>
                    <p className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-1 rounded text-[11px] break-all">
                      https://docs.google.com/spreadsheets/d/<strong className="text-green-900 dark:text-green-100 underline">1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</strong>/edit
                    </p>
                    <p>الجزء بين <code>/d/</code> و <code>/edit</code> هو الـ <strong>Sheet ID</strong> — انسخه والصقه أدناه</p>
                  </div>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldRow label="Sheet ID">
                  <Input
                    value={settings.googleSheetId || ""}
                    onChange={e => set("googleSheetId", e.target.value)}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">من رابط الجدول: /d/<strong>ID</strong>/edit</p>
                </FieldRow>
                <FieldRow label="اسم الـ Sheet (تبويب)">
                  <Input value={settings.googleSheetName || ""} onChange={e => set("googleSheetName", e.target.value)} placeholder="بيانات التسجيل" />
                  <p className="text-xs text-muted-foreground mt-1">اسم التبويب في أسفل الجدول</p>
                </FieldRow>
                <FieldRow label="بريد Service Account">
                  <Input
                    value={settings.googleServiceAccountEmail || ""}
                    onChange={e => set("googleServiceAccountEmail", e.target.value)}
                    placeholder="name@project-id.iam.gserviceaccount.com"
                    className="text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">موجود في ملف JSON تحت مفتاح "client_email"</p>
                </FieldRow>
              </div>

              <FieldRow label="Service Account JSON Key">
                <textarea
                  className="w-full h-32 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-y"
                  placeholder={settings.hasGoogleKey
                    ? "🔒 مفتاح محفوظ ومشفَّر — الصق مفتاحاً جديداً للتحديث"
                    : '{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "...",\n  "client_email": "..."\n}'}
                  onChange={e => set("googleServiceAccountKey", e.target.value)}
                />
                {settings.hasGoogleKey
                  ? <p className="text-xs text-green-600 mt-1">✅ مفتاح محفوظ ومشفَّر بـ AES-256</p>
                  : <p className="text-xs text-amber-600 mt-1">⚠️ الصق محتوى ملف JSON الكامل الذي نزّلته من Google Cloud</p>
                }
              </FieldRow>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  حفظ
                </Button>
                <TestBtn label="اختبار الاتصال" onTest={() => apiRequest("POST", "/api/settings/test-sheets")} />
              </div>

              {/* Column Verification */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm">🔍 التحقق من تطابق الأعمدة</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    يقارن أعمدة الـ Google Sheet الفعلية مع الأعمدة المعرّفة في النموذج والمنصة — يكشف أي أعمدة ناقصة أو إضافية.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={verifyColumns}
                    disabled={verifying || fixingHeaders}
                    data-testid="button-verify-columns"
                  >
                    {verifying
                      ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />جاري الفحص...</>
                      : <>🔍 فحص تطابق الأعمدة</>
                    }
                  </Button>
                  <Button
                    variant="outline"
                    onClick={fixSheetHeaders}
                    disabled={fixingHeaders || verifying}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                    data-testid="button-fix-sheet-headers"
                  >
                    {fixingHeaders
                      ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />جاري التصحيح...</>
                      : <>🔧 تصحيح ترويسات الـ Sheet تلقائياً</>
                    }
                  </Button>
                </div>

                {fixResult && (
                  <div className={`p-3 rounded-lg border text-sm space-y-2 ${fixResult.ok ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700"}`}>
                    {fixResult.ok ? (
                      <>
                        <p className="font-semibold text-green-800 dark:text-green-200">✅ تم تصحيح الترويسات بنجاح</p>
                        <p className="text-xs text-green-700 dark:text-green-300">
                          تم كتابة {fixResult.newHeaders.length} عموداً رسمياً في الصف الأول — البيانات لم تُمسّ.
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                          الآن يمكنك الضغط على "فحص تطابق الأعمدة" للتحقق أن النتيجة 100%.
                        </p>
                      </>
                    ) : (
                      <p className="text-red-700 dark:text-red-400">{fixResult.message}</p>
                    )}
                  </div>
                )}

                {verifyResult && (
                  <div className="space-y-3">
                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        ✅ متطابقة: {verifyResult.matched.length}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${verifyResult.missingFromSheet.length > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}>
                        ❌ ناقصة من الـ Sheet: {verifyResult.missingFromSheet.length}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${verifyResult.extraInSheet.length > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}>
                        ⚠️ إضافية في الـ Sheet: {verifyResult.extraInSheet.length}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                        إجمالي أعمدة الـ Sheet: {verifyResult.sheetHeaders.length}
                      </span>
                    </div>

                    {verifyResult.message && (
                      <p className="text-sm text-red-700 dark:text-red-400 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                        {verifyResult.message}
                      </p>
                    )}

                    {/* Overall status */}
                    {verifyResult.ok && verifyResult.missingFromSheet.length === 0 && verifyResult.extraInSheet.length === 0 && (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-200 font-medium">
                        ✅ جميع الأعمدة متطابقة تماماً — المزامنة ستعمل بشكل صحيح
                      </div>
                    )}

                    {/* Missing columns */}
                    {verifyResult.missingFromSheet.length > 0 && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg space-y-2">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          ❌ أعمدة ناقصة من الـ Sheet ({verifyResult.missingFromSheet.length})
                        </p>
                        <p className="text-xs text-red-700 dark:text-red-400">
                          هذه الأعمدة موجودة في النظام لكنها غير موجودة في الـ Sheet — لن تُكتب بياناتها عند المزامنة
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {verifyResult.missingFromSheet.map(col => (
                            <span key={col} className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 rounded text-xs font-mono border border-red-200 dark:border-red-700">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Extra columns */}
                    {verifyResult.extraInSheet.length > 0 && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg space-y-2">
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                          ⚠️ أعمدة إضافية في الـ Sheet ({verifyResult.extraInSheet.length})
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          هذه الأعمدة موجودة في الـ Sheet لكن النظام لا يعرفها — ستُترك فارغة عند الكتابة ولن تُستورد
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {verifyResult.extraInSheet.map(col => (
                            <span key={col} className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded text-xs font-mono border border-amber-200 dark:border-amber-700">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All sheet headers ordered */}
                    {verifyResult.sheetHeaders.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1">
                          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                          عرض ترتيب أعمدة الـ Sheet الفعلي ({verifyResult.sheetHeaders.length} عمود)
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                          {verifyResult.sheetHeaders.map((col, i) => (
                            <span
                              key={i}
                              className={`px-2 py-0.5 rounded text-xs font-mono border ${
                                verifyResult.matched.includes(col)
                                  ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border-green-200 dark:border-green-700"
                                  : "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700"
                              }`}
                              title={`العمود ${i + 1}`}
                            >
                              {i + 1}. {col}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {/* Import from Sheet */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm">📥 استيراد البيانات من Google Sheets</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    يقرأ جميع الصفوف من الـ Sheet ويُدخلها في قاعدة البيانات — إن وجد موظف بنفس الرقم الوطني يتم تحديثه، وإلا يُضاف كسجل جديد.
                  </p>
                </div>

                {/* Sync deletes option */}
                <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={syncDeletes}
                    onChange={e => setSyncDeletes(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
                    data-testid="checkbox-sync-deletes"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">مزامنة المحذوفات</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      يحذف من المنصة أي موظف لا يوجد رقمه الوطني في الـ Sheet الحالي — <span className="text-red-600 dark:text-red-400 font-medium">الحذف نهائي ولا يمكن التراجع</span>
                    </p>
                  </div>
                </label>

                <Button
                  variant="outline"
                  onClick={importFromSheets}
                  disabled={importing}
                  data-testid="button-import-from-sheets"
                >
                  {importing
                    ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />جاري الاستيراد...</>
                    : <><Download className="h-4 w-4 ml-2" />استيراد من Google Sheets</>
                  }
                </Button>

                {importResult && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-sm space-y-1">
                    <p className="font-semibold text-green-800 dark:text-green-200">✅ تمت المزامنة بنجاح</p>
                    <p className="text-green-700 dark:text-green-300">
                      إجمالي الصفوف في الـ Sheet: <strong>{importResult.total}</strong> ·
                      مُضاف: <strong>{importResult.inserted}</strong> ·
                      مُحدَّث: <strong>{importResult.updated}</strong> ·
                      تجاهُل: <strong>{importResult.skipped}</strong>
                      {importResult.deleted > 0 && (
                        <> · <span className="text-red-600 dark:text-red-400">مَحذوف من المنصة: <strong>{importResult.deleted}</strong></span></>
                      )}
                    </p>
                  </div>
                )}
                {importError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
                    ❌ {importError}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Telegram Tab */}
          <TabsContent value="telegram">
            <div className="section-card space-y-4">
              <h3 className="font-semibold">Telegram Bot</h3>

              {/* Setup guide */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-xs text-blue-800 dark:text-blue-300 space-y-1">
                <p className="font-semibold text-sm">📋 {ar ? "خطوات الإعداد:" : "Setup steps:"}</p>
                <p>١. افتح Telegram وابحث عن <strong>@BotFather</strong> ← أرسل <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">/newbot</code></p>
                <p>٢. احفظ الـ <strong>Bot Token</strong> الذي يعطيك إياه</p>
                <p>٣. أضف البوت إلى مجموعتك/قناتك واجعله <strong>مشرفاً</strong></p>
                <p>٤. أرسل أي رسالة في المجموعة، ثم اضغط <strong>"جلب Chat ID تلقائياً"</strong></p>
              </div>

              <FieldRow label="Bot Token">
                <Input
                  type="password"
                  placeholder={settings.hasTelegramToken ? (ar ? "محفوظ — ألصق جديداً للتحديث" : "Saved — paste new to update") : "1234567890:ABCdefGHIjklmno..."}
                  onChange={e => { set("telegramBotToken", e.target.value); setTgTokenLive(e.target.value); }}
                />
                {settings.hasTelegramToken && !tgTokenLive && (
                  <p className="text-xs text-green-600 mt-1">✅ {ar ? "Token محفوظ ومشفَّر" : "Token saved & encrypted"}</p>
                )}
              </FieldRow>

              <FieldRow label="Chat ID">
                <div className="flex gap-2">
                  <Input
                    value={settings.telegramChatId || ""}
                    onChange={e => set("telegramChatId", e.target.value)}
                    placeholder="-1001234567890"
                    className="font-mono flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    disabled={tgFetching}
                    onClick={async () => {
                      setTgFetching(true);
                      setTgChats(null);
                      setTgFetchError(null);
                      try {
                        const res = await apiRequest<{ ok: boolean; chats?: Array<{ id: string; title: string; type: string }>; message?: string }>(
                          "POST", "/api/settings/telegram-updates",
                          tgTokenLive ? { token: tgTokenLive } : {}
                        );
                        if (res.ok && res.chats) setTgChats(res.chats);
                        else setTgFetchError(res.message || "فشل جلب المحادثات");
                      } catch (e: any) { setTgFetchError(e.message); }
                      finally { setTgFetching(false); }
                    }}
                  >
                    {tgFetching ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : "🔍"}
                    {ar ? "جلب Chat ID تلقائياً" : "Auto-detect Chat ID"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {ar ? "للمجموعات والقنوات: الرقم سالب يبدأ بـ -100" : "Groups/channels: negative number starting with -100"}
                </p>
              </FieldRow>

              {/* Status indicators */}
              <div className="flex gap-3 flex-wrap">
                <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${settings.hasTelegramToken ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300" : "bg-red-50 border-red-200 text-red-600 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400"}`}>
                  {settings.hasTelegramToken ? "✅" : "❌"} Bot Token
                </div>
                <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${settings.telegramChatId ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300" : "bg-red-50 border-red-200 text-red-600 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400"}`}>
                  {settings.telegramChatId ? "✅" : "❌"} Chat ID
                </div>
                {settings.hasTelegramToken && settings.telegramChatId && (
                  <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300">
                    🔔 الإشعارات مفعّلة
                  </div>
                )}
                {(!settings.hasTelegramToken || !settings.telegramChatId) && (
                  <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300">
                    ⚠️ الإشعارات متوقفة — أكمل الإعداد
                  </div>
                )}
              </div>

              {/* Chat list from getUpdates */}
              {tgChats && tgChats.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground px-3 py-2 bg-slate-50 dark:bg-slate-700/50">
                    اختر المحادثة — سيُحفظ تلقائياً:
                  </p>
                  {tgChats.map(chat => (
                    <button
                      key={chat.id}
                      onClick={async () => {
                        set("telegramChatId", chat.id);
                        setTgChats(null);
                        // Auto-save when chat is selected
                        setSaving(true);
                        try {
                          await apiRequest("POST", "/api/settings/save", { telegramChatId: chat.id });
                          setSettings((s: any) => ({ ...s, telegramChatId: chat.id }));
                        } catch {}
                        finally { setSaving(false); }
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-green-50 dark:hover:bg-green-900/10 border-t border-slate-100 dark:border-slate-700 transition-colors text-right"
                    >
                      <span className="font-medium">{chat.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{chat.type}</span>
                        <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-primary">{chat.id}</code>
                        <span className="text-xs text-green-600">← اضغط للاختيار والحفظ</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {tgFetchError && (
                <p className="text-sm text-red-600 dark:text-red-400 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">{tgFetchError}</p>
              )}

              {/* What gets sent */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">📨 محتوى الإشعار عند تسجيل جديد:</p>
                <pre className="font-sans leading-relaxed whitespace-pre-wrap">{`📋 تسجيل جديد — منصة مسارات

👤 الاسم: محمد أحمد الخطيب
🆔 الرقم الوطني: 0123456789
💼 المسمى الوظيفي: طبيب اختصاصي
📍 المحافظة: دمشق
🕒 الوقت: 25/06/2026، 10:30 ص`}</pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { save(); setTgTokenLive(""); }} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  {ar ? "حفظ" : "Save"}
                </Button>
                <TestBtn
                  label={ar ? "إرسال رسالة تجريبية" : "Send Test Message"}
                  onTest={() => apiRequest("POST", "/api/settings/test-telegram", {
                    chatId: settings.telegramChatId,
                    ...(tgTokenLive ? { token: tgTokenLive } : {}),
                  })}
                />
              </div>
            </div>
          </TabsContent>

          {/* Email Tab */}
          <TabsContent value="email">
            <div className="section-card space-y-4">
              <h3 className="font-semibold">{ar ? "إعدادات البريد الإلكتروني (SMTP)" : "Email Settings (SMTP)"}</h3>

              {/* Gmail step-by-step guide */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm text-blue-900 dark:text-blue-200">📧 دليل إعداد Gmail خطوة بخطوة</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-600 dark:text-blue-300"
                    onClick={() => {
                      set("smtpHost", "smtp.gmail.com");
                      set("smtpPort", 465);
                      set("smtpFromName", settings.smtpFromName || "منصة مسارات");
                    }}
                  >
                    ⚡ تعبئة إعدادات Gmail تلقائياً
                  </Button>
                </div>
                <div className="text-xs text-blue-800 dark:text-blue-300 space-y-2">
                  <div className="flex gap-2">
                    <span className="shrink-0 w-5 h-5 bg-blue-200 dark:bg-blue-800 rounded-full flex items-center justify-center font-bold text-blue-900 dark:text-blue-100 text-[10px]">١</span>
                    <p>افتح <strong>إعدادات حساب Google</strong> ← Security ← <strong>2-Step Verification</strong> وفعّلها</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="shrink-0 w-5 h-5 bg-blue-200 dark:bg-blue-800 rounded-full flex items-center justify-center font-bold text-blue-900 dark:text-blue-100 text-[10px]">٢</span>
                    <p>في نفس صفحة Security ← ابحث عن <strong>App passwords</strong> ← اختر "Mail" ← انسخ كلمة المرور المكونة من 16 حرفاً</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="shrink-0 w-5 h-5 bg-blue-200 dark:bg-blue-800 rounded-full flex items-center justify-center font-bold text-blue-900 dark:text-blue-100 text-[10px]">٣</span>
                    <p>الصقها في حقل كلمة المرور أدناه <strong>بدلاً من كلمة مرور Gmail العادية</strong></p>
                  </div>
                  <div className="mt-2 p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg font-mono text-[11px] space-y-0.5">
                    <p>Host: <strong>smtp.gmail.com</strong> · Port: <strong>465</strong> (SSL)</p>
                    <p>Username: <strong>بريدك@gmail.com</strong></p>
                    <p>Password: <strong>كلمة مرور التطبيق (16 حرفاً)</strong></p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldRow label="SMTP Host">
                  <Input value={settings.smtpHost || ""} onChange={e => set("smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
                </FieldRow>
                <FieldRow label="SMTP Port">
                  <div className="flex gap-2">
                    <Input type="number" value={settings.smtpPort || 465} onChange={e => set("smtpPort", parseInt(e.target.value))} className="flex-1" />
                    <div className="flex gap-1">
                      <button onClick={() => set("smtpPort", 465)} className={`px-2 py-1 text-xs rounded border transition-colors ${(settings.smtpPort || 465) === 465 ? "bg-primary text-white border-primary" : "border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>465</button>
                      <button onClick={() => set("smtpPort", 587)} className={`px-2 py-1 text-xs rounded border transition-colors ${settings.smtpPort === 587 ? "bg-primary text-white border-primary" : "border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>587</button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">465 (SSL/TLS) · 587 (STARTTLS)</p>
                </FieldRow>
                <FieldRow label={ar ? "بريدك الإلكتروني" : "Your Email"}>
                  <Input value={settings.smtpUser || ""} onChange={e => set("smtpUser", e.target.value)} placeholder="yourname@gmail.com" />
                </FieldRow>
                <FieldRow label={ar ? "كلمة مرور التطبيق (App Password)" : "App Password"}>
                  <Input
                    type="password"
                    placeholder={settings.hasSmtpPass ? "محفوظة — ألصق جديدة للتحديث" : "xxxx xxxx xxxx xxxx"}
                    onChange={e => { set("smtpPass", e.target.value); setSmtpPassLive(e.target.value); }}
                  />
                  {settings.hasSmtpPass && !smtpPassLive
                    ? <p className="text-xs text-green-600 mt-1">✅ كلمة مرور محفوظة</p>
                    : <p className="text-xs text-amber-600 mt-1">⚠️ استخدم App Password وليس كلمة مرور Gmail العادية</p>
                  }
                </FieldRow>
                <FieldRow label={ar ? "اسم المرسل" : "From Name"}>
                  <Input value={settings.smtpFromName || ""} onChange={e => set("smtpFromName", e.target.value)} placeholder="منصة مسارات" />
                </FieldRow>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { save(); setSmtpPassLive(""); }} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  {ar ? "حفظ" : "Save"}
                </Button>
                <TestBtn
                  label={ar ? "اختبار الاتصال" : "Test Connection"}
                  onTest={() => apiRequest("POST", "/api/settings/test-email", {
                    host: settings.smtpHost,
                    port: settings.smtpPort || 465,
                    user: settings.smtpUser,
                    pass: smtpPassLive || undefined,
                  })}
                />
              </div>
              {!smtpPassLive && settings.hasSmtpPass && (
                <p className="text-xs text-muted-foreground">
                  💡 سيستخدم الاختبار كلمة المرور المحفوظة — إذا استمر الفشل، الصق كلمة مرور جديدة ثم اختبر
                </p>
              )}
            </div>
          </TabsContent>

          {/* General Tab */}
          <TabsContent value="general">
            <div className="section-card space-y-4">
              <h3 className="font-semibold">{ar ? "الإعدادات العامة" : "General Settings"}</h3>
              <FieldRow label={ar ? "اسم النظام" : "System Name"}>
                <Input value={settings.appName || ""} onChange={e => set("appName", e.target.value)} />
              </FieldRow>
              <FieldRow label={ar ? "اللغة الافتراضية" : "Default Language"}>
                <select value={settings.defaultLanguage || "ar"} onChange={e => set("defaultLanguage", e.target.value)} className="h-10 w-full px-3 rounded-md border border-input bg-background text-sm">
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </FieldRow>
              <FieldRow label={ar ? "المنطقة الزمنية" : "Timezone"}>
                <Input value={settings.timezone || ""} onChange={e => set("timezone", e.target.value)} placeholder="Asia/Damascus" />
              </FieldRow>
              <Button onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                {ar ? "حفظ" : "Save"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
