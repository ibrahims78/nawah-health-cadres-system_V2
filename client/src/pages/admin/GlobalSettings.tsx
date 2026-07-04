import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useLang } from "@/context/LanguageContext";
import {
  Save, Loader2, Users, Mail, Globe, Plus, Trash2,
  Eye, EyeOff, Send, RefreshCw, KeyRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type ExtUser = User & { lastLoginAt?: string | Date | null };

function formatDate(d?: string | Date | null, ar: boolean = true) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(ar ? "ar" : "en", { year: "numeric", month: "short", day: "numeric" });
}

export function GlobalSettings() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"general" | "smtp" | "users">("general");
  const [showPass, setShowPass] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);

  // Reset password dialog
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetUserName, setResetUserName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // Delete user confirm dialog
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserName, setDeleteUserName] = useState("");

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/projects/global-settings"],
    queryFn: () => fetch("/api/projects/global-settings", { credentials: "include" }).then(r => r.json()),
  });

  const { data: userList = [] } = useQuery<ExtUser[]>({
    queryKey: ["/api/projects/users-list"],
    queryFn: () => fetch("/api/projects/users-list", { credentials: "include" }).then(r => r.json()),
  });

  const { register: regGeneral, handleSubmit: hsGeneral, reset: resetGeneral } = useForm<any>();
  const {
    register: regSmtp, handleSubmit: hsSmtp, reset: resetSmtp, getValues: getSmtpValues,
    setValue: setSmtpValue, watch: watchSmtp,
  } = useForm<any>();
  const smtpPortVal = Number(watchSmtp("smtpPort")) || 587;
  const {
    register: regInvite, handleSubmit: hsInvite, reset: resetInvite,
  } = useForm<{ email: string; role: string }>({ defaultValues: { email: "", role: "viewer" } });
  const {
    register: regUser, handleSubmit: hsUser, reset: resetUser, formState: { errors: userErrors },
  } = useForm<{ fullName: string; email: string; password: string; role: string }>({
    defaultValues: { fullName: "", email: "", password: "", role: "viewer" },
  });

  useEffect(() => {
    if (settings) {
      resetGeneral({
        appName: settings.appName,
        defaultLanguage: settings.defaultLanguage,
        invitationExpiryHours: settings.invitationExpiryHours,
      });
      resetSmtp({
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpUser: settings.smtpUser,
        smtpFromName: settings.smtpFromName,
      });
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/projects/global-settings", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects/global-settings"] });
      toast({ description: ar ? "✅ تم الحفظ بنجاح" : "✅ Saved successfully" });
    },
    onError: (err: any) => toast({ variant: "destructive", description: `❌ ${err.message}` }),
  });

  const inviteMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/projects/send-invitation", data),
    onSuccess: (res: any) => {
      if (res.emailSent) {
        toast({ description: ar ? "✅ تم إرسال الدعوة بالبريد الإلكتروني" : "✅ Invitation sent via email" });
      } else {
        const link = res.inviteUrl || "";
        toast({
          description: (
            <span className="break-all">
              {ar ? "🔗 رابط الدعوة: " : "🔗 Invitation link: "}
              <a href={link} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 dark:text-blue-400">{link}</a>
            </span>
          ) as any,
          duration: 15000,
        });
      }
      resetInvite({ email: "", role: "viewer" });
    },
    onError: (err: any) => toast({ variant: "destructive", description: `❌ ${err.message}` }),
  });

  const createUserMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/projects/create-user", data),
    onSuccess: (_, vars: any) => {
      qc.invalidateQueries({ queryKey: ["/api/projects/users-list"] });
      toast({ description: ar ? `✅ تم إنشاء حساب ${vars.fullName} بنجاح` : `✅ Account ${vars.fullName} created successfully` });
      resetUser({ fullName: "", email: "", password: "", role: "viewer" });
    },
    onError: (err: any) => toast({ variant: "destructive", description: `❌ ${err.message}` }),
  });

  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/projects/users/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/projects/users-list"] }),
  });

  const changeRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiRequest("PATCH", `/api/projects/users/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/projects/users-list"] }),
  });

  const testSmtp = async () => {
    setSmtpTesting(true);
    const vals = getSmtpValues();
    const res: any = await apiRequest("POST", "/api/projects/test-email", {
      host: vals.smtpHost,
      port: vals.smtpPort,
      user: vals.smtpUser,
      pass: vals.smtpPass,
    }).catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    toast({ variant: res.ok ? undefined : "destructive", description: res.message });
    setSmtpTesting(false);
  };

  const doResetPassword = async () => {
    if (!resetUserId || newPass.length < 8) return;
    setResetLoading(true);
    const res: any = await apiRequest("POST", `/api/projects/reset-password/${resetUserId}`, { password: newPass })
      .catch(e => ({ ok: false, message: `❌ ${e.message}` }));
    const ok = res.ok !== false;
    toast({
      variant: ok ? undefined : "destructive",
      description: ok ? (ar ? "✅ تم تغيير كلمة المرور بنجاح" : "✅ Password changed successfully") : res.message || (ar ? "❌ فشل" : "❌ Failed"),
    });
    setResetLoading(false);
    if (ok) {
      setNewPass("");
      setResetUserId(null);
    }
  };

  const ROLE_LABEL: Record<string, string> = ar ? {
    admin: "مدير", editor: "محرر", viewer: "مشاهد",
  } : {
    admin: "Admin", editor: "Editor", viewer: "Viewer",
  };
  const ROLE_VARIANT: Record<string, "default" | "outline" | "secondary"> = {
    admin: "default", editor: "outline", viewer: "secondary",
  };

  const tabs = [
    { key: "general", label: ar ? "عام" : "General", icon: Globe },
    { key: "smtp", label: ar ? "البريد" : "Email", icon: Mail },
    { key: "users", label: ar ? "المستخدمون" : "Users", icon: Users },
  ] as const;

  return (
    <Layout>
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{ar ? "الإعدادات العامة" : "Global Settings"}</h1>
          <p className="text-sm text-muted-foreground">{ar ? "إعدادات النظام على مستوى المنصة" : "Platform-wide system settings"}</p>
        </div>

        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.key
                  ? "bg-white dark:bg-slate-700 shadow-sm text-primary"
                  : "text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              data-testid={`tab-${t.key}`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ─── General Tab ─── */}
        {tab === "general" && (
          <form onSubmit={hsGeneral(d => saveMut.mutate(d))}>
            <Card className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "اسم التطبيق / المنصة" : "App / Platform Name"}</Label>
                <Input {...regGeneral("appName")} placeholder={ar ? "مسارات" : "Masar"} data-testid="input-appName" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "اللغة الافتراضية" : "Default Language"}</Label>
                <select {...regGeneral("defaultLanguage")}
                  className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                  data-testid="select-language">
                  <option value="ar">{ar ? "العربية" : "Arabic"}</option>
                  <option value="en">{ar ? "English" : "English"}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "مدة صلاحية دعوة المستخدمين (ساعة)" : "User invitation expiry (hours)"}</Label>
                <Input
                  {...regGeneral("invitationExpiryHours")}
                  type="number" min={1} max={720}
                  placeholder="72"
                  className="w-40"
                  data-testid="input-invitationHours"
                />
              </div>
              <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-general">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                {ar ? "حفظ الإعدادات" : "Save Settings"}
              </Button>
            </Card>
          </form>
        )}

        {/* ─── SMTP Tab ─── */}
        {tab === "smtp" && (
          <form onSubmit={hsSmtp(d => saveMut.mutate(d))}>
            <Card className="p-5 space-y-4">

              {/* Gmail step-by-step guide */}
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-200 dark:border-blue-800">
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                    {ar ? "⚡ دليل إعداد Gmail خطوة بخطوة" : "⚡ Gmail Setup Guide"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300"
                    onClick={() => {
                      setSmtpValue("smtpHost", "smtp.gmail.com");
                      setSmtpValue("smtpPort", 465);
                    }}
                  >
                    ⚡ {ar ? "تعبئة إعدادات Gmail تلقائياً" : "Auto-fill Gmail settings"}
                  </Button>
                </div>
                <div className="px-4 py-3 space-y-1.5 text-xs text-blue-700 dark:text-blue-300" dir="rtl">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">١</span>
                    <span>
                      {ar
                        ? <>افتح <strong>إعدادات حساب Google</strong> ← <strong>Security</strong> ← فعّل <strong>2-Step Verification</strong></>
                        : <>Open <strong>Google Account</strong> → <strong>Security</strong> → enable <strong>2-Step Verification</strong></>}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">٢</span>
                    <span>
                      {ar
                        ? <>في نفس صفحة <strong>Security</strong> ابحث عن <strong>App passwords</strong> ← اختر "Mail"</>
                        : <>On the same <strong>Security</strong> page, find <strong>App passwords</strong> → choose "Mail"</>}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">٣</span>
                    <span>
                      {ar
                        ? <>انسخ كلمة المرور المكوّنة من 16 حرفاً واستخدمها أدناه <strong>بدلاً</strong> من كلمة المرور <strong>العادية</strong></>
                        : <>Copy the 16-character password and use it below <strong>instead</strong> of your <strong>regular</strong> password</>}
                    </span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700 text-[11px] text-blue-500 dark:text-blue-400 leading-5">
                    Host: <code className="font-mono">smtp.gmail.com</code> · Port: <code className="font-mono">465</code> (SSL) &nbsp;|&nbsp;
                    Username: <code className="font-mono">بريدك@gmail.com</code> &nbsp;|&nbsp;
                    Password: <code className="font-mono">كلمة مرور التطبيق (16 حرفاً)</code>
                  </div>
                </div>
              </div>

              {/* Host + Port */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">SMTP Host</Label>
                  <Input {...regSmtp("smtpHost")} placeholder="smtp.gmail.com" data-testid="input-smtpHost" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">SMTP Port</Label>
                  {/* hidden input keeps the form value in sync */}
                  <input type="hidden" {...regSmtp("smtpPort")} />
                  <div className="flex gap-0 rounded-md overflow-hidden border border-input">
                    {([465, 587] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        data-testid={`btn-port-${p}`}
                        onClick={() => setSmtpValue("smtpPort", p)}
                        className={`flex-1 py-2 text-sm font-medium transition-colors
                          ${smtpPortVal === p
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    465 (SSL/TLS) &nbsp;·&nbsp; 587 (STARTTLS)
                  </p>
                </div>
              </div>

              {/* Username + App Password */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{ar ? "بريدك الإلكتروني" : "Your Email"}</Label>
                  <Input {...regSmtp("smtpUser")} placeholder="yourname@gmail.com" data-testid="input-smtpUser" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{ar ? "كلمة مرور التطبيق (App Password)" : "App Password"}</Label>
                  <Input
                    {...regSmtp("smtpPass")}
                    type="password"
                    placeholder={settings?.hasSmtpPass
                      ? (ar ? "محفوظة — اتركها فارغة للإبقاء" : "Saved — leave empty to keep")
                      : "XXXX XXXX XXXX XXXX"}
                    data-testid="input-smtpPass"
                  />
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    ⚠️ {ar ? "استخدم App Password وليس كلمة المرور العادية" : "Use App Password, not your regular password"}
                  </p>
                </div>
              </div>

              {/* Sender name */}
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "اسم المرسل" : "Sender Name"}</Label>
                <Input {...regSmtp("smtpFromName")} placeholder={ar ? "مسارات" : "Masar"} data-testid="input-smtpFromName" />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button type="submit" disabled={saveMut.isPending} data-testid="button-save-smtp">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
                  {ar ? "حفظ" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={smtpTesting}
                  onClick={testSmtp}
                  data-testid="button-test-smtp"
                >
                  {smtpTesting
                    ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                    : <RefreshCw className="h-4 w-4 ml-1" />}
                  {ar ? "اختبار الاتصال" : "Test Connection"}
                </Button>
              </div>
            </Card>
          </form>
        )}

        {/* ─── Users Tab ─── */}
        {tab === "users" && (
          <div className="space-y-4">

            {/* Users table */}
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{ar ? "المستخدمون الحاليون" : "Current Users"}</h3>
                <Badge variant="secondary">{userList.length}</Badge>
              </div>
              {userList.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">{ar ? "لا يوجد مستخدمون بعد" : "No users yet"}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">{ar ? "الاسم" : "Name"}</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground hidden md:table-cell">{ar ? "البريد" : "Email"}</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">{ar ? "الدور" : "Role"}</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground hidden lg:table-cell">{ar ? "آخر دخول" : "Last Login"}</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground w-28">{ar ? "إجراءات" : "Actions"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {userList.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors" data-testid={`row-user-${u.id}`}>
                          <td className="px-4 py-2.5 font-medium text-sm">{u.fullName}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{u.email}</td>
                          <td className="px-4 py-2.5">
                            <select
                              defaultValue={u.role}
                              onChange={e => changeRoleMut.mutate({ userId: u.id, role: e.target.value })}
                              className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs font-medium"
                              data-testid={`select-role-${u.id}`}
                            >
                              <option value="viewer">{ar ? "مشاهد" : "Viewer"}</option>
                              <option value="editor">{ar ? "محرر" : "Editor"}</option>
                              <option value="admin">{ar ? "مدير" : "Admin"}</option>
                            </select>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                            {formatDate(u.lastLoginAt, ar)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-blue-400 hover:text-blue-600"
                                title={ar ? "إعادة تعيين كلمة المرور" : "Reset Password"}
                                onClick={() => {
                                  setResetUserId(u.id);
                                  setResetUserName(u.fullName);
                                  setNewPass("");
                                }}
                                data-testid={`button-reset-pass-${u.id}`}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-red-400 hover:text-red-600"
                                onClick={() => { setDeleteUserId(u.id); setDeleteUserName(u.fullName); }}
                                data-testid={`button-delete-user-${u.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Create user directly */}
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Plus className="h-4 w-4 text-green-600" />
                {ar ? "إنشاء مستخدم مباشرة" : "Create User Directly"}
              </h3>
              <form onSubmit={hsUser(d => createUserMut.mutate(d))} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{ar ? "الاسم الكامل" : "Full Name"}</Label>
                    <Input
                      {...regUser("fullName", { required: true })}
                      placeholder={ar ? "محمد أحمد" : "John Doe"}
                      data-testid="input-new-fullName"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{ar ? "البريد الإلكتروني" : "Email"}</Label>
                    <Input
                      {...regUser("email", { required: true })}
                      type="email"
                      placeholder="user@example.com"
                      data-testid="input-new-email"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{ar ? "كلمة المرور" : "Password"}</Label>
                    <div className="relative">
                      <Input
                        {...regUser("password", { required: true, minLength: 8 })}
                        type={showPass ? "text" : "password"}
                        placeholder={ar ? "8 أحرف على الأقل" : "At least 8 characters"}
                        data-testid="input-new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(v => !v)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
                        tabIndex={-1}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {userErrors.password && (
                      <p className="text-xs text-red-500">{ar ? "8 أحرف على الأقل" : "At least 8 characters"}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{ar ? "الدور" : "Role"}</Label>
                    <select
                      {...regUser("role")}
                      className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                      data-testid="select-new-role"
                    >
                      <option value="viewer">{ar ? "مشاهد" : "Viewer"}</option>
                      <option value="editor">{ar ? "محرر" : "Editor"}</option>
                      <option value="admin">{ar ? "مدير" : "Admin"}</option>
                    </select>
                  </div>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createUserMut.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-create-user"
                >
                  {createUserMut.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                    : <Plus className="h-4 w-4 ml-1" />}
                  {ar ? "إنشاء مستخدم" : "Create User"}
                </Button>
              </form>
            </Card>

            {/* Invite via email */}
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-600" />
                {ar ? "دعوة مستخدم بالبريد الإلكتروني" : "Invite User via Email"}
              </h3>
              <form onSubmit={hsInvite(d => inviteMut.mutate(d))} className="space-y-3">
                <div className="flex gap-3">
                  <Input
                    {...regInvite("email", { required: true })}
                    placeholder="user@example.com"
                    type="email"
                    className="flex-1"
                    data-testid="input-invite-email"
                  />
                  <select
                    {...regInvite("role")}
                    className="h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                    data-testid="select-invite-role"
                  >
                    <option value="viewer">{ar ? "مشاهد" : "Viewer"}</option>
                    <option value="editor">{ar ? "محرر" : "Editor"}</option>
                    <option value="admin">{ar ? "مدير" : "Admin"}</option>
                  </select>
                  <Button type="submit" disabled={inviteMut.isPending} data-testid="button-invite">
                    {inviteMut.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUserId} onOpenChange={v => { if (!v) { setResetUserId(null); setNewPass(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-500" />
              {ar ? "إعادة تعيين كلمة المرور" : "Reset Password"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {ar ? "إعادة تعيين كلمة مرور المستخدم: " : "Reset password for user: "}
              <strong>{resetUserName}</strong>
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">{ar ? "كلمة المرور الجديدة" : "New Password"}</Label>
              <div className="relative">
                <Input
                  type={showNewPass ? "text" : "password"}
                  value={newPass}
                  onChange={e => setNewPass(e.target.value)}
                  placeholder={ar ? "8 أحرف على الأقل" : "At least 8 characters"}
                  data-testid="input-new-pass"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
                >
                  {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPass && newPass.length < 8 && (
                <p className="text-xs text-red-500">{ar ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters"}</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setResetUserId(null); setNewPass(""); }}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={doResetPassword}
              disabled={resetLoading || newPass.length < 8}
              data-testid="button-confirm-reset-pass"
            >
              {resetLoading ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <KeyRound className="h-4 w-4 ml-1" />}
              {ar ? "تغيير كلمة المرور" : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete User Confirm Dialog ─── */}
      <Dialog open={!!deleteUserId} onOpenChange={o => !o && setDeleteUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? "حذف مستخدم" : "Delete User"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {ar
              ? `هل أنت متأكد من حذف مستخدم "${deleteUserName}"؟ لا يمكن التراجع عن هذا الإجراء.`
              : `Are you sure you want to delete "${deleteUserName}"? This action cannot be undone.`}
          </p>
          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeleteUserId(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button variant="destructive" onClick={() => { deleteUserMut.mutate(deleteUserId!); setDeleteUserId(null); }} disabled={deleteUserMut.isPending}>
              {deleteUserMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 ml-1" />}
              {ar ? "حذف" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
