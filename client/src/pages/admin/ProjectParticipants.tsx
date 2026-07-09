import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, fetchJson } from "@/lib/queryClient";
import { useLang } from "@/context/LanguageContext";
import {
  Users, Plus, Upload, Download, Send, Trash2, Copy, ArrowRight,
  CheckCircle2, Clock, Edit3, Lock, MessageSquare, RefreshCw, Search,
  UserCheck, Bell, Settings2, ExternalLink, Check, Mail, AlertCircle,
} from "lucide-react";
import type { Project, ProjectField } from "@shared/schema";

interface Participant {
  id: string;
  name: string;
  identifier: string | null;
  identifierType: string;
  token: string;
  telegramChatId: string | null;
  submittedAt: string | null;
  firstOpenedAt: string | null;
  lastNotifiedAt: string | null;
  notifyCount: number;
  lastEmailedAt: string | null;
  emailCount: number;
  addedAt: string;
  notes: string | null;
  status: "unopened" | "opened" | "submitted_editable" | "submitted_locked";
  participantLink: string;
}

interface ParticipantStats {
  total: number;
  unopened: number;
  opened: number;
  submittedEditable: number;
  submittedLocked: number;
  submitted: number;
  withTelegram: number;
}

function StatusBadge({ status, isAr }: { status: Participant["status"]; isAr: boolean }) {
  const map: Record<Participant["status"], { label: string; labelEn: string; cls: string; icon: any }> = {
    unopened: { label: "لم يُفتح", labelEn: "Unopened", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: Clock },
    opened: { label: "فُتح", labelEn: "Opened", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: RefreshCw },
    submitted_editable: { label: "مُسجَّل ✏️", labelEn: "Submitted ✏️", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: Edit3 },
    submitted_locked: { label: "مُسجَّل 🔒", labelEn: "Submitted 🔒", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: Lock },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      <m.icon className="h-2.5 w-2.5" />
      {isAr ? m.label : m.labelEn}
    </span>
  );
}

export function ProjectParticipants() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dialogs
  const [addDialog, setAddDialog] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [notifyDialog, setNotifyDialog] = useState(false);
  const [notifyBatchDialog, setNotifyBatchDialog] = useState(false);
  const [editParticipant, setEditParticipant] = useState<Participant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBulk, setDeleteBulk] = useState(false);

  // Add form state
  const [addName, setAddName] = useState("");
  const [addIdentifier, setAddIdentifier] = useState("");
  const [addIdType, setAddIdType] = useState<"email" | "phone" | "national_id" | "custom">("email");
  const [addNotes, setAddNotes] = useState("");

  // Notify message
  const [notifyMsg, setNotifyMsg] = useState("");
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyBatchMsg, setNotifyBatchMsg] = useState("");

  // Email
  const [emailBatchDialog, setEmailBatchDialog] = useState(false);
  const [emailResultDialog, setEmailResultDialog] = useState(false);
  const [emailBatchResult, setEmailBatchResult] = useState<{ sent: number; failed: number; noEmail: number; failures: string[] } | null>(null);

  // Import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useQuery<any>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetchJson(`/api/projects/${id}`),
  });

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetchJson(`/api/projects/${id}/fields`),
  });

  const { data: participants = [], isLoading } = useQuery<Participant[]>({
    queryKey: ["/api/projects", id, "participants"],
    queryFn: () => fetchJson(`/api/projects/${id}/participants`),
    refetchInterval: 30_000,
  });

  const { data: stats } = useQuery<ParticipantStats>({
    queryKey: ["/api/projects", id, "participants", "stats"],
    queryFn: () => fetchJson(`/api/projects/${id}/participants/stats`),
    refetchInterval: 30_000,
  });

  const addMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/projects/${id}/participants`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants", "stats"] });
      setAddDialog(false);
      setAddName(""); setAddIdentifier(""); setAddNotes("");
      toast({ description: isAr ? "✅ تم إضافة المشارك" : "✅ Participant added" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const editMut = useMutation({
    mutationFn: ({ pid, data }: { pid: string; data: any }) =>
      apiRequest("PATCH", `/api/projects/${id}/participants/${pid}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      setEditParticipant(null);
      toast({ description: isAr ? "✅ تم تحديث بيانات المشارك" : "✅ Participant updated" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const deleteMut = useMutation({
    mutationFn: (pid: string) => apiRequest("DELETE", `/api/projects/${id}/participants/${pid}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants", "stats"] });
      setDeleteId(null);
      toast({ description: isAr ? "تم الحذف" : "Deleted" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/participants/bulk-delete`, { ids: [...selected] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants", "stats"] });
      setSelected(new Set());
      setDeleteBulk(false);
      toast({ description: isAr ? "✅ تم حذف المشاركين" : "✅ Participants deleted" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const notifyAllMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/participants/notify-all`, { message: notifyMsg }),
    onSuccess: (data: any) => {
      setNotifyDialog(false);
      setNotifyMsg("");
      toast({ description: isAr ? `✅ أُرسل لـ ${data?.sent ?? 0} مشارك` : `✅ Sent to ${data?.sent ?? 0}` });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const notifyBatchMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/participants/notify-batch`, { ids: [...selected], message: notifyBatchMsg }),
    onSuccess: (data: any) => {
      setNotifyBatchDialog(false);
      setNotifyBatchMsg("");
      toast({ description: isAr ? `✅ أُرسل لـ ${data?.sent ?? 0} مشارك` : `✅ Sent to ${data?.sent ?? 0}` });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const notifyOneMut = useMutation({
    mutationFn: ({ pid, message }: { pid: string; message: string }) =>
      apiRequest("POST", `/api/projects/${id}/participants/${pid}/notify`, { message }),
    onSuccess: () => toast({ description: isAr ? "✅ تم الإرسال" : "✅ Sent" }),
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const sendEmailOneMut = useMutation({
    mutationFn: (pid: string) =>
      apiRequest("POST", `/api/projects/${id}/participants/${pid}/send-invite-email`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      toast({ description: isAr ? "✅ تم إرسال البريد بنجاح" : "✅ Email sent successfully" });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const sendEmailBatchMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${id}/participants/send-invite-email-batch`, { ids: [...selected] }),
    onSuccess: (data: any) => {
      setEmailBatchDialog(false);
      setEmailBatchResult(data);
      setEmailResultDialog(true);
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
    },
    onError: (e: any) => toast({ variant: "destructive", description: `❌ ${e.message}` }),
  });

  const doImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("overwriteDuplicates", String(importOverwrite));
      const res = await fetch(`/api/projects/${id}/participants/import`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل الاستيراد");
      setImportResult(data);
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "participants", "stats"] });
    } catch (e: any) {
      toast({ variant: "destructive", description: `❌ ${e.message}` });
    } finally {
      setImportLoading(false);
    }
  };

  const doExport = () => {
    window.open(`/api/projects/${id}/participants/export`, "_blank");
  };

  const copyLink = (link: string) => {
    const url = `${window.location.origin}${link}`;
    navigator.clipboard.writeText(url).then(() =>
      toast({ description: isAr ? "✅ تم نسخ الرابط" : "✅ Link copied" })
    );
  };

  const toggleSelect = (pid: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(pid) ? s.delete(pid) : s.add(pid); return s; });
  const toggleAll = () =>
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));

  const filtered = participants.filter(p => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.identifier || "").toLowerCase().includes(q);
  });

  const idTypeLabel = (t: string) => {
    const map: Record<string, string> = { email: "بريد إلكتروني", phone: "هاتف", national_id: "رقم هوية", custom: "مخصص" };
    return isAr ? (map[t] || t) : t;
  };

  return (
    <Layout projectId={id}>
      <div className="space-y-5 max-w-6xl">

        {/* ─── Header ─── */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => nav(`/admin/projects/${id}/dashboard`)}>
            <ArrowRight className="h-4 w-4 ml-1" />{isAr ? "لوحة التحكم" : "Dashboard"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-bold">{isAr ? "المشاركون" : "Participants"}</h1>
            {stats && <Badge variant="outline">{stats.total}</Badge>}
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={doExport} data-testid="button-export-participants">
            <Download className="h-3.5 w-3.5 ml-1" />{isAr ? "تصدير" : "Export"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportDialog(true)} data-testid="button-import-participants">
            <Upload className="h-3.5 w-3.5 ml-1" />{isAr ? "استيراد Excel" : "Import Excel"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNotifyDialog(true)} data-testid="button-notify-all">
            <Bell className="h-3.5 w-3.5 ml-1" />{isAr ? "إشعار الكل" : "Notify All"}
          </Button>
          <Button size="sm" onClick={() => setAddDialog(true)} data-testid="button-add-participant">
            <Plus className="h-3.5 w-3.5 ml-1" />{isAr ? "إضافة مشارك" : "Add Participant"}
          </Button>
        </div>

        {/* ─── Stats mini-cards ─── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: isAr ? "المجموع" : "Total", val: stats.total, cls: "text-slate-700 dark:text-slate-200" },
              { label: isAr ? "لم يُفتح" : "Unopened", val: stats.unopened, cls: "text-red-600" },
              { label: isAr ? "فُتح" : "Opened", val: stats.opened, cls: "text-yellow-600" },
              { label: isAr ? "مُسجَّل ✏️" : "Submitted ✏️", val: stats.submittedEditable, cls: "text-green-600" },
              { label: isAr ? "مُسجَّل 🔒" : "Submitted 🔒", val: stats.submittedLocked, cls: "text-emerald-700" },
              { label: isAr ? "الإجمالي المُسجَّل" : "All Submitted", val: stats.submitted, cls: "text-blue-600" },
              { label: isAr ? "Telegram مُفعَّل" : "Telegram Active", val: stats.withTelegram, cls: "text-indigo-600" },
            ].map(s => (
              <Card key={s.label} className="p-3 text-center">
                <div className={`text-2xl font-bold ${s.cls}`}>{s.val}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
              </Card>
            ))}
          </div>
        )}

        {/* ─── Filters + bulk actions ─── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? "بحث باسم أو مُعرِّف..." : "Search by name or identifier..."}
              className="pr-9 text-sm"
              data-testid="input-search-participants"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 text-sm" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "جميع الحالات" : "All Statuses"}</SelectItem>
              <SelectItem value="unopened">{isAr ? "لم يُفتح" : "Unopened"}</SelectItem>
              <SelectItem value="opened">{isAr ? "فُتح" : "Opened"}</SelectItem>
              <SelectItem value="submitted_editable">{isAr ? "مُسجَّل ✏️" : "Submitted ✏️"}</SelectItem>
              <SelectItem value="submitted_locked">{isAr ? "مُسجَّل 🔒" : "Submitted 🔒"}</SelectItem>
            </SelectContent>
          </Select>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 border border-primary/30 rounded-lg px-3 py-1.5 bg-primary/5">
              <span className="text-xs font-medium text-primary">{selected.size} {isAr ? "محدد" : "selected"}</span>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => setEmailBatchDialog(true)}>
                <Mail className="h-3 w-3 ml-1" />{isAr ? "إرسال بريد" : "Email"}
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setNotifyBatchDialog(true)}>
                <MessageSquare className="h-3 w-3 ml-1" />{isAr ? "إشعار" : "Notify"}
              </Button>
              <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => setDeleteBulk(true)}>
                <Trash2 className="h-3 w-3 ml-1" />{isAr ? "حذف" : "Delete"}
              </Button>
            </div>
          )}
        </div>

        {/* ─── Table ─── */}
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">{participants.length === 0
                ? (isAr ? "لا يوجد مشاركون بعد. ابدأ بإضافة أو استيراد المشاركين." : "No participants yet. Add or import participants to get started.")
                : (isAr ? "لا توجد نتائج مطابقة للفلتر." : "No participants match the filter.")
              }</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">{isAr ? "الاسم" : "Name"}</th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">{isAr ? "المُعرِّف" : "Identifier"}</th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">{isAr ? "الحالة" : "Status"}</th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">Telegram</th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">{isAr ? "آخر إشعار" : "Last Notified"}</th>
                    <th className="px-3 py-3 text-right font-semibold text-xs text-slate-600 dark:text-slate-400">{isAr ? "الإجراءات" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filtered.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          data-testid={`checkbox-participant-${p.id}`}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-800 dark:text-slate-100 text-sm">{p.name}</div>
                        {p.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{p.notes}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.identifier ? (
                          <div>
                            <div className="text-xs text-slate-600 dark:text-slate-300">{p.identifier}</div>
                            <div className="text-[10px] text-muted-foreground">{idTypeLabel(p.identifierType)}</div>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={p.status} isAr={isAr} /></td>
                      <td className="px-3 py-2.5">
                        {p.telegramChatId ? (
                          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <Check className="h-3 w-3" />{isAr ? "مُفعَّل" : "Active"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{isAr ? "غير مُفعَّل" : "Not active"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                        {p.lastNotifiedAt ? (
                          <span title={new Date(p.lastNotifiedAt).toLocaleString(isAr ? "ar" : "en")}>
                            {new Date(p.lastNotifiedAt).toLocaleDateString(isAr ? "ar" : "en")}
                            {p.notifyCount ? <span className="mr-1 text-primary font-medium">×{p.notifyCount}</span> : null}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            title={isAr ? "نسخ الرابط" : "Copy link"}
                            onClick={() => copyLink(p.participantLink)}
                            data-testid={`button-copy-link-${p.id}`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            title={isAr ? "فتح الرابط" : "Open link"}
                            onClick={() => window.open(p.participantLink, "_blank")}
                            data-testid={`button-open-link-${p.id}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          {/* زر إرسال البريد الإلكتروني — يظهر فقط إذا كان نوع المُعرِّف email */}
                          {p.identifierType === "email" && p.identifier ? (
                            <Button
                              size="icon" variant="ghost"
                              className={`h-7 w-7 ${p.emailCount ? "text-green-500 hover:text-green-600" : "text-blue-500 hover:text-blue-600"}`}
                              title={p.emailCount
                                ? (isAr ? `إعادة إرسال (أُرسل ${p.emailCount} مرة — ${p.lastEmailedAt ? new Date(p.lastEmailedAt).toLocaleDateString(isAr ? "ar" : "en") : ""})` : `Resend (sent ${p.emailCount}×)`)
                                : (isAr ? `إرسال الرابط إلى ${p.identifier}` : `Send link to ${p.identifier}`)
                              }
                              disabled={sendEmailOneMut.isPending}
                              onClick={() => sendEmailOneMut.mutate(p.id)}
                              data-testid={`button-send-email-${p.id}`}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-slate-300 cursor-not-allowed"
                              title={isAr ? "لا يوجد بريد إلكتروني مُسجَّل" : "No email registered"}
                              disabled
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {p.telegramChatId && (
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-sky-500 hover:text-sky-600"
                              title={isAr ? "إرسال إشعار تيليغرام" : "Send Telegram notification"}
                              onClick={() => {
                                const msg = prompt(isAr ? "نص الرسالة:" : "Message:");
                                if (msg) notifyOneMut.mutate({ pid: p.id, message: msg });
                              }}
                              data-testid={`button-notify-${p.id}`}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            title={isAr ? "تعديل" : "Edit"}
                            onClick={() => setEditParticipant(p)}
                            data-testid={`button-edit-participant-${p.id}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600"
                            title={isAr ? "حذف" : "Delete"}
                            onClick={() => setDeleteId(p.id)}
                            data-testid={`button-delete-participant-${p.id}`}
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
      </div>

      {/* ─── Email Batch Confirm Dialog ─── */}
      <Dialog open={emailBatchDialog} onOpenChange={setEmailBatchDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              {isAr ? "إرسال روابط الدعوة بالبريد" : "Send Invite Links by Email"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {isAr
                ? `سيتم إرسال رابط التسجيل الشخصي بالبريد الإلكتروني لـ ${selected.size} مشارك محدد.`
                : `A personal registration link will be emailed to ${selected.size} selected participant(s).`}
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {isAr
                  ? "سيُرسل البريد فقط للمشاركين الذين نوع مُعرِّفهم «بريد إلكتروني» ولديهم عنوان مُسجَّل."
                  : "Only participants with identifier type \"email\" and a registered address will receive the email."}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEmailBatchDialog(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={sendEmailBatchMut.isPending}
              onClick={() => sendEmailBatchMut.mutate()}
            >
              {sendEmailBatchMut.isPending
                ? <><RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />{isAr ? "جاري الإرسال..." : "Sending..."}</>
                : <><Mail className="h-3.5 w-3.5 ml-1" />{isAr ? "إرسال" : "Send"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Email Batch Result Dialog ─── */}
      <Dialog open={emailResultDialog} onOpenChange={setEmailResultDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {isAr ? "نتيجة إرسال البريد" : "Email Send Results"}
            </DialogTitle>
          </DialogHeader>
          {emailBatchResult && (
            <div className="py-2 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-600">{emailBatchResult.sent}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{isAr ? "أُرسل" : "Sent"}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <div className="text-2xl font-bold text-slate-500">{emailBatchResult.noEmail}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{isAr ? "بدون بريد" : "No Email"}</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-500">{emailBatchResult.failed}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{isAr ? "فشل" : "Failed"}</div>
                </div>
              </div>
              {emailBatchResult.failures.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1.5">
                    {isAr ? "تفاصيل الأخطاء:" : "Error details:"}
                  </p>
                  <ul className="space-y-0.5">
                    {emailBatchResult.failures.slice(0, 5).map((f, i) => (
                      <li key={i} className="text-[11px] text-red-600 dark:text-red-400">{f}</li>
                    ))}
                    {emailBatchResult.failures.length > 5 && (
                      <li className="text-[11px] text-muted-foreground">
                        {isAr ? `...و ${emailBatchResult.failures.length - 5} أخرى` : `...and ${emailBatchResult.failures.length - 5} more`}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setEmailResultDialog(false)}>{isAr ? "إغلاق" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Add Participant Dialog ─── */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "إضافة مشارك جديد" : "Add New Participant"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{isAr ? "الاسم *" : "Name *"}</Label>
              <Input value={addName} onChange={e => setAddName(e.target.value)} placeholder={isAr ? "اسم المشارك" : "Participant name"} data-testid="input-add-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "نوع المُعرِّف" : "ID Type"}</Label>
                <Select value={addIdType} onValueChange={v => setAddIdType(v as any)}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">{isAr ? "بريد إلكتروني" : "Email"}</SelectItem>
                    <SelectItem value="phone">{isAr ? "هاتف" : "Phone"}</SelectItem>
                    <SelectItem value="national_id">{isAr ? "رقم هوية" : "National ID"}</SelectItem>
                    <SelectItem value="custom">{isAr ? "مخصص" : "Custom"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isAr ? "قيمة المُعرِّف" : "Identifier"}</Label>
                <Input value={addIdentifier} onChange={e => setAddIdentifier(e.target.value)} placeholder={addIdType === "email" ? "example@email.com" : ""} data-testid="input-add-identifier" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isAr ? "ملاحظات (اختياري)" : "Notes (optional)"}</Label>
              <Textarea value={addNotes} onChange={e => setAddNotes(e.target.value)} rows={2} data-testid="textarea-add-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button disabled={!addName.trim() || addMut.isPending} onClick={() => addMut.mutate({ name: addName, identifier: addIdentifier || undefined, identifierType: addIdType, notes: addNotes || undefined })} data-testid="button-add-confirm">
              {addMut.isPending && <RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />}
              {isAr ? "إضافة" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Participant Dialog ─── */}
      {editParticipant && (
        <Dialog open={!!editParticipant} onOpenChange={() => setEditParticipant(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isAr ? "تعديل بيانات المشارك" : "Edit Participant"}</DialogTitle>
            </DialogHeader>
            <EditParticipantForm
              participant={editParticipant}
              isAr={isAr}
              onSave={(data) => editMut.mutate({ pid: editParticipant.id, data })}
              saving={editMut.isPending}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ─── Import Dialog ─── */}
      <Dialog open={importDialog} onOpenChange={v => { setImportDialog(v); if (!v) { setImportFile(null); setImportResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "استيراد مشاركين من Excel" : "Import Participants from Excel"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">{isAr ? "يجب أن يحتوي الملف على عمود الاسم كأول عمود. الحد الأقصى 200 مشارك في المرة الواحدة." : "File must contain a Name column. Max 200 participants per import."}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => setImportFile(e.target.files?.[0] || null)}
            />
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-slate-400" />
              {importFile ? (
                <p className="text-sm font-medium">{importFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{isAr ? "اضغط لاختيار ملف Excel" : "Click to choose an Excel file"}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="overwrite"
                checked={importOverwrite}
                onChange={e => setImportOverwrite(e.target.checked)}
                className="h-3.5 w-3.5 rounded"
                data-testid="checkbox-import-overwrite"
              />
              <Label htmlFor="overwrite" className="text-xs cursor-pointer">{isAr ? "تحديث البيانات المكررة (بدلاً من تخطيها)" : "Update duplicates (instead of skipping)"}</Label>
            </div>
            {importResult && (
              <div className={`p-3 rounded-lg text-sm ${importResult.added || importResult.updated ? "bg-green-50 dark:bg-green-900/20 text-green-700" : "bg-slate-50 dark:bg-slate-800"}`}>
                <p className="font-medium">
                  {isAr
                    ? `✅ مضاف: ${importResult.added} | مُحدَّث: ${importResult.updated} | متخطَّى: ${importResult.skipped}`
                    : `✅ Added: ${importResult.added} | Updated: ${importResult.updated} | Skipped: ${importResult.skipped}`}
                </p>
                {importResult.errors?.length > 0 && (
                  <ul className="mt-2 text-xs text-red-600 space-y-0.5">
                    {importResult.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialog(false)}>{isAr ? "إغلاق" : "Close"}</Button>
            <Button disabled={!importFile || importLoading} onClick={doImport} data-testid="button-import-confirm">
              {importLoading && <RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />}
              {isAr ? "استيراد" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Notify All Dialog ─── */}
      <Dialog open={notifyDialog} onOpenChange={setNotifyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "إرسال إشعار لجميع من فعّلوا البوت" : "Notify All Active Telegram Users"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">{isAr ? "سيُرسَل الإشعار فقط للمشاركين الذين فعّلوا البوت ولم يُسجِّلوا بعد." : "Message will only be sent to participants who activated the bot and haven't submitted yet."}</p>
            <div className="space-y-1.5">
              <Label className="text-xs">{isAr ? "نص الرسالة" : "Message"}</Label>
              <Textarea value={notifyMsg} onChange={e => setNotifyMsg(e.target.value)} rows={4} placeholder={isAr ? "أدخل نص الرسالة..." : "Enter message..."} data-testid="textarea-notify-msg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyDialog(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button disabled={!notifyMsg.trim() || notifyAllMut.isPending} onClick={() => notifyAllMut.mutate()} data-testid="button-notify-confirm">
              {notifyAllMut.isPending && <RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />}
              <Send className="h-3.5 w-3.5 ml-1" />
              {isAr ? "إرسال" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Notify Batch Dialog ─── */}
      <Dialog open={notifyBatchDialog} onOpenChange={setNotifyBatchDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? `إرسال إشعار للمحددين (${selected.size})` : `Notify Selected (${selected.size})`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{isAr ? "نص الرسالة" : "Message"}</Label>
              <Textarea value={notifyBatchMsg} onChange={e => setNotifyBatchMsg(e.target.value)} rows={4} data-testid="textarea-notify-batch-msg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyBatchDialog(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button disabled={!notifyBatchMsg.trim() || notifyBatchMut.isPending} onClick={() => notifyBatchMut.mutate()} data-testid="button-notify-batch-confirm">
              {notifyBatchMut.isPending && <RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />}
              <Send className="h-3.5 w-3.5 ml-1" />
              {isAr ? "إرسال" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete single confirm ─── */}
      <Dialog open={!!deleteId} onOpenChange={v => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAr ? "حذف المشارك" : "Delete Participant"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{isAr ? "هل أنت متأكد؟ لا يمكن التراجع." : "Are you sure? This cannot be undone."}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} data-testid="button-delete-confirm">
              {isAr ? "حذف" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Bulk delete confirm ─── */}
      <Dialog open={deleteBulk} onOpenChange={setDeleteBulk}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAr ? `حذف ${selected.size} مشاركين` : `Delete ${selected.size} Participants`}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{isAr ? "هل أنت متأكد؟ لا يمكن التراجع." : "Are you sure? This cannot be undone."}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteBulk(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => bulkDeleteMut.mutate()} data-testid="button-bulk-delete-confirm">
              {isAr ? "حذف الكل" : "Delete All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function EditParticipantForm({ participant, isAr, onSave, saving }: {
  participant: Participant;
  isAr: boolean;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(participant.name);
  const [identifier, setIdentifier] = useState(participant.identifier || "");
  const [identifierType, setIdentifierType] = useState(participant.identifierType || "email");
  const [notes, setNotes] = useState(participant.notes || "");
  const [telegramChatId, setTelegramChatId] = useState(participant.telegramChatId || "");

  return (
    <div className="space-y-3 py-2">
      <div className="space-y-1.5">
        <Label className="text-xs">{isAr ? "الاسم *" : "Name *"}</Label>
        <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-edit-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{isAr ? "نوع المُعرِّف" : "ID Type"}</Label>
          <Select value={identifierType} onValueChange={setIdentifierType}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">{isAr ? "هاتف" : "Phone"}</SelectItem>
              <SelectItem value="national_id">{isAr ? "رقم هوية" : "National ID"}</SelectItem>
              <SelectItem value="custom">{isAr ? "مخصص" : "Custom"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{isAr ? "المُعرِّف" : "Identifier"}</Label>
          <Input value={identifier} onChange={e => setIdentifier(e.target.value)} data-testid="input-edit-identifier" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Telegram Chat ID</Label>
        <Input value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)} placeholder={isAr ? "اتركه فارغاً للمسح" : "Leave empty to clear"} data-testid="input-edit-telegram" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{isAr ? "ملاحظات" : "Notes"}</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} data-testid="textarea-edit-notes" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button disabled={!name.trim() || saving} onClick={() => onSave({ name, identifier: identifier || null, identifierType, notes: notes || null, telegramChatId: telegramChatId || null })} data-testid="button-edit-save">
          {saving && <RefreshCw className="h-3.5 w-3.5 ml-1 animate-spin" />}
          {isAr ? "حفظ" : "Save"}
        </Button>
      </div>
    </div>
  );
}
